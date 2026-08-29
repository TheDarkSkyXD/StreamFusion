import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KickLivePlayer } from "@/features/playback/components/player/kick/kick-live-player";
import { KickVodPlayer } from "@/features/playback/components/player/kick/kick-vod-player";
import { TwitchLivePlayer } from "@/features/playback/components/player/twitch/twitch-live-player";
import { TwitchVodPlayer } from "@/features/playback/components/player/twitch/twitch-vod-player";

const h = vi.hoisted(() => ({
  kickReady: null as null | (() => void),
  kickControlProps: null as null | Record<string, unknown>,
  twitchReady: null as null | (() => void),
  twitchAudioProps: null as null | { muted?: boolean; volume?: number },
  twitchControlProps: null as null | Record<string, unknown>,
  twitchVodReady: null as null | (() => void),
}));

vi.mock("@/components/dev/use-render-count", () => ({ useRenderCount: vi.fn() }));
vi.mock("@/components/ui/loading-spinner", () => ({
  KickLoadingSpinner: () => null,
  TwitchLoadingSpinner: () => null,
}));
vi.mock("@/features/playback/components/player/hooks/use-default-quality", () => ({ useDefaultQuality: vi.fn() }));
vi.mock("@/features/playback/components/player/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({ isFullscreen: false, toggleFullscreen: vi.fn() }),
}));
vi.mock("@/features/playback/components/player/hooks/use-picture-in-picture", () => ({
  usePictureInPicture: () => ({ isPip: false, togglePip: vi.fn() }),
}));
vi.mock("@/features/playback/components/player/hooks/use-resume-playback", () => ({ useResumePlayback: vi.fn() }));
vi.mock("@/features/playback/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    volume: 50,
    isMuted: false,
    handleVolumeChange: vi.fn(),
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
  }),
}));
vi.mock("@/features/playback/data/use-ad-element-observer", () => ({ useAdElementObserver: vi.fn() }));
vi.mock("@/store/adblock-store", () => ({ useAdBlockStore: () => false }));
vi.mock("@/features/playback/components/player/kick/uptime-readout", () => ({ UptimeReadout: () => null }));
vi.mock("@/features/playback/components/player/kick/kick-live-player-controls", () => ({
  KickLivePlayerControls: (props: Record<string, unknown>) => {
    h.kickControlProps = props;
    return null;
  },
}));
vi.mock("@/features/playback/components/player/twitch/twitch-live-player-controls", () => ({
  TwitchLivePlayerControls: (props: Record<string, unknown>) => {
    h.twitchControlProps = props;
    return null;
  },
}));
vi.mock("@/features/playback/components/player/twitch/ad-block-fallback-overlay", () => ({
  AdBlockFallbackOverlay: () => null,
}));
vi.mock("@/features/playback/components/player/twitch/video-stats-overlay", () => ({
  VideoStatsOverlay: () => null,
}));

vi.mock("@/features/playback/components/player/kick/kick-hls-player", async () => {
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
vi.mock("@/features/playback/components/player/twitch/twitch-hls-player", async () => {
  const { forwardRef } = await import("react");
  return {
    TwitchHlsPlayer: forwardRef<
      HTMLVideoElement,
      { muted?: boolean; onQualityLevels?: (levels: []) => void; volume?: number }
    >(({ muted, onQualityLevels, volume }, ref) => {
      h.twitchReady = () => onQualityLevels?.([]);
      h.twitchAudioProps = { muted, volume };
      return <video ref={ref} data-testid="live-video" />;
    }),
  };
});
vi.mock("@/features/playback/components/player/twitch/twitch-vod-hls-player", async () => {
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
  return event;
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

afterEach(() => vi.unstubAllGlobals());

// Guards: live playback stays on the native media-audio path and never exposes proof diagnostics.
it("keeps Twitch live audio native and its diagnostics off-screen", () => {
  const AudioContextMock = vi.fn();
  vi.stubGlobal("AudioContext", AudioContextMock);

  render(
    <TwitchLivePlayer
      streamUrl="https://usher.ttvnw.net/api/channel/hls/native-audio.m3u8"
      channelName="native-audio"
      enableAdBlock={false}
    />
  );

  expect(h.twitchAudioProps).toEqual({ muted: false, volume: 0.5 });
  expect(AudioContextMock).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(/Local audio capture proof/i)).not.toBeInTheDocument();
});

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

// Guards: live players leave left/right arrows unconsumed and expose no configurable seek authority.
describe.each([
  [
    "Kick",
    () => <KickLivePlayer streamUrl="https://example.test/kick.m3u8" />,
    () => h.kickReady,
    () => h.kickControlProps,
  ],
  [
    "Twitch",
    () => (
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/example.m3u8"
        channelName="example"
      />
    ),
    () => h.twitchReady,
    () => h.twitchControlProps,
  ],
] as const)(
  "%s live player seek exclusion",
  (_platform, renderPlayer, getReady, getControlProps) => {
    it("does not expose or consume configurable seek actions", async () => {
      const { getByTestId } = render(renderPlayer());
      const video = getByTestId("live-video") as HTMLVideoElement;
      video.currentTime = 120;

      await waitFor(() => expect(getReady()).toBeTypeOf("function"));
      act(() => getReady()?.());

      let arrowLeft!: KeyboardEvent;
      let arrowRight!: KeyboardEvent;
      act(() => {
        arrowLeft = pressKey("ArrowLeft");
        arrowRight = pressKey("ArrowRight");
      });

      expect(video.currentTime).toBe(120);
      expect(arrowLeft.defaultPrevented).toBe(false);
      expect(arrowRight.defaultPrevented).toBe(false);

      const controlProps = getControlProps();
      expect(controlProps).not.toBeNull();
      expect(controlProps).not.toHaveProperty("seekBackwardSeconds");
      expect(controlProps).not.toHaveProperty("seekForwardSeconds");
      expect(controlProps).not.toHaveProperty("onSeekBackward");
      expect(controlProps).not.toHaveProperty("onSeekForward");
    });
  }
);

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
