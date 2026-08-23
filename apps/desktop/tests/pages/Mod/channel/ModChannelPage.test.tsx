import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

const moderationState = vi.hoisted(() => ({
  value: {
    state: "authorized",
    role: "broadcaster",
    refresh: vi.fn(),
  } as
    | { state: "authorized"; role: "broadcaster"; refresh: () => void }
    | { state: "hidden" }
    | {
        state: "reconnect-required";
        role: "moderator";
        missingScopes: string[];
        reconnect: () => void;
      },
}));

vi.mock("@/hooks/useModerationAuthority", () => ({
  useModerationAuthority: () => moderationState.value,
}));

const kickChannelQuery = vi.hoisted(() => ({
  value: {
    data: {
      id: "987654",
      username: "xqc",
      displayName: "Xqc",
    },
    isPending: false,
    isError: false,
  },
}));

vi.mock("@/hooks/queries/useChannels", () => ({
  useChannelByUsername: () => kickChannelQuery.value,
}));

const authState = vi.hoisted(() => ({
  twitchUser: { id: "111", login: "me" } as { id: string; login: string } | null,
  kickUser: null as { id: number; username: string; slug: string } | null,
}));

const twitchExecute = vi.hoisted(() => vi.fn());

vi.mock("@/store/auth-store", () => {
  const useStore = Object.assign(
    (selector: (s: typeof authState) => unknown) => selector(authState),
    { getState: () => authState }
  );
  return { useAuthStore: useStore };
});

// Child sections — keep this test focused on the shell wiring.
vi.mock("@/pages/Mod/channel/ChannelModLogFeed", () => ({
  ChannelModLogFeed: ({ channelId, channelSlug }: { channelId: string; channelSlug: string }) => (
    <div data-testid="channel-mod-log-feed-stub" data-channel-slug={channelSlug}>
      {channelId}
    </div>
  ),
}));
vi.mock("@/pages/Mod/channel/ChannelBannedList", () => ({
  ChannelBannedList: ({
    platform,
    broadcasterId,
  }: {
    platform: string;
    broadcasterId?: string;
  }) => (
    <div
      data-testid="channel-banned-list-stub"
      data-platform={platform}
      data-broadcaster={broadcasterId ?? ""}
    />
  ),
}));
vi.mock("@/pages/Mod/channel/ChannelEngagement", () => ({
  ChannelEngagement: ({ broadcasterId }: { broadcasterId: string }) => (
    <div data-testid="channel-engagement-stub">{broadcasterId}</div>
  ),
}));
vi.mock("@/pages/Mod/channel/ChannelUnbanRequests", () => ({
  ChannelUnbanRequests: () => null,
}));
vi.mock("@/pages/Mod/channel/ChannelModeratorsTable", () => ({
  ChannelModeratorsTable: () => null,
}));
vi.mock("@/pages/Mod/channel/ChannelVipsTable", () => ({
  ChannelVipsTable: () => null,
}));
vi.mock("@/pages/Mod/channel/RetentionCard", () => ({
  RetentionCard: ({ scope, title }: { scope: string; title: string }) => (
    <div data-testid={`retention-stub-${scope}`}>{title}</div>
  ),
}));

import { ModChannelPage } from "@/pages/Mod/channel/ModChannelPage";

describe("ModChannelPage", () => {
  beforeEach(() => {
    moderationState.value = {
      state: "authorized",
      role: "broadcaster",
      refresh: vi.fn(),
    };
    authState.twitchUser = { id: "111", login: "me" };
    authState.kickUser = null;
    kickChannelQuery.value = {
      data: {
        id: "987654",
        username: "xqc",
        displayName: "Xqc",
      },
      isPending: false,
      isError: false,
    };
    import.meta.env.VITE_TWITCH_CLIENT_ID = "cid";
    const api = installElectronAPIMock();
    twitchExecute.mockReset();
    twitchExecute.mockResolvedValue({ ok: true, data: null });
    api.twitch.execute = twitchExecute;
  });

  it("shows the resolving placeholder until Twitch channel resolves", async () => {
    // Hang the typed IPC request so we can observe the resolving state.
    twitchExecute.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<ModChannelPage platform="twitch" channel="ninja" />);
    expect(screen.getByTestId("mod-channel-resolving")).toBeInTheDocument();
  });

  it("renders Twitch sections after resolve (own-broadcaster path enables engagement)", async () => {
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "111", login: "me", displayName: "Me" },
    });
    renderWithProviders(<ModChannelPage platform="twitch" channel="me" />);
    await waitFor(() =>
      expect(screen.getByTestId("retention-stub-channel:111")).toBeInTheDocument()
    );
    expect(screen.getByTestId("retention-stub-global")).toBeInTheDocument();
    expect(screen.getByTestId("channel-mod-log-feed-stub").textContent).toBe("111");
    expect(screen.getByTestId("channel-banned-list-stub").getAttribute("data-platform")).toBe(
      "twitch"
    );
    expect(screen.getByTestId("channel-engagement-stub")).toBeInTheDocument();
  });

  it("hides engagement section when signed-in user is not the broadcaster", async () => {
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "999", login: "someone", displayName: "Someone" },
    });
    renderWithProviders(<ModChannelPage platform="twitch" channel="someone" />);
    await waitFor(() =>
      expect(screen.getByTestId("retention-stub-channel:999")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("channel-engagement-stub")).not.toBeInTheDocument();
  });

  // Guards: the dashboard uses the same canonical numeric Kick key as dialog reads and writers.
  it("Kick page resolves the slug and queries history with the canonical broadcaster id", async () => {
    renderWithProviders(<ModChannelPage platform="kick" channel="Xqc" />);
    // No resolving state.
    expect(screen.queryByTestId("mod-channel-resolving")).not.toBeInTheDocument();
    expect(screen.getByTestId("retention-stub-channel:kick:987654")).toBeInTheDocument();
    expect(screen.getByTestId("channel-mod-log-feed-stub").textContent).toBe("987654");
    expect(screen.getByTestId("channel-mod-log-feed-stub")).toHaveAttribute(
      "data-channel-slug",
      "Xqc"
    );
    expect(screen.getByTestId("channel-banned-list-stub").getAttribute("data-platform")).toBe(
      "kick"
    );
    // No engagement for Kick.
    expect(screen.queryByTestId("channel-engagement-stub")).not.toBeInTheDocument();
  });

  it("shows resolve-failed when Twitch /users returns 404", async () => {
    renderWithProviders(<ModChannelPage platform="twitch" channel="ghost" />);
    await waitFor(() =>
      expect(screen.getByTestId("mod-channel-resolve-failed")).toBeInTheDocument()
    );
  });

  it("does not mount dashboard data when authority is hidden", async () => {
    moderationState.value = { state: "hidden" };
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "999", login: "someone", displayName: "Someone" },
    });

    renderWithProviders(<ModChannelPage platform="twitch" channel="someone" />);

    expect(await screen.findByTestId("mod-channel-authority-hidden")).toBeInTheDocument();
    expect(screen.queryByTestId("channel-mod-log-feed-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("retention-stub-global")).not.toBeInTheDocument();
  });

  it("offers one platform reconnect without mounting dashboard data", async () => {
    const reconnect = vi.fn();
    moderationState.value = {
      state: "reconnect-required",
      role: "moderator",
      missingScopes: ["user:read:moderated_channels"],
      reconnect,
    };
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "999", login: "someone", displayName: "Someone" },
    });

    renderWithProviders(<ModChannelPage platform="twitch" channel="someone" />);

    const button = await screen.findByRole("button", {
      name: "Reconnect Twitch",
    });
    button.click();
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("channel-mod-log-feed-stub")).not.toBeInTheDocument();
  });
});
