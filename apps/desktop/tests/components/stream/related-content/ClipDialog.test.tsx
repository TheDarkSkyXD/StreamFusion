import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedChannel } from "@shared/platform-types";
import { ClipDialog } from "@/features/playback/components/related-content/ClipDialog";
import type { VideoOrClip } from "@/features/playback/components/related-content/types";
import { Platform } from "@streamfusion/core/platform";
import type React from "react";
import { installElectronAPIMock } from "../../../test-utils";

const addToHistory = vi.hoisted(() => vi.fn());

// Mock child components
vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({ alt, src }: { alt: string; src?: string }) => (
    <div data-testid="platform-avatar" data-src={src}>
      {alt}
    </div>
  ),
}));

vi.mock("@/components/ui/follow-button", () => ({
  FollowButton: () => <button data-testid="follow-button">Follow</button>,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  KickLoadingSpinner: () => <div data-testid="kick-loading-spinner">Kick Loading</div>,
  TwitchLoadingSpinner: () => <div data-testid="twitch-loading-spinner">Twitch Loading</div>,
}));

vi.mock("@/features/playback/components/player/twitch/twitch-vod-player", () => ({
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
      Twitch Player
      <button type="button" onClick={onReady}>
        Ready playback
      </button>
      <button type="button" onClick={onError}>
        Fail playback
      </button>
    </div>
  ),
}));

vi.mock("@/features/playback/components/player/kick/kick-vod-player", () => ({
  KickVodPlayer: () => <div data-testid="kick-vod-player">Kick Player</div>,
}));

vi.mock("@/features/media-library/data/useHistoryQuery", () => ({
  useHistoryActions: () => ({ addToHistory }),
}));

// Mock router
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    children,
    to,
    params,
    onClick,
  }: React.PropsWithChildren<{
    to: string;
    params?: Record<string, unknown>;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }>) => (
    <a
      href={to}
      data-params={JSON.stringify(params)}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
        mockNavigate({ to, params });
      }}
    >
      {children}
    </a>
  ),
}));

// Guards: guest playback surfaces expose Share and Download without consulting auth state
// Guards: Clip sharing copies only the explicit public content URL, never the playback URL
// Guards: Twitch clip history keeps stable clip identity and never persists its reversible playback URL
// Guards: player failures unmount playback, show retry guidance, and disable Share and Download
// Guards: switching Clips clears Copied state and waits for the new player readiness signal
// Guards: the displayed channel name routes by the selected Clip's canonical Platform and slug and closes the dialog
describe("[Unit] ClipDialog", () => {
  const mockOnClose = vi.fn();
  const mockOnPlaybackError = vi.fn();

  const mockClip: VideoOrClip = {
    id: "clip-123",
    title: "Awesome Clip",
    thumbnailUrl: "thumb.jpg",
    created_at: "2023-01-01",
    duration: "30s",
    url: "http://clip.url",
    shareUrl: "https://clips.twitch.tv/AwesomeClip",
    embedUrl: "http://embed.url",
    gameName: "Just Chatting",
    creatorName: "Clipper",
    views: "100",
    date: "2023-01-01",
    isLive: false,
    channelSlug: "coolstreamer",
    vodId: "vod-123",
  };

  const mockChannelData: UnifiedChannel = {
    id: "123",
    username: "coolstreamer",
    displayName: "CoolStreamer",
    avatarUrl: "avatar.jpg",
    followerCount: 1000,
    bio: "Cool stream",
    platform: "twitch",
    isLive: false,
    isVerified: true,
    isPartner: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    addToHistory.mockReset();
    // Setup default window mocks if needed
    const api = installElectronAPIMock();
    api.videos.getByLivestreamId = vi.fn();
    api.downloads.getQueue = vi.fn().mockResolvedValue({ jobs: [] });
    api.downloads.downloadClip = vi.fn().mockResolvedValue({ success: true, jobId: "clip-job" });
  });

  it("enables guest sharing and downloading only after the player becomes ready", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <ClipDialog
        selectedClip={mockClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="https://video.example/clip.m3u8"
        platform="twitch"
        channelName="coolstreamer"
        channelData={null}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    const share = screen.getByRole("button", { name: "Share" });
    const download = screen.getByRole("button", { name: "Download" });
    expect(share).toBeDisabled();
    expect(download).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Ready playback" }));

    expect(share).toBeEnabled();
    expect(download).toBeEnabled();
    fireEvent.click(share);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://clips.twitch.tv/AwesomeClip")
    );

    fireEvent.click(download);
    await waitFor(() =>
      expect(vi.mocked(window.electronAPI.downloads.downloadClip)).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "twitch",
          clipId: "clip-123",
          clipUrl: "https://video.example/clip.m3u8",
        })
      )
    );
  });

  it("disables sharing and downloading after playback fails", async () => {
    render(
      <ClipDialog
        selectedClip={mockClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="https://video.example/clip.m3u8"
        platform="twitch"
        channelName="coolstreamer"
        channelData={null}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Ready playback" }));
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Fail playback" }));

    expect(screen.queryByTestId("twitch-vod-player")).not.toBeInTheDocument();
    expect(screen.getByText("Unable to play this clip")).toBeInTheDocument();
    expect(screen.getByText("Try closing and reopening the clip, or try again later.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeDisabled();
    expect(mockOnPlaybackError).toHaveBeenCalledTimes(1);
  });

  it("resets Copied immediately when the selected clip changes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const baseProps = {
      onClose: mockOnClose,
      clipLoading: false,
      clipError: null,
      platform: "twitch" as Platform,
      channelName: "coolstreamer",
      channelData: null,
      onPlaybackError: mockOnPlaybackError,
    };
    const { rerender } = render(
      <ClipDialog
        {...baseProps}
        selectedClip={mockClip}
        clipPlaybackUrl="https://video.example/first.m3u8"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Ready playback" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeEnabled();

    rerender(
      <ClipDialog
        {...baseProps}
        selectedClip={{
          ...mockClip,
          id: "clip-456",
          title: "Another Clip",
          shareUrl: "https://clips.twitch.tv/AnotherClip",
        }}
        clipPlaybackUrl="https://video.example/second.m3u8"
      />
    );

    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();

    rerender(
      <ClipDialog
        {...baseProps}
        selectedClip={mockClip}
        clipPlaybackUrl="https://video.example/first.m3u8"
      />
    );
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  });

  it("should render nothing when no clip is selected", () => {
    render(
      <ClipDialog
        selectedClip={null}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl={null}
        platform="twitch"
        channelName="coolstreamer"
        channelData={null}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.queryByText("Awesome Clip")).not.toBeInTheDocument();
  });

  it("should show loading spinner when clipLoading is true", () => {
    render(
      <ClipDialog
        selectedClip={mockClip}
        onClose={mockOnClose}
        clipLoading={true}
        clipError={null}
        clipPlaybackUrl={null}
        platform="twitch"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByText("Loading clip...")).toBeInTheDocument();
    expect(screen.getByTestId("twitch-loading-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("kick-loading-spinner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("twitch-vod-player")).not.toBeInTheDocument();
  });

  it("should show Kick loading spinner, not Twitch loading, while a Kick clip loads", () => {
    const kickClip = { ...mockClip, platform: "kick" as Platform };

    render(
      <ClipDialog
        selectedClip={kickClip}
        onClose={mockOnClose}
        clipLoading={true}
        clipError={null}
        clipPlaybackUrl={null}
        platform="kick"
        channelName="coolstreamer"
        channelData={{ ...mockChannelData, platform: "kick" }}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByText("Loading clip...")).toBeInTheDocument();
    expect(screen.getByTestId("kick-loading-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("twitch-loading-spinner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("twitch-vod-player")).not.toBeInTheDocument();
  });

  it("should show error message when a Kick clipError is present", () => {
    const kickClip = { ...mockClip, platform: "kick" as Platform };

    render(
      <ClipDialog
        selectedClip={kickClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError="Failed to fetch clip"
        clipPlaybackUrl={null}
        platform="kick"
        channelName="coolstreamer"
        channelData={{ ...mockChannelData, platform: "kick" }}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByText("Failed to load clip")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch clip")).toBeInTheDocument();
  });

  it("should render Twitch player when platform is twitch and url is available", () => {
    render(
      <ClipDialog
        selectedClip={mockClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="twitch"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByTestId("twitch-vod-player")).toBeInTheDocument();
    expect(screen.getByTestId("twitch-vod-player")).toHaveAttribute(
      "data-stream-url",
      "http://video.url"
    );
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
    expect(screen.getAllByText("Awesome Clip").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CoolStreamer").length).toBeGreaterThan(0);
  });

  it("should render Kick player when platform is kick and url is available", () => {
    const kickClip = { ...mockClip, platform: "kick" as Platform };
    render(
      <ClipDialog
        selectedClip={kickClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="kick"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByTestId("kick-vod-player")).toBeInTheDocument();
  });

  it("records Twitch clip identity without its reversible playback URL", async () => {
    render(
      <ClipDialog
        selectedClip={mockClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="twitch-clip-media://sentinel-clip"
        platform="twitch"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    await waitFor(() => expect(addToHistory).toHaveBeenCalledTimes(1));
    const historyItem = addToHistory.mock.calls[0]?.[0];
    expect(historyItem).toEqual(
      expect.objectContaining({
        id: "twitch-clip-clip-123",
        originalId: "clip-123",
        title: "Awesome Clip",
        thumbnail: "thumb.jpg",
        platform: "twitch",
        type: "clip",
        channelName: "coolstreamer",
        channelDisplayName: "CoolStreamer",
        channelAvatar: "avatar.jpg",
        channelFollowerCount: 1000,
        clipViews: "100",
        clipCreatorName: "Clipper",
        clipCategory: "Just Chatting",
      })
    );
    expect(historyItem).not.toHaveProperty("playbackUrl");
  });

  it("should render real clip and channel metadata instead of hidden placeholders", () => {
    render(
      <ClipDialog
        selectedClip={mockClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="twitch"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByText("Just Chatting")).toBeInTheDocument();
    expect(screen.getByText("Clipped by @Clipper")).toBeInTheDocument();
    expect(screen.getByText("100 views")).toBeInTheDocument();
    expect(screen.getByText("1K followers")).toBeInTheDocument();
    expect(screen.queryByText("Followers hidden")).not.toBeInTheDocument();
    expect(screen.getByTestId("platform-avatar")).toHaveAttribute("data-src", "avatar.jpg");
  });

  it("routes the channel name using the selected clip identity and closes the dialog", () => {
    render(
      <ClipDialog
        selectedClip={{ ...mockClip, platform: "kick", channelSlug: "canonical-channel" }}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="twitch"
        channelName="stale-parent-channel"
        channelData={{ ...mockChannelData, username: "stale-channel-data" }}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    fireEvent.click(screen.getByRole("link", { name: "CoolStreamer" }));

    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "canonical-channel" },
    });
  });

  it("should render category and view count when clip payload uses viewCount", () => {
    render(
      <ClipDialog
        selectedClip={{
          ...mockClip,
          views: "",
          viewCount: 12345,
          category: "Fortnite",
          gameName: "Ignored fallback",
        }}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="twitch"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByText("Fortnite")).toBeInTheDocument();
    expect(screen.getByText("12.3K views")).toBeInTheDocument();
    expect(screen.queryByText("Ignored fallback")).not.toBeInTheDocument();
  });

  it("should fall back to real clip channel metadata while channel lookup is unavailable", () => {
    render(
      <ClipDialog
        selectedClip={{
          ...mockClip,
          channelName: "Clip Channel",
          channelAvatar: "clip-avatar.jpg",
          channelFollowerCount: 2500,
        }}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="twitch"
        channelName="coolstreamer"
        channelData={null}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getAllByText("Clip Channel").length).toBeGreaterThan(0);
    expect(screen.getByText("2.5K followers")).toBeInTheDocument();
    expect(screen.getByTestId("platform-avatar")).toHaveAttribute("data-src", "clip-avatar.jpg");
  });

  it("should not embed or record a Twitch clip when direct playback url is unavailable", () => {
    render(
      <ClipDialog
        selectedClip={mockClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl={null}
        platform="twitch"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByText("No playback URL available")).toBeInTheDocument();
    expect(screen.queryByTestId("twitch-vod-player")).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
    expect(addToHistory).not.toHaveBeenCalled();
  });

  it("should show an app error instead of embedding Twitch when direct playback errors", () => {
    render(
      <ClipDialog
        selectedClip={mockClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError="Playback lookup failed"
        clipPlaybackUrl={null}
        platform="twitch"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByText("Failed to load clip")).toBeInTheDocument();
    expect(screen.getByText("Playback lookup failed")).toBeInTheDocument();
    expect(screen.queryByTestId("twitch-vod-player")).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
    expect(addToHistory).not.toHaveBeenCalled();
  });

  it("should not record an unplayable Kick clip in history when no playback url is available", () => {
    const kickClip = { ...mockClip, platform: "kick" as Platform };

    render(
      <ClipDialog
        selectedClip={kickClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl={null}
        platform="kick"
        channelName="coolstreamer"
        channelData={{ ...mockChannelData, platform: "kick" }}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(addToHistory).not.toHaveBeenCalled();
  });

  it("should prefer the selected clip platform over a stale parent platform", () => {
    const kickClip = { ...mockClip, platform: "kick" as Platform };

    render(
      <ClipDialog
        selectedClip={kickClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="twitch"
        channelName="coolstreamer"
        channelData={{ ...mockChannelData, platform: "kick" }}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    expect(screen.getByTestId("kick-vod-player")).toBeInTheDocument();
    expect(screen.queryByTestId("twitch-vod-player")).not.toBeInTheDocument();
  });

  it("should handle VOD lookup for Kick when Watch Full Video is clicked", async () => {
    const kickClip = {
      ...mockClip,
      platform: "kick" as Platform,
      channelSlug: "coolstreamer",
      vodId: "123",
    };

    const mockGetByLivestreamId = vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: "vod-real-id",
        source: "vod-source",
        title: "Full VOD",
        channelName: "coolstreamer",
      },
    });

    window.electronAPI.videos.getByLivestreamId = mockGetByLivestreamId;

    render(
      <ClipDialog
        selectedClip={kickClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="kick"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    const watchButton = screen.getByText("Watch Full Video");
    fireEvent.click(watchButton);

    expect(watchButton).toBeDisabled();
    expect(screen.getByText("Loading VOD...")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetByLivestreamId).toHaveBeenCalledWith({
        channelSlug: "coolstreamer",
        livestreamId: "123",
      });
      expect(mockOnClose).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "/video/$platform/$videoId",
          params: { platform: "kick", videoId: "vod-real-id" },
        })
      );
    });
  });

  it("should show error when Kick VOD lookup fails", async () => {
    const kickClip = {
      ...mockClip,
      platform: "kick" as Platform,
      channelSlug: "coolstreamer",
      vodId: "123",
    };

    const mockGetByLivestreamId = vi.fn().mockResolvedValue({
      success: false,
      error: "VOD not found",
    });

    window.electronAPI.videos.getByLivestreamId = mockGetByLivestreamId;

    render(
      <ClipDialog
        selectedClip={kickClip}
        onClose={mockOnClose}
        clipLoading={false}
        clipError={null}
        clipPlaybackUrl="http://video.url"
        platform="kick"
        channelName="coolstreamer"
        channelData={mockChannelData}
        onPlaybackError={mockOnPlaybackError}
      />
    );

    const watchButton = screen.getByText("Watch Full Video");
    fireEvent.click(watchButton);

    await waitFor(() => {
      expect(screen.getByText("VOD not found")).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
