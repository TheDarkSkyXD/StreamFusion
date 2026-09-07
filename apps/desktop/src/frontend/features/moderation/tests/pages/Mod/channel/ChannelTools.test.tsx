import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  installElectronAPIMock,
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from "../../../../../../../../tests/test-utils";
import { twitchToolAccess } from "@/features/moderation/adapters/electron/twitch-tool-access";
import { createDesktopChannelTools } from "@/features/moderation/adapters/electron/channel-tools";
import { ChannelEngagement } from "@/features/moderation/components/screens/Mod/channel/ChannelEngagement";
import { ChannelToolsPanel } from "@/features/moderation/components/screens/Mod/channel/workspace/ChannelToolsPanel";
import { useModerationAuthority } from "@/features/moderation/components/hooks/useModerationAuthority";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { useDevModOverrideStore } from "@/features/moderation/components/state/dev-mod-override-store";
import type { TwitchApiCommand } from "@shared/twitch-api-types";

const execute = vi.fn();
const scopes = [
  "moderator:manage:shield_mode",
  "moderator:manage:automod_settings",
  "moderator:manage:blocked_terms",
  "channel:manage:polls",
  "channel:manage:predictions",
];
const levels = {
  aggression: 1,
  bullying: 1,
  disability: 1,
  misogyny: 1,
  raceEthnicityOrReligion: 1,
  sexBasedTerms: 1,
  sexualitySexOrGender: 1,
  swearing: 1,
};
const policy = { overallLevel: null, levels };
const prediction = {
  id: "p1",
  title: "Who wins?",
  status: "LOCKED",
  outcomes: [
    { id: "a", title: "Team A", channel_points: 200 },
    { id: "b", title: "Team B", channel_points: 100 },
  ],
};
const failure = {
  ok: false,
  error: { code: "unavailable", message: "Twitch temporarily unavailable" },
};

beforeEach(() => {
  const api = installElectronAPIMock();
  execute.mockReset();
  execute.mockImplementation(async (command: TwitchApiCommand) => ({
    ok: true,
    data:
      command.operation === "get-shield-mode"
        ? { active: true }
        : command.operation === "get-automod-settings"
          ? policy
          : command.operation === "get-blocked-terms"
            ? { items: [{ id: "term1", text: "blocked phrase" }], cursor: null }
            : { data: [] },
  }));
  api.twitch.execute = execute;
  useDevModOverrideStore.getState().reset();
  useAuthStore.setState({
    twitchUser: {
      id: "123",
      login: "owner",
      displayName: "Owner",
      profileImageUrl: "",
      createdAt: "",
      broadcasterType: "",
    },
  });
});

function tools(granted = scopes) {
  return (
    <ChannelToolsPanel
      channelId="123"
      actorId="123"
      channel="owner"
      refreshCounter={0}
      access={twitchToolAccess(granted, true)}
      requestScopes={vi.fn()}
    />
  );
}

// Guards: unrelated missing grants cannot hide permitted tools or broadcaster workspace access.
// Guards: failed/malformed reads remain errors, distinct from empty engagement or inactive Shield.
// Guards: mutations keep actor/target identity, confirm outcomes, prevent double submits and retain failures.
describe("existing channel tools", () => {
  it("checks each tool and separates read from manage grants", () => {
    const access = twitchToolAccess(
      ["moderator:read:unban_requests", "channel:manage:polls"],
      true
    );
    expect(access.unban).toMatchObject({ canRead: true, canManage: false });
    expect(access.polls).toMatchObject({ canRead: true, canManage: true });
    expect(access.predictions.canRead).toBe(false);
    expect(twitchToolAccess(scopes, false).polls.broadcasterOnly).toBe(true);
    expect(twitchToolAccess(["moderation:read"], false).bans.canRead).toBe(false);
  });

  it("allows verified own-channel entry with only a relevant tool scope", async () => {
    window.electronAPI.auth.tokenStatus = vi.fn().mockResolvedValue({
      connected: true,
      valid: true,
      userId: "123",
      scopes: ["moderator:manage:banned_users"],
    });
    const { result } = renderHook(() => useModerationAuthority("twitch", "123", "owner"));
    await waitFor(() => expect(result.current.state).toBe("authorized"));
    expect(result.current).toMatchObject({ grantedScopes: ["moderator:manage:banned_users"] });
  });

  it("keeps a prediction visible when the independent poll read fails", async () => {
    execute.mockImplementation(async (command: TwitchApiCommand) =>
      command.operation === "get-polls" ? failure : { ok: true, data: { data: [prediction] } }
    );
    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(failure.error.message);
    expect(await screen.findByText("Who wins?")).toBeInTheDocument();
    expect(screen.queryByTestId("channel-engagement-empty")).not.toBeInTheDocument();
  });

  it("rejects malformed engagement instead of treating it as empty", async () => {
    const port = createDesktopChannelTools(
      vi.fn().mockResolvedValue({ ok: true, data: { data: [{ id: "bad" }] } })
    );
    await expect(port.engagement.list("polls", "123")).rejects.toThrow("invalid tool response");
  });

  it("creates a poll once with entered choices and duration", async () => {
    let finish: (() => void) | undefined;
    execute.mockImplementation((command: TwitchApiCommand) =>
      command.operation === "create-poll"
        ? new Promise((resolve) => {
            finish = () => resolve({ ok: true, data: {} });
          })
        : Promise.resolve({ ok: true, data: { data: [] } })
    );
    renderWithProviders(
      <ChannelEngagement
        broadcasterId="123"
        access={twitchToolAccess(["channel:manage:polls"], true)}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Create Polls" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Which map?" } });
    fireEvent.change(screen.getByLabelText("Option 1"), { target: { value: "Forest" } });
    fireEvent.change(screen.getByLabelText("Option 2"), { target: { value: "Desert" } });
    const start = screen.getByRole("button", { name: "Start" });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(execute.mock.calls.filter(([command]) => command.operation === "create-poll")).toEqual([
      [
        {
          operation: "create-poll",
          broadcasterId: "123",
          title: "Which map?",
          choices: ["Forest", "Desert"],
          duration: 300,
        },
      ],
    ]);
    finish?.();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument()
    );
  });

  it("confirms the selected outcome and preserves failed resolution", async () => {
    execute.mockImplementation(async (command: TwitchApiCommand) =>
      command.operation === "end-prediction"
        ? failure
        : { ok: true, data: { data: command.operation === "get-predictions" ? [prediction] : [] } }
    );
    renderWithProviders(
      <ChannelEngagement broadcasterId="123" access={twitchToolAccess(scopes, true)} />
    );
    fireEvent.click((await screen.findAllByRole("button", { name: "Choose winner" }))[0]);
    expect(execute.mock.calls.some(([command]) => command.operation === "end-prediction")).toBe(
      false
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(failure.error.message);
    expect(execute).toHaveBeenCalledWith({
      operation: "end-prediction",
      broadcasterId: "123",
      predictionId: "p1",
      status: "RESOLVED",
      winningOutcomeId: "a",
    });
    expect(screen.getByRole("group", { name: "Confirm moderation action" })).toBeInTheDocument();
  });

  it("uses authoritative Shield state and keeps a failed toggle honest", async () => {
    execute.mockImplementation(async (command: TwitchApiCommand) =>
      command.operation === "set-shield-mode" ? failure : { ok: true, data: { active: true } }
    );
    renderWithProviders(tools(["moderator:manage:shield_mode"]));
    expect(screen.queryByText("Shield Mode is inactive.")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate Shield Mode" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(failure.error.message);
    expect(screen.getByText("Shield Mode is active.")).toBeInTheDocument();
    expect(execute).toHaveBeenCalledWith({
      operation: "set-shield-mode",
      broadcasterId: "123",
      moderatorId: "123",
      active: false,
    });
  });

  it("saves custom AutoMod categories without an overall-level override", async () => {
    renderWithProviders(tools(["moderator:manage:automod_settings"]));
    fireEvent.change(await screen.findByLabelText("Aggression"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save AutoMod level" }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({
        operation: "update-automod-settings",
        broadcasterId: "123",
        moderatorId: "123",
        settings: {
          aggression: 3,
          bullying: 1,
          disability: 1,
          misogyny: 1,
          race_ethnicity_or_religion: 1,
          sex_based_terms: 1,
          sexuality_sex_or_gender: 1,
          swearing: 1,
        },
      })
    );
  });

  it("keeps a blocked term when deletion fails", async () => {
    execute.mockImplementation(async (command: TwitchApiCommand) =>
      command.operation === "remove-blocked-term"
        ? failure
        : { ok: true, data: { items: [{ id: "term1", text: "blocked phrase" }], cursor: null } }
    );
    renderWithProviders(tools(["moderator:manage:blocked_terms"]));
    fireEvent.click(await screen.findByRole("button", { name: "Remove blocked phrase" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(failure.error.message);
    expect(screen.getByText("blocked phrase")).toBeInTheDocument();
  });
});
