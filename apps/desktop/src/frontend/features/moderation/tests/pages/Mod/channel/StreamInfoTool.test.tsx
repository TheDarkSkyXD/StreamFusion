import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import {
  installElectronAPIMock,
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from "../../../../../../../../tests/test-utils";
import { StreamInfoTool } from "@/features/moderation/components/screens/Mod/channel/workspace/StreamInfoTool";
import { ToolAccessGate } from "@/features/moderation/components/screens/Mod/channel/workspace/ToolAccessGate";
import { twitchToolAccess } from "@/features/moderation/adapters/electron/twitch-tool-access";
import { createDesktopChannelTools } from "@/features/moderation/adapters/electron/channel-tools";
import type { StreamInfo } from "@shared/moderation-types";
import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";

const info: StreamInfo = {
  broadcasterId: "123",
  title: "Current title",
  category: { id: "509658", name: "Just Chatting" },
  language: "en",
  tags: ["English", "Gaming"],
  contentClassificationLabels: ["MatureGame", "ProfanityVulgarity"],
  availableContentClassificationLabels: [
    {
      id: "ProfanityVulgarity",
      name: "Significant profanity",
      description: "Frequent strong language",
    },
    { id: "Gambling", name: "Gambling", description: "Games of chance" },
  ],
};
const execute = vi.fn<(command: TwitchApiCommand) => Promise<TwitchApiResult>>();
const search = vi.fn();
const openExternal = vi.fn();

beforeEach(() => {
  const api = installElectronAPIMock();
  execute.mockReset().mockImplementation(async (command) => ({
    ok: true,
    data: command.operation === "get-stream-info" ? info : { updated: true },
  }));
  search.mockReset().mockResolvedValue({
    success: true,
    data: [{ id: "32982", name: "Grand Theft Auto V", platform: "twitch" }],
    providers: { twitch: "complete", kick: "not-requested" },
  });
  openExternal.mockReset().mockResolvedValue(undefined);
  api.twitch.execute = execute;
  api.categories.search = search;
  api.openExternal = openExternal;
});

function renderTool() {
  return renderWithProviders(<StreamInfoTool channelId="123" channel="owner" refreshCounter={0} />);
}
function updates() {
  return execute.mock.calls.filter(([command]) => command.operation === "update-stream-info");
}

// Guards: broadcaster ownership and exact grants are independent of other moderation tools.
// Guards: only edited fields reach the backend; Twitch-managed labels cannot be overwritten.
// Guards: retries, double clicks, failed receipts/readback and stale searches never imply a successful save.
describe("stream info editor", () => {
  it("requests only broadcast scope and sends remote moderators to Twitch without a read", async () => {
    const requestScopes = vi.fn();
    const view = renderWithProviders(
      <ToolAccessGate
        access={twitchToolAccess([], true)["stream-info"]}
        channel="owner"
        requestScopes={requestScopes}
      >
        <StreamInfoTool channelId="123" channel="owner" refreshCounter={0} />
      </ToolAccessGate>
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Twitch" }));
    expect(requestScopes).toHaveBeenCalledWith(["channel:manage:broadcast"]);
    expect(execute).not.toHaveBeenCalled();
    view.rerender(
      <ToolAccessGate
        access={twitchToolAccess(["channel:manage:broadcast"], false)["stream-info"]}
        channel="owner"
        requestScopes={requestScopes}
      >
        <StreamInfoTool channelId="123" channel="owner" refreshCounter={0} />
      </ToolAccessGate>
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Twitch Mod View" }));
    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith("https://www.twitch.tv/moderator/owner")
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("saves edited fields, selected category and explicit label changes then reloads authoritative values", async () => {
    let release: ((result: TwitchApiResult) => void) | undefined;
    execute.mockImplementation(async (command) =>
      command.operation === "get-stream-info"
        ? { ok: true, data: info }
        : new Promise((resolve) => {
            release = resolve;
          })
    );
    renderTool();
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Updated title" } });
    fireEvent.change(screen.getByLabelText("Search categories"), {
      target: { value: "Grand Theft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Grand Theft Auto V" }));
    fireEvent.change(screen.getByLabelText("Tags", { exact: false, selector: "input" }), {
      target: { value: "Gaming, Español" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Significant profanity/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Gambling/ }));
    expect(screen.getByText(/MatureGame is managed by Twitch/)).toBeVisible();
    const save = screen.getByRole("button", { name: "Save stream info" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(updates()).toEqual([
      [
        {
          operation: "update-stream-info",
          broadcasterId: "123",
          settings: {
            title: "Updated title",
            categoryId: "32982",
            tags: ["Gaming", "Español"],
            contentClassificationLabels: [
              { id: "ProfanityVulgarity", enabled: false },
              { id: "Gambling", enabled: true },
            ],
          },
        },
      ],
    ]);
    await act(async () => release?.({ ok: true, data: { updated: true } }));
    await waitFor(() =>
      expect(
        execute.mock.calls.filter(([command]) => command.operation === "get-stream-info")
      ).toHaveLength(2)
    );
    expect(await screen.findByDisplayValue("Current title")).toBeVisible();
  });

  it("keeps a denied save as an error with its draft intact", async () => {
    execute.mockImplementation(async (command) =>
      command.operation === "get-stream-info"
        ? { ok: true, data: info }
        : { ok: false, error: { code: "forbidden", message: "Broadcast permission was revoked" } }
    );
    renderTool();
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Unsaved title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stream info" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Broadcast permission was revoked");
    expect(screen.getByDisplayValue("Unsaved title")).toBeVisible();
    expect(screen.queryByText(/Twitch accepted/)).toBeNull();
  });

  it("does not submit a dirty form when retrying failed category search", async () => {
    search.mockRejectedValue(new Error("Category search unavailable"));
    renderTool();
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Unsaved title" } });
    fireEvent.change(screen.getByLabelText("Search categories"), { target: { value: "Game" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(updates()).toHaveLength(0);
  });

  it("retains a reload error after Twitch accepts an update", async () => {
    let accepted = false;
    execute.mockImplementation(async (command) => {
      if (command.operation === "update-stream-info") {
        accepted = true;
        return { ok: true, data: { updated: true } };
      }
      return accepted
        ? { ok: false, error: { code: "unavailable", message: "Readback unavailable" } }
        : { ok: true, data: info };
    });
    renderTool();
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save stream info" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Readback unavailable");
    expect(screen.getByRole("button", { name: "Save stream info" })).toBeDisabled();
  });

  it("rejects malformed read data and a missing update receipt", async () => {
    const malformed = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const port = createDesktopChannelTools(malformed);
    await expect(port.streamInfo.get("123")).rejects.toThrow();
    await expect(port.streamInfo.update("123", { title: "Valid title" })).rejects.toThrow();
  });

  it("ignores category results for a replaced query", async () => {
    let resolveSearch: ((value: unknown) => void) | undefined;
    search.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      })
    );
    renderTool();
    const input = await screen.findByLabelText("Search categories");
    fireEvent.change(input, { target: { value: "Old query" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(input, { target: { value: "New query" } });
    await act(async () =>
      resolveSearch?.({
        success: true,
        data: [{ id: "1", name: "Stale result" }],
        providers: { twitch: "complete", kick: "not-requested" },
      })
    );
    expect(screen.queryByRole("button", { name: "Stale result" })).toBeNull();
    expect(updates()).toHaveLength(0);
  });

  it("blocks invalid tags without sending a provider mutation", async () => {
    renderTool();
    fireEvent.change(await screen.findByLabelText("Tags", { exact: false, selector: "input" }), {
      target: { value: "A tag with spaces" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("without spaces");
    expect(screen.getByRole("button", { name: "Save stream info" })).toBeDisabled();
    expect(updates()).toHaveLength(0);
  });
});
