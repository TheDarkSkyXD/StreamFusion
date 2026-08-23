import { act, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVolumeStore } from "@/store/volume-store";

const harness = vi.hoisted(() => ({
  hlsProps: null as null | {
    autoPlay?: boolean;
    muted?: boolean;
  },
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  TwitchLoadingSpinner: () => null,
}));
vi.mock("@/hooks/use-ad-element-observer", () => ({ useAdElementObserver: vi.fn() }));
vi.mock("@/store/adblock-store", () => ({ useAdBlockStore: () => true }));
vi.mock("@/components/player/hooks/use-default-quality", () => ({
  useDefaultQuality: () => ({ defaultQuality: "auto" }),
}));
vi.mock("@/components/player/persistent-player-shell", () => ({
  useDockedPlayerConfig: () => null,
}));
vi.mock("@/components/player/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({ isFullscreen: false, toggleFullscreen: vi.fn() }),
}));
vi.mock("@/components/player/hooks/use-local-live-captions", () => ({
  useLocalLiveCaptions: () => ({
    activeCues: [],
    selected: false,
    selectLocal: vi.fn(),
    stop: vi.fn(),
    modelState: "ready",
    phase: "idle",
    error: null,
    downloadModel: vi.fn(),
    cancelModelDownload: vi.fn(),
    removeModel: vi.fn(),
    retry: vi.fn(),
  }),
}));
vi.mock("@/components/player/hooks/use-picture-in-picture", () => ({
  usePictureInPicture: () => ({ isPip: false, togglePip: vi.fn() }),
}));
vi.mock("@/components/player/hooks/use-player-keyboard", () => ({ usePlayerKeyboard: vi.fn() }));
vi.mock("@/components/player/hooks/use-player-network-recovery", () => ({
  usePlayerNetworkRecovery: vi.fn(),
}));
vi.mock("@/components/player/hooks/use-timed-text", () => ({
  useTimedText: () => ({
    activeCues: [],
    tracks: [],
    selectedTrackKey: null,
    selectTrack: vi.fn(),
  }),
}));
vi.mock("@/components/player/caption-overlay", () => ({ CaptionOverlay: () => null }));
vi.mock("@/components/player/twitch/ad-block-fallback-overlay", () => ({
  AdBlockFallbackOverlay: () => null,
}));
vi.mock("@/components/player/twitch/twitch-live-player-controls", () => ({
  TwitchLivePlayerControls: ({
    isPlaying,
    volume,
    muted,
    currentQualityId,
    isFullscreen,
    isTheater,
    playbackRate,
    onToggleMute,
    onVolumeChange,
  }: {
    isPlaying: boolean;
    volume: number;
    muted: boolean;
    currentQualityId: string;
    isFullscreen: boolean;
    isTheater: boolean;
    playbackRate: number;
    onToggleMute: () => void;
    onVolumeChange: (volume: number) => void;
  }) => (
    <>
      <output
        data-testid="twitch-control-state"
        data-playing={String(isPlaying)}
        data-volume={String(volume)}
        data-muted={String(muted)}
        data-quality={currentQualityId}
        data-fullscreen={String(isFullscreen)}
        data-theater={String(isTheater)}
        data-playback-rate={String(playbackRate)}
      />
      <button type="button" aria-label="Toggle mute" onClick={onToggleMute} />
      <button type="button" aria-label="Set volume to 55" onClick={() => onVolumeChange(55)} />
    </>
  ),
}));
vi.mock("@/components/player/twitch/video-stats-overlay", () => ({
  VideoStatsOverlay: () => null,
}));
vi.mock("@/components/player/twitch/twitch-hls-player", () => ({
  TwitchHlsPlayer: forwardRef<
    HTMLVideoElement,
    {
      autoPlay?: boolean;
      muted?: boolean;
    }
  >((props, ref) => {
    harness.hlsProps = props;
    return <video ref={ref} data-testid="twitch-video" />;
  }),
}));

import { TwitchLivePlayer } from "@/components/player/twitch/twitch-live-player";

async function passVolumeInitializationGuard(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

// Guards: internal ad-audio suppression cannot become persisted user mute intent or change any player control state.
// Guards: verified clean presentation restores the exact prior muted or unmuted user preference.
// Guards: recovery and remount media events have no authority to overwrite explicit user audio intent.
// Guards: explicit viewer mute and volume controls remain the only writers of persisted audio intent.
describe("Twitch live-player audio safety gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.hlsProps = null;
    sessionStorage.clear();
    useVolumeStore.setState({ volume: 37, isMuted: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an unmuted viewer's control intent isolated from the physical ad-audio shield", async () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");
    const controls = screen.getByTestId("twitch-control-state");

    await passVolumeInitializationGuard();

    expect(controls).toHaveAttribute("data-playing", "true");
    expect(controls).toHaveAttribute("data-muted", "false");
    expect(controls).toHaveAttribute("data-volume", "37");
    const initialControlState = controls.outerHTML;

    act(() => {
      video.setAttribute("data-streamfusion-ad-presentation-shielded", "true");
      video.muted = true;
      fireEvent(video, new Event("volumechange"));
    });

    expect(video.muted).toBe(true);
    expect(useVolumeStore.getState()).toMatchObject({ volume: 37, isMuted: false });
    expect(harness.hlsProps?.muted).toBe(false);
    expect(controls).toHaveAttribute("data-playing", "true");
    expect(controls).toHaveAttribute("data-muted", "false");
    expect(controls).toHaveAttribute("data-volume", "37");
    expect(controls.outerHTML).toBe(initialControlState);

    act(() => {
      video.muted = harness.hlsProps?.muted ?? false;
      video.removeAttribute("data-streamfusion-ad-presentation-shielded");
      fireEvent(video, new Event("volumechange"));
    });

    expect(video.muted).toBe(false);
    expect(useVolumeStore.getState()).toMatchObject({ volume: 37, isMuted: false });
    expect(controls.outerHTML).toBe(initialControlState);

    act(() => {
      video.setAttribute("data-streamfusion-ad-presentation-shielded", "true");
      video.muted = true;
      fireEvent(video, new Event("volumechange"));
      video.muted = harness.hlsProps?.muted ?? false;
      video.removeAttribute("data-streamfusion-ad-presentation-shielded");
      fireEvent(video, new Event("volumechange"));
    });

    expect(video.muted).toBe(false);
    expect(useVolumeStore.getState()).toMatchObject({ volume: 37, isMuted: false });
    expect(controls.outerHTML).toBe(initialControlState);
  });

  it("preserves an already-muted viewer's preference through verified clean release", async () => {
    useVolumeStore.setState({ volume: 64, isMuted: true });
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");
    const controls = screen.getByTestId("twitch-control-state");

    await passVolumeInitializationGuard();

    expect(video.muted).toBe(true);
    expect(harness.hlsProps?.muted).toBe(true);
    expect(controls).toHaveAttribute("data-muted", "true");
    const initialControlState = controls.outerHTML;

    act(() => {
      video.setAttribute("data-streamfusion-ad-presentation-shielded", "true");
      video.muted = true;
      fireEvent(video, new Event("volumechange"));
      video.muted = harness.hlsProps?.muted ?? false;
      video.removeAttribute("data-streamfusion-ad-presentation-shielded");
      fireEvent(video, new Event("volumechange"));
    });

    expect(video.muted).toBe(true);
    expect(useVolumeStore.getState()).toMatchObject({ volume: 64, isMuted: true });
    expect(controls.outerHTML).toBe(initialControlState);
  });

  it("ignores an internal volumechange after the presentation shield is gone", async () => {
    const rendered = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");

    await passVolumeInitializationGuard();

    act(() => {
      video.muted = true;
      video.volume = 0.8;
      fireEvent(video, new Event("volumechange"));
    });

    expect(useVolumeStore.getState()).toMatchObject({ volume: 37, isMuted: false });
    expect(harness.hlsProps?.muted).toBe(false);

    rendered.unmount();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8?hmr=1"
        channelName="sodapoppin"
        autoPlay
      />
    );

    expect(screen.getByTestId<HTMLVideoElement>("twitch-video").muted).toBe(false);
    expect(useVolumeStore.getState()).toMatchObject({ volume: 37, isMuted: false });
    expect(harness.hlsProps?.muted).toBe(false);
  });

  it("changes persisted audio intent only through explicit viewer controls", async () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
      />
    );

    await passVolumeInitializationGuard();

    fireEvent.click(screen.getByRole("button", { name: "Toggle mute" }));
    expect(useVolumeStore.getState()).toMatchObject({ volume: 37, isMuted: true });
    expect(harness.hlsProps?.muted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Set volume to 55" }));
    expect(useVolumeStore.getState()).toMatchObject({ volume: 55, isMuted: false });
    expect(harness.hlsProps?.muted).toBe(false);
  });
});
