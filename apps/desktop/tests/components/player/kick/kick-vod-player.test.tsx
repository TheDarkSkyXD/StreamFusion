import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KickVodPlayer } from "@/components/player/kick/kick-vod-player";
import type { QualityLevel } from "@/components/player/types";
import { createChatReplayPlaybackStore } from "@/hooks/chat-replay-playback-store";

const hookMocks = vi.hoisted(() => ({
  useResumePlayback: vi.fn(),
  useSeekPreview: vi.fn(() => ({
    previewImage: undefined,
    handleSeekHover: vi.fn(),
  })),
}));

const hlsBoundary = vi.hoisted(() => ({
  startLoad: vi.fn(),
  stopLoad: vi.fn(),
  subtitleTracks: [],
  subtitleTrack: -1,
  config: {},
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock("@/components/player/hooks/use-seek-preview", () => ({
  useSeekPreview: hookMocks.useSeekPreview,
}));

vi.mock("@/components/player/hooks/use-resume-playback", () => ({
  useResumePlayback: hookMocks.useResumePlayback,
}));

vi.mock("@/components/player/kick/kick-vod-player-controls", () => ({
  KickVodPlayerControls: ({ onSeek }: { onSeek: (time: number) => void }) => (
    <button type="button" onClick={() => onSeek(72)}>
      Seek to 72 seconds
    </button>
  ),
}));

vi.mock("@/components/player/hls-player", () => ({
  HlsPlayer: React.forwardRef<
    HTMLVideoElement,
    React.VideoHTMLAttributes<HTMLVideoElement> & {
      currentLevel?: string;
      hlsConfig?: unknown;
      onHlsInstance?: (hls: typeof hlsBoundary) => void;
      onQualityLevels?: (levels: QualityLevel[]) => void;
    }
  >(
    (
      {
        currentLevel: _currentLevel,
        hlsConfig: _hlsConfig,
        onHlsInstance,
        onQualityLevels,
        ...props
      },
      ref
    ) => {
      React.useEffect(() => {
        onHlsInstance?.(hlsBoundary);
      }, [onHlsInstance]);

      return (
        <>
          <button
            type="button"
            onClick={() =>
              onQualityLevels?.([
                { id: "0", label: "720p", width: 1280, height: 720, bitrate: 3_000_000 },
              ])
            }
          >
            Publish qualities
          </button>
          <video ref={ref} data-testid="kick-vod-video" {...props} />
        </>
      );
    }
  ),
}));

// Guards: Kick VOD readiness requires playable media; manifest quality discovery alone cannot ready the player.
// Guards: rapid Kick VOD seeks recover only the newest target and clear loading on its first presented frame.
// Guards: unresolved Kick VOD seeks exhaust once at 7.5 seconds and never leave loading indefinite.
// Guards: pausing an active HLS VOD seek clears loading without later recovery or failure.
// Guards: a new stream URL clears terminal seek state and cannot revive the old generation.
// Guards: Kick VOD thumbnails use the image proxy for poster and seek preview while persistence keeps the provider URL.
describe("KickVodPlayer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("resolves the reported Kick thumbnail once for poster and seek preview", () => {
    const thumbnail = "https://images.kick.com/video_thumbnails/DsuAwCgUc9Bh/lB7LKqQzyR6s/720.webp";
    const resolvedThumbnail =
      "kick-image://image?u=aHR0cHM6Ly9pbWFnZXMua2ljay5jb20vdmlkZW9fdGh1bWJuYWlscy9Ec3VBd0NnVWM5QmgvbEI3TEtxUXp5UjZzLzcyMC53ZWJw";

    render(
      <KickVodPlayer
        streamUrl="https://stream.kick.com/vod/123.m3u8"
        videoId="123"
        thumbnail={thumbnail}
      />
    );

    expect(screen.getByTestId("kick-vod-video")).toHaveAttribute("poster", resolvedThumbnail);
    expect(hookMocks.useSeekPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        streamUrl: "https://stream.kick.com/vod/123.m3u8",
        thumbnail: resolvedThumbnail,
      })
    );
    expect(hookMocks.useResumePlayback).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnail })
    );
  });

  it("becomes ready on canplay, not when quality levels are published", () => {
    const onReady = vi.fn();
    const { rerender } = render(
      <KickVodPlayer streamUrl="https://stream.kick.com/vod/123.m3u8" onReady={onReady} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish qualities" }));
    expect(onReady).not.toHaveBeenCalled();

    const video = screen.getByTestId("kick-vod-video");
    fireEvent.canPlay(video);
    fireEvent.canPlay(video);
    expect(onReady).toHaveBeenCalledTimes(1);

    rerender(<KickVodPlayer streamUrl="https://stream.kick.com/vod/456.m3u8" onReady={onReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish qualities" }));
    expect(onReady).toHaveBeenCalledTimes(1);

    rerender(<KickVodPlayer streamUrl="https://stream.kick.com/vod/123.m3u8" onReady={onReady} />);
    expect(onReady).toHaveBeenCalledTimes(1);
    fireEvent.canPlay(screen.getByTestId("kick-vod-video"));
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it("publishes fractional playback snapshots from the media element", () => {
    const onPlaybackStateChange = vi.fn();
    render(
      <KickVodPlayer
        streamUrl="https://stream.kick.com/vod/123.m3u8"
        onPlaybackStateChange={onPlaybackStateChange}
      />
    );
    const video = screen.getByTestId("kick-vod-video") as HTMLVideoElement;

    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 42.625,
      writable: true,
    });
    fireEvent.timeUpdate(video);
    fireEvent.play(video);
    Object.defineProperty(video, "playbackRate", {
      configurable: true,
      value: 1.5,
      writable: true,
    });
    fireEvent.rateChange(video);

    expect(onPlaybackStateChange).toHaveBeenLastCalledWith({
      currentTime: 42.625,
      isPlaying: true,
      playbackRate: 1.5,
    });

    fireEvent.pause(video);
    expect(onPlaybackStateChange).toHaveBeenLastCalledWith({
      currentTime: 42.625,
      isPlaying: false,
      playbackRate: 1.5,
    });
  });

  it("applies replay timestamp seek requests to the media element", () => {
    const playbackStore = createChatReplayPlaybackStore();
    render(
      <KickVodPlayer
        streamUrl="https://stream.kick.com/vod/123.m3u8"
        subscribeToSeek={playbackStore.subscribeToSeek}
      />
    );
    const video = screen.getByTestId("kick-vod-video") as HTMLVideoElement;

    act(() => playbackStore.requestSeek(12.75));

    expect(video.currentTime).toBe(12.75);
  });

  it("recovers only the newest committed seek and clears its loading state", () => {
    vi.useFakeTimers();
    const playbackStore = createChatReplayPlaybackStore();
    const onError = vi.fn();
    const { container } = render(
      <KickVodPlayer
        streamUrl="https://stream.kick.com/vod/123.m3u8"
        subscribeToSeek={playbackStore.subscribeToSeek}
        onError={onError}
      />
    );
    const video = screen.getByTestId("kick-vod-video") as HTMLVideoElement;
    let currentTime = 0;
    let readyState: number = HTMLMediaElement.HAVE_METADATA;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => readyState,
    });
    Object.defineProperty(video, "paused", { configurable: true, value: false });

    fireEvent.canPlay(video);
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();

    act(() => {
      playbackStore.requestSeek(12);
      vi.advanceTimersByTime(100);
      playbackStore.requestSeek(48);
    });
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_499));
    expect(hlsBoundary.startLoad).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(hlsBoundary.startLoad).toHaveBeenCalledExactlyOnceWith(48);
    expect(hlsBoundary.startLoad.mock.calls.flat()).not.toContain(12);

    act(() => {
      readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
      currentTime = 48;
      fireEvent.seeked(video);
      fireEvent.timeUpdate(video);
    });

    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(100_000));
    expect(onError).not.toHaveBeenCalled();
    expect(hlsBoundary.startLoad).toHaveBeenCalledTimes(1);
    expect(hlsBoundary.stopLoad).not.toHaveBeenCalled();
  });

  it("clears seek loading when playback pauses without later HLS recovery", () => {
    vi.useFakeTimers();
    const playbackStore = createChatReplayPlaybackStore();
    const onError = vi.fn();
    const { container } = render(
      <KickVodPlayer
        streamUrl="https://stream.kick.com/vod/paused.m3u8"
        subscribeToSeek={playbackStore.subscribeToSeek}
        onError={onError}
      />
    );
    const video = screen.getByTestId("kick-vod-video") as HTMLVideoElement;
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.canPlay(video);

    act(() => playbackStore.requestSeek(48));
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();

    fireEvent.pause(video);
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(100_000));
    expect(onError).not.toHaveBeenCalled();
    expect(hlsBoundary.startLoad).not.toHaveBeenCalled();
    expect(hlsBoundary.stopLoad).not.toHaveBeenCalled();
  });

  it("exhausts an unresolved HLS VOD seek exactly once at 7.5 seconds", () => {
    vi.useFakeTimers();
    const playbackStore = createChatReplayPlaybackStore();
    const onError = vi.fn();
    const { container } = render(
      <KickVodPlayer
        streamUrl="https://stream.kick.com/vod/terminal.m3u8"
        subscribeToSeek={playbackStore.subscribeToSeek}
        onError={onError}
      />
    );
    const video = screen.getByTestId("kick-vod-video") as HTMLVideoElement;
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.canPlay(video);

    act(() => {
      playbackStore.requestSeek(48);
      vi.advanceTimersByTime(7_499);
    });

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
    expect(hlsBoundary.startLoad.mock.calls).toEqual([[48], [48]]);
    expect(hlsBoundary.stopLoad).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledExactlyOnceWith({
      code: "SEEK_TIMEOUT",
      message: "Seek timed out before a matching video frame was presented",
      fatal: true,
    });

    act(() => vi.advanceTimersByTime(100_000));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(hlsBoundary.startLoad).toHaveBeenCalledTimes(2);
    expect(hlsBoundary.stopLoad).toHaveBeenCalledTimes(1);
  });

  it("restores controls and seek recovery when the stream URL changes after terminal failure", () => {
    vi.useFakeTimers();
    const playbackStore = createChatReplayPlaybackStore();
    const onError = vi.fn();
    const { container, rerender } = render(
      <KickVodPlayer
        streamUrl="https://stream.kick.com/vod/failed.m3u8"
        subscribeToSeek={playbackStore.subscribeToSeek}
        onError={onError}
      />
    );
    const video = screen.getByTestId("kick-vod-video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.durationChange(video);
    fireEvent.canPlay(video);
    expect(screen.getByRole("button", { name: "Seek to 72 seconds" })).toBeInTheDocument();

    act(() => {
      playbackStore.requestSeek(48);
      vi.advanceTimersByTime(7_500);
    });
    expect(screen.queryByRole("button", { name: "Seek to 72 seconds" })).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);

    rerender(
      <KickVodPlayer
        streamUrl="https://stream.kick.com/vod/recovered.m3u8"
        subscribeToSeek={playbackStore.subscribeToSeek}
        onError={onError}
      />
    );
    fireEvent.canPlay(video);
    fireEvent.click(screen.getByRole("button", { name: "Seek to 72 seconds" }));

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(hlsBoundary.startLoad.mock.calls).toEqual([[48], [48], [72]]);

    fireEvent.pause(video);
    act(() => vi.advanceTimersByTime(100_000));
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(hlsBoundary.startLoad.mock.calls).toEqual([[48], [48], [72]]);
    expect(hlsBoundary.stopLoad).toHaveBeenCalledTimes(1);
  });
});
