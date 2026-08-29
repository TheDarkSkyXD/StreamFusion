import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KickVodPlayer, type KickVodPlayerProps } from "@/features/playback/components/player/kick/kick-vod-player";
import { TwitchVodPlayer } from "@/features/playback/components/player/twitch/twitch-vod-player";
import type { QualityLevel } from "@/features/playback/components/player/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createChatReplayPlaybackStore } from "@/features/chat/data/chat-replay-playback-store";
import { useSeekIntervalStore } from "@/store/seek-interval-store";

vi.mock("@/features/playback/components/player/hooks/use-seek-preview", () => ({
  useSeekPreview: () => ({
    previewImage: undefined,
    handleSeekHover: vi.fn(),
  }),
}));

vi.mock("@/features/playback/components/player/play-pause-button", () => ({
  PlayPauseButton: ({ onToggle }: { onToggle: () => void }) => (
    <button type="button" onClick={onToggle}>
      Play/Pause
    </button>
  ),
}));

vi.mock("@/features/playback/components/player/volume-control", () => ({
  VolumeControl: () => null,
}));

vi.mock("@/features/playback/components/player/settings-menu", () => ({
  SettingsMenu: () => null,
}));

vi.mock("@/features/playback/components/player/twitch/twitch-progress-bar", () => ({
  TwitchProgressBar: () => null,
}));

vi.mock("@/features/playback/components/player/kick/kick-progress-bar", () => ({
  KickProgressBar: () => null,
}));

vi.mock("@/features/playback/components/player/hls-player", () => ({
  HlsPlayer: React.forwardRef<
    HTMLVideoElement,
    React.VideoHTMLAttributes<HTMLVideoElement> & {
      currentLevel?: string;
      hlsConfig?: unknown;
      onHlsInstance?: unknown;
      onQualityLevels?: (levels: QualityLevel[]) => void;
      sources?: unknown;
    }
  >(
    (
      {
        currentLevel: _currentLevel,
        hlsConfig: _hlsConfig,
        onHlsInstance: _onHlsInstance,
        onQualityLevels,
        sources: _sources,
        ...props
      },
      ref
    ) => {
      const testId = props.src?.includes("kick") ? "kick-vod-video" : "twitch-vod-video";
      return (
        <>
          <button type="button" onClick={() => onQualityLevels?.([])}>
            Publish qualities
          </button>
          <video ref={ref} data-testid={testId} {...props} />
        </>
      );
    }
  ),
}));

function renderTwitchVodAt(currentTime: number, duration: number) {
  render(
    <TooltipProvider>
      <TwitchVodPlayer streamUrl="https://usher.ttvnw.net/vod/123.m3u8" />
    </TooltipProvider>
  );

  const video = screen.getByTestId<HTMLVideoElement>("twitch-vod-video");
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  video.currentTime = currentTime;
  fireEvent.durationChange(video);
  fireEvent.timeUpdate(video);
  return video;
}

function renderKickVodAt(
  currentTime: number,
  duration: number,
  props: Pick<KickVodPlayerProps, "subscribeToSeek"> = {}
) {
  render(
    <TooltipProvider>
      <KickVodPlayer streamUrl="https://stream.kick.com/vod/123.m3u8" {...props} />
    </TooltipProvider>
  );

  const video = screen.getByTestId<HTMLVideoElement>("kick-vod-video");
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  video.currentTime = currentTime;
  fireEvent.durationChange(video);
  fireEvent.timeUpdate(video);
  return video;
}

// Guards: Twitch VOD seek controls consume the persisted independent intervals at the real player seam.
// Guards: Kick VOD seek controls consume the persisted independent intervals at the real player seam.
// Guards: relative seeks start from the media element's authoritative currentTime and update visible state immediately.
// Guards: Kick chat-replay timestamp requests remain exact absolute seeks, independent of relative seek preferences.
describe("platform VOD seek intervals", () => {
  beforeEach(() => {
    useSeekIntervalStore.setState({ rewindSeconds: 7, forwardSeconds: 30 });
  });

  it("rewinds a Twitch VOD by the configured interval", () => {
    const video = renderTwitchVodAt(50, 120);
    video.currentTime = 60;

    fireEvent.click(screen.getByRole("button", { name: "Rewind 7 seconds" }));

    expect(video.currentTime).toBe(53);
    expect(screen.getByText("00:53 / 02:00")).toBeInTheDocument();
  });

  it("fast-forwards a Twitch VOD by its independently configured interval", () => {
    const video = renderTwitchVodAt(50, 120);
    video.currentTime = 60;

    fireEvent.click(screen.getByRole("button", { name: "Fast forward 30 seconds" }));

    expect(video.currentTime).toBe(90);
    expect(screen.getByText("01:30 / 02:00")).toBeInTheDocument();
  });

  it("clamps Twitch VOD rewind at the beginning", () => {
    const video = renderTwitchVodAt(4, 120);

    fireEvent.click(screen.getByRole("button", { name: "Rewind 7 seconds" }));

    expect(video.currentTime).toBe(0);
    expect(screen.getByText("00:00 / 02:00")).toBeInTheDocument();
  });

  it("clamps Twitch VOD fast-forward at the finite media duration", () => {
    const video = renderTwitchVodAt(110, 120);

    fireEvent.click(screen.getByRole("button", { name: "Fast forward 30 seconds" }));

    expect(video.currentTime).toBe(120);
    expect(screen.getByText("02:00 / 02:00")).toBeInTheDocument();
  });

  it("uses the same configured rewind action for Twitch VOD ArrowLeft", () => {
    const video = renderTwitchVodAt(50, 120);
    fireEvent.click(screen.getByRole("button", { name: "Publish qualities" }));

    fireEvent.keyDown(window, { key: "ArrowLeft" });

    expect(video.currentTime).toBe(43);
    expect(screen.getByText("00:43 / 02:00")).toBeInTheDocument();
  });

  it("uses the same configured fast-forward action for Twitch VOD ArrowRight", () => {
    const video = renderTwitchVodAt(50, 120);
    fireEvent.click(screen.getByRole("button", { name: "Publish qualities" }));

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(video.currentTime).toBe(80);
    expect(screen.getByText("01:20 / 02:00")).toBeInTheDocument();
  });

  it("rewinds a Kick VOD by the configured interval", () => {
    const video = renderKickVodAt(50, 120);
    video.currentTime = 60;

    fireEvent.click(screen.getByRole("button", { name: "Rewind 7 seconds" }));

    expect(video.currentTime).toBe(53);
    expect(screen.getByText("00:53 / 02:00")).toBeInTheDocument();
  });

  it("fast-forwards a Kick VOD by its independently configured interval", () => {
    const video = renderKickVodAt(50, 120);
    video.currentTime = 60;

    fireEvent.click(screen.getByRole("button", { name: "Fast forward 30 seconds" }));

    expect(video.currentTime).toBe(90);
    expect(screen.getByText("01:30 / 02:00")).toBeInTheDocument();
  });

  it("clamps and disables Kick VOD rewind at the beginning", () => {
    const video = renderKickVodAt(4, 120);

    fireEvent.click(screen.getByRole("button", { name: "Rewind 7 seconds" }));

    expect(video.currentTime).toBe(0);
    expect(screen.getByText("00:00 / 02:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rewind 7 seconds" })).toBeDisabled();
  });

  it("clamps and disables Kick VOD fast-forward at the finite media duration", () => {
    const video = renderKickVodAt(110, 120);

    fireEvent.click(screen.getByRole("button", { name: "Fast forward 30 seconds" }));

    expect(video.currentTime).toBe(120);
    expect(screen.getByText("02:00 / 02:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fast forward 30 seconds" })).toBeDisabled();
  });

  it("uses the same configured rewind action for Kick VOD ArrowLeft", () => {
    const video = renderKickVodAt(50, 120);
    fireEvent.click(screen.getByRole("button", { name: "Publish qualities" }));

    fireEvent.keyDown(window, { key: "ArrowLeft" });

    expect(video.currentTime).toBe(43);
    expect(screen.getByText("00:43 / 02:00")).toBeInTheDocument();
  });

  it("uses the same configured fast-forward action for Kick VOD ArrowRight", () => {
    const video = renderKickVodAt(50, 120);
    fireEvent.click(screen.getByRole("button", { name: "Publish qualities" }));

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(video.currentTime).toBe(80);
    expect(screen.getByText("01:20 / 02:00")).toBeInTheDocument();
  });

  it("keeps Kick chat-replay requests as exact absolute seeks", () => {
    const playbackStore = createChatReplayPlaybackStore();
    const video = renderKickVodAt(80, 120, {
      subscribeToSeek: playbackStore.subscribeToSeek,
    });

    act(() => playbackStore.requestSeek(12.75));

    expect(video.currentTime).toBe(12.75);
    expect(screen.getByText("00:12 / 02:00")).toBeInTheDocument();
  });
});
