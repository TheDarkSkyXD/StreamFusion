import { TWITCH_APP_SCOPES } from "@shared/auth-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  installElectronAPIMock,
  fireEvent,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../../../../../../../../tests/test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

const moderationState = vi.hoisted(() => ({
  value: {
    state: "authorized",
    role: "broadcaster",
    refresh: vi.fn(),
    grantedScopes: [],
    requestScopes: vi.fn(),
  } as
    | {
        state: "authorized";
        role: "broadcaster";
        refresh: () => void;
        grantedScopes?: readonly string[];
        requestScopes?: (scopes: string[]) => void;
      }
    | { state: "hidden" }
    | { state: "checking" }
    | { state: "unverifiable"; retry: () => void }
    | {
        state: "reconnect-required";
        role: "moderator";
        missingScopes: string[];
        reconnect: () => void;
      },
}));

vi.mock("@/features/moderation/components/hooks/useModerationAuthority", () => ({
  useModerationAuthority: () => moderationState.value,
}));

const kickChannelQuery = vi.hoisted(() => ({
  value: {
    data: {
      id: "987654",
      kickUserId: "123456",
      username: "xqc",
      displayName: "Xqc",
    },
    isPending: false,
    isError: false,
  },
}));

vi.mock("@/features/discovery/components/hooks/queries/useChannels", () => ({
  useChannelByUsername: () => kickChannelQuery.value,
}));

const authState = vi.hoisted(() => ({
  twitchUser: { id: "111", login: "me" } as { id: string; login: string } | null,
  kickUser: null as { id: number; username: string; slug: string } | null,
}));

const twitchExecute = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/components/state/auth-store", () => {
  const useStore = Object.assign(
    (selector: (s: typeof authState) => unknown) => selector(authState),
    { getState: () => authState }
  );
  return { useAuthStore: useStore };
});

// Child sections keep this test focused on the shell wiring.
vi.mock("@/features/moderation/components/screens/Mod/channel/ChannelModLogFeed", () => ({
  ChannelModLogFeed: ({ channelId, channelSlug }: { channelId: string; channelSlug: string }) => (
    <div data-testid="channel-mod-log-feed-stub" data-channel-slug={channelSlug}>
      {channelId}
    </div>
  ),
}));
vi.mock("@/features/moderation/components/screens/Mod/channel/ChannelBannedList", () => ({
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
vi.mock("@/features/moderation/components/screens/Mod/channel/ChannelEngagement", () => ({
  ChannelEngagement: ({ broadcasterId }: { broadcasterId: string }) => (
    <div data-testid="channel-engagement-stub">{broadcasterId}</div>
  ),
}));
vi.mock("@/features/moderation/components/screens/Mod/channel/ChannelUnbanRequests", () => ({
  ChannelUnbanRequests: ({ broadcasterId }: { broadcasterId: string }) => (
    <div data-testid="channel-unban-requests-stub">{broadcasterId}</div>
  ),
}));
vi.mock("@/features/moderation/components/screens/Mod/channel/ChannelModeratorsTable", () => ({
  ChannelModeratorsTable: () => null,
}));
vi.mock("@/features/moderation/components/screens/Mod/channel/ChannelVipsTable", () => ({
  ChannelVipsTable: () => null,
}));
vi.mock("@/features/moderation/components/screens/Mod/channel/RetentionCard", () => ({
  RetentionCard: ({ scope, title }: { scope: string; title: string }) => (
    <div data-testid={`retention-stub-${scope}`}>{title}</div>
  ),
}));
vi.mock("@/features/moderation/components/screens/Mod/channel/workspace/ModLivePanels", () => ({
  ModVideoPanel: ({
    platform,
    channel,
    channelId,
  }: {
    platform: string;
    channel: string;
    channelId: string;
  }) => (
    <div data-testid="mod-video-panel-boundary" data-platform={platform} data-channel={channel}>
      {channelId}
    </div>
  ),
  ModChatPanel: ({
    platform,
    channel,
    channelId,
  }: {
    platform: string;
    channel: string;
    channelId: string;
  }) => (
    <div data-testid="mod-chat-panel-boundary" data-platform={platform} data-channel={channel}>
      {channelId}
    </div>
  ),
}));
vi.mock("@/features/moderation/components/screens/Mod/channel/workspace/AutoModQueue", () => ({
  AutoModQueue: ({ channelId, channel }: { channelId: string; channel: string }) => (
    <div data-testid="automod-queue-boundary" data-channel={channel}>
      {channelId}
    </div>
  ),
}));

import { ModChannelPage } from "@/features/moderation/components/screens/Mod/channel/ModChannelPage";

// Guards: canonical Twitch and Kick identities reach media, history, retention, and AutoMod boundaries.
// Guards: own-channel workspaces survive authority checks while other channels remain permission-gated.
// Guards: platform-specific tools cannot leak into unsupported Kick or non-owner Twitch workspaces.
describe("ModChannelPage", () => {
  beforeEach(() => {
    localStorage.clear();
    moderationState.value = {
      state: "authorized",
      role: "broadcaster",
      refresh: vi.fn(),
      grantedScopes: TWITCH_APP_SCOPES,
      requestScopes: vi.fn(),
    };
    authState.twitchUser = { id: "111", login: "me" };
    authState.kickUser = null;
    kickChannelQuery.value = {
      data: {
        id: "987654",
        kickUserId: "123456",
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

  // Guards: the live workspace keeps default tools mounted and reveals optional Twitch tools on demand.
  // Guards: each media host receives the resolved canonical channel identity.
  it("renders the Twitch workspace with canonical media identities and reveals docked tools", async () => {
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "111", login: "me", displayName: "Me" },
    });
    renderWithProviders(<ModChannelPage platform="twitch" channel="me" />);
    await waitFor(() => expect(screen.getByTestId("mod-workspace")).toBeInTheDocument());
    expect(screen.getByTestId("channel-mod-log-feed-stub").textContent).toBe("111");
    expect(screen.getByTestId("mod-video-panel-boundary")).toHaveTextContent("111");
    expect(screen.getByTestId("mod-chat-panel-boundary")).toHaveTextContent("111");
    expect(screen.getByTestId("automod-queue-boundary")).toHaveTextContent("111");
    expect(screen.getByTestId("automod-queue-boundary")).toHaveAttribute("data-channel", "me");
    expect(screen.queryByTestId("retention-stub-channel:111")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retention" }));
    expect(screen.getByTestId("retention-stub-channel:111")).toBeInTheDocument();
    expect(screen.getByTestId("retention-stub-global")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Banned users" }));
    expect(screen.getByTestId("channel-banned-list-stub")).toHaveAttribute(
      "data-platform",
      "twitch"
    );

    fireEvent.click(screen.getByRole("button", { name: "Active engagement" }));
    expect(screen.getByTestId("channel-engagement-stub")).toBeInTheDocument();
  });

  it("keeps engagement dock available for a native handoff on remote channels", async () => {
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "999", login: "someone", displayName: "Someone" },
    });
    renderWithProviders(<ModChannelPage platform="twitch" channel="someone" />);
    await waitFor(() => expect(screen.getByTestId("mod-workspace")).toBeInTheDocument());
    expect(screen.getByTestId("automod-queue-boundary")).toHaveTextContent("999");
    expect(screen.getByRole("button", { name: "Pending unban requests" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Banned users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active engagement" })).toBeInTheDocument();
    expect(screen.queryByTestId("channel-engagement-stub")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pending unban requests" }));
    expect(screen.getByTestId("channel-unban-requests-stub")).toHaveTextContent("999");
  });

  // Guards: remote authority refresh retains live media instances while privileged tools close.
  it("keeps an already-open moderator workspace through transient verification", async () => {
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "999", login: "someone", displayName: "Someone" },
    });
    const { rerender } = renderWithProviders(
      <ModChannelPage platform="twitch" channel="someone" />
    );
    const video = await screen.findByTestId("mod-video-panel-boundary");
    const chat = screen.getByTestId("mod-chat-panel-boundary");
    fireEvent.click(screen.getByRole("button", { name: "Banned users" }));
    expect(screen.getByTestId("channel-banned-list-stub")).toBeInTheDocument();
    moderationState.value = { state: "checking" };
    rerender(<ModChannelPage platform="twitch" channel="someone" />);
    expect(screen.getByTestId("mod-video-panel-boundary")).toBe(video);
    expect(screen.getByTestId("mod-chat-panel-boundary")).toBe(chat);
    expect(screen.queryByTestId("channel-banned-list-stub")).not.toBeInTheDocument();
    moderationState.value = { state: "unverifiable", retry: vi.fn() };
    rerender(<ModChannelPage platform="twitch" channel="someone" />);
    expect(screen.getByTestId("mod-chat-panel-boundary")).toBe(chat);
    expect(screen.queryByTestId("channel-banned-list-stub")).not.toBeInTheDocument();
    // Guards: temporary authority loss hides privileged content without forgetting its open slot.
    moderationState.value = {
      state: "authorized",
      role: "broadcaster",
      refresh: vi.fn(),
      grantedScopes: TWITCH_APP_SCOPES,
      requestScopes: vi.fn(),
    };
    rerender(<ModChannelPage platform="twitch" channel="someone" />);
    expect(screen.getByTestId("channel-banned-list-stub")).toBeInTheDocument();
    expect(screen.getByTestId("mod-video-panel-boundary")).toBe(video);
    expect(screen.getByTestId("mod-chat-panel-boundary")).toBe(chat);
    moderationState.value = { state: "hidden" };
    rerender(<ModChannelPage platform="twitch" channel="someone" />);
    expect(screen.queryByTestId("mod-workspace")).not.toBeInTheDocument();
  });

  // Guards: owners retain video, chat, history, and retention while scope verification is pending.
  // Guards: unverified owner access cannot expose Twitch moderation endpoints.
  it("keeps the own Twitch workspace available while authority checking or unverifiable", async () => {
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "111", login: "me", displayName: "Me" },
    });
    moderationState.value = { state: "checking" };
    const { rerender } = renderWithProviders(<ModChannelPage platform="twitch" channel="me" />);

    await waitFor(() => expect(screen.getByTestId("mod-workspace")).toBeInTheDocument());
    expect(screen.getByTestId("mod-channel-authority-checking")).toBeInTheDocument();
    const retainedVideo = screen.getByTestId("mod-video-panel-boundary");
    const retainedChat = screen.getByTestId("mod-chat-panel-boundary");
    expect(screen.getByTestId("mod-video-panel-boundary")).toHaveTextContent("111");
    expect(screen.getByTestId("channel-mod-log-feed-stub")).toHaveTextContent("111");
    expect(screen.getByTestId("automod-queue-boundary")).toHaveTextContent("111");
    expect(screen.queryByRole("button", { name: "Banned users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Active engagement" })).not.toBeInTheDocument();

    const retry = vi.fn();
    moderationState.value = { state: "unverifiable", retry };
    rerender(<ModChannelPage platform="twitch" channel="me" />);
    expect(screen.getByTestId("mod-workspace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    moderationState.value = {
      state: "authorized",
      role: "broadcaster",
      refresh: vi.fn(),
      grantedScopes: TWITCH_APP_SCOPES,
      requestScopes: vi.fn(),
    };
    rerender(<ModChannelPage platform="twitch" channel="me" />);
    expect(screen.getByTestId("mod-video-panel-boundary")).toBe(retainedVideo);
    expect(screen.getByTestId("mod-chat-panel-boundary")).toBe(retainedChat);
  });

  // Guards: the dashboard uses Kick broadcaster user_id for moderation and the stable slug for retention.
  it("Kick page resolves the slug and queries history with the canonical broadcaster id", async () => {
    renderWithProviders(<ModChannelPage platform="kick" channel="Xqc" />);
    // No resolving state.
    expect(screen.queryByTestId("mod-channel-resolving")).not.toBeInTheDocument();
    expect(screen.getByTestId("mod-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("channel-mod-log-feed-stub").textContent).toBe("123456");
    expect(screen.getByTestId("channel-mod-log-feed-stub")).toHaveAttribute(
      "data-channel-slug",
      "Xqc"
    );
    expect(screen.getByTestId("retention-stub-channel:kick:xqc")).toBeInTheDocument();
    expect(screen.getByTestId("retention-stub-global")).toBeInTheDocument();
    expect(screen.queryByTestId("automod-queue-boundary")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Banned users" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("channel-banned-list-stub")).not.toBeInTheDocument();
    expect(screen.queryByTestId("channel-engagement-stub")).not.toBeInTheDocument();
  });

  // Guards: a Kick owner's canonical identity keeps the workspace available when reconnect is required.
  it("keeps the own Kick workspace available during reconnect without remote Twitch tools", async () => {
    const reconnect = vi.fn();
    authState.kickUser = { id: 123456, username: "owner", slug: "xqc" };
    moderationState.value = {
      state: "reconnect-required",
      role: "moderator",
      missingScopes: ["moderator:read:chatters"],
      reconnect,
    };

    renderWithProviders(<ModChannelPage platform="kick" channel="XQC" />);

    expect(screen.getByTestId("mod-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("mod-channel-reconnect-required")).toBeInTheDocument();
    expect(screen.getByTestId("mod-video-panel-boundary")).toHaveTextContent("123456");
    expect(screen.getByTestId("mod-chat-panel-boundary")).toHaveTextContent("123456");
    expect(screen.getByTestId("retention-stub-channel:kick:xqc")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Kick" }));
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Banned users" })).not.toBeInTheDocument();
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

  it("keeps another Twitch channel gated while authority is checking", async () => {
    moderationState.value = { state: "checking" };
    twitchExecute.mockResolvedValue({
      ok: true,
      data: { id: "999", login: "someone", displayName: "Someone" },
    });

    renderWithProviders(<ModChannelPage platform="twitch" channel="someone" />);

    expect(await screen.findByTestId("mod-channel-authority-checking")).toBeInTheDocument();
    expect(screen.queryByTestId("mod-workspace")).not.toBeInTheDocument();
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
