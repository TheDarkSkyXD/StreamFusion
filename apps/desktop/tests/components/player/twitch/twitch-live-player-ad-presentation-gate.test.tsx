import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdBlockStatus } from "@/shared/adblock-types";

const harness = vi.hoisted(() => ({
  hlsProps: null as null | { onAdBlockStatusChange?: (status: AdBlockStatus) => void },
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
  TwitchHlsPlayer: (props: { onAdBlockStatusChange?: (status: AdBlockStatus) => void }) => {
    harness.hlsProps = props;
    return <video data-testid="twitch-video" />;
  },
}));

import { TwitchLivePlayer } from "@/components/player/twitch/twitch-live-player";

function status(overrides: Partial<AdBlockStatus>): AdBlockStatus {
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

// Guards: fallback and segment-stripping states keep the exact Blocking ads indicator visible while the video presentation is shielded.
describe("Twitch live-player ad presentation gate", () => {
  beforeEach(() => {
    harness.hlsProps = null;
  });

  it("shows the exact top-left Blocking ads indicator during fallback", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
      />
    );

    act(() => {
      harness.hlsProps?.onAdBlockStatusChange?.(
        status({ isShowingAd: true, isUsingFallbackMode: true })
      );
    });

    const indicator = screen.getByText("Blocking ads");
    expect(indicator).toHaveClass(
      "top-2",
      "left-2",
      "z-40",
      "bg-black/80",
      "text-white",
      "text-sm",
      "font-medium",
      "px-2",
      "py-1",
      "rounded"
    );
    expect(screen.getByTestId("twitch-video")).toBeInTheDocument();
  });

  it("shows Blocking midroll ads while segments are being stripped", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
      />
    );

    act(() => {
      harness.hlsProps?.onAdBlockStatusChange?.(
        status({ isMidroll: true, isStrippingSegments: true })
      );
    });

    expect(screen.getByText("Blocking midroll ads")).toBeInTheDocument();
  });
});
