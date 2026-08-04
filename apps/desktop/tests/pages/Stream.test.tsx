import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerError } from "@/components/player/types";
import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  userEvent,
  waitFor,
} from "../test-utils";

const mockRouteParams = vi.hoisted(() => ({
  params: { platform: "twitch", channel: "ninja" },
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockRemoveFollowedStreamFromCache = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  ...routerMock({ params: mockRouteParams.params }),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/queries/useChannels", () => ({
  useChannelByUsername: vi.fn(),
}));

vi.mock("@/hooks/queries/useStreams", () => ({
  useStreamByChannel: vi.fn(),
  useFollowedStreams: vi.fn(),
  useTopStreams: vi.fn(),
  removeFollowedStreamFromCache: mockRemoveFollowedStreamFromCache,
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
  RelatedContent: ({
    channelData,
    streamStartedAt,
  }: {
    channelData?: { username?: string } | null;
    streamStartedAt?: string | null;
  }) => (
    <div
      data-testid="related-content"
      data-channel={channelData?.username ?? "none"}
      data-stream-started-at={streamStartedAt ?? "none"}
    >
      related
    </div>
  ),
}));

vi.mock("@/components/stream/stream-info", () => ({
  StreamInfo: ({
    channel,
    stream,
    recordingAction,
  }: {
    channel?: { username?: string; displayName?: string } | null;
    stream?: { channelName?: string; title?: string } | null;
    recordingAction?: ReactNode;
  }) => (
    <div>
      <div
        data-testid="stream-info"
        data-channel={channel?.username ?? "none"}
        data-display-name={channel?.displayName ?? "none"}
        data-stream-channel={stream?.channelName ?? "none"}
      >
        {stream?.title ?? "no-title"}
      </div>
      {recordingAction}
    </div>
  ),
}));

import { useChannelByUsername } from "@/hooks/queries/useChannels";
import { useStreamByChannel } from "@/hooks/queries/useStreams";
import { PersistentPlayerShell } from "@/components/player/persistent-player-shell";
import { StreamPage } from "@/pages/Stream";
import {
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_CHAT_PREFERENCES,
} from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

const useChannelMock = vi.mocked(useChannelByUsername);
const useStreamMock = vi.mocked(useStreamByChannel);
type ChannelQueryResult = ReturnType<typeof useChannelByUsername>;
type StreamQueryResult = ReturnType<typeof useStreamByChannel>;
type StreamRefetchResult = Awaited<ReturnType<StreamQueryResult["refetch"]>>;

function partialQueryResult<TResult extends object>(result: Partial<TResult>): TResult {
  return result as TResult;
}

const mockRefetchChannel = vi.fn<ChannelQueryResult["refetch"]>();
const mockRefetchStream = vi.fn<StreamQueryResult["refetch"]>();

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

function setChatWidthPx(chatWidthPx: 280 | 340 | 420) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chatDisplay: {
        ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
        ...(s.preferences?.chatDisplay ?? {}),
        chatWidthPx,
      },
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
// Guards: offline state — confirmed offline metadata with no playback URL shows an "is currently offline" panel with a Check Again button so the page is recoverable
// Guards: terminal Twitch stream-status errors outrank sibling channel loading and show a retryable failure without falsely claiming the channel is offline
// Guards: authoritative Twitch live status retries playback immediately even while sibling channel metadata is still loading
// Guards: Twitch watchdog hints reload playback once only after a route-matched status recheck confirms the stream is still live.
// Guards: failed Twitch watchdog status rechecks release the same-revision gate for a later hint without reloading playback.
// Guards: live playback rechecks are one-shot per playback revision, so repeated refreshable token/source errors do not spam reloads or remount the same bad URL.
// Guards: a new playback revision may recheck immediately; live playback recovery must not depend on a timer cooldown that can interrupt viewers later.
// Guards: stream-ended reloads clear stale playback only after metadata confirms offline; a transient Twitch playback "offline" error while metadata still says live does not reload.
// Guards: offline/player-error stream pages clear PiP state so a stale live stream cannot spawn the mini-player after route navigation.
// Guards: Kick live playback also rechecks before showing offline, so signed CDN gaps do not falsely mark a live channel offline.
// Guards: Kick player-ended signals verify current stream metadata before refreshing playback, and confirmed offline status clears the stale followed-stream row immediately.
// Guards: valid Kick HLS playback outranks null stream lookups and stale route-matched offline channel cache
// Guards: ambiguous Kick metadata plus terminal playback failure renders a retryable load error instead of a permanent black player
// Guards: empty channelData (loading) doesn't blank the page — even before channelData resolves the player layout reserves space so the layout doesn't shift after data lands
// Guards: Twitch offline routes keep playback idle until metadata confirms live, avoiding repeated Usher 404s from the HLS loader
// Guards: confirmed offline Twitch stream metadata stops playback resolution, unmounts stale playback, and shows the offline screen even while channel metadata still says live
// Guards: checking a confirmed-offline Twitch stream refetches channel and stream metadata without restarting playback or dismissing the offline screen
// Guards: a transient Twitch status refresh failure keeps already-playing route-matched live playback mounted when cached channel metadata disagrees
// Guards: fresh Twitch offline confirmation immediately replaces stale playback even while the matching channel record is still loading
// Guards: authoritative Twitch offline status never leaks previous-route placeholder identity or presentation metadata into the overlay
// Guards: stream routes refresh playback when metadata transitions from confirmed offline to confirmed live.
// Guards: Twitch offline overlay includes the channel's last known category/title metadata when the channel query has it
// Guards: stale channelData from the previous route cannot mount chat for the new route, preventing previous-channel subscriber badges from seeding the new channel.
// Guards: a rapid Twitch route change treats prior-channel placeholder status as loading, without resolving playback or showing the new channel offline
// Guards: previous-route placeholder channel and stream records never reach StreamInfo or RelatedContent.
// Guards: fresh channel identity redirects stale renamed-channel routes to the canonical platform username.
// Guards: stream pages prefer provider-cased display names over lowercase login fallbacks.
// Guards: the main Stream chat rail immediately applies each saved appearance width as its border-box outer width.
// Guards: successful non-placeholder Twitch stream data for another route cannot falsely confirm the current channel offline
// Guards: changing Twitch routes clears the previous player's fatal error so the new channel can show its loading state
// Guards: playable live Stream pages start direct-to-file recording with the provider's stable live Stream identity
describe("StreamPage", () => {
  beforeEach(() => {
    useChannelMock.mockReset();
    useStreamMock.mockReset();
    mockUseStreamPlayback.mockClear();
    mockRefetchChannel.mockReset();
    mockRefetchStream.mockReset();
    mockRouteParams.params.platform = "twitch";
    mockRouteParams.params.channel = "ninja";
    setChatPosition("right");
    setChatWidthPx(340);
    mockPlaybackState.playback = null;
    mockPlaybackState.isLoading = false;
    mockPlaybackState.error = null;
    mockPlaybackState.reloadAttempts = 0;
    mockPlaybackState.playbackRevision = 0;
    mockReloadPlayback.mockClear();
    mockNavigate.mockReset();
    mockRemoveFollowedStreamFromCache.mockClear();
    playerMocks.twitchLivePlayerProps = null;
    playerMocks.kickLivePlayerProps = null;
    mockSetCurrentStream.mockClear();
    mockSetIsOnStreamPage.mockClear();
  });

  afterEach(() => {
    act(() => {
      setChatPosition("right");
      setChatWidthPx(340);
    });
  });

  it("renders the Twitch live player + chat for a twitch route", async () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ channelName: "ninja", title: "Going live" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };
    renderWithProviders(<StreamPage />);
    expect(await screen.findByTestId("twitch-live-player")).toBeInTheDocument();
    expect(await screen.findByTestId("chat-panel")).toBeInTheDocument();
  });

  it("starts a playable live Stream with its stable provider identity", async () => {
    const api = installElectronAPIMock();
    api.streamRecording.start = vi.fn(async () => ({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    }));
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({
        id: "stream-live-123",
        channelName: "ninja",
        title: "Going live",
        isLive: true,
      }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };
    const user = userEvent.setup();

    renderWithProviders(<StreamPage />);

    await user.click(screen.getByRole("button", { name: "Record stream" }));
    await user.click(screen.getByRole("button", { name: "Choose save location" }));

    expect(api.streamRecording.start).toHaveBeenCalledWith({
      platform: "twitch",
      channelName: "ninja",
      streamId: "stream-live-123",
      title: "Going live",
      desiredQuality: { quality: "Source", isSource: true },
    });
  });

  // Guards: the real app-shell path renders only a dock for persistent playback, never a second route-owned live player.
  it("reserves the persistent player dock without mounting a duplicate route player", () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ channelName: "ninja", title: "Going live" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };

    const { container } = renderWithProviders(
      <PersistentPlayerShell>
        <StreamPage />
      </PersistentPlayerShell>
    );

    expect(container.querySelector("#persistent-live-player-dock")).toBeInTheDocument();
    expect(screen.queryByTestId("twitch-live-player")).toBeNull();
  });

  it("immediately sizes the outer chat rail to each saved width preset", () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ title: "Going live" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    useAuthStore.setState({ preferences: null });
    const { container } = renderWithProviders(<StreamPage />);
    const chatRail = screen.getByTestId("stream-chat-rail");

    expect(chatRail).toHaveStyle({
      width: "340px",
      minWidth: "340px",
      maxWidth: "340px",
      boxSizing: "border-box",
    });

    for (const outerWidth of [280, 340, 420] as const) {
      act(() => setChatWidthPx(outerWidth));

      expect(chatRail).toHaveStyle({
        width: `${outerWidth}px`,
        minWidth: `${outerWidth}px`,
        maxWidth: `${outerWidth}px`,
        boxSizing: "border-box",
      });
    }

    expect(container.querySelector(".cursor-ew-resize")).toBeNull();
  });

  it("passes the loaded stream into StreamInfo", () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ channelName: "ninja", title: "My Title" }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    renderWithProviders(<StreamPage />);
    expect(screen.getByTestId("stream-info")).toHaveTextContent("My Title");
  });

  it("shows the provider-cased Kick display name when channel metadata only repeats the slug", () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "abbyapple";
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "abbyapple" }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({
        platform: "kick",
        channelName: "abbyapple",
        channelDisplayName: "AbbyApple",
        isLive: true,
      }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);

    renderWithProviders(<StreamPage />);

    expect(screen.getByTestId("stream-info")).toHaveAttribute("data-display-name", "AbbyApple");
  });

  it("keeps the provider-cased display name on the Kick offline overlay", () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "abbyapple";
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "abbyapple", isLive: false }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({
        platform: "kick",
        channelName: "abbyapple",
        channelDisplayName: "AbbyApple",
        isLive: false,
        startedAt: null,
      }),
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);

    renderWithProviders(<StreamPage />);

    const offlineStatus = screen.getByText("is currently offline");
    expect(offlineStatus.previousElementSibling).toHaveTextContent("AbbyApple");
  });

  it('hides the chat panel when chat position is "hidden" (U5)', async () => {
    useChannelMock.mockReturnValue({ data: routeChannel(), isLoading: false } as ReturnType<
      typeof useChannelByUsername
    >);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ channelName: "ninja", title: "Going live" }),
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

  it("keeps Twitch playback idle while a rapid route change still exposes prior-channel placeholder data", () => {
    mockRouteParams.params.channel = "cinna";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: fixtures.channel({
          platform: "twitch",
          username: "forsen",
          displayName: "Forsen",
          isLive: true,
        }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: true,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({
          platform: "twitch",
          channelName: "forsen",
          channelDisplayName: "Forsen",
          isLive: true,
        }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: true,
      })
    );
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/forsen.m3u8" };

    const { container } = renderWithProviders(<StreamPage />);

    expect(mockUseStreamPlayback).toHaveBeenLastCalledWith("twitch", "");
    expect(screen.queryByTestId("twitch-live-player")).toBeNull();
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("does not pass previous-route placeholder metadata to stream details", async () => {
    mockRouteParams.params.channel = "cinna";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: fixtures.channel({
          platform: "twitch",
          username: "forsen",
          displayName: "Forsen",
        }),
        isLoading: false,
        isPlaceholderData: true,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({
          platform: "twitch",
          channelName: "forsen",
          title: "Previous route title",
          startedAt: "2026-08-01T12:00:00.000Z",
        }),
        isLoading: false,
        isPlaceholderData: true,
      })
    );

    renderWithProviders(<StreamPage />);

    expect(screen.getByTestId("stream-info")).toHaveAttribute("data-channel", "none");
    expect(screen.getByTestId("stream-info")).toHaveAttribute("data-stream-channel", "none");
    const relatedContent = await screen.findByTestId("related-content");
    expect(relatedContent).toHaveAttribute("data-channel", "none");
    expect(relatedContent).toHaveAttribute("data-stream-started-at", "none");
  });

  it("replaces a stale renamed-channel route with the canonical username", async () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "old-slug";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: fixtures.channel({
          id: "456",
          platform: "kick",
          username: "new-slug",
          displayName: "New Slug",
        }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );

    renderWithProviders(<StreamPage />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/stream/$platform/$channel",
        params: { platform: "kick", channel: "new-slug" },
        replace: true,
      })
    );
  });

  it("shows a retryable status error for successful Twitch stream data from the wrong route", () => {
    mockRouteParams.params.channel = "cinna";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: undefined,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({
          platform: "twitch",
          channelName: "forsen",
          channelDisplayName: "Forsen",
          isLive: true,
        }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = null;
    mockPlaybackState.isLoading = false;
    mockPlaybackState.error = null;

    const { container } = renderWithProviders(<StreamPage />);

    expect(screen.queryByText(/is currently offline/i)).toBeNull();
    expect(screen.queryByTestId("twitch-live-player")).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.getByText(/unable to check stream status/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check again/i })).toBeInTheDocument();
  });

  it("does not carry a fatal Twitch player error into the next route's loading state", async () => {
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: routeChannel({ displayName: "Ninja", isLive: true }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({ channelName: "ninja", isLive: true }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };

    const { container, rerender } = renderWithProviders(<StreamPage />);
    await screen.findByTestId("twitch-live-player");

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "MEDIA_ERROR",
        message: "Ninja media failed",
        fatal: true,
      });
    });

    mockRouteParams.params.channel = "cinna";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: undefined,
        isLoading: true,
        isError: false,
        isSuccess: false,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: undefined,
        isLoading: true,
        isError: false,
        isSuccess: false,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = null;

    rerender(<StreamPage />);

    expect(mockUseStreamPlayback).toHaveBeenLastCalledWith("twitch", "");
    expect(screen.queryByTestId("twitch-live-player")).toBeNull();
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
    expect(screen.queryByText("Ninja media failed")).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
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
    // Stream metadata explicitly confirms the channel is offline.
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ isLive: false, startedAt: null }),
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
      data: fixtures.stream({ isLive: false, startedAt: null }),
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

  it("keeps existing Twitch playback mounted when a transient stream refresh error leaves conflicting cached metadata", () => {
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: routeChannel({ displayName: "Ninja", isLive: false }),
        isLoading: false,
        isError: false,
        isSuccess: true,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({
          channelName: "ninja",
          isLive: true,
          startedAt: null,
        }),
        isLoading: false,
        isError: true,
        isSuccess: false,
        isPlaceholderData: false,
        error: new Error("Transient Twitch status refresh failure"),
      })
    );
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };

    renderWithProviders(<StreamPage />);

    expect(mockUseStreamPlayback).toHaveBeenLastCalledWith("twitch", "ninja");
    expect(screen.getByTestId("twitch-live-player")).toBeInTheDocument();
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
  });

  it("refreshes playback when stream metadata transitions from offline to online", async () => {
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ninja", isLive: false }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({
      data: fixtures.stream({ isLive: false, startedAt: null }),
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

  it("shows the Twitch offline screen when stream metadata turns offline before stale channel metadata", async () => {
    const user = userEvent.setup();
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: routeChannel({ displayName: "Ninja", isLive: true }),
        isLoading: false,
        refetch: mockRefetchChannel,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({
          channelName: "ninja",
          title: "Last live title",
          startedAt: "2026-07-30T12:00:00.000Z",
        }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
        refetch: mockRefetchStream,
      })
    );
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };

    const { rerender } = renderWithProviders(<StreamPage />);

    expect(await screen.findByTestId("twitch-live-player")).toBeInTheDocument();

    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
        refetch: mockRefetchStream,
      })
    );

    rerender(<StreamPage />);

    expect(mockUseStreamPlayback).toHaveBeenLastCalledWith("twitch", "");
    await waitFor(() => expect(screen.queryByTestId("twitch-live-player")).toBeNull());
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /check again/i }));

    expect(mockRefetchChannel).toHaveBeenCalledTimes(1);
    expect(mockRefetchStream).toHaveBeenCalledTimes(1);
    expect(mockReloadPlayback).not.toHaveBeenCalled();
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });

  it("shows Twitch offline immediately when fresh stream status is null while channel metadata still loads", () => {
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: undefined,
        isLoading: true,
        isError: false,
        isSuccess: false,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };

    const { container } = renderWithProviders(<StreamPage />);

    expect(mockUseStreamPlayback).toHaveBeenLastCalledWith("twitch", "");
    expect(screen.queryByTestId("twitch-live-player")).toBeNull();
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("uses the current Twitch route identity when offline status outruns stale channel placeholder data", () => {
    mockRouteParams.params.channel = "cinna";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: fixtures.channel({
          platform: "twitch",
          username: "forsen",
          displayName: "Forsen",
          isLive: true,
          bannerUrl: "https://example.com/forsen-offline-banner.jpg",
          categoryName: "Previous Route Category",
          lastStreamTitle: "Previous route title",
        }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: true,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = null;
    mockPlaybackState.isLoading = false;

    renderWithProviders(<StreamPage />);

    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
    expect(screen.getByText("cinna")).toBeInTheDocument();
    expect(screen.queryByText("Forsen")).toBeNull();
    expect(screen.queryByText("Previous Route Category")).toBeNull();
    expect(screen.queryByText("Previous route title")).toBeNull();
    expect(screen.queryByAltText("Offline banner")).toBeNull();
  });

  it("shows a retryable status-check failure when both Twitch metadata queries fail", async () => {
    const user = userEvent.setup();
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: undefined,
        isLoading: false,
        isError: true,
        isSuccess: false,
        isPlaceholderData: false,
        refetch: mockRefetchChannel,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: undefined,
        isLoading: false,
        isError: true,
        isSuccess: false,
        isPlaceholderData: false,
        refetch: mockRefetchStream,
      })
    );
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = null;

    const { container } = renderWithProviders(<StreamPage />);

    expect(screen.queryByText(/is currently offline/i)).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.getByText(/unable to check stream status/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /check again/i }));

    expect(mockRefetchChannel).toHaveBeenCalledTimes(1);
    expect(mockRefetchStream).toHaveBeenCalledTimes(1);
    expect(mockReloadPlayback).not.toHaveBeenCalled();
  });

  it("shows a Twitch status-check failure when the stream query fails while channel metadata still loads", () => {
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: undefined,
        isLoading: true,
        isError: false,
        isSuccess: false,
        isPlaceholderData: false,
        refetch: mockRefetchChannel,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: undefined,
        isLoading: false,
        isError: true,
        isSuccess: false,
        isPlaceholderData: false,
        refetch: mockRefetchStream,
      })
    );
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = null;
    mockPlaybackState.error = null;

    const { container } = renderWithProviders(<StreamPage />);

    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.getByText(/unable to check stream status/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check again/i })).toBeInTheDocument();
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
  });

  it("retries Twitch playback from authoritative live status while channel metadata still loads", async () => {
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: undefined,
        isLoading: true,
        isError: false,
        isSuccess: false,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({
          platform: "twitch",
          channelName: "ninja",
          title: "Still live",
          isLive: true,
          startedAt: "2026-07-30T12:00:00.000Z",
        }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = null;
    mockPlaybackState.isLoading = false;
    mockPlaybackState.error = new Error("Channel is offline");
    mockPlaybackState.reloadAttempts = 0;

    renderWithProviders(<StreamPage />);

    await waitFor(() => expect(mockReloadPlayback).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
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

  it("verifies Kick status before refreshing playback when metadata still says online", async () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "iceposeidon";
    const currentLiveStream = fixtures.stream({
      platform: "kick",
      channelName: "iceposeidon",
      title: "Cx House",
      startedAt: "2026-06-25T00:00:00.000Z",
    });
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "Ice Poseidon", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: currentLiveStream,
        isLoading: false,
        refetch: mockRefetchStream,
      })
    );
    mockRefetchStream.mockResolvedValueOnce(
      partialQueryResult<StreamRefetchResult>({
        data: currentLiveStream,
        isError: false,
        isSuccess: true,
      })
    );
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

    await waitFor(() => expect(mockRefetchStream).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockReloadPlayback).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });

  it("does not refresh dead Kick playback after the player recheck confirms offline", async () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "jollyirl";
    const currentLiveStream = fixtures.stream({
      platform: "kick",
      channelName: "jollyirl",
      title: "India Day 18",
      isLive: true,
      startedAt: "2026-08-02T08:29:00.000Z",
    });
    const confirmedOfflineStream = fixtures.stream({
      platform: "kick",
      channelName: "jollyirl",
      title: "India Day 18",
      isLive: false,
      startedAt: null,
    });
    useChannelMock.mockReturnValue({
      data: routeChannel({ displayName: "JollyIRL", isLive: true }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: currentLiveStream,
        isLoading: false,
        refetch: mockRefetchStream,
      })
    );
    mockRefetchStream.mockResolvedValueOnce(
      partialQueryResult<StreamRefetchResult>({
        data: confirmedOfflineStream,
        isError: false,
        isSuccess: true,
      })
    );
    mockPlaybackState.playback = { url: "https://stream.kick.com/live.m3u8" };

    renderWithProviders(<StreamPage />);
    await screen.findByTestId("kick-live-player");

    act(() => {
      playerMocks.kickLivePlayerProps?.onError?.({
        code: "STREAM_OFFLINE",
        message: "Stream ended or became unavailable",
        fatal: true,
      });
    });

    await waitFor(() => expect(mockRefetchStream).toHaveBeenCalledTimes(1));
    expect(mockReloadPlayback).not.toHaveBeenCalled();
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });

  it("clears the stale Kick followed-stream cache when explicit metadata confirms offline", async () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "jollyirl";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: routeChannel({ displayName: "JollyIRL", isLive: true }),
        isLoading: false,
        isError: false,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({
          platform: "kick",
          channelName: "jollyirl",
          isLive: false,
          startedAt: null,
        }),
        isLoading: false,
        isError: false,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = { url: "https://stream.kick.com/stale-live.m3u8" };

    renderWithProviders(<StreamPage />);

    await waitFor(() =>
      expect(mockRemoveFollowedStreamFromCache).toHaveBeenCalledWith(
        expect.anything(),
        "kick",
        "jollyirl"
      )
    );
    expect(screen.queryByTestId("kick-live-player")).toBeNull();
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });

  it("keeps valid Kick playback mounted when a fresh stream lookup returns null", async () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "iceposeidon";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: undefined,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = { url: "https://stream.kick.com/iceposeidon.m3u8" };

    renderWithProviders(<StreamPage />);

    expect(mockUseStreamPlayback).toHaveBeenLastCalledWith("kick", "iceposeidon");
    expect(await screen.findByTestId("kick-live-player")).toBeInTheDocument();
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
  });

  it("keeps valid Kick playback mounted when stale channel cache says offline", async () => {
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "iceposeidon";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: routeChannel({ displayName: "Ice Poseidon", isLive: false }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    mockPlaybackState.playback = { url: "https://stream.kick.com/iceposeidon.m3u8" };

    renderWithProviders(<StreamPage />);

    expect(mockUseStreamPlayback).toHaveBeenLastCalledWith("kick", "iceposeidon");
    expect(await screen.findByTestId("kick-live-player")).toBeInTheDocument();
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
  });

  it("shows a retryable Kick load error when stream status is ambiguous", async () => {
    const user = userEvent.setup();
    mockRouteParams.params.platform = "kick";
    mockRouteParams.params.channel = "iceposeidon";
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: undefined,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
        refetch: mockRefetchChannel,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
        refetch: mockRefetchStream,
      })
    );
    mockPlaybackState.playback = null;
    mockPlaybackState.isLoading = false;
    mockPlaybackState.error = new Error("Failed to resolve Kick playback URL");
    mockPlaybackState.reloadAttempts = 0;

    const { container } = renderWithProviders(<StreamPage />);

    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
    expect(screen.getByText(/unable to load stream/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /check again/i }));

    expect(mockRefetchChannel).toHaveBeenCalledTimes(1);
    expect(mockRefetchStream).toHaveBeenCalledTimes(1);
    expect(mockReloadPlayback).toHaveBeenCalledTimes(1);
  });

  it("reloads Twitch playback once when a watchdog status recheck confirms the current route is still live", async () => {
    const currentLiveStream = fixtures.stream({
      channelName: "ninja",
      title: "Going live",
      isLive: true,
      startedAt: "2026-06-25T00:00:00.000Z",
    });
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: routeChannel({ displayName: "Ninja", isLive: true }),
        isLoading: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: currentLiveStream,
        isLoading: false,
        refetch: mockRefetchStream,
      })
    );
    mockRefetchStream.mockResolvedValueOnce(
      partialQueryResult<StreamRefetchResult>({
        data: currentLiveStream,
        isError: false,
        isSuccess: true,
      })
    );
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

    await waitFor(() => expect(mockRefetchStream).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockReloadPlayback).toHaveBeenCalledTimes(1));
    expect(mockReloadPlayback).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
  });

  it("rechecks Twitch status once per playback revision after repeated watchdog offline hints", async () => {
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: routeChannel({ displayName: "Ninja", isLive: true }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: fixtures.stream({
          channelName: "ninja",
          title: "Going live",
          isLive: true,
          startedAt: "2026-07-30T12:00:00.000Z",
        }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
        refetch: mockRefetchStream,
      })
    );
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };
    mockPlaybackState.playbackRevision = 7;

    const { rerender } = renderWithProviders(<StreamPage />);
    await screen.findByTestId("twitch-live-player");

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "STREAM_OFFLINE",
        message: "Stream offline or unavailable",
        fatal: true,
      });
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "STREAM_OFFLINE",
        message: "Stream offline or unavailable",
        fatal: true,
      });
    });

    expect(mockRefetchStream).toHaveBeenCalledTimes(1);
    expect(mockReloadPlayback).not.toHaveBeenCalled();
    expect(screen.getByTestId("twitch-live-player")).toBeInTheDocument();

    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: null,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
        refetch: mockRefetchStream,
      })
    );

    rerender(<StreamPage />);

    await waitFor(() => expect(screen.queryByTestId("twitch-live-player")).toBeNull());
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
    expect(mockUseStreamPlayback).toHaveBeenLastCalledWith("twitch", "");
    expect(mockReloadPlayback).not.toHaveBeenCalled();
  });

  it("allows a later same-revision Twitch watchdog recheck after the first status recheck returns an error", async () => {
    const currentLiveStream = fixtures.stream({
      channelName: "ninja",
      title: "Going live",
      isLive: true,
      startedAt: "2026-07-30T12:00:00.000Z",
    });
    const statusErrorResult = partialQueryResult<StreamRefetchResult>({
      data: undefined,
      error: new Error("Twitch status refresh failed"),
      isError: true,
      isSuccess: false,
    });
    useChannelMock.mockReturnValue(
      partialQueryResult<ChannelQueryResult>({
        data: routeChannel({ displayName: "Ninja", isLive: true }),
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      })
    );
    useStreamMock.mockReturnValue(
      partialQueryResult<StreamQueryResult>({
        data: currentLiveStream,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
        refetch: mockRefetchStream,
      })
    );
    mockRefetchStream.mockResolvedValue(statusErrorResult);
    mockPlaybackState.playback = { url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8" };
    mockPlaybackState.playbackRevision = 7;

    renderWithProviders(<StreamPage />);
    await screen.findByTestId("twitch-live-player");

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "DECODER_STALL",
        message: "Decoder stopped making progress",
        fatal: true,
      });
    });

    await waitFor(() => expect(mockRefetchStream).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      playerMocks.twitchLivePlayerProps?.onError?.({
        code: "DECODER_STALL",
        message: "Decoder stopped making progress again",
        fatal: true,
      });
    });

    await waitFor(() => expect(mockRefetchStream).toHaveBeenCalledTimes(2));
    expect(mockReloadPlayback).not.toHaveBeenCalled();
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
