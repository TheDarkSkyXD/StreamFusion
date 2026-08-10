import { act, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdBlockStatus } from "@/shared/adblock-types";

const harness = vi.hoisted(() => ({
  hlsProps: null as null | {
    autoPlay?: boolean;
    onAdBlockStatusChange?: (status: AdBlockStatus) => void;
    onCleanPresentedFrame?: () => void;
    onBeforeAdPresentationShield?: () => void;
    onVerifiedCleanAdPresentation?: () => void;
    onAdBlockRecoveryRefresh?: () => void;
    onPlaybackRecoveryStateChange?: (recovering: boolean) => void;
    onError?: (error: {
      code: string;
      message: string;
      fatal: boolean;
      shouldRefresh?: boolean;
    }) => void;
  },
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  TwitchLoadingSpinner: () => <div data-testid="twitch-loading-spinner" />,
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
  TwitchLivePlayerControls: ({
    isPlaying,
    onTogglePlay,
  }: {
    isPlaying: boolean;
    onTogglePlay: () => void;
  }) => (
    <button
      type="button"
      aria-label={isPlaying ? "Pause playback" : "Play playback"}
      onClick={onTogglePlay}
    >
      <output data-testid="twitch-playback-state">{isPlaying ? "playing" : "paused"}</output>
    </button>
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
      onAdBlockStatusChange?: (status: AdBlockStatus) => void;
      onCleanPresentedFrame?: () => void;
      onBeforeAdPresentationShield?: () => void;
      onVerifiedCleanAdPresentation?: () => void;
      onAdBlockRecoveryRefresh?: () => void;
      onPlaybackRecoveryStateChange?: (recovering: boolean) => void;
      onError?: (error: {
        code: string;
        message: string;
        fatal: boolean;
        shouldRefresh?: boolean;
      }) => void;
    }
  >((props, ref) => {
    harness.hlsProps = props;
    return <video ref={ref} data-testid="twitch-video" />;
  }),
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

function emitStatus(nextStatus: AdBlockStatus): void {
  if (
    nextStatus.isUsingFallbackMode ||
    nextStatus.isStrippingSegments ||
    (nextStatus.isShowingAd && nextStatus.activePlayerType === null)
  ) {
    harness.hlsProps?.onBeforeAdPresentationShield?.();
  }
  harness.hlsProps?.onAdBlockStatusChange?.(nextStatus);
}

// Guards: fallback and segment-stripping states retain the compact ad-block status over a safe cover.
// Guards: ad blocking without a capturable clean frame shows the stream poster instead of a black player.
// Guards: ad blocking without either a clean frame or poster shows a non-black cover with the blocking status.
// Guards: ordinary playback-health frames cannot remove the cover; only verified ad-recovery presentation can.
// Guards: changing Twitch playback identity clears the old channel cover before it can leak onto the new route.
// Guards: changing Twitch streams immediately restores startup loading UI and clears stale ad, recovery, and error presentation.
// Guards: a failed stream poster falls back to the built-in non-black cover.
// Guards: the persistent cover becomes visible synchronously before HLS hides the unsafe video.
// Guards: a keyed HLS recovery remount cannot overwrite an existing clean-frame cover with fallback art.
// Guards: an ad hold cannot request a parent playback refresh that remounts and pauses the media element.
// Guards: ordinary ad substitution keeps its stable cover free of startup-loader chrome without changing the playing control state.
// Guards: fallback and midroll ad shielding keep the player-level blocking status visible.
// Guards: transient media pauses during internal recovery cannot replace explicit playing intent.
// Guards: deliberate pause intent survives internal player remounts and cannot be auto-resumed by recovery events.
// Guards: deliberate play intent survives internal player remounts even when configured autoplay is off.
// Guards: same-channel token URL refresh preserves the ad cover, playing intent, and spinner-free substitution.
// Guards: a verified clean ad substitute never regains startup-loader chrome on later waiting events.
// Guards: a transient Chromium background pause resumes from playing intent, not from the element's paused snapshot.
describe("Twitch live-player ad presentation gate", () => {
  beforeEach(() => {
    harness.hlsProps = null;
    sessionStorage.clear();
  });

  it.each([
    ["fallback", status({ isShowingAd: true, isUsingFallbackMode: true })],
    ["midroll stripping", status({ isMidroll: true, isStrippingSegments: true })],
  ])("keeps the blocking status visible during %s shielding", (_label, adStatus) => {
    const { container } = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
      />
    );

    act(() => emitStatus(adStatus));

    expect(container.querySelector('[role="status"]')).toHaveTextContent(
      adStatus.isMidroll ? "Blocking midroll ads" : "Blocking ads"
    );
    expect(screen.getByTestId("twitch-video")).toBeInTheDocument();
  });

  it("hides buffering chrome behind the stable ad cover without changing playing intent", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");

    expect(screen.getByTestId("twitch-loading-spinner")).toBeInTheDocument();

    fireEvent.play(video);
    fireEvent.playing(video);
    expect(screen.queryByTestId("twitch-loading-spinner")).not.toBeInTheDocument();

    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
    });
    fireEvent.waiting(video);
    fireEvent.stalled(video);
    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
    });
    fireEvent.waiting(video);

    expect(screen.getByRole("img", { name: "Sodapoppin live stream" })).toBeVisible();
    expect(screen.queryByTestId("twitch-loading-spinner")).not.toBeInTheDocument();
    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("playing");
  });

  it("keeps playing intent when an internal recovery transiently pauses the media element", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");

    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("playing");

    fireEvent.pause(video);
    fireEvent.waiting(video);

    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("playing");
  });

  it("preserves deliberate pause intent across an internal remount", () => {
    const rendered = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");
    vi.spyOn(video, "pause").mockImplementation(() => {});
    const play = vi.spyOn(video, "play").mockResolvedValue();

    fireEvent.click(screen.getByRole("button", { name: "Pause playback" }));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    fireEvent(document, new Event("visibilitychange"));

    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("paused");
    expect(harness.hlsProps?.autoPlay).toBe(false);
    expect(play).not.toHaveBeenCalled();

    rendered.unmount();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8?refresh=1"
        channelName="sodapoppin"
        autoPlay
      />
    );
    const remountedVideo = screen.getByTestId<HTMLVideoElement>("twitch-video");
    fireEvent.play(remountedVideo);
    fireEvent.playing(remountedVideo);

    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("paused");
    expect(harness.hlsProps?.autoPlay).toBe(false);
  });

  it("preserves deliberate play intent across an internal remount", async () => {
    const rendered = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay={false}
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");
    vi.spyOn(video, "play").mockResolvedValue();

    fireEvent.click(screen.getByRole("button", { name: "Play playback" }));

    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("playing");
    expect(harness.hlsProps?.autoPlay).toBe(true);

    rendered.unmount();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8?refresh=1"
        channelName="sodapoppin"
        autoPlay={false}
      />
    );

    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("playing");
    expect(harness.hlsProps?.autoPlay).toBe(true);
  });

  it("preserves the stable ad cover and playing intent across a token URL refresh", () => {
    const rendered = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8?token=one"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");
    fireEvent.playing(video);
    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
    });
    fireEvent.waiting(video);

    rendered.rerender(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8?token=two"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
        autoPlay
      />
    );
    fireEvent.waiting(video);

    expect(screen.getByRole("img", { name: "Sodapoppin live stream" })).toBeVisible();
    expect(screen.queryByTestId("twitch-loading-spinner")).not.toBeInTheDocument();
    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("playing");
    expect(harness.hlsProps?.autoPlay).toBe(true);
  });

  it("keeps a verified clean ad substitute free of the startup spinner while it waits", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");
    fireEvent.playing(video);
    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
      harness.hlsProps?.onVerifiedCleanAdPresentation?.();
      emitStatus(status({ isShowingAd: true, activePlayerType: "autoplay" }));
    });

    expect(screen.queryByRole("img", { name: "Sodapoppin live stream" })).not.toBeInTheDocument();

    fireEvent.waiting(video);
    fireEvent.stalled(video);
    fireEvent.waiting(video);

    expect(screen.queryByTestId("twitch-loading-spinner")).not.toBeInTheDocument();
    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("playing");
  });

  it("resumes a transient background pause when explicit intent is playing", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        autoPlay
      />
    );
    const video = screen.getByTestId<HTMLVideoElement>("twitch-video");
    const play = vi.spyOn(video, "play").mockResolvedValue();
    Object.defineProperty(video, "paused", { configurable: true, value: true });

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    fireEvent(document, new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    fireEvent(document, new Event("visibilitychange"));

    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("twitch-playback-state")).toHaveTextContent("playing");
  });

  it("covers preroll shielding with the stream poster when no clean frame is capturable", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
      />
    );

    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
    });

    expect(screen.getByRole("img", { name: "Sodapoppin live stream" })).toHaveAttribute(
      "src",
      "https://static-cdn.example/sodapoppin-live.jpg"
    );
  });

  it("freezes the last clean video frame synchronously when ad shielding starts", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
      />
    );
    const video = screen.getByTestId("twitch-video");
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });

    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
    });

    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
    expect(screen.getByTestId("twitch-ad-clean-frame-cover")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Sodapoppin live stream" })).not.toBeInTheDocument();
  });

  it("shows a non-black cover and blocking status when neither a frame nor poster is available", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
      />
    );

    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
    });

    expect(screen.getByTestId("twitch-ad-placeholder-cover")).toHaveClass("bg-[#18181b]");
    expect(screen.getByText("Blocking ads")).toBeInTheDocument();
    expect(screen.queryByText("Keeping your stream ad-free")).not.toBeInTheDocument();
    expect(screen.getByTestId("twitch-ad-placeholder-cover")).toHaveTextContent("");
  });

  it("upgrades an active preroll placeholder when the stream poster arrives", () => {
    const rendered = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
      />
    );

    act(() => harness.hlsProps?.onBeforeAdPresentationShield?.());

    expect(screen.getByTestId("twitch-ad-placeholder-cover")).toBeVisible();

    rendered.rerender(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
      />
    );

    expect(screen.getByRole("img", { name: "Sodapoppin live stream" })).toBeVisible();
    expect(screen.getByTestId("twitch-ad-placeholder-cover")).not.toBeVisible();
  });

  it("restores the placeholder when a late preroll poster fails", () => {
    const rendered = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
      />
    );
    act(() => harness.hlsProps?.onBeforeAdPresentationShield?.());

    rendered.rerender(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/expired.jpg"
      />
    );
    fireEvent.error(screen.getByRole("img", { name: "Sodapoppin live stream" }));

    expect(screen.getByTestId("twitch-ad-placeholder-cover")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Sodapoppin live stream" })).not.toBeInTheDocument();
  });

  it("releases the cover only after the verified clean ad replacement is presented", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
      />
    );
    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
      harness.hlsProps?.onCleanPresentedFrame?.();
    });
    expect(screen.getByRole("img", { name: "Sodapoppin live stream" })).toBeInTheDocument();

    act(() => harness.hlsProps?.onVerifiedCleanAdPresentation?.());

    expect(screen.queryByRole("img", { name: "Sodapoppin live stream" })).not.toBeInTheDocument();
  });

  it("clears the previous channel cover when playback identity changes", () => {
    const rendered = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
      />
    );
    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
    });
    expect(screen.getByRole("img", { name: "Sodapoppin live stream" })).toBeInTheDocument();

    rendered.rerender(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/pokimane.m3u8"
        channelName="pokimane"
        poster="https://static-cdn.example/pokimane-live.jpg"
      />
    );

    expect(screen.queryByRole("img", { name: "Sodapoppin live stream" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Pokimane live stream" })).not.toBeInTheDocument();
  });

  it("shows startup loading UI immediately when switching Twitch streams", () => {
    const rendered = render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
      />
    );
    const video = screen.getByTestId("twitch-video");
    fireEvent.playing(video);
    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
      harness.hlsProps?.onPlaybackRecoveryStateChange?.(true);
      harness.hlsProps?.onError?.({
        code: "UNKNOWN",
        message: "previous stream failed",
        fatal: true,
      });
    });

    rendered.rerender(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/pokimane.m3u8"
        channelName="pokimane"
        poster="https://static-cdn.example/pokimane-live.jpg"
      />
    );

    expect(screen.getByTestId("twitch-loading-spinner")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Stream interrupted — reconnecting…")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /live stream/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("twitch-ad-placeholder-cover")).not.toBeVisible();
  });

  it("falls back to the Twitch placeholder when the poster cannot load", () => {
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/expired.jpg"
      />
    );
    act(() => {
      emitStatus(status({ isShowingAd: true, isUsingFallbackMode: true }));
    });

    fireEvent.error(screen.getByRole("img", { name: "Sodapoppin live stream" }));

    expect(screen.getByTestId("twitch-ad-placeholder-cover")).toBeInTheDocument();
  });

  it("makes a captured clean-frame cover visible in the pre-shield call stack", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
      />
    );
    const video = screen.getByTestId("twitch-video");
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    const canvas = screen.getByTestId("twitch-ad-clean-frame-cover");
    expect(canvas).toHaveClass("hidden");

    act(() => {
      harness.hlsProps?.onBeforeAdPresentationShield?.();
      expect(canvas).not.toHaveClass("hidden");
    });

    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
  });

  it("retains an existing clean-frame cover across a repeated pre-shield signal", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        poster="https://static-cdn.example/sodapoppin-live.jpg"
      />
    );
    const video = screen.getByTestId("twitch-video");
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    act(() => harness.hlsProps?.onBeforeAdPresentationShield?.());
    const canvas = screen.getByTestId("twitch-ad-clean-frame-cover");
    expect(canvas).not.toHaveClass("hidden");

    Object.defineProperty(video, "readyState", { configurable: true, value: 0 });
    act(() => harness.hlsProps?.onBeforeAdPresentationShield?.());

    expect(canvas).not.toHaveClass("hidden");
    expect(screen.queryByRole("img", { name: "Sodapoppin live stream" })).not.toBeInTheDocument();
  });

  it("does not give the ad watchdog parent refresh authority", () => {
    const onRefresh = vi.fn();
    render(
      <TwitchLivePlayer
        streamUrl="https://usher.ttvnw.net/api/channel/hls/sodapoppin.m3u8"
        channelName="sodapoppin"
        onRefresh={onRefresh}
      />
    );

    expect(harness.hlsProps).not.toHaveProperty("onAdBlockRecoveryRefresh");
  });
});
