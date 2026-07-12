import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KickLivePlayer } from "@/components/player/kick/kick-live-player";
import { KickVodPlayer } from "@/components/player/kick/kick-vod-player";
import { TwitchLivePlayer } from "@/components/player/twitch/twitch-live-player";
import { TwitchVodPlayer } from "@/components/player/twitch/twitch-vod-player";

const h = vi.hoisted(() => ({
  kickReady: null as null | (() => void),
  twitchReady: null as null | (() => void),
  twitchVodReady: null as null | (() => void),
}));

vi.mock("@/components/dev/use-render-count", () => ({ useRenderCount: vi.fn() }));
vi.mock("@/components/ui/loading-spinner", () => ({
  KickLoadingSpinner: () => null,
  TwitchLoadingSpinner: () => null,
}));
vi.mock("@/components/player/hooks/use-default-quality", () => ({ useDefaultQuality: vi.fn() }));
vi.mock("@/components/player/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({ isFullscreen: false, toggleFullscreen: vi.fn() }),
}));
vi.mock("@/components/player/hooks/use-picture-in-picture", () => ({
  usePictureInPicture: () => ({ isPip: false, togglePip: vi.fn() }),
}));
vi.mock("@/components/player/hooks/use-resume-playback", () => ({ useResumePlayback: vi.fn() }));
vi.mock("@/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    volume: 50,
    isMuted: false,
    handleVolumeChange: vi.fn(),
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-ad-element-observer", () => ({ useAdElementObserver: vi.fn() }));
vi.mock("@/store/adblock-store", () => ({ useAdBlockStore: () => false }));
vi.mock("@/components/player/kick/uptime-readout", () => ({ UptimeReadout: () => null }));
vi.mock("@/components/player/kick/kick-live-player-controls", () => ({
  KickLivePlayerControls: () => null,
}));
vi.mock("@/components/player/twitch/twitch-live-player-controls", () => ({
  TwitchLivePlayerControls: () => null,
}));
vi.mock("@/components/player/twitch/ad-block-fallback-overlay", () => ({
  AdBlockFallbackOverlay: () => null,
}));
vi.mock("@/components/player/twitch/video-stats-overlay", () => ({
  VideoStatsOverlay: () => null,
}));

vi.mock("@/components/player/kick/kick-hls-player", async () => {
  const { forwardRef } = await import("react");
  return {
    KickHlsPlayer: forwardRef<HTMLVideoElement, { onQualityLevels?: (levels: []) => void }>(
      ({ onQualityLevels }, ref) => {
        h.kickReady = () => onQualityLevels?.([]);
        return <video ref={ref} data-testid="live-video" />;
      }
    ),
  };
});
vi.mock("@/components/player/twitch/twitch-hls-player", async () => {
  const { forwardRef } = await import("react");
  return {
    TwitchHlsPlayer: forwardRef<HTMLVideoElement, { onQualityLevels?: (levels: []) => void }>(
      ({ onQualityLevels }, ref) => {
        h.twitchReady = () => onQualityLevels?.([]);
        return <video ref={ref} data-testid="live-video" />;
      }
    ),
  };
});
vi.mock("@/components/player/twitch/twitch-vod-hls-player", async () => {
  const { forwardRef } = await import("react");
  return {
    TwitchVodHlsPlayer: forwardRef<HTMLVideoElement, { onQualityLevels?: (levels: []) => void }>(
      ({ onQualityLevels }, ref) => {
        h.twitchVodReady = () => onQualityLevels?.([]);
        return <video ref={ref} data-testid="live-video" />;
      }
    ),
  };
});

function pressKey(key: string, target?: HTMLElement) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  if (target) Object.defineProperty(event, "target", { value: target });
  window.dispatchEvent(event);
}

function installPlaybackSpies(video: HTMLVideoElement) {
  let paused = true;
  const play = vi.fn().mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  const pause = vi.fn().mockImplementation(() => {
    paused = true;
  });
  Object.defineProperties(video, {
    paused: { get: () => paused, configurable: true },
    play: { value: play, configurable: true },
    pause: { value: pause, configurable: true },
  });
  return { play, pause };
}

// Guards: ready Kick and Twitch live players retain Space/K playback shortcuts.
// Guards: Space on a focused unrelated control cannot also toggle live playback.
describe.each([
  ["Kick", () => <KickLivePlayer streamUrl="https://example.test/kick.m3u8" />, () => h.kickReady],
  [
    "Twitch",
    () => (
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/example.m3u8"
        channelName="example"
      />
    ),
    () => h.twitchReady,
  ],
] as const)("%s live player keyboard playback authority", (_platform, renderPlayer, getReady) => {
  it("keeps Space/K shortcuts without colliding with a focused unrelated control", async () => {
    const { getByTestId } = render(renderPlayer());
    const video = getByTestId("live-video") as HTMLVideoElement;
    const { play, pause } = installPlaybackSpies(video);

    await waitFor(() => expect(getReady()).toBeTypeOf("function"));
    act(() => getReady()?.());
    act(() => pressKey(" "));
    expect(play).toHaveBeenCalledTimes(1);
    act(() => pressKey("k"));
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);

    const unrelatedButton = document.createElement("button");
    act(() => pressKey(" ", unrelatedButton));
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});

// Guards: ready Kick and Twitch VOD players retain Space/K playback shortcuts.
// Guards: Space on a focused unrelated control cannot also toggle VOD playback.
describe.each([
  [
    "Kick",
    () => <KickVodPlayer streamUrl="https://example.test/kick-vod.m3u8" />,
    () => h.kickReady,
  ],
  [
    "Twitch",
    () => <TwitchVodPlayer streamUrl="https://usher.ttvnw.net/vod/example.m3u8" />,
    () => h.twitchVodReady,
  ],
] as const)("%s VOD player keyboard playback authority", (_platform, renderPlayer, getReady) => {
  it("keeps Space/K shortcuts without colliding with a focused unrelated control", async () => {
    const { getByTestId } = render(renderPlayer());
    const video = getByTestId("live-video") as HTMLVideoElement;
    const { play, pause } = installPlaybackSpies(video);

    await waitFor(() => expect(getReady()).toBeTypeOf("function"));
    act(() => getReady()?.());
    act(() => pressKey(" "));
    expect(play).toHaveBeenCalledTimes(1);
    act(() => pressKey("k"));
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);

    const unrelatedButton = document.createElement("button");
    act(() => pressKey(" ", unrelatedButton));
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
