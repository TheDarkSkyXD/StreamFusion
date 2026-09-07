import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { useOnDemandSeekRecovery } from "@/features/playback/components/player/hooks/use-on-demand-seek-recovery";
import { logger } from "@/renderer/logging/logger";

function createPlayingVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  return video;
}

// Guards: requestVideoFrameCallback completes only the newest seek whose presented media time matches its target.
// Guards: event fallback requires seek acknowledgement and a later ready media event before completing.
// Guards: HLS VOD recovery uses bounded load restart and reseek actions without autoplay or source replacement.
// Guards: native clip recovery uses only bounded reseeks without loading, autoplay, or HLS operations.
// Guards: pausing cancels every pending seek action and rejects late matching frames without autoplay.
// Guards: hidden, offline, and ended media states invalidate active or newly committed seek recovery.
// Guards: source identity changes and unmount invalidate pending generations and late presentation callbacks.
// Guards: eligibility cancellation is reported once while lifecycle cleanup remains silent to consumers.
// Guards: every pending frame handle is canceled by its owning video unless that handle already fired.
// Guards: source changes invalidate old callbacks before layout consumers can observe the new source options.
// Guards: same-source rerenders keep the active generation but use the latest HLS instance and terminal callback.
// Guards: success-path timing telemetry is structured and never exposes source identity or playback URLs.
// Guards: recovery telemetry reports only the latest generation's bounded stages and one exhaustion event.
// Guards: programmatic media seeks start recovery while seeking after an explicit commit keeps its generation.
describe("useOnDemandSeekRecovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("observes presented frames until the newest generation matches its target", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: requestVideoFrameCallback,
    });
    const cancelVideoFrameCallback = vi.fn();
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
    const hls = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onSuccess = vi.fn();
    const onTerminal = vi.fn();
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls,
        mediaKind: "hls-vod",
        sourceKey: "opaque-source-identity",
        onSuccess,
        onTerminal,
      })
    );

    let generationA = 0;
    let generationB = 0;
    act(() => {
      generationA = result.current.commitSeek(12);
      generationB = result.current.commitSeek(48);
    });

    act(() => {
      frameCallbacks.shift()?.(0, { mediaTime: 12 } as VideoFrameCallbackMetadata);
      frameCallbacks.shift()?.(0, { mediaTime: 46.5 } as VideoFrameCallbackMetadata);
    });
    expect(onSuccess).not.toHaveBeenCalled();

    const matchingFrame = frameCallbacks.shift();
    act(() => {
      matchingFrame?.(0, { mediaTime: 47.5 } as VideoFrameCallbackMetadata);
      matchingFrame?.(0, { mediaTime: 47.5 } as VideoFrameCallbackMetadata);
      vi.advanceTimersByTime(100_000);
    });

    expect(generationB).toBeGreaterThan(generationA);
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith({
      generation: generationB,
      targetSeconds: 48,
      presentedSeconds: 47.5,
    });
    expect(onTerminal).not.toHaveBeenCalled();
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(3);
    expect(cancelVideoFrameCallback).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("uses a ready post-seek media event when frame callbacks are unavailable", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    let readyState: number = HTMLMediaElement.HAVE_METADATA;
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => readyState,
    });
    const onSuccess = vi.fn();
    const onTerminal = vi.fn();
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        mediaKind: "native-clip",
        sourceKey: "opaque-clip-identity",
        onSuccess,
        onTerminal,
      })
    );

    let generation = 0;
    act(() => {
      generation = result.current.commitSeek(48);
      video.currentTime = 48;
      video.dispatchEvent(new Event("seeked"));
    });
    expect(onSuccess).not.toHaveBeenCalled();

    act(() => {
      readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
      video.currentTime = 46.5;
      video.dispatchEvent(new Event("timeupdate"));
    });
    expect(onSuccess).not.toHaveBeenCalled();

    act(() => {
      video.currentTime = 47.5;
      video.dispatchEvent(new Event("timeupdate"));
      video.dispatchEvent(new Event("playing"));
      vi.advanceTimersByTime(100_000);
    });

    expect(onSuccess).toHaveBeenCalledExactlyOnceWith({
      generation,
      targetSeconds: 48,
      presentedSeconds: 47.5,
    });
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it("runs the bounded HLS VOD recovery actions without autoplay or source replacement", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const source = "https://example.test/vod.m3u8";
    video.src = source;
    const reseekTargets: number[] = [];
    let currentTime = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        reseekTargets.push(value);
      },
    });
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn(() => 1),
    });
    const play = vi.fn();
    Object.defineProperty(video, "play", { configurable: true, value: play });
    const hls = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onTerminal = vi.fn();
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls,
        mediaKind: "hls-vod",
        sourceKey: "opaque-hls-identity",
        onSuccess: vi.fn(),
        onTerminal,
      })
    );

    let generation = 0;
    act(() => {
      generation = result.current.commitSeek(30);
      vi.advanceTimersByTime(2_499);
    });
    expect(hls.startLoad).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(hls.startLoad).toHaveBeenCalledExactlyOnceWith(30);
    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(reseekTargets).toEqual([30]);

    act(() => vi.advanceTimersByTime(2_999));
    expect(hls.startLoad).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(hls.stopLoad).toHaveBeenCalledTimes(1);
    expect(hls.startLoad.mock.calls).toEqual([[30], [30]]);
    expect(reseekTargets).toEqual([30, 30]);

    act(() => vi.advanceTimersByTime(2_000));
    expect(onTerminal).toHaveBeenCalledExactlyOnceWith({
      generation,
      targetSeconds: 30,
      stage: "terminal",
    });

    act(() => vi.advanceTimersByTime(100_000));
    expect(hls.stopLoad).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(2);
    expect(reseekTargets).toEqual([30, 30]);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
    expect(video.src).toBe(source);
  });

  it("runs bounded native clip reseeks without loading or autoplay", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const reseekTargets: number[] = [];
    let currentTime = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        reseekTargets.push(value);
      },
    });
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn(() => 1),
    });
    const load = vi.fn();
    const play = vi.fn();
    Object.defineProperty(video, "load", { configurable: true, value: load });
    Object.defineProperty(video, "play", { configurable: true, value: play });
    const onTerminal = vi.fn();
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls: null,
        mediaKind: "native-clip",
        sourceKey: "opaque-native-clip-identity",
        onSuccess: vi.fn(),
        onTerminal,
      })
    );

    let generation = 0;
    act(() => {
      generation = result.current.commitSeek(0.25);
      vi.advanceTimersByTime(2_500);
    });
    expect(reseekTargets).toEqual([0.25]);

    act(() => vi.advanceTimersByTime(3_000));
    expect(reseekTargets).toEqual([0.25, 0, 0.25]);

    act(() => vi.advanceTimersByTime(2_000));
    expect(onTerminal).toHaveBeenCalledExactlyOnceWith({
      generation,
      targetSeconds: 0.25,
      stage: "terminal",
    });

    act(() => vi.advanceTimersByTime(100_000));
    expect(reseekTargets).toEqual([0.25, 0, 0.25]);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("cancels the active seek when playback pauses", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const cancelVideoFrameCallback = vi.fn();
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
    const reseek = vi.fn();
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 0,
      set: reseek,
    });
    const play = vi.fn();
    Object.defineProperty(video, "play", { configurable: true, value: play });
    const hls = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onSuccess = vi.fn();
    const onTerminal = vi.fn();
    const onCancel = vi.fn();
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls,
        mediaKind: "hls-vod",
        sourceKey: "opaque-paused-source",
        onSuccess,
        onTerminal,
        onCancel,
      })
    );

    act(() => {
      result.current.commitSeek(30);
      video.dispatchEvent(new Event("pause"));
      frameCallbacks.shift()?.(0, { mediaTime: 30 } as VideoFrameCallbackMetadata);
      vi.advanceTimersByTime(100_000);
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onTerminal).not.toHaveBeenCalled();
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(reseek).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("pause");
    expect(cancelVideoFrameCallback).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.debug).toHaveBeenCalledWith(
      "Player:OnDemandSeekRecovery",
      "seek-cancelled",
      expect.objectContaining({
        generation: expect.any(Number),
        targetSeconds: 30,
        mediaKind: "hls-vod",
        reason: "pause",
        elapsedMs: 0,
      })
    );
  });

  it.each([
    {
      label: "becomes hidden",
      reason: "hidden" as const,
      beforeCommit: false,
      makeIneligible: (_video: HTMLVideoElement) => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      },
    },
    {
      label: "goes offline",
      reason: "offline" as const,
      beforeCommit: false,
      makeIneligible: (_video: HTMLVideoElement) => {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        window.dispatchEvent(new Event("offline"));
      },
    },
    {
      label: "ends",
      reason: "ended" as const,
      beforeCommit: false,
      makeIneligible: (video: HTMLVideoElement) => {
        video.dispatchEvent(new Event("ended"));
      },
    },
    {
      label: "starts hidden",
      reason: "hidden" as const,
      beforeCommit: true,
      makeIneligible: (_video: HTMLVideoElement) => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      },
    },
    {
      label: "starts offline",
      reason: "offline" as const,
      beforeCommit: true,
      makeIneligible: (_video: HTMLVideoElement) => {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      },
    },
    {
      label: "starts paused",
      reason: "pause" as const,
      beforeCommit: true,
      makeIneligible: (video: HTMLVideoElement) => {
        Object.defineProperty(video, "paused", { configurable: true, value: true });
      },
    },
  ])("cancels recovery when media $label", ({ reason, beforeCommit, makeIneligible }) => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    const requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: requestVideoFrameCallback,
    });
    const cancelVideoFrameCallback = vi.fn();
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
    const reseek = vi.fn();
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 0,
      set: reseek,
    });
    const play = vi.fn();
    Object.defineProperty(video, "play", { configurable: true, value: play });
    const hls = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onSuccess = vi.fn();
    const onTerminal = vi.fn();
    const onCancel = vi.fn();

    if (beforeCommit) makeIneligible(video);
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls,
        mediaKind: "hls-vod",
        sourceKey: "opaque-ineligible-source",
        onSuccess,
        onTerminal,
        onCancel,
      })
    );

    act(() => {
      result.current.commitSeek(30);
      if (!beforeCommit) makeIneligible(video);
      frameCallbacks.forEach((callback) =>
        callback(0, { mediaTime: 30 } as VideoFrameCallbackMetadata)
      );
      vi.advanceTimersByTime(100_000);
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onTerminal).not.toHaveBeenCalled();
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(reseek).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(beforeCommit ? 0 : 1);
    expect(cancelVideoFrameCallback).toHaveBeenCalledTimes(beforeCommit ? 0 : 1);
    if (!beforeCommit) {
      expect(cancelVideoFrameCallback).toHaveBeenCalledWith(1);
    }
    expect(onCancel).toHaveBeenCalledExactlyOnceWith(reason);
    const cancellationLogs = vi
      .mocked(logger.debug)
      .mock.calls.filter(([, message]) => message === "seek-cancelled");
    expect(cancellationLogs).toHaveLength(1);
    expect(cancellationLogs[0]?.[2]).toEqual(
      expect.objectContaining({ reason, targetSeconds: 30, mediaKind: "hls-vod" })
    );
    expect(JSON.stringify(cancellationLogs)).not.toContain("opaque-ineligible-source");
  });

  it("cancels the old generation when source identity changes and accepts a newer commit", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const videoRef = { current: video };
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const cancelVideoFrameCallback = vi.fn();
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
    const hls = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onSuccess = vi.fn();
    const onTerminal = vi.fn();
    const onCancel = vi.fn();
    const { result, rerender } = renderHook(
      ({ sourceKey }) =>
        useOnDemandSeekRecovery({
          videoRef,
          hls,
          mediaKind: "hls-vod",
          sourceKey,
          onSuccess,
          onTerminal,
          onCancel,
        }),
      { initialProps: { sourceKey: "opaque-source-a" } }
    );

    let generationA = 0;
    act(() => {
      generationA = result.current.commitSeek(12);
    });
    rerender({ sourceKey: "opaque-source-b" });
    act(() => {
      frameCallbacks.shift()?.(0, { mediaTime: 12 } as VideoFrameCallbackMetadata);
      vi.advanceTimersByTime(100_000);
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onTerminal).not.toHaveBeenCalled();
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(cancelVideoFrameCallback).toHaveBeenCalledExactlyOnceWith(1);

    let generationB = 0;
    act(() => {
      generationB = result.current.commitSeek(48);
      frameCallbacks.shift()?.(0, { mediaTime: 48 } as VideoFrameCallbackMetadata);
    });

    expect(generationB).toBeGreaterThan(generationA);
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith({
      generation: generationB,
      targetSeconds: 48,
      presentedSeconds: 48,
    });
    expect(cancelVideoFrameCallback).toHaveBeenCalledTimes(1);
  });

  it("invalidates the old source before later layout effects can use new source options", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const videoRef = { current: video };
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const cancelVideoFrameCallback = vi.fn();
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
    const hlsA = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const hlsB = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onSuccessA = vi.fn();
    const onSuccessB = vi.fn();
    const onTerminalA = vi.fn();
    const onTerminalB = vi.fn();
    const onCancelA = vi.fn();
    const onCancelB = vi.fn();
    const { result, rerender } = renderHook(
      ({ sourceKey, hls, onSuccess, onTerminal, onCancel }) => {
        const recovery = useOnDemandSeekRecovery({
          videoRef,
          hls,
          mediaKind: "hls-vod",
          sourceKey,
          onSuccess,
          onTerminal,
          onCancel,
        });
        useLayoutEffect(() => {
          if (sourceKey !== "opaque-source-b") return;
          vi.advanceTimersByTime(2_500);
          frameCallbacks[0]?.(0, { mediaTime: 12 } as VideoFrameCallbackMetadata);
        }, [sourceKey]);
        return recovery;
      },
      {
        initialProps: {
          sourceKey: "opaque-source-a",
          hls: hlsA,
          onSuccess: onSuccessA,
          onTerminal: onTerminalA,
          onCancel: onCancelA,
        },
      }
    );

    act(() => {
      result.current.commitSeek(12);
    });
    rerender({
      sourceKey: "opaque-source-b",
      hls: hlsB,
      onSuccess: onSuccessB,
      onTerminal: onTerminalB,
      onCancel: onCancelB,
    });
    act(() => vi.advanceTimersByTime(100_000));

    expect(cancelVideoFrameCallback).toHaveBeenCalledExactlyOnceWith(1);
    expect(hlsA.startLoad).not.toHaveBeenCalled();
    expect(hlsB.startLoad).not.toHaveBeenCalled();
    expect(onSuccessA).not.toHaveBeenCalled();
    expect(onSuccessB).not.toHaveBeenCalled();
    expect(onTerminalA).not.toHaveBeenCalled();
    expect(onTerminalB).not.toHaveBeenCalled();
    expect(onCancelA).not.toHaveBeenCalled();
    expect(onCancelB).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain(
      "opaque-source-a"
    );
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain(
      "opaque-source-b"
    );
  });

  it("uses the latest recovery dependencies after a same-source rerender", () => {
    vi.useFakeTimers();
    const videoRef = { current: createPlayingVideo() };
    const hlsA = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const hlsB = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onTerminalA = vi.fn();
    const onTerminalB = vi.fn();
    const { result, rerender } = renderHook(
      ({ hls, onTerminal }) =>
        useOnDemandSeekRecovery({
          videoRef,
          hls,
          mediaKind: "hls-vod",
          sourceKey: "opaque-stable-source",
          onSuccess: vi.fn(),
          onTerminal,
        }),
      { initialProps: { hls: hlsA, onTerminal: onTerminalA } }
    );

    let generation = 0;
    act(() => {
      generation = result.current.commitSeek(30);
    });
    rerender({ hls: hlsB, onTerminal: onTerminalB });
    act(() => vi.advanceTimersByTime(7_500));

    expect(hlsA.startLoad).not.toHaveBeenCalled();
    expect(hlsA.stopLoad).not.toHaveBeenCalled();
    expect(hlsB.startLoad.mock.calls).toEqual([[30], [30]]);
    expect(hlsB.stopLoad).toHaveBeenCalledTimes(1);
    expect(onTerminalA).not.toHaveBeenCalled();
    expect(onTerminalB).toHaveBeenCalledExactlyOnceWith({
      generation,
      targetSeconds: 30,
      stage: "terminal",
    });
  });

  it("cancels the active generation when the hook unmounts", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const cancelVideoFrameCallback = vi.fn();
    Object.defineProperty(video, "cancelVideoFrameCallback", {
      configurable: true,
      value: cancelVideoFrameCallback,
    });
    const hls = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onSuccess = vi.fn();
    const onTerminal = vi.fn();
    const onCancel = vi.fn();
    const { result, unmount } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls,
        mediaKind: "hls-vod",
        sourceKey: "opaque-unmounted-source",
        onSuccess,
        onTerminal,
        onCancel,
      })
    );

    act(() => {
      result.current.commitSeek(30);
    });
    unmount();
    act(() => {
      frameCallbacks.shift()?.(0, { mediaTime: 30 } as VideoFrameCallbackMetadata);
      vi.advanceTimersByTime(100_000);
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onTerminal).not.toHaveBeenCalled();
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(hls.stopLoad).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(cancelVideoFrameCallback).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("logs secret-free timing from commit through the first matching frame", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const onSuccess = vi.fn();
    const sourceKey =
      "opaque-source::https://cdn.example.test/vod.m3u8?token=do-not-log-this";
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls: { startLoad: vi.fn(), stopLoad: vi.fn() },
        mediaKind: "hls-vod",
        sourceKey,
        onSuccess,
        onTerminal: vi.fn(),
      })
    );

    let generation = 0;
    act(() => {
      generation = result.current.commitSeek(48);
      vi.advanceTimersByTime(100);
      video.dispatchEvent(new Event("seeking"));
      vi.advanceTimersByTime(200);
      video.dispatchEvent(new Event("seeked"));
      vi.advanceTimersByTime(400);
      video.dispatchEvent(new Event("stalled"));
      vi.advanceTimersByTime(200);
      frameCallbacks.shift()?.(0, { mediaTime: 47.5 } as VideoFrameCallbackMetadata);
    });

    expect(vi.mocked(logger.debug).mock.calls).toEqual([
      [
        "Player:OnDemandSeekRecovery",
        "seek-committed",
        { generation, targetSeconds: 48, mediaKind: "hls-vod" },
      ],
      [
        "Player:OnDemandSeekRecovery",
        "seek-seeking",
        { generation, targetSeconds: 48, mediaKind: "hls-vod", elapsedMs: 100 },
      ],
      [
        "Player:OnDemandSeekRecovery",
        "seek-acknowledged",
        { generation, targetSeconds: 48, mediaKind: "hls-vod", elapsedMs: 300 },
      ],
      [
        "Player:OnDemandSeekRecovery",
        "seek-stalled",
        { generation, targetSeconds: 48, mediaKind: "hls-vod", elapsedMs: 700 },
      ],
      [
        "Player:OnDemandSeekRecovery",
        "seek-first-matching-frame",
        {
          generation,
          targetSeconds: 48,
          mediaKind: "hls-vod",
          presentedSeconds: 47.5,
          elapsedMs: 900,
        },
      ],
      [
        "Player:OnDemandSeekRecovery",
        "seek-succeeded",
        { generation, targetSeconds: 48, mediaKind: "hls-vod", elapsedMs: 900 },
      ],
    ]);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    const loggedArguments = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(loggedArguments).not.toContain(sourceKey);
    expect(loggedArguments).not.toContain("https://cdn.example.test/vod.m3u8");
    expect(loggedArguments).not.toContain("do-not-log-this");
  });

  it("logs only the latest generation's bounded recovery and exhaustion", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn(() => 1),
    });
    const hls = { startLoad: vi.fn(), stopLoad: vi.fn() };
    const onTerminal = vi.fn();
    const sourceKey =
      "opaque-source::https://cdn.example.test/latest.m3u8?token=never-log-this";
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls,
        mediaKind: "hls-vod",
        sourceKey,
        onSuccess: vi.fn(),
        onTerminal,
      })
    );

    let generationA = 0;
    let generationB = 0;
    act(() => {
      generationA = result.current.commitSeek(12);
      vi.advanceTimersByTime(100);
      generationB = result.current.commitSeek(48);
    });
    vi.mocked(logger.debug).mockClear();

    act(() => vi.advanceTimersByTime(2_500));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => vi.advanceTimersByTime(2_000));

    expect(vi.mocked(logger.debug).mock.calls).toEqual([
      [
        "Player:OnDemandSeekRecovery",
        "seek-recovery-stage",
        {
          generation: generationB,
          targetSeconds: 48,
          mediaKind: "hls-vod",
          stage: "soft",
          elapsedMs: 2_500,
        },
      ],
      [
        "Player:OnDemandSeekRecovery",
        "seek-recovery-stage",
        {
          generation: generationB,
          targetSeconds: 48,
          mediaKind: "hls-vod",
          stage: "hard",
          elapsedMs: 5_500,
        },
      ],
      [
        "Player:OnDemandSeekRecovery",
        "seek-recovery-stage",
        {
          generation: generationB,
          targetSeconds: 48,
          mediaKind: "hls-vod",
          stage: "terminal",
          elapsedMs: 7_500,
        },
      ],
      [
        "Player:OnDemandSeekRecovery",
        "seek-exhausted",
        {
          generation: generationB,
          targetSeconds: 48,
          mediaKind: "hls-vod",
          stage: "terminal",
          elapsedMs: 7_500,
        },
      ],
    ]);
    expect(generationB).toBeGreaterThan(generationA);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(2);
    expect(hls.stopLoad).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(100_000));
    expect(logger.debug).toHaveBeenCalledTimes(4);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(2);
    expect(hls.stopLoad).toHaveBeenCalledTimes(1);

    const recoveryLogs = vi.mocked(logger.debug).mock.calls;
    expect(recoveryLogs.every(([, , meta]) => meta?.generation === generationB)).toBe(true);
    expect(recoveryLogs.every(([, , meta]) => meta?.targetSeconds === 48)).toBe(true);
    const loggedArguments = JSON.stringify(recoveryLogs);
    expect(loggedArguments).not.toContain(sourceKey);
    expect(loggedArguments).not.toContain("https://cdn.example.test/latest.m3u8");
    expect(loggedArguments).not.toContain("never-log-this");
  });

  it("starts programmatic seek recovery without superseding an explicit commit", () => {
    vi.useFakeTimers();
    const video = createPlayingVideo();
    let currentTime = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(video, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useOnDemandSeekRecovery({
        videoRef: { current: video },
        hls: { startLoad: vi.fn(), stopLoad: vi.fn() },
        mediaKind: "hls-vod",
        sourceKey: "opaque-programmatic-source",
        onSuccess,
        onTerminal: vi.fn(),
      })
    );

    act(() => {
      currentTime = 25;
      video.dispatchEvent(new Event("seeking"));
      frameCallbacks.shift()?.(0, { mediaTime: 25 } as VideoFrameCallbackMetadata);
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    const programmaticSuccess = onSuccess.mock.calls[0][0];
    expect(programmaticSuccess).toEqual({
      generation: expect.any(Number),
      targetSeconds: 25,
      presentedSeconds: 25,
    });

    let explicitGeneration = 0;
    act(() => {
      explicitGeneration = result.current.commitSeek(50);
      currentTime = 50;
      video.dispatchEvent(new Event("seeking"));
      frameCallbacks.shift()?.(0, { mediaTime: 50 } as VideoFrameCallbackMetadata);
    });

    expect(explicitGeneration).toBeGreaterThan(programmaticSuccess.generation);
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenLastCalledWith({
      generation: explicitGeneration,
      targetSeconds: 50,
      presentedSeconds: 50,
    });
    const explicitCommitLogs = vi
      .mocked(logger.debug)
      .mock.calls.filter(
        ([, message, meta]) =>
          message === "seek-committed" && meta?.targetSeconds === 50
      );
    expect(explicitCommitLogs).toEqual([
      [
        "Player:OnDemandSeekRecovery",
        "seek-committed",
        {
          generation: explicitGeneration,
          targetSeconds: 50,
          mediaKind: "hls-vod",
        },
      ],
    ]);
  });
});
