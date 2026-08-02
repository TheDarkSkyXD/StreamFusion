import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { KickVodPlayer } from "@/components/player/kick/kick-vod-player";
import type { QualityLevel } from "@/components/player/types";
import { createChatReplayPlaybackStore } from "@/hooks/chat-replay-playback-store";

vi.mock("@/components/player/hooks/use-seek-preview", () => ({
  useSeekPreview: () => ({
    previewImage: undefined,
    handleSeekHover: vi.fn(),
  }),
}));

vi.mock("@/components/player/hls-player", () => ({
  HlsPlayer: React.forwardRef<
    HTMLVideoElement,
    React.VideoHTMLAttributes<HTMLVideoElement> & {
      currentLevel?: string;
      hlsConfig?: unknown;
      onHlsInstance?: unknown;
      onQualityLevels?: (levels: QualityLevel[]) => void;
    }
  >(
    (
      {
        currentLevel: _currentLevel,
        hlsConfig: _hlsConfig,
        onHlsInstance: _onHlsInstance,
        onQualityLevels,
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
        <video ref={ref} data-testid="kick-vod-video" {...props} />
      </>
    )
  ),
}));

// Guards: Kick VOD readiness requires playable media; manifest quality discovery alone cannot ready the player.
describe("KickVodPlayer", () => {
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
});
