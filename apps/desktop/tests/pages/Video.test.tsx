import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock, renderWithProviders, routerMock, screen } from "../test-utils";

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
const repairFollowMetadataFromChannel = vi.fn(async () => false);
vi.mock("@/hooks/queries/useHistoryQuery", () => ({
  useHistoryActions: () => ({ addToHistory, removeFromHistory }),
}));

vi.mock("@/store/follow-store", () => ({
  useFollowStore: (selector?: (state: any) => unknown) => {
    const state = {
      localFollows: [],
      addFollow: vi.fn(),
      removeFollow: vi.fn(),
      isFollowing: () => false,
      toggleFollow: vi.fn(),
      getFollowSource: () => null,
      upgradeFollowIfNeeded: vi.fn(),
      repairFollowMetadataFromChannel,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/components/player/twitch", () => ({
  TwitchVodPlayer: ({
    streamUrl,
    onReady,
    onError,
  }: {
    streamUrl: string;
    onReady?: () => void;
    onError?: () => void;
  }) => (
    <div data-testid="twitch-vod-player" data-stream-url={streamUrl}>
      vod
      <button type="button" onClick={onReady}>
        Ready playback
      </button>
      <button type="button" onClick={onError}>
        Fail playback
      </button>
    </div>
  ),
}));

vi.mock("@/components/player/kick", () => ({
  KickVodPlayer: () => <div data-testid="kick-vod-player">vod</div>,
}));

let electronApi: any;

// Some side-effects (related-content loader, etc.) call electronAPI directly.
beforeEach(() => {
  electronApi = installElectronAPIMock();
  electronApi.videos.getPlaybackUrl = vi.fn(async () => ({
    success: true,
    data: { url: "https://video.example/vod.m3u8" },
  }));
  electronApi.videos.getMetadata = vi.fn(async () => ({ success: false }));
  electronApi.videos.getByChannel = vi.fn(async () => ({ success: true, data: [] }));
  electronApi.streams.getByChannel = vi.fn(async () => ({
    success: true,
    data: null,
  }));
  electronApi.channels.getByUsername = vi.fn(async () => ({
    error: null,
    data: {
      id: "channel-1",
      platform: "twitch",
      username: "ninja",
      displayName: "Ninja",
      avatarUrl: "https://cdn.example.test/ninja-avatar.png",
      isLive: false,
      isVerified: true,
      isPartner: true,
    },
  }));
  electronApi.downloads.getQueue = vi.fn(async () => ({ jobs: [] }));
  electronApi.downloads.downloadVideo = vi.fn(async () => ({ success: true, jobId: "video-job" }));
});

vi.mock("@/components/stream/related-content/VideoCard", () => ({
  VideoCard: ({ video }: { video: { title: string } }) => (
    <div data-testid="video-card">{video.title}</div>
  ),
}));

import { VideoPage } from "@/pages/Video";

// Guards: guest VOD playback surfaces expose Share and Download without requiring auth state
// Guards: VOD sharing copies the public Platform URL while downloading uses the resolved playback source
// Guards: player failures unmount playback, disable VOD actions, and resolve again only after explicit Retry
// Guards: a resolved VOD playback source mounts its player without waiting for metadata
// Guards: platform-provided language names render without crashing the VOD page
// Guards: VOD channel avatars fall back to the canonical channel lookup when route metadata omits them
// Guards: offline VOD channels do not offer a link to a nonexistent live stream
// Guards: Watch Live appears only after current stream status confirms the channel is live
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
      language: "Portuguese",
      shareUrl: "https://www.twitch.tv/videos/vod-1",
    });
    addToHistory.mockReset();
    removeFromHistory.mockReset();
    repairFollowMetadataFromChannel.mockClear();
  });

  it("renders the VOD title passed via search params", async () => {
    renderWithProviders(<VideoPage />);
    expect(screen.getByText(/yesterday stream vod/i)).toBeInTheDocument();
    expect(screen.getByText("Portuguese")).toBeInTheDocument();
    await screen.findByTestId("twitch-vod-player");
  });

  it("hides Watch Live when the VOD channel is offline", async () => {
    renderWithProviders(<VideoPage />);

    await waitFor(() => expect(electronApi.streams.getByChannel).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Watch Live" })).not.toBeInTheDocument();
  });

  it("shows Watch Live when fresh stream status says the VOD channel is live", async () => {
    electronApi.streams.getByChannel = vi.fn(async () => ({
      success: true,
      data: {
        platform: "twitch",
        channelName: "ninja",
        isLive: true,
      },
    }));

    renderWithProviders(<VideoPage />);

    expect(await screen.findByRole("link", { name: "Watch Live" })).toBeInTheDocument();
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
    expect(JSON.stringify(electronApi.logs.write.mock.calls)).not.toContain(
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
    const playbackResolvers = new Map<
      string,
      (value: { success: boolean; data?: { url: string } }) => void
    >();
    const metadataResolvers = new Map<
      string,
      (value: { success: boolean; data?: Record<string, unknown> }) => void
    >();
    electronApi.videos.getPlaybackUrl = vi.fn(
      ({ videoId }: { videoId: string }) =>
        new Promise<{ success: boolean; data?: { url: string } }>((resolve) => {
          playbackResolvers.set(videoId, resolve);
        })
    );
    electronApi.videos.getMetadata = vi.fn(
      ({ videoId }: { videoId: string }) =>
        new Promise<{ success: boolean; data?: Record<string, unknown> }>((resolve) => {
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
    metadataResolvers.get("vod-1")!({ success: true, data: { title: "Stale VOD" } });

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
    const playbackResolvers = new Map<
      string,
      (value: { success: boolean; data?: { url: string } }) => void
    >();
    const metadataResolvers = new Map<
      string,
      (value: { success: boolean; data?: Record<string, unknown> }) => void
    >();
    electronApi.videos.getPlaybackUrl = vi.fn(
      ({ videoId }: { videoId: string }) =>
        new Promise<{ success: boolean; data?: { url: string } }>((resolve) => {
          playbackResolvers.set(videoId, resolve);
        })
    );
    electronApi.videos.getMetadata = vi.fn(
      ({ videoId }: { videoId: string }) =>
        new Promise<{ success: boolean; data?: Record<string, unknown> }>((resolve) => {
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
});
