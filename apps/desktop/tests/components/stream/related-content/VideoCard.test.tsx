import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { VideoCard } from "@/components/stream/related-content/VideoCard";
import type { VideoOrClip } from "@/components/stream/related-content/types";
import { usePlaybackPositionStore } from "@/store/playback-position-store";

// Guards: navigating to a LIVE VideoCard must scroll the main content area to top so the player isn't pushed off-screen by leftover scroll position from a prior page
// Guards: a thumbnail load failure must not remove the real Kick VOD card or its navigation metadata while the image retries.

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
    onClick,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    // biome-ignore lint/a11y/useValidAnchor: stub for tests, not real navigation.
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/components/ui/proxied-image", () => ({
  ProxiedImage: ({
    src,
    alt,
    onProxyError,
    fallback,
  }: {
    src: string;
    alt: string;
    onProxyError?: () => void;
    fallback?: React.ReactNode;
  }) => (
    <>
      {/* biome-ignore lint/performance/noImgElement: test stub */}
      <img src={src} alt={alt} onError={onProxyError} />
      <div hidden>{fallback}</div>
    </>
  ),
}));

vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

describe("VideoCard navigation+scroll behavior", () => {
  const baseVideo: VideoOrClip = {
    id: "123",
    title: "Test Video",
    thumbnailUrl: "thumb.jpg",
    duration: "0:00",
    views: "500",
    date: "2023-01-01",
    isLive: false,
  };

  beforeEach(() => {
    usePlaybackPositionStore.setState({ positions: {} });
  });

  it("does not show saved VOD progress unless its page explicitly opts in", () => {
    usePlaybackPositionStore.getState().savePosition("twitch", "123", 90, 360);

    render(
      <VideoCard video={baseVideo} platform="twitch" channelName="Streamer" channelData={null} />
    );

    expect(screen.queryByRole("progressbar", { name: "Watch progress" })).not.toBeInTheDocument();
  });

  it("shows a full bar for a completed VOD", () => {
    usePlaybackPositionStore.getState().savePosition("kick", "123", 3500, 3600);

    render(
      <VideoCard
        video={baseVideo}
        platform="kick"
        channelName="Streamer"
        channelData={null}
        showWatchProgress
      />
    );

    expect(screen.getByRole("progressbar", { name: "Watch progress" })).toHaveAttribute(
      "aria-valuenow",
      "100"
    );
  });

  it("does not show progress for a VOD with no saved position", () => {
    render(
      <VideoCard video={baseVideo} platform="twitch" channelName="Streamer" channelData={null} />
    );

    expect(screen.queryByRole("progressbar", { name: "Watch progress" })).not.toBeInTheDocument();
  });

  it("does not show VOD progress on a currently live channel card", () => {
    usePlaybackPositionStore.getState().savePosition("twitch", "123", 90, 360);

    render(
      <VideoCard
        video={{ ...baseVideo, isLive: true }}
        platform="twitch"
        channelName="Streamer"
        channelData={null}
        showWatchProgress
      />
    );

    expect(screen.queryByRole("progressbar", { name: "Watch progress" })).not.toBeInTheDocument();
  });

  it("awaits navigation then scrolls the content area to top for a LIVE (channel) card", async () => {
    const scrollTo = vi.fn();
    const scrollArea = document.createElement("div");
    scrollArea.id = "main-content-scroll-area";
    (scrollArea as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    document.body.appendChild(scrollArea);
    mockNavigate.mockClear();

    const liveVideo: VideoOrClip = { ...baseVideo, isLive: true };
    render(
      <VideoCard video={liveVideo} platform="twitch" channelName="Streamer" channelData={null} />
    );

    await act(async () => {
      fireEvent.click(screen.getByAltText("Test Video").closest("a")!);
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/stream/$platform/$channel" })
    );
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    document.body.removeChild(scrollArea);
  });

  it("keeps the VOD card and a clear unavailable state when its thumbnail fails", () => {
    render(
      <VideoCard video={baseVideo} platform="kick" channelName="Streamer" channelData={null} />
    );

    fireEvent.error(screen.getByAltText("Test Video"));

    expect(screen.getByText("Test Video")).toBeInTheDocument();
    expect(screen.getByText("Thumbnail unavailable")).toBeInTheDocument();
  });

  it("shows a truthful unavailable state when Kick supplies no thumbnail URL", () => {
    render(
      <VideoCard
        video={{ ...baseVideo, thumbnailUrl: "" }}
        platform="kick"
        channelName="Streamer"
        channelData={null}
      />
    );

    expect(screen.getByText("Test Video")).toBeInTheDocument();
    expect(screen.getByText("Thumbnail unavailable")).toBeInTheDocument();
  });
});
