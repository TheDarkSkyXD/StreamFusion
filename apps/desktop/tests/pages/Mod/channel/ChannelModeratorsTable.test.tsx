import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../test-utils";

const authState = vi.hoisted(() => ({
  twitchUser: { id: "111", login: "me" } as { id: string; login: string } | null,
}));

vi.mock("@/store/auth-store", () => {
  const useStore = (selector: (state: typeof authState) => unknown) => selector(authState);
  return { useAuthStore: useStore };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ChannelModeratorsTable } from "@/pages/Mod/channel/ChannelModeratorsTable";
import { useModeratedChannelsStore } from "@/features/moderation/data/moderated-channels-store";
import { toast } from "sonner";

const executeMock = vi.fn();
const moderator = (id: string, login: string, name: string) => ({
  user_id: id,
  user_login: login,
  user_name: name,
});

// Guards: moderator roster reads and add/remove writes use credential-free typed Twitch IPC commands.
// Guards: roster pagination, empty/error states, and live signed-in moderator authority stay synchronized.
describe("ChannelModeratorsTable", () => {
  beforeEach(() => {
    authState.twitchUser = { id: "111", login: "me" };
    useModeratedChannelsStore.getState().clear();
    const api = installElectronAPIMock();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ ok: true, data: { data: [], pagination: {} } });
    api.twitch.execute = executeMock;
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("renders moderators returned by IPC", async () => {
    executeMock.mockResolvedValue({
      ok: true,
      data: {
        data: [moderator("u1", "mod1", "Mod1"), moderator("u2", "mod2", "Mod2")],
        pagination: {},
      },
    });
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await screen.findByTestId("moderator-row-u1");
    expect(screen.getByText("Mod1")).toBeInTheDocument();
    expect(screen.getByText("Mod2")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    expect(await screen.findByText(/no moderators yet/i)).toBeInTheDocument();
  });

  it("shows the first-100 footer when a cursor exists", async () => {
    executeMock.mockResolvedValue({
      ok: true,
      data: { data: [moderator("u1", "mod1", "Mod1")], pagination: { cursor: "next" } },
    });
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    expect(await screen.findByText(/showing first 100/i)).toBeInTheDocument();
  });

  it("resolves a username and adds that moderator", async () => {
    executeMock.mockImplementation(async (command) => {
      if (command.operation === "get-moderators") {
        return { ok: true, data: { data: [], pagination: {} } };
      }
      if (command.operation === "resolve-channel") {
        return { ok: true, data: { id: "u9", login: "new_mod", displayName: "NewMod" } };
      }
      return { ok: true, data: null };
    });
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await screen.findByText(/no moderators yet/i);
    fireEvent.change(screen.getByLabelText(/add moderator by username/i), {
      target: { value: "new_mod" },
    });
    fireEvent.click(screen.getByTestId("add-moderator-button"));

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith({
        operation: "add-moderator",
        broadcasterId: "222",
        userId: "u9",
      })
    );
    expect(await screen.findByTestId("moderator-row-u9")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
  });

  it("marks the channel moderated when the signed-in user is added", async () => {
    executeMock.mockImplementation(async (command) => {
      if (command.operation === "get-moderators") {
        return { ok: true, data: { data: [], pagination: {} } };
      }
      if (command.operation === "resolve-channel") {
        return { ok: true, data: { id: "111", login: "me", displayName: "Me" } };
      }
      return { ok: true, data: null };
    });
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await screen.findByText(/no moderators yet/i);
    fireEvent.change(screen.getByLabelText(/add moderator by username/i), {
      target: { value: "me" },
    });
    fireEvent.click(screen.getByTestId("add-moderator-button"));
    await waitFor(() =>
      expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("222")).toBe(true)
    );
  });

  it("toasts when username resolution returns no user", async () => {
    executeMock.mockImplementation(async (command) =>
      command.operation === "get-moderators"
        ? { ok: true, data: { data: [], pagination: {} } }
        : { ok: true, data: null }
    );
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await screen.findByText(/no moderators yet/i);
    fireEvent.change(screen.getByLabelText(/add moderator by username/i), {
      target: { value: "ghost" },
    });
    fireEvent.click(screen.getByTestId("add-moderator-button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("removes a moderator and drops the row", async () => {
    executeMock.mockImplementation(async (command) =>
      command.operation === "get-moderators"
        ? { ok: true, data: { data: [moderator("u1", "mod1", "Mod1")], pagination: {} } }
        : { ok: true, data: null }
    );
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await screen.findByTestId("moderator-row-u1");
    fireEvent.click(screen.getByTestId("remove-moderator-button-u1"));
    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith({
        operation: "remove-moderator",
        broadcasterId: "222",
        userId: "u1",
      })
    );
    expect(screen.queryByTestId("moderator-row-u1")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
  });

  it("clears live mod state when the signed-in moderator is removed", async () => {
    useModeratedChannelsStore.getState().setTwitchChannelModState("222", true);
    executeMock.mockImplementation(async (command) =>
      command.operation === "get-moderators"
        ? { ok: true, data: { data: [moderator("111", "me", "Me")], pagination: {} } }
        : { ok: true, data: null }
    );
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await screen.findByTestId("moderator-row-111");
    fireEvent.click(screen.getByTestId("remove-moderator-button-111"));
    await waitFor(() =>
      expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds.has("222")).toBe(false)
    );
  });

  it("surfaces an IPC load error", async () => {
    executeMock.mockResolvedValue({
      ok: false,
      error: { code: "unauthorized", message: "nope" },
    });
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    expect(await screen.findByTestId("channel-moderators-error")).toBeInTheDocument();
  });
});
