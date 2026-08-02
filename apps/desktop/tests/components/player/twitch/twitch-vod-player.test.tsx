import { fireEvent, render, screen } from "@testing-library/react";
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
describe("TwitchVodPlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

    const video = screen.getByTestId("twitch-vod-video");
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

    const video = screen.getByTestId("twitch-vod-video");
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    fireEvent.durationChange(video);

    fireEvent.click(screen.getByRole("button", { name: "Seek to 61 seconds" }));

    expect(screen.getByLabelText("Visible playback position")).toHaveTextContent("61");
    expect(video.currentTime).toBe(61);
  });
});
