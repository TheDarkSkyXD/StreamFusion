import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TwitchVodPlayer } from "@/components/player/twitch/twitch-vod-player";

vi.mock("@/components/player/hooks/use-seek-preview", () => ({
  useSeekPreview: () => ({
    previewImage: undefined,
    handleSeekHover: vi.fn(),
  }),
}));

vi.mock("@/components/player/hls-player", () => ({
  HlsPlayer: React.forwardRef<HTMLVideoElement, React.VideoHTMLAttributes<HTMLVideoElement> & {
    currentLevel?: string;
    onHlsInstance?: unknown;
    onQualityLevels?: unknown;
    sources?: unknown;
  }>(({ currentLevel: _currentLevel, onHlsInstance: _onHlsInstance, onQualityLevels: _onQualityLevels, sources: _sources, ...props }, ref) => (
    <video ref={ref} data-testid="twitch-vod-video" {...props} />
  )),
}));

// Guards: Twitch VOD video-surface clicks cannot bypass the explicit play/pause controls.
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
});
