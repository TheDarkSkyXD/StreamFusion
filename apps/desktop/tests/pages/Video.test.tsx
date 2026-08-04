import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock, renderWithProviders, routerMock, screen } from "../test-utils";

vi.mock("@tanstack/react-router", () =>
  routerMock({
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
  TwitchVodPlayer: ({ onReady, onError }: { onReady?: () => void; onError?: () => void }) => (
    <div data-testid="twitch-vod-player">
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
// Guards: player failures disable both VOD actions because the playback entitlement is invalid
// Guards: platform-provided language names render without crashing the VOD page
// Guards: VOD channel avatars fall back to the canonical channel lookup when route metadata omits them
describe("VideoPage", () => {
  beforeEach(() => {
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

  it("mounts the Twitch VOD player for a twitch platform when a src is provided", async () => {
    renderWithProviders(<VideoPage />);
    // The mocked preload resolves a playable source, so the page must route it
    // to the Twitch player rather than the Kick player.
    expect(await screen.findByTestId("twitch-vod-player")).toBeInTheDocument();
    expect(screen.queryByTestId("kick-vod-player")).not.toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(removeFromHistory).toHaveBeenCalledWith("twitch-video-vod-1");
  });
});
