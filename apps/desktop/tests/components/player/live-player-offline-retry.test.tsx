import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerError } from "@/components/player/types";
import type { AdBlockStatus } from "@/shared/adblock-types";

const h = vi.hoisted(() => ({
  kickHlsProps: null as null | { onError?: (error: PlayerError) => void },
  twitchHlsProps: null as null | {
    onAdBlockRecoveryRefresh?: () => void;
    onAdBlockStatusChange?: (status: AdBlockStatus) => void;
    onCleanPresentedFrame?: () => void;
    onError?: (error: PlayerError) => void;
  },
  kickHlsMounts: 0,
  twitchHlsMounts: 0,
  recoveryCount: 0,
}));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ recoveryCount: h.recoveryCount }),
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
    const [mountId] = useState(() => ++h.kickHlsMounts);
    return <div data-testid="kick-hls-player" data-mount-id={mountId} />;
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
    onCleanPresentedFrame?: () => void;
    onError?: (error: PlayerError) => void;
  }) => {
    h.twitchHlsProps = props;
    const [mountId] = useState(() => ++h.twitchHlsMounts);
    return <div data-testid="twitch-hls-player" data-mount-id={mountId} />;
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
// Guards: Twitch ad holds recover inside HLS and cannot request a page-owned remount that pauses playback.
describe("live player offline retry handling", () => {
  beforeEach(() => {
    h.kickHlsProps = null;
    h.twitchHlsProps = null;
    h.kickHlsMounts = 0;
    h.twitchHlsMounts = 0;
    h.recoveryCount = 0;
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

  it("Twitch STREAM_OFFLINE receives a bounded playback refresh", async () => {
    vi.useFakeTimers();
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
    expect(onError).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
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

  it("Twitch watchdog-only missing fragments receive a bounded playback refresh", async () => {
    vi.useFakeTimers();
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
    expect(onError).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // Guards: confirmed network recovery remounts a failed Kick HLS engine but leaves a healthy engine intact.
  it("remounts only an errored Kick HLS engine on confirmed recovery", () => {
    const { getByTestId, rerender } = render(
      <KickLivePlayer streamUrl="https://example.test/kick.m3u8" />
    );
    const healthyMountId = getByTestId("kick-hls-player").dataset.mountId;

    h.recoveryCount = 1;
    rerender(<KickLivePlayer streamUrl="https://example.test/kick.m3u8" />);
    expect(getByTestId("kick-hls-player").dataset.mountId).toBe(healthyMountId);

    act(() => h.kickHlsProps?.onError?.(offlineError));
    h.recoveryCount = 2;
    rerender(<KickLivePlayer streamUrl="https://example.test/kick.m3u8" />);

    expect(getByTestId("kick-hls-player").dataset.mountId).not.toBe(healthyMountId);
  });

  // Guards: confirmed network recovery remounts a failed Twitch HLS engine but leaves a healthy engine intact.
  it("remounts only an errored Twitch HLS engine on confirmed recovery", () => {
    const props = {
      streamUrl: "https://usher.ttvnw.net/api/channel/hls/xqc.m3u8",
      channelName: "xqc",
    };
    const { getByTestId, rerender } = render(<TwitchLivePlayer {...props} />);
    const healthyMountId = getByTestId("twitch-hls-player").dataset.mountId;

    h.recoveryCount = 1;
    rerender(<TwitchLivePlayer {...props} />);
    expect(getByTestId("twitch-hls-player").dataset.mountId).toBe(healthyMountId);

    act(() => h.twitchHlsProps?.onError?.(offlineError));
    h.recoveryCount = 2;
    rerender(<TwitchLivePlayer {...props} />);

    expect(getByTestId("twitch-hls-player").dataset.mountId).not.toBe(healthyMountId);
  });

  it("Twitch refreshes the source after the bounded stall watchdog is exhausted", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const onRefresh = vi.fn();
    const watchdogError: PlayerError = {
      code: "PLAYBACK_STALL",
      message: "Live video stopped receiving playable data",
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

    expect(onError).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("Twitch stops the spinner and surfaces an exhausted stall after bounded refresh attempts", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const onRefresh = vi.fn();
    const watchdogError: PlayerError = {
      code: "PLAYBACK_STALL",
      message: "Live video stopped receiving playable data",
      fatal: true,
      shouldRefresh: true,
    };
    const { queryByTestId } = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        onError={onError}
        onRefresh={onRefresh}
      />
    );

    act(() => h.twitchHlsProps?.onError?.(watchdogError));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    act(() => h.twitchHlsProps?.onError?.(watchdogError));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    act(() => h.twitchHlsProps?.onError?.(watchdogError));

    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(watchdogError);
    expect(queryByTestId("twitch-loading")).toBeNull();
    vi.useRealTimers();
  });

  // Guards: an exhausted parent-owned recovery renders a visible retry action instead of leaving a permanent spinner or black surface.
  it("shows a retry affordance when parent-owned recovery is exhausted", () => {
    const onRefresh = vi.fn();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        recoveryManagedExternally
        onError={() => false}
        onRefresh={onRefresh}
      />
    );

    act(() => h.twitchHlsProps?.onError?.(offlineError));

    expect(screen.queryByTestId("twitch-loading")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Playback interrupted");
    screen.getByRole("button", { name: "Retry playback" }).click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("Twitch does not reset the retry budget for a fresh URL until playback resumes", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const onRefresh = vi.fn();
    const watchdogError: PlayerError = {
      code: "PLAYBACK_STALL",
      message: "Live video stopped receiving playable data",
      fatal: true,
      shouldRefresh: true,
    };
    const renderPlayer = (revision: number) => (
      <TwitchLivePlayer
        streamUrl={`https://usher.ttvnw.net/api/channel/hls/xqc-${revision}.m3u8`}
        channelName="xqc"
        onError={onError}
        onRefresh={onRefresh}
      />
    );
    const { rerender } = render(renderPlayer(1));

    act(() => h.twitchHlsProps?.onError?.(watchdogError));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    rerender(renderPlayer(2));
    act(() => h.twitchHlsProps?.onError?.(watchdogError));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    rerender(renderPlayer(3));
    act(() => h.twitchHlsProps?.onError?.(watchdogError));

    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(watchdogError);
    vi.useRealTimers();
  });

  it("Twitch does not pass page refresh authority into adblock recovery", () => {
    const onRefresh = vi.fn();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/xqc.m3u8"
        channelName="xqc"
        onRefresh={onRefresh}
      />
    );

    expect(h.twitchHlsProps).not.toHaveProperty("onAdBlockRecoveryRefresh");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("Twitch does not suppress fatal playback errors indefinitely while adblock is active", async () => {
    vi.useFakeTimers();
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

    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
