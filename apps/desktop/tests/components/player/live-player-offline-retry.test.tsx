import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerError } from "@/components/player/types";
import type { AdBlockStatus } from "@/shared/adblock-types";

const h = vi.hoisted(() => ({
  kickHlsProps: null as null | { onError?: (error: PlayerError) => void },
  twitchHlsProps: null as null | {
    onAdBlockRecoveryRefresh?: () => void;
    onAdBlockStatusChange?: (status: AdBlockStatus) => void;
    onError?: (error: PlayerError) => void;
  },
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  KickLoadingSpinner: () => <div data-testid="kick-loading" />,
  TwitchLoadingSpinner: () => <div data-testid="twitch-loading" />,
}));

vi.mock("@/components/dev/use-render-count", () => ({
  useRenderCount: vi.fn(),
}));

vi.mock("@/hooks/use-ad-element-observer", () => ({
  useAdElementObserver: vi.fn(),
}));

vi.mock("@/store/adblock-store", () => ({
  useAdBlockStore: () => true,
}));

vi.mock("@/components/player/hooks/use-default-quality", () => ({
  useDefaultQuality: vi.fn(),
}));

vi.mock("@/components/player/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({ isFullscreen: false, toggleFullscreen: vi.fn() }),
}));

vi.mock("@/components/player/hooks/use-picture-in-picture", () => ({
  usePictureInPicture: () => ({ isPip: false, togglePip: vi.fn() }),
}));

vi.mock("@/components/player/hooks/use-player-keyboard", () => ({
  usePlayerKeyboard: vi.fn(),
}));

vi.mock("@/components/player/hooks/use-resume-playback", () => ({
  useResumePlayback: vi.fn(),
}));

vi.mock("@/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    volume: 1,
    isMuted: false,
    handleVolumeChange: vi.fn(),
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
  }),
}));

vi.mock("@/components/player/hls-player", () => ({
  HlsPlayer: (props: { onError?: (error: PlayerError) => void }) => {
    h.kickHlsProps = props;
    return <div data-testid="kick-hls-player" />;
  },
}));

vi.mock("@/components/player/kick/kick-live-player-controls", () => ({
  KickLivePlayerControls: () => <div data-testid="kick-controls" />,
}));

vi.mock("@/components/player/kick/uptime-readout", () => ({
  UptimeReadout: () => null,
}));

vi.mock("@/components/player/twitch/twitch-hls-player", () => ({
  TwitchHlsPlayer: (props: {
    onAdBlockRecoveryRefresh?: () => void;
    onAdBlockStatusChange?: (status: AdBlockStatus) => void;
    onError?: (error: PlayerError) => void;
  }) => {
    h.twitchHlsProps = props;
    return <div data-testid="twitch-hls-player" />;
  },
}));

vi.mock("@/components/player/twitch/twitch-live-player-controls", () => ({
  TwitchLivePlayerControls: () => <div data-testid="twitch-controls" />,
}));

vi.mock("@/components/player/twitch/ad-block-fallback-overlay", () => ({
  AdBlockFallbackOverlay: () => null,
}));

vi.mock("@/components/player/twitch/video-stats-overlay", () => ({
  VideoStatsOverlay: () => null,
}));

import { KickLivePlayer } from "@/components/player/kick/kick-live-player";
import { TwitchLivePlayer } from "@/components/player/twitch/twitch-live-player";

const offlineError: PlayerError = {
  code: "STREAM_OFFLINE",
  message: "Stream offline or unavailable",
  fatal: true,
};

// Guards: live-player wrappers must surface confirmed STREAM_OFFLINE errors to the page instead of refreshing forever on fresh-but-dead playback URLs.
// Guards: Twitch adblock recovery can escalate from an HLS reload to the page-owned playback URL refresh without coupling the adblock service to page state.
describe("live player offline retry handling", () => {
  beforeEach(() => {
    h.kickHlsProps = null;
    h.twitchHlsProps = null;
  });

  it("Kick STREAM_OFFLINE calls onError without auto-refreshing", () => {
    const onError = vi.fn();
    const onRefresh = vi.fn();
    render(
      <KickLivePlayer
        streamUrl="https://example.test/kick.m3u8"
        onError={onError}
        onRefresh={onRefresh}
      />
    );

    act(() => h.kickHlsProps?.onError?.(offlineError));

    expect(onRefresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(offlineError);
  });

  it("Kick refreshable HLS errors call onError without auto-refreshing", () => {
    const onError = vi.fn();
    const onRefresh = vi.fn();
    const refreshableError: PlayerError = {
      code: "NO_FRAGMENTS",
      message: "No video fragments received after manifest load",
      fatal: true,
      shouldRefresh: true,
    };
    render(
      <KickLivePlayer
        streamUrl="https://example.test/kick.m3u8"
        onError={onError}
        onRefresh={onRefresh}
      />
    );

    act(() => h.kickHlsProps?.onError?.(refreshableError));

    expect(onRefresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(refreshableError);
  });

  it("Twitch STREAM_OFFLINE calls onError without auto-refreshing", () => {
    const onError = vi.fn();
    const onRefresh = vi.fn();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        onError={onError}
        onRefresh={onRefresh}
      />
    );

    act(() => h.twitchHlsProps?.onError?.(offlineError));

    expect(onRefresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(offlineError);
  });

  it("Twitch recoverable errors auto-refresh playback", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const onRefresh = vi.fn();
    const refreshableError: PlayerError = {
      code: "TOKEN_EXPIRED",
      message: "Playback token expired",
      fatal: true,
      shouldRefresh: true,
    };
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        onError={onError}
        onRefresh={onRefresh}
      />
    );

    act(() => h.twitchHlsProps?.onError?.(refreshableError));
    expect(onError).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("Twitch watchdog-only missing fragments call onError without auto-refreshing", () => {
    const onError = vi.fn();
    const onRefresh = vi.fn();
    const watchdogError: PlayerError = {
      code: "NO_FRAGMENTS",
      message: "No video fragments received after manifest load",
      fatal: true,
    };
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        onError={onError}
        onRefresh={onRefresh}
      />
    );

    act(() => h.twitchHlsProps?.onError?.(watchdogError));

    expect(onRefresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(watchdogError);
  });

  it("Twitch refreshable missing-fragment watchdog errors call onError without auto-refreshing", () => {
    const onError = vi.fn();
    const onRefresh = vi.fn();
    const watchdogError: PlayerError = {
      code: "NO_FRAGMENTS",
      message: "No video fragments received after manifest load",
      fatal: true,
      shouldRefresh: true,
    };
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        onError={onError}
        onRefresh={onRefresh}
      />
    );

    act(() => h.twitchHlsProps?.onError?.(watchdogError));

    expect(onRefresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(watchdogError);
  });

  it("Twitch passes the page refresh callback into adblock recovery", () => {
    const onRefresh = vi.fn();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        onRefresh={onRefresh}
      />
    );

    act(() => h.twitchHlsProps?.onAdBlockRecoveryRefresh?.());

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("Twitch suppresses refreshable playback errors while adblock is blocking ads", () => {
    const onError = vi.fn();
    const onRefresh = vi.fn();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        onError={onError}
        onRefresh={onRefresh}
      />
    );

    act(() =>
      h.twitchHlsProps?.onAdBlockStatusChange?.({
        isActive: true,
        isShowingAd: true,
        isMidroll: false,
        isStrippingSegments: true,
        numStrippedSegments: 1,
        activePlayerType: null,
        channelName: "xqc",
        isUsingFallbackMode: false,
        adStartTime: Date.now(),
      })
    );
    act(() =>
      h.twitchHlsProps?.onError?.({
        code: "NO_FRAGMENTS",
        message: "No video fragments received after manifest load",
        fatal: true,
        shouldRefresh: true,
      })
    );

    expect(onRefresh).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
