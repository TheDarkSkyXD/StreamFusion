import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Ref } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdBlockStatus } from "@/shared/adblock-types";

interface HlsHarnessProps {
  ref?: Ref<HTMLVideoElement>;
  onAdBlockStatusChange?: (status: AdBlockStatus) => void;
}

const harness = vi.hoisted(() => ({
  hlsProps: null as HlsHarnessProps | null,
  recoverFromNetworkError: null as (() => void) | null,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  TwitchLoadingSpinner: () => <div data-testid="loading-spinner" />,
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
  usePlayerNetworkRecovery: (_hasError: boolean, recover: () => void) => {
    harness.recoverFromNetworkError = recover;
  },
}));
vi.mock("@/components/player/hooks/use-timed-text", () => ({
  useTimedText: () => ({
    activeCues: [],
    tracks: [],
    selectedTrackKey: null,
    selectTrack: vi.fn(),
  }),
}));
vi.mock("@/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    volume: 50,
    isMuted: false,
    handleVolumeChange: vi.fn(),
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
  }),
}));
vi.mock("@/components/player/caption-overlay", () => ({ CaptionOverlay: () => null }));
vi.mock("@/components/player/twitch/ad-block-fallback-overlay", () => ({
  AdBlockFallbackOverlay: () => null,
}));
vi.mock("@/components/player/twitch/twitch-live-player-controls", () => ({
  TwitchLivePlayerControls: () => null,
}));
vi.mock("@/components/player/twitch/video-stats-overlay", () => ({
  VideoStatsOverlay: () => null,
}));
vi.mock("@/components/player/twitch/twitch-hls-player", () => ({
  TwitchHlsPlayer: (props: HlsHarnessProps) => {
    harness.hlsProps = props;
    return <video ref={props.ref} data-testid="twitch-video" />;
  },
}));

import { TwitchLivePlayer } from "@/components/player/twitch/twitch-live-player";

function status(overrides: Partial<AdBlockStatus> = {}): AdBlockStatus {
  return {
    isActive: true,
    isShowingAd: false,
    isMidroll: false,
    isStrippingSegments: false,
    numStrippedSegments: 0,
    activePlayerType: null,
    channelName: "sodapoppin",
    isUsingFallbackMode: false,
    adStartTime: null,
    ...overrides,
  };
}

function renderPlayer() {
  return render(
    <TwitchLivePlayer
      streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
      channelName="sodapoppin"
    />
  );
}

function publishStatus(nextStatus: AdBlockStatus) {
  act(() => {
    harness.hlsProps?.onAdBlockStatusChange?.(nextStatus);
  });
}

// Guards: automatic playback recovery remains silent while the player reconnects in place.
// Guards: active Twitch ad substitution keeps the visible top-left blocking status users rely on.
describe("Twitch live-player ad-block indicator", () => {
  beforeEach(() => {
    harness.hlsProps = null;
    harness.recoverFromNetworkError = null;
  });

  it("does not render or announce automatic playback recovery", () => {
    const { container } = renderPlayer();

    expect(harness.hlsProps).not.toHaveProperty("onPlaybackRecoveryStateChange");
    expect(screen.queryByText(/stream interrupted/i)).not.toBeInTheDocument();
    expect(container.querySelector("[aria-live]")).not.toBeInTheDocument();
  });

  it("announces ordinary preroll ad substitution", () => {
    renderPlayer();

    publishStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));

    expect(screen.getByRole("status")).toHaveTextContent("Blocking ads");
  });

  it("distinguishes active midroll substitution", () => {
    renderPlayer();

    publishStatus(status({ isShowingAd: true, isMidroll: true }));

    expect(screen.getByRole("status")).toHaveTextContent("Blocking midroll ads");
  });

  it("does not announce stale ad flags after ad blocking becomes inactive", () => {
    renderPlayer();

    publishStatus(
      status({
        isActive: false,
        isShowingAd: true,
        isStrippingSegments: true,
        isUsingFallbackMode: true,
      })
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not conflate ordinary loading, buffering, or network recovery with ad handling", () => {
    renderPlayer();
    const video = screen.getByTestId("twitch-video");

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.playing(video);
    expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument();
    fireEvent.waiting(video);
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      harness.recoverFromNetworkError?.();
    });

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
