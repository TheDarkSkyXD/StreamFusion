import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TwitchVodPlayer } from "@/components/player/twitch/twitch-vod-player";
import type { QualityLevel } from "@/components/player/types";

vi.mock("@/components/player/hooks/use-seek-preview", () => ({
  useSeekPreview: () => ({
    previewImage: undefined,
    handleSeekHover: vi.fn(),
  }),
}));

vi.mock("@/components/player/twitch/twitch-vod-player-controls", () => ({
  TwitchVodPlayerControls: ({
    currentTime,
    onSeek,
  }: {
    currentTime: number;
    onSeek: (time: number) => void;
  }) => (
    <div>
      <output aria-label="Visible playback position">{currentTime}</output>
      <button type="button" onClick={() => onSeek(61)}>
        Seek to 61 seconds
      </button>
    </div>
  ),
}));

vi.mock("@/components/player/hls-player", () => ({
  HlsPlayer: React.forwardRef<
    HTMLVideoElement,
    React.VideoHTMLAttributes<HTMLVideoElement> & {
      currentLevel?: string;
      onHlsInstance?: unknown;
      onQualityLevels?: (levels: QualityLevel[]) => void;
      sources?: unknown;
    }
  >(
    (
      {
        currentLevel: _currentLevel,
        onHlsInstance: _onHlsInstance,
        onQualityLevels,
        sources: _sources,
        ...props
      },
      ref
    ) => (
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
        <video ref={ref} data-testid="twitch-vod-video" {...props} />
      </>
    )
  ),
}));

// Guards: Twitch VOD video-surface clicks cannot bypass the explicit play/pause controls.
// Guards: Twitch VOD readiness requires playable media; manifest quality discovery alone cannot ready the player.
// Guards: a seek updates the visible playback position immediately, without waiting for timeupdate.
// Guards: native MP4 seeks use bounded reseeks, clear loading on presentation, and never load or autoplay.
// Guards: unresolved native MP4 seeks exhaust once at 7.5 seconds and never leave loading indefinite.
// Guards: pausing an active native MP4 seek clears loading without later recovery or failure.
// Guards: a new stream URL clears terminal seek state and cannot revive the old generation.
describe("TwitchVodPlayer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("does not play a paused VOD when its video surface is clicked", () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(<TwitchVodPlayer streamUrl="https://usher.ttvnw.net/vod/123.m3u8" autoPlay />);

    fireEvent.click(screen.getByTestId("twitch-vod-video"));

    expect(playSpy).not.toHaveBeenCalled();
  });

  it("becomes ready on canplay, not when quality levels are published", () => {
    const onReady = vi.fn();
    const { rerender } = render(
      <TwitchVodPlayer streamUrl="https://usher.ttvnw.net/vod/123.m3u8" onReady={onReady} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish qualities" }));
    expect(onReady).not.toHaveBeenCalled();

    const video = screen.getByTestId<HTMLVideoElement>("twitch-vod-video");
    fireEvent.canPlay(video);
    fireEvent.canPlay(video);
    expect(onReady).toHaveBeenCalledTimes(1);

    rerender(
      <TwitchVodPlayer streamUrl="https://usher.ttvnw.net/vod/456.m3u8" onReady={onReady} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish qualities" }));
    expect(onReady).toHaveBeenCalledTimes(1);

    rerender(
      <TwitchVodPlayer streamUrl="https://usher.ttvnw.net/vod/123.m3u8" onReady={onReady} />
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    fireEvent.canPlay(screen.getByTestId("twitch-vod-video"));
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it("updates the visible playback position in the seek event", () => {
    render(<TwitchVodPlayer streamUrl="https://usher.ttvnw.net/vod/123.m3u8" />);

    const video = screen.getByTestId<HTMLVideoElement>("twitch-vod-video");
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.durationChange(video);

    fireEvent.click(screen.getByRole("button", { name: "Seek to 61 seconds" }));

    expect(screen.getByLabelText("Visible playback position")).toHaveTextContent("61");
    expect(video.currentTime).toBe(61);
  });

  it("recovers a native MP4 seek with bounded reseeks and no load or autoplay", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { container } = render(
      <TwitchVodPlayer streamUrl="https://clips.example.test/highlight.mp4" onError={onError} />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-vod-video");
    const reseekTargets: number[] = [];
    let currentTime = 0;
    let readyState: number = HTMLMediaElement.HAVE_METADATA;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        reseekTargets.push(value);
      },
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => readyState,
    });
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    const load = vi.fn();
    const play = vi.fn();
    Object.defineProperty(video, "load", { configurable: true, value: load });
    Object.defineProperty(video, "play", { configurable: true, value: play });

    fireEvent.durationChange(video);
    fireEvent.canPlay(video);
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Seek to 61 seconds" }));
    expect(screen.getByLabelText("Visible playback position")).toHaveTextContent("61");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(reseekTargets).toEqual([61]);

    act(() => vi.advanceTimersByTime(2_500));
    expect(reseekTargets).toEqual([61, 61]);
    act(() => vi.advanceTimersByTime(3_000));
    expect(reseekTargets).toEqual([61, 61, 60.75, 61]);

    act(() => {
      readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
      currentTime = 61;
      fireEvent.seeked(video);
      fireEvent.timeUpdate(video);
    });
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(100_000));
    expect(onError).not.toHaveBeenCalled();
    expect(reseekTargets).toEqual([61, 61, 60.75, 61]);
    expect(load).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("clears seek loading when playback pauses without later native recovery", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { container } = render(
      <TwitchVodPlayer streamUrl="https://clips.example.test/paused.mp4" onError={onError} />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-vod-video");
    const reseekTargets: number[] = [];
    let currentTime = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        reseekTargets.push(value);
      },
    });
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.durationChange(video);
    fireEvent.canPlay(video);

    fireEvent.click(screen.getByRole("button", { name: "Seek to 61 seconds" }));
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();

    fireEvent.pause(video);
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(100_000));
    expect(onError).not.toHaveBeenCalled();
    expect(reseekTargets).toEqual([61]);
  });

  it("exhausts an unresolved native MP4 seek exactly once at 7.5 seconds", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { container } = render(
      <TwitchVodPlayer streamUrl="https://clips.example.test/terminal.mp4" onError={onError} />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-vod-video");
    const reseekTargets: number[] = [];
    let currentTime = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        reseekTargets.push(value);
      },
    });
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    const load = vi.fn();
    const play = vi.fn();
    Object.defineProperty(video, "load", { configurable: true, value: load });
    Object.defineProperty(video, "play", { configurable: true, value: play });
    fireEvent.durationChange(video);
    fireEvent.canPlay(video);

    fireEvent.click(screen.getByRole("button", { name: "Seek to 61 seconds" }));
    act(() => vi.advanceTimersByTime(7_499));

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
    expect(reseekTargets).toEqual([61, 61, 60.75, 61]);
    expect(load).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledExactlyOnceWith({
      code: "SEEK_TIMEOUT",
      message: "Seek timed out before a matching video frame was presented",
      fatal: true,
    });

    act(() => vi.advanceTimersByTime(100_000));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reseekTargets).toEqual([61, 61, 60.75, 61]);
    expect(load).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("restores controls and seek recovery when the stream URL changes after terminal failure", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { container, rerender } = render(
      <TwitchVodPlayer streamUrl="https://clips.example.test/failed.mp4" onError={onError} />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-vod-video");
    const reseekTargets: number[] = [];
    let currentTime = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        reseekTargets.push(value);
      },
    });
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.durationChange(video);
    fireEvent.canPlay(video);

    fireEvent.click(screen.getByRole("button", { name: "Seek to 61 seconds" }));
    act(() => vi.advanceTimersByTime(7_500));
    expect(
      screen.queryByRole("button", { name: "Seek to 61 seconds" })
    ).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reseekTargets).toEqual([61, 61, 60.75, 61]);

    rerender(
      <TwitchVodPlayer streamUrl="https://clips.example.test/recovered.mp4" onError={onError} />
    );
    fireEvent.canPlay(video);
    fireEvent.click(screen.getByRole("button", { name: "Seek to 61 seconds" }));
    act(() => vi.advanceTimersByTime(2_500));
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(reseekTargets).toEqual([61, 61, 60.75, 61, 61, 61]);

    fireEvent.pause(video);
    act(() => vi.advanceTimersByTime(100_000));
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reseekTargets).toEqual([61, 61, 60.75, 61, 61, 61]);
  });
});
