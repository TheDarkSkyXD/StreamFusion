import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerError } from "@/components/player/types";
import { fixtures, renderWithProviders, routerMock, screen, waitFor } from "../test-utils";

const mockRouteParams = vi.hoisted(() => ({
  params: { platform: "twitch", channel: "ninja" },
}));

vi.mock("@tanstack/react-router", () => routerMock({ params: mockRouteParams.params }));

vi.mock("@/hooks/queries/useChannels", () => ({
  useChannelByUsername: vi.fn(),
}));

vi.mock("@/hooks/queries/useStreams", () => ({
  useStreamByChannel: vi.fn(),
  useFollowedStreams: vi.fn(),
  useTopStreams: vi.fn(),
}));

// Mutable holder so individual tests can flip the playback state (loading /
// offline / live) without re-registering vi.mock — the factory closes over the
// reference returned here.
const mockPlaybackState: {
  playback: { url: string } | null;
  isLoading: boolean;
  error: Error | null;
  reloadAttempts: number;
  playbackRevision: number;
} = { playback: null, isLoading: false, error: null, reloadAttempts: 0, playbackRevision: 0 };

const mockSetCurrentStream = vi.fn();
const mockSetIsOnStreamPage = vi.fn();
const mockUseStreamPlayback = vi.fn();
const playerMocks = vi.hoisted(() => ({
  twitchLivePlayerProps: null as null | {
    onError?: (error: PlayerError) => void;
    streamUrl?: string;
  },
  kickLivePlayerProps: null as null | {
    onError?: (error: PlayerError) => void;
    streamUrl?: string;
  },
}));
const mockReloadPlayback = vi.fn();

vi.mock("@/hooks/useStreamPlayback", () => ({
  useStreamPlayback: (platform: string, identifier: string) => {
    mockUseStreamPlayback(platform, identifier);
    return {
      get playback() {
        return mockPlaybackState.playback;
      },
      get isLoading() {
        return mockPlaybackState.isLoading;
      },
      get error() {
        return mockPlaybackState.error;
      },
      reload: mockReloadPlayback,
      isUsingProxy: false,
      retryWithoutProxy: vi.fn(),
      get reloadAttempts() {
        return mockPlaybackState.reloadAttempts;
      },
      get playbackRevision() {
        return mockPlaybackState.playbackRevision;
      },
    };
  },
}));

vi.mock("@/store/app-store", () => ({
  useAppStore: () => ({ isTheaterModeActive: false, setTheaterModeActive: vi.fn() }),
}));

vi.mock("@/store/pip-store", () => ({
  usePipStore: () => ({
    isPip: false,
    openPip: vi.fn(),
    closePip: vi.fn(),
    setCurrentStream: mockSetCurrentStream,
    setIsOnStreamPage: mockSetIsOnStreamPage,
    isOnStreamPage: false,
    currentStream: null,
  }),
}));

vi.mock("@/components/player/twitch", () => ({
  TwitchLivePlayer: (props: { onError?: (error: PlayerError) => void; streamUrl?: string }) => {
    playerMocks.twitchLivePlayerProps = props;
    return <div data-testid="twitch-live-player">player</div>;
  },
}));

vi.mock("@/components/player/kick", () => ({
  KickLivePlayer: (props: { onError?: (error: PlayerError) => void; streamUrl?: string }) => {
    playerMocks.kickLivePlayerProps = props;
    return <div data-testid="kick-live-player">player</div>;
  },
}));

vi.mock("@/components/chat", () => ({
  ChatPanel: () => <div data-testid="chat-panel">chat</div>,
}));

vi.mock("@/components/stream/related-content", () => ({
  RelatedContent: () => <div data-testid="related-content">related</div>,
}));

vi.mock("@/components/stream/stream-info", () => ({
  StreamInfo: ({ stream }: { stream?: { title?: string } }) => (
    <div data-testid="stream-info">{stream?.title ?? "no-title"}</div>
  ),
}));

import { useChannelByUsername } from "@/hooks/queries/useChannels";
import { useStreamByChannel } from "@/hooks/queries/useStreams";
import { StreamPage } from "@/pages/Stream";
import { DEFAULT_CHAT_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

const useChannelMock = vi.mocked(useChannelByUsername);
const useStreamMock = vi.mocked(useStreamByChannel);

// Restore chat-position pref between tests so the hide-panel test doesn't leak
// into the default-render assertions above.
function setChatPosition(position: "right" | "left" | "hidden") {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chat: { ...DEFAULT_CHAT_PREFERENCES, position },
    } as typeof s.preferences,
  }));
}

function routeChannel(
  overrides: Partial<import("@/backend/api/unified/platform-types").UnifiedChannel> = {}
) {
  return fixtures.channel({
    platform: mockRouteParams.params.platform as "twitch" | "kick",
    username: mockRouteParams.params.channel,
    displayName: mockRouteParams.params.channel,
    ...overrides,
  });
}

// Guards: loading state — while channel meta + HLS playback are pending, the player area mounts the platform loading spinner (Twitch purple / Kick green) so users see "loading", not "broken"
// Guards: offline state — channel exists but streamData.startedAt is null AND no playback URL → "is currently offline" panel with a Check Again button so the page is recoverable. Distinct from "error" (which uses the same panel but is gated by playerError) — both surfaces resolve to the same UI because users can't tell the cases apart
// Guards: error path — Twitch watchdog/offline hints do not refresh healthy live playback while metadata still says live.
// Guards: live playback rechecks are one-shot per playback revision, so repeated refreshable token/source errors do not spam reloads or remount the same bad URL.
// Guards: a new playback revision may recheck immediately; live playback recovery must not depend on a timer cooldown that can interrupt viewers later.
// Guards: stream-ended reloads clear stale playback only after metadata confirms offline; a transient Twitch playback "offline" error while metadata still says live does not reload.
// Guards: offline/player-error stream pages clear PiP state so a stale live stream cannot spawn the mini-player after route navigation.
// Guards: Kick live playback also rechecks before showing offline, so signed CDN gaps do not falsely mark a live channel offline.
// Guards: empty channelData (loading) doesn't blank the page — even before channelData resolves the player layout reserves space so the layout doesn't shift after data lands
// Guards: Twitch offline routes keep playback idle until metadata confirms live, avoiding repeated Usher 404s from the HLS loader
// Guards: stream routes refresh playback when metadata transitions from confirmed offline to confirmed live.
// Guards: Twitch offline overlay includes the channel's last known category/title metadata when the channel query has it
// Guards: stale channelData from the previous route cannot mount chat for the new route, preventing previous-channel subscriber badges from seeding the new channel.
describe("StreamPage", () => {
  beforeEach(() => {
    useChannelMock.mockReset();
    useStreamMock.mockReset();
    mockUseStreamPlayback.mockClear();
    mockRouteParams.params.platform = "twitch";
    mockRouteParams.params.channel = "ninja";
    setChatPosition("right");
    mockPlaybackState.playback = null;
    mockPlaybackState.isLoading = false;
    mockPlaybackState.error = null;
    mockPlaybackState.reloadAttempts = 0;
    mockPlaybackState.playbackRevision = 0;
    mockReloadPlayback.mockClear();
    playerMocks.twitchLivePlayerProps = null;
    playerMocks.kickLivePlayerProps = null;
    mockSetCurrentStream.mockClear();
    mockSetIsOnStreamPage.mockClear();
  });

  afterEach(() => {
    setChatPosition("right");
  });

  it("renders the Twitch live player + chat for a twitch route", async () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Going live" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };
    renderWithProviders(<StreamPage />);
    expect(await screen.findByTestId("twitch-live-player")).toBeInTheDocument();
    expect(await screen.findByTestId("chat-panel")).toBeInTheDocument();
  });

  it("keeps the chat content fixed at 340px without a resize handle", () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Going live" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    const { container } = renderWithProviders(<StreamPage />);

    expect(screen.getByTestId("stream-chat-rail")).toHaveStyle({
      width: "341px",
      minWidth: "341px",
      maxWidth: "341px",
    });
    expect(container.querySelector(".cursor-ew-resize")).toBeNull();
  });

  it("passes the loaded stream into StreamInfo", () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "My Title" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    renderWithProviders(<StreamPage />);
    expect(screen.getByTestId("stream-info")).toHaveTextContent("My Title");
  });

  it('hides the chat panel when chat position is "hidden" (U5)', async () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Going live" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };
    setChatPosition("hidden");
    renderWithProviders(<StreamPage />);
    // Player still renders; the chat panel (and the chat service it mounts) does not.
    expect(await screen.findByTestId("twitch-live-player")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("does not mount Twitch chat while channel data still belongs to the previous route", async () => {
    mockRouteParams.params.channel = "cinna";
    useChannelMock.mockReturnValue({
      data: fixtures.channel({
        id: "517475551",
        username: "extraemily",
        displayName: "ExtraEmily",
      }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Cinna live", channelName: "cinna" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/cinna.m3u8" };

    renderWithProviders(<StreamPage />);

    expect(await screen.findByTestId("twitch-live-player")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-panel")).toBeNull();
  });

  it("loading: shows the platform spinner while playback + channel + stream all resolve", () => {
    useChannelMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useStreamByChannel
    >);
    mockPlaybackState.isLoading = true;
    mockPlaybackState.playback = null;
    const { container } = renderWithProviders(<StreamPage />);
    // Loading spinner has class 'animate-spin' — search the rendered tree for it.
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    // The "offline" panel must NOT render while we're still loading.
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
  });

  it('offline: channel exists but stream is not live and no playback url → "is currently offline" panel with Check Again', () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({
        displayName: "OfflineGuy",
        categoryName: "Fortnite",
        lastStreamTitle: "Zero Build with chat",
      }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    // streamData with no startedAt → isStreamLive=false.
    useStreamMock.mockReturnValue({
      data: { ...fixtures.stream(), startedAt: null } as any,
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = null;
    renderWithProviders(<StreamPage />);
    expect(mockUseStreamPlayback).toHaveBeenCalledWith("twitch", "");
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
    expect(screen.getByText("Zero Build with chat")).toBeInTheDocument();
    expect(screen.getByText("Last streamed in Fortnite")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check again/i })).toBeInTheDocument();
    expect(mockSetCurrentStream).toHaveBeenCalledWith(null);
  });

  it("offline: stale playback url is suppressed so the offline screen renders instead of the player empty-source state", () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({
        displayName: "OfflineGuy",
        isLive: false,
        categoryName: "Fortnite",
        lastStreamTitle: "Zero Build with chat",
      }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: { ...fixtures.stream(), startedAt: null } as any,
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/offline.m3u8" };

    renderWithProviders(<StreamPage />);

    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
    expect(screen.queryByTestId("twitch-live-player")).toBeNull();
  });

  it("live: requests Twitch playback only after live metadata is present", () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useStreamByChannel>);

    renderWithProviders(<StreamPage />);

    expect(mockUseStreamPlayback).toHaveBeenCalledWith("twitch", "ninja");
  });

  it("refreshes playback when stream metadata transitions from offline to online", async () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: false }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: { ...fixtures.stream(), startedAt: null } as any,
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = null;

    const { rerender } = renderWithProviders(<StreamPage />);

    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
    expect(mockReloadPlayback).not.toHaveBeenCalled();

    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Back online", startedAt: "2026-07-02T23:10:00.000Z" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);

    rerender(<StreamPage />);

    await waitFor(() => expect(mockReloadPlayback).toHaveBeenCalledTimes(1));
  });

  it("error path (no playback url, no channel data) still surfaces the offline panel — same shape as offline so users see one consistent recovery affordance", () => {
    // Both the channel query and the stream query failed (data=undefined,
    // isLoading=false). The page degrades to the offline panel using the
    // route param as the channel name.
    useChannelMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useStreamByChannel
    >);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = null;
    renderWithProviders(<StreamPage />);
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });

  it("live playback fetch failure: shows offline after holding the bad source and schedules a recheck", async () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Just ended", startedAt: "2026-06-15T14:00:00.000Z" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = null;
    mockPlaybackState.error = new Error("Channel is offline");

    renderWithProviders(<StreamPage />);

    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
    await waitFor(() => expect(mockReloadPlayback).toHaveBeenCalledTimes(1));
  });

  it("refreshes Kick playback instead of showing offline when live metadata still says online", async () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "iceposeidon";
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ice Poseidon", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Cx House", startedAt: "2026-06-25T00:00:00.000Z" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = { url: "https://stream.kick.com/live.m3u8" };

    renderWithProviders(<StreamPage />);
    await screen.findByTestId("kick-live-player");

    act(() => {
      playerMocks.kickLivePlayerProps?.onError?.({
        code: "STREAM_OFFLINE",
        message: "Stream offline or unavailable",
        fatal: true,
      });
    });

    expect(mockReloadPlayback).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });

  it("keeps Twitch playback mounted without refreshing when watchdog reports missing fragments while metadata is live", async () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Going live", startedAt: "2026-06-25T00:00:00.000Z" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };

    renderWithProviders(<StreamPage />);
    await screen.findByTestId("twitch-live-player");

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "NO_FRAGMENTS",
        message: "No video fragments received after manifest load",
        fatal: true,
      });
    });

    expect(mockReloadPlayback).not.toHaveBeenCalled();
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
    expect(screen.getByTestId("twitch-live-player")).toBeInTheDocument();
  });

  it("does not spam Twitch reloads for repeated token errors on the same playback revision", async () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Going live", startedAt: "2026-06-25T00:00:00.000Z" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };
    mockPlaybackState.playbackRevision = 7;

    renderWithProviders(<StreamPage />);
    await screen.findByTestId("twitch-live-player");

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "TOKEN_EXPIRED",
        message: "Playback token expired",
        fatal: true,
        shouldRefresh: true,
      });
    });

    await waitFor(() => expect(screen.queryByTestId("twitch-live-player")).toBeNull());

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "TOKEN_EXPIRED",
        message: "Playback token expired",
        fatal: true,
        shouldRefresh: true,
      });
    });

    expect(mockReloadPlayback).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });

  it("allows an immediate Twitch recheck when the playback revision changes", async () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Going live", startedAt: "2026-06-25T00:00:00.000Z" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja-7.m3u8" };
    mockPlaybackState.playbackRevision = 7;

    const { rerender } = renderWithProviders(<StreamPage />);
    await screen.findByTestId("twitch-live-player");

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "TOKEN_EXPIRED",
        message: "Playback token expired",
        fatal: true,
        shouldRefresh: true,
      });
    });

    await waitFor(() => expect(screen.queryByTestId("twitch-live-player")).toBeNull());
    expect(mockReloadPlayback).toHaveBeenCalledTimes(1);

    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja-8.m3u8" };
    mockPlaybackState.playbackRevision = 8;
    rerender(<StreamPage />);

    await waitFor(() =>
      expect(playerMocks.twitchLivePlayerProps?.streamUrl).toBe(
        "https://usher.ttvnw.net/api/channel/hls/ninja-8.m3u8"
      )
    );

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "TOKEN_EXPIRED",
        message: "Playback token expired",
        fatal: true,
        shouldRefresh: true,
      });
    });

    expect(mockReloadPlayback).toHaveBeenCalledTimes(2);
  });

  it("refreshes Twitch playback when a recoverable Twitch error is reported", async () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Going live", startedAt: "2026-06-25T00:00:00.000Z" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };

    renderWithProviders(<StreamPage />);
    await screen.findByTestId("twitch-live-player");

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "TOKEN_EXPIRED",
        message: "Playback token expired",
        fatal: true,
        shouldRefresh: true,
      });
    });

    expect(mockReloadPlayback).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });

  it("primes PiP as soon as playback URL exists even while stream metadata is loading", () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = { url: "https://example.com/live.m3u8" };

    renderWithProviders(<StreamPage />);

    expect(mockSetCurrentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "twitch",
        channelName: "ninja",
        streamUrl: "https://example.com/live.m3u8",
      })
    );
  });
});
