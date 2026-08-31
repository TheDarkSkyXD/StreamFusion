import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
} from "../test-utils";

const routeState = vi.hoisted(() => ({
  params: { platform: "twitch", videoId: "vod-1" },
  search: {
    title: "Yesterday Stream VOD",
    channelName: "ninja",
    channelDisplayName: "Ninja",
    channelAvatar: undefined,
    views: "1500",
    date: new Date().toISOString(),
    duration: "1:23:45",
    category: "Just Chatting",
    categoryId: "509658",
    language: "Portuguese",
    shareUrl: "https://www.twitch.tv/videos/vod-1",
  },
}));

vi.mock("@tanstack/react-router", () =>
  routerMock({
    params: routeState.params,
    search: routeState.search,
  })
);

const addToHistory = vi.fn();
const removeFromHistory = vi.fn();
vi.mock("@/features/media-library/data/useHistoryQuery", () => ({
  useHistoryActions: () => ({ addToHistory, removeFromHistory }),
}));

vi.mock("@/store/follow-store", () => ({
  useFollowStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      localFollows: [],
      addFollow: vi.fn(),
      removeFollow: vi.fn(),
      isFollowing: () => false,
      toggleFollow: vi.fn(),
      getFollowSource: () => null,
      upgradeFollowIfNeeded: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/features/playback/components/player/twitch/twitch-vod-player", () => ({
  TwitchVodPlayer: ({
    streamUrl,
    onReady,
    onError,
    onPlaybackStateChange,
  }: {
    streamUrl: string;
    onReady?: () => void;
    onError?: () => void;
    onPlaybackStateChange?: (snapshot: {
      currentTime: number;
      isPlaying: boolean;
      playbackRate: number;
    }) => void;
  }) => (
    <div data-testid="twitch-vod-player" data-stream-url={streamUrl}>
      vod
      <button type="button" onClick={onReady}>
        Ready playback
      </button>
      <button type="button" onClick={onError}>
        Fail playback
      </button>
      <button
        type="button"
        onClick={() =>
          onPlaybackStateChange?.({ currentTime: 120, isPlaying: true, playbackRate: 1 })
        }
      >
        Advance playback
      </button>
    </div>
  ),
}));

vi.mock("@/features/playback/components/player/kick/kick-vod-player", () => ({
  KickVodPlayer: () => <div data-testid="kick-vod-player">vod</div>,
}));

let electronApi: ReturnType<typeof installElectronAPIMock>;

// Some side-effects (related-content loader, etc.) call electronAPI directly.
beforeEach(() => {
  electronApi = installElectronAPIMock();
  electronApi.videos.getPlaybackUrl = vi.fn<typeof electronApi.videos.getPlaybackUrl>(async () => ({
    success: true,
    data: { url: "https://video.example/vod.m3u8" },
  }));
  electronApi.videos.getMetadata = vi.fn<typeof electronApi.videos.getMetadata>(async () => ({
    success: false,
  }));
  electronApi.videos.getByChannel = vi.fn<typeof electronApi.videos.getByChannel>(async () => ({
    success: true,
    data: [],
  }));
  electronApi.videos.getChatReplayWindow = vi.fn<typeof electronApi.videos.getChatReplayWindow>(
    async ({ platform, videoId }) => ({
      success: true,
      data: { capability: "unsupported", platform, videoId },
    })
  );
  electronApi.videos.cancelChatReplayWindow = vi.fn(async () => ({ cancelled: true }));
  electronApi.streams.getByChannel = vi.fn<typeof electronApi.streams.getByChannel>(async () => ({
    success: true,
    data: null,
  }));
  electronApi.channels.getByUsername = vi.fn<typeof electronApi.channels.getByUsername>(
    async ({ username, platform }) => ({
      success: true,
      data: {
        id: `channel-${username}`,
        platform,
        username,
        displayName: username === "ninja" ? "Ninja" : username,
        avatarUrl: `https://cdn.example.test/${username}-avatar.png`,
        isLive: false,
        isVerified: true,
        isPartner: true,
      },
    })
  );
  electronApi.downloads.getQueue = vi.fn(async () => ({ jobs: [] }));
  electronApi.downloads.downloadVideo = vi.fn(async () => ({ success: true, jobId: "video-job" }));
});

vi.mock("@/features/playback/components/related-content/VideoCard", () => ({
  VideoCard: ({ video }: { video: { title: string } }) => (
    <div data-testid="video-card">{video.title}</div>
  ),
}));

import { VideoPage } from "@/pages/Video";
import { CHANNEL_KEYS } from "@/features/discovery/data/queries/useChannels";
import { VOD_LIVE_LINK_KEYS } from "@/features/playback/data/useVodLiveLink";

// Guards: guest VOD playback surfaces expose Share and Download without requiring auth state
// Guards: VOD sharing copies the public Platform URL while downloading uses the resolved playback source
// Guards: player failures unmount playback, disable VOD actions, and resolve again only after explicit Retry
// Guards: a resolved VOD playback source mounts its player without waiting for metadata
// Guards: platform-provided language names render without crashing the VOD page
// Guards: VOD channel avatars fall back to the canonical channel lookup when route metadata omits them
// Guards: offline VOD channels do not offer a link to a nonexistent live stream
// Guards: cached channel metadata cannot keep Watch Live visible after the stream ends
// Guards: Watch Live waits for fresh stream-status authority and hides on route switches, lookup errors, and ended streams
// Guards: a VOD category links back to that platform category instead of rendering as inert text
// Guards: invalid Kick VOD routes fail closed without fabricated channel metadata, follow actions, or history writes
// Guards: VOD follow writes stay unavailable until the platform returns a canonical non-empty channel identity
// Guards: the VOD route requests provider chat replay instead of rendering a hard-coded placeholder.
// Guards: same-route VOD navigation starts the next chat replay at the beginning, not the prior VOD offset.
describe("VideoPage", () => {
  beforeEach(() => {
    Object.assign(routeState.params, { platform: "twitch", videoId: "vod-1" });
    Object.assign(routeState.search, {
      title: "Yesterday Stream VOD",
      channelName: "ninja",
      channelDisplayName: "Ninja",
      channelAvatar: undefined,
      views: "1500",
      date: new Date().toISOString(),
      duration: "1:23:45",
      category: "Just Chatting",
      categoryId: "509658",
      language: "Portuguese",
      shareUrl: "https://www.twitch.tv/videos/vod-1",
    });
    addToHistory.mockReset();
    removeFromHistory.mockReset();
  });

  it("loads chat replay for the routed video", async () => {
    renderWithProviders(<VideoPage />);

    await waitFor(() =>
      expect(electronApi.videos.getChatReplayWindow).toHaveBeenCalledWith(
        expect.objectContaining({ platform: "twitch", videoId: "vod-1", offsetSeconds: 0 })
      )
    );
    expect(screen.queryByText("Chat replay not available for this video")).not.toBeInTheDocument();
  });

  it("resets chat replay playback when the routed video changes", async () => {
    const { rerender } = renderWithProviders(<VideoPage />);
    await screen.findByTestId("twitch-vod-player");
    fireEvent.click(screen.getByRole("button", { name: "Advance playback" }));
    await waitFor(() =>
      expect(electronApi.videos.getChatReplayWindow).toHaveBeenCalledWith(
        expect.objectContaining({ videoId: "vod-1", offsetSeconds: 120 })
      )
    );

    Object.assign(routeState.params, { videoId: "vod-2" });
    Object.assign(routeState.search, { title: "Second VOD" });
    rerender(<VideoPage />);

    await waitFor(() =>
      expect(electronApi.videos.getChatReplayWindow).toHaveBeenCalledWith(
        expect.objectContaining({ videoId: "vod-2", offsetSeconds: 0 })
      )
    );
  });

  it("renders the VOD title passed via search params", async () => {
    renderWithProviders(<VideoPage />);
    expect(screen.getByText(/yesterday stream vod/i)).toBeInTheDocument();
    expect(screen.getByText("Portuguese")).toBeInTheDocument();
    await screen.findByTestId("twitch-vod-player");
  });

  it("links the displayed category to its category page", async () => {
    renderWithProviders(<VideoPage />);

    expect(await screen.findByRole("link", { name: "Just Chatting" })).toHaveAttribute(
      "data-params",
      JSON.stringify({ platform: "twitch", categoryId: "509658" })
    );
  });

  it("hides Watch Live when the VOD channel is offline", async () => {
    renderWithProviders(<VideoPage />);

    await waitFor(() => expect(electronApi.channels.getByUsername).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Watch Live" })).not.toBeInTheDocument();
  });

  it("waits for canonical channel identity before enabling Follow", async () => {
    type ChannelResult = Awaited<ReturnType<typeof electronApi.channels.getByUsername>>;
    let resolveChannel!: (result: ChannelResult) => void;
    electronApi.channels.getByUsername = vi.fn(
      () =>
        new Promise<ChannelResult>((resolve) => {
          resolveChannel = resolve;
        })
    );

    renderWithProviders(<VideoPage />);

    await screen.findByTestId("twitch-vod-player");
    expect(screen.queryByRole("button", { name: /follow/i })).not.toBeInTheDocument();

    await act(async () => {
      resolveChannel({
        success: true,
        data: {
          id: "channel-ninja",
          platform: "twitch",
          username: "ninja",
          displayName: "Ninja",
          avatarUrl: "https://cdn.example.test/ninja-avatar.png",
          isLive: false,
          isVerified: true,
          isPartner: true,
        },
      });
    });

    expect(await screen.findByRole("button", { name: /follow/i })).toBeInTheDocument();
  });

  it("ignores stale cached channel live state when the current stream is offline", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(CHANNEL_KEYS.byUsername("ninja", "twitch"), {
      id: "channel-1",
      platform: "twitch",
      username: "ninja",
      displayName: "Ninja",
      avatarUrl: "https://cdn.example.test/ninja-avatar.png",
      isLive: true,
      isVerified: true,
      isPartner: true,
    });

    renderWithProviders(<VideoPage />, { queryClient });

    await screen.findByTestId("twitch-vod-player");
    expect(screen.queryByRole("link", { name: "Watch Live" })).not.toBeInTheDocument();
  });

  it("shows Watch Live when fresh stream status says the VOD channel is live", async () => {
    electronApi.channels.getByUsername = vi.fn<typeof electronApi.channels.getByUsername>(
      async () => ({
        success: true,
        data: {
          id: "channel-1",
          platform: "twitch",
          username: "ninja",
          displayName: "Ninja",
          avatarUrl: "https://cdn.example.test/ninja-avatar.png",
          isLive: true,
          isVerified: true,
          isPartner: true,
        },
      })
    );
    electronApi.streams.getByChannel = vi.fn<typeof electronApi.streams.getByChannel>(async () => ({
      success: true,
      data: fixtures.stream({ channelName: "ninja", channelDisplayName: "Ninja" }),
    }));

    renderWithProviders(<VideoPage />);

    expect(await screen.findByRole("link", { name: "Watch Live" })).toBeInTheDocument();
  });

  it("hides Watch Live when stream status lookup fails even if channel metadata says live", async () => {
    electronApi.channels.getByUsername = vi.fn<typeof electronApi.channels.getByUsername>(
      async () => ({
        success: true,
        data: {
          id: "channel-1",
          platform: "twitch",
          username: "ninja",
          displayName: "Ninja",
          avatarUrl: "https://cdn.example.test/ninja-avatar.png",
          isLive: true,
          isVerified: true,
          isPartner: true,
        },
      })
    );
    electronApi.streams.getByChannel = vi.fn<typeof electronApi.streams.getByChannel>(async () => ({
      success: false,
      error: "status unavailable",
    }));

    renderWithProviders(<VideoPage />);

    await waitFor(() => expect(electronApi.streams.getByChannel).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Watch Live" })).not.toBeInTheDocument();
  });

  it("does not trust cached stream live status when the fresh lookup fails", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      VOD_LIVE_LINK_KEYS.byChannel("ninja", "twitch"),
      fixtures.stream({ channelName: "ninja", channelDisplayName: "Ninja" })
    );
    electronApi.streams.getByChannel = vi.fn<typeof electronApi.streams.getByChannel>(async () => ({
      success: false,
      error: "status unavailable",
    }));

    renderWithProviders(<VideoPage />, { queryClient });

    await waitFor(() => expect(electronApi.streams.getByChannel).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Watch Live" })).not.toBeInTheDocument();
  });

  it("removes Watch Live when the live stream status updates to offline", async () => {
    const queryClient = new QueryClient();
    electronApi.streams.getByChannel = vi.fn<typeof electronApi.streams.getByChannel>(async () => ({
      success: true,
      data: fixtures.stream({ channelName: "ninja", channelDisplayName: "Ninja" }),
    }));

    renderWithProviders(<VideoPage />, { queryClient });

    expect(await screen.findByRole("link", { name: "Watch Live" })).toBeInTheDocument();
    queryClient.setQueryData(VOD_LIVE_LINK_KEYS.byChannel("ninja", "twitch"), null);

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Watch Live" })).not.toBeInTheDocument()
    );
  });

  it("does not carry Watch Live from a live VOD channel across a route switch", async () => {
    electronApi.streams.getByChannel = vi.fn<typeof electronApi.streams.getByChannel>(
      async ({ username }) => ({
        success: true,
        data:
          username === "ninja"
            ? fixtures.stream({ channelName: "ninja", channelDisplayName: "Ninja" })
            : null,
      })
    );

    const { rerender } = renderWithProviders(<VideoPage />);

    expect(await screen.findByRole("link", { name: "Watch Live" })).toBeInTheDocument();
    Object.assign(routeState.params, { videoId: "vod-2" });
    Object.assign(routeState.search, {
      title: "Offline Channel VOD",
      channelName: "shroud",
      channelDisplayName: "Shroud",
      shareUrl: "https://www.twitch.tv/videos/vod-2",
    });
    rerender(<VideoPage />);

    await waitFor(() =>
      expect(electronApi.streams.getByChannel).toHaveBeenCalledWith({
        username: "shroud",
        platform: "twitch",
      })
    );
    expect(screen.queryByRole("link", { name: "Watch Live" })).not.toBeInTheDocument();
  });

  it("mounts the Twitch VOD player for a twitch platform when a src is provided", async () => {
    renderWithProviders(<VideoPage />);
    // The mocked preload resolves a playable source, so the page must route it
    // to the Twitch player rather than the Kick player.
    expect(await screen.findByTestId("twitch-vod-player")).toBeInTheDocument();
    expect(screen.queryByTestId("kick-vod-player")).not.toBeInTheDocument();
  });

  it("resolves each VOD resource once under StrictMode", async () => {
    renderWithProviders(<VideoPage />, { reactStrictMode: true });

    await screen.findByTestId("twitch-vod-player");
    expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(1);
    expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(1);
  });

  it("mounts playback while metadata is still pending", async () => {
    let resolveMetadata: (value: { success: boolean }) => void;
    const metadataPromise = new Promise<{ success: boolean }>((resolve) => {
      resolveMetadata = resolve;
    });
    electronApi.videos.getMetadata = vi.fn(() => metadataPromise);
    electronApi.logs.write = vi.fn();
    const timing = vi.spyOn(performance, "now").mockReturnValue(100);

    renderWithProviders(<VideoPage />);

    await waitFor(() => expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("twitch-vod-player")).toBeInTheDocument();
    await waitFor(() =>
      expect(electronApi.logs.write).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "debug",
          tag: "Page:Video",
          message: "playback-source-to-player-mounted",
          meta: expect.objectContaining({
            platform: "twitch",
            videoId: "vod-1",
            generation: 1,
            elapsedMs: 0,
          }),
        })
      )
    );
    expect(JSON.stringify(vi.mocked(electronApi.logs.write).mock.calls)).not.toContain(
      "https://video.example/vod.m3u8"
    );
    timing.mockRestore();

    resolveMetadata!({ success: false });
  });

  it("updates late metadata without remounting resolved playback", async () => {
    const metadata = {
      id: "vod-1",
      title: "Metadata arrived later",
      channelId: "channel-1",
      channelName: "ninja",
      channelDisplayName: "Ninja",
      channelAvatar: null,
      views: 42,
      duration: "1:23:45",
      createdAt: new Date().toISOString(),
      thumbnailUrl: "",
      description: "",
      type: "archive",
      platform: "twitch",
      category: "Just Chatting",
    };
    let resolveMetadata: (value: { success: true; data: typeof metadata }) => void;
    const metadataPromise = new Promise<{ success: true; data: typeof metadata }>((resolve) => {
      resolveMetadata = resolve;
    });
    electronApi.videos.getMetadata = vi.fn(() => metadataPromise);

    renderWithProviders(<VideoPage />);

    const player = await screen.findByTestId("twitch-vod-player");
    resolveMetadata!({
      success: true,
      data: metadata,
    });

    await screen.findByRole("heading", { name: "Metadata arrived later" });
    expect(screen.getByTestId("twitch-vod-player")).toBe(player);
  });

  it("retries failed metadata without restarting working playback", async () => {
    electronApi.videos.getMetadata = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: "metadata unavailable" })
      .mockResolvedValue({
        success: true,
        data: {
          id: "vod-1",
          title: "Metadata retry succeeded",
          channelId: "channel-1",
          channelName: "ninja",
          channelDisplayName: "Ninja",
          channelAvatar: null,
          views: 42,
          duration: "1:23:45",
          createdAt: new Date().toISOString(),
          thumbnailUrl: "",
          description: "",
          type: "archive",
          platform: "twitch",
        },
      });

    renderWithProviders(<VideoPage />);

    const player = await screen.findByTestId("twitch-vod-player");
    fireEvent.click(await screen.findByRole("button", { name: "Retry details" }));

    await waitFor(() => expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(2));
    await screen.findByRole("heading", { name: "Metadata retry succeeded" });
    expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("twitch-vod-player")).toBe(player);
  });

  it("keeps a playback-source failure retryable after metadata succeeds", async () => {
    electronApi.videos.getPlaybackUrl = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: "source unavailable" })
      .mockResolvedValue({ success: true, data: { url: "https://video.example/retried.m3u8" } });
    electronApi.videos.getMetadata = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: "vod-1",
        title: "Metadata is available",
        channelId: "channel-1",
        channelName: "ninja",
        channelDisplayName: "Ninja",
        channelAvatar: null,
        views: 42,
        duration: "1:23:45",
        createdAt: new Date().toISOString(),
        thumbnailUrl: "",
        description: "",
        type: "archive",
        platform: "twitch",
      },
    });

    renderWithProviders(<VideoPage />);

    await screen.findByRole("heading", { name: "Metadata is available" });
    expect(screen.queryByTestId("twitch-vod-player")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(2));
    expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Metadata is available" })).toBeInTheDocument();
    expect(await screen.findByTestId("twitch-vod-player")).toHaveAttribute(
      "data-stream-url",
      "https://video.example/retried.m3u8"
    );
  });

  it("ignores stale playback and metadata after a rapid route switch", async () => {
    type PlaybackResult = Awaited<ReturnType<typeof electronApi.videos.getPlaybackUrl>>;
    type MetadataResult = Awaited<ReturnType<typeof electronApi.videos.getMetadata>>;
    const playbackResolvers = new Map<string, (value: PlaybackResult) => void>();
    const metadataResolvers = new Map<string, (value: MetadataResult) => void>();
    electronApi.videos.getPlaybackUrl = vi.fn<typeof electronApi.videos.getPlaybackUrl>(
      ({ videoId }: { videoId: string }) =>
        new Promise<PlaybackResult>((resolve) => {
          playbackResolvers.set(videoId, resolve);
        })
    );
    electronApi.videos.getMetadata = vi.fn<typeof electronApi.videos.getMetadata>(
      ({ videoId }: { videoId: string }) =>
        new Promise<MetadataResult>((resolve) => {
          metadataResolvers.set(videoId, resolve);
        })
    );

    const { rerender } = renderWithProviders(<VideoPage />);
    await waitFor(() => expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(1));

    Object.assign(routeState.params, { videoId: "vod-2" });
    Object.assign(routeState.search, { title: "Second VOD" });
    rerender(<VideoPage />);

    await waitFor(() => expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(2));

    playbackResolvers.get("vod-2")!({
      success: true,
      data: { url: "https://video.example/vod-2.m3u8" },
    });
    const player = await screen.findByTestId("twitch-vod-player");
    expect(player).toHaveAttribute("data-stream-url", "https://video.example/vod-2.m3u8");

    playbackResolvers.get("vod-1")!({
      success: true,
      data: { url: "https://video.example/vod-1.m3u8" },
    });
    metadataResolvers.get("vod-1")!({
      success: true,
      data: {
        id: "vod-1",
        title: "Stale VOD",
        channelId: "channel-1",
        channelName: "ninja",
        channelDisplayName: "Ninja",
        channelAvatar: null,
        views: 1,
        duration: "1:00",
        createdAt: new Date().toISOString(),
        thumbnailUrl: "",
        description: "",
        type: "archive",
        platform: "twitch",
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId("twitch-vod-player")).toHaveAttribute(
        "data-stream-url",
        "https://video.example/vod-2.m3u8"
      )
    );
    expect(screen.queryByRole("heading", { name: "Stale VOD" })).not.toBeInTheDocument();
    expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(2);
    expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(2);

    metadataResolvers.get("vod-2")!({
      success: true,
      data: {
        id: "vod-2",
        title: "Second VOD metadata",
        channelId: "channel-2",
        channelName: "ninja",
        channelDisplayName: "Ninja",
        channelAvatar: null,
        views: 42,
        duration: "1:23:45",
        createdAt: new Date().toISOString(),
        thumbnailUrl: "",
        description: "",
        type: "archive",
        platform: "twitch",
      },
    });
    await screen.findByRole("heading", { name: "Second VOD metadata" });
    expect(screen.getByTestId("twitch-vod-player")).toBe(player);
  });

  it("reuses pending resolvers when rapid back navigation returns to a VOD", async () => {
    type PlaybackResult = Awaited<ReturnType<typeof electronApi.videos.getPlaybackUrl>>;
    type MetadataResult = Awaited<ReturnType<typeof electronApi.videos.getMetadata>>;
    const playbackResolvers = new Map<string, (value: PlaybackResult) => void>();
    const metadataResolvers = new Map<string, (value: MetadataResult) => void>();
    electronApi.videos.getPlaybackUrl = vi.fn<typeof electronApi.videos.getPlaybackUrl>(
      ({ videoId }: { videoId: string }) =>
        new Promise<PlaybackResult>((resolve) => {
          playbackResolvers.set(videoId, resolve);
        })
    );
    electronApi.videos.getMetadata = vi.fn<typeof electronApi.videos.getMetadata>(
      ({ videoId }: { videoId: string }) =>
        new Promise<MetadataResult>((resolve) => {
          metadataResolvers.set(videoId, resolve);
        })
    );

    const { rerender } = renderWithProviders(<VideoPage />);
    await waitFor(() => expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(1));

    Object.assign(routeState.params, { videoId: "vod-2" });
    Object.assign(routeState.search, { title: "Second VOD" });
    rerender(<VideoPage />);
    await waitFor(() => expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(2));

    Object.assign(routeState.params, { videoId: "vod-1" });
    Object.assign(routeState.search, { title: "Yesterday Stream VOD" });
    rerender(<VideoPage />);
    await waitFor(() => expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(2));

    playbackResolvers.get("vod-1")!({
      success: true,
      data: { url: "https://video.example/vod-1.m3u8" },
    });
    metadataResolvers.get("vod-1")!({
      success: true,
      data: {
        id: "vod-1",
        title: "Returned VOD metadata",
        channelId: "channel-1",
        channelName: "ninja",
        channelDisplayName: "Ninja",
        channelAvatar: null,
        views: 42,
        duration: "1:23:45",
        createdAt: new Date().toISOString(),
        thumbnailUrl: "",
        description: "",
        type: "archive",
        platform: "twitch",
      },
    });

    expect(await screen.findByTestId("twitch-vod-player")).toHaveAttribute(
      "data-stream-url",
      "https://video.example/vod-1.m3u8"
    );
    await screen.findByRole("heading", { name: "Returned VOD metadata" });
    expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(2);
    expect(electronApi.videos.getMetadata).toHaveBeenCalledTimes(2);
  });

  it("records VOD watch in history on mount", async () => {
    renderWithProviders(<VideoPage />);
    expect(addToHistory).toHaveBeenCalledWith(
      expect.objectContaining({ type: "video", platform: "twitch" })
    );
    await screen.findByTestId("twitch-vod-player");
  });

  it("shows the canonical channel avatar when route metadata has no avatar", async () => {
    renderWithProviders(<VideoPage />);

    const avatar = await screen.findByRole("img", { name: "Ninja" });

    expect(avatar).toHaveAttribute("src", "https://cdn.example.test/ninja-avatar.png");
  });

  it("shares and downloads a playable VOD for a guest", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderWithProviders(<VideoPage />);

    const share = await screen.findByRole("button", { name: "Share" });
    const download = screen.getByRole("button", { name: "Download" });
    expect(share).toBeDisabled();
    expect(download).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Ready playback" }));

    expect(share).toBeEnabled();
    expect(download).toBeEnabled();
    fireEvent.click(share);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://www.twitch.tv/videos/vod-1")
    );

    fireEvent.click(download);
    await waitFor(() =>
      expect(electronApi.downloads.downloadVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "twitch",
          videoId: "vod-1",
          playbackUrl: "https://video.example/vod.m3u8",
        })
      )
    );
  });

  it("disables sharing and downloading after playback fails", async () => {
    renderWithProviders(<VideoPage />);

    const readyPlayback = await screen.findByRole("button", { name: "Ready playback" });
    fireEvent.click(readyPlayback);
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();

    const failPlayback = await screen.findByRole("button", { name: "Fail playback" });
    fireEvent.click(failPlayback);

    expect(screen.queryByTestId("twitch-vod-player")).not.toBeInTheDocument();
    expect(screen.getByText("Unable to play this video")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(removeFromHistory).toHaveBeenCalledWith("twitch-video-vod-1");
    expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);

    await waitFor(() => expect(electronApi.videos.getPlaybackUrl).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("twitch-vod-player")).toBeInTheDocument();
  });

  it("fails closed for an invalid Kick VOD route without showing fabricated metadata", async () => {
    Object.assign(routeState.params, { platform: "kick", videoId: "definitely-not-a-real-vod-id" });
    Object.assign(routeState.search, {
      title: undefined,
      channelName: undefined,
      channelDisplayName: undefined,
      channelAvatar: undefined,
      views: undefined,
      date: undefined,
      duration: undefined,
      category: undefined,
      categoryId: undefined,
      language: undefined,
      shareUrl: undefined,
    });
    electronApi.videos.getPlaybackUrl = vi.fn<typeof electronApi.videos.getPlaybackUrl>(
      async () => ({
        success: false,
        error: "Could not resolve VOD playback URL",
      })
    );
    electronApi.videos.getMetadata = vi.fn<typeof electronApi.videos.getMetadata>(async () => ({
      success: false,
      error: "Video metadata unavailable",
    }));
    electronApi.logs.write = vi.fn();

    renderWithProviders(<VideoPage />);

    expect(await screen.findByText("Could not resolve VOD playback URL")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Video unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow" })).not.toBeInTheDocument();
    expect(screen.queryByText("Kick VOD")).not.toBeInTheDocument();
    expect(screen.queryByText("Kick Channel")).not.toBeInTheDocument();
    expect(screen.queryByText(/More from/i)).not.toBeInTheDocument();
    expect(electronApi.channels.getByUsername).not.toHaveBeenCalled();
    expect(electronApi.videos.getByChannel).not.toHaveBeenCalled();
    expect(addToHistory).not.toHaveBeenCalled();
    expect(electronApi.logs.write).not.toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        tag: "Page:Video",
      })
    );
  });
});
