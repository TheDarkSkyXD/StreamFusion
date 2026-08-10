import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { logger } from "@/renderer/logging/logger";

import {
  OnDemandSeekRecoveryController,
  type OnDemandSeekRecovery,
  type OnDemandSeekSuccess,
} from "../on-demand-seek-recovery-controller";

export type OnDemandMediaKind = "hls-vod" | "native-clip";
export type OnDemandSeekCancelReason =
  | "pause"
  | "hidden"
  | "offline"
  | "ended"
  | "ineligible";

export interface OnDemandSeekHlsLike {
  startLoad(startPosition?: number): void;
  stopLoad(): void;
}

export interface UseOnDemandSeekRecoveryOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  hls?: OnDemandSeekHlsLike | null;
  mediaKind: OnDemandMediaKind;
  sourceKey: string;
  onSuccess: (success: OnDemandSeekSuccess) => void;
  onTerminal: (recovery: OnDemandSeekRecovery) => void;
  onCancel?: (reason: OnDemandSeekCancelReason) => void;
}

export interface UseOnDemandSeekRecoveryResult {
  commitSeek(targetSeconds: number): number;
}

const HAVE_CURRENT_DATA = 2;
const LOG_TAG = "Player:OnDemandSeekRecovery";

interface ActiveSeekTiming {
  generation: number;
  targetSeconds: number;
  mediaKind: OnDemandMediaKind;
  committedAt: number;
}

interface ActiveFrameRequest {
  video: HTMLVideoElement;
  id: number;
  generation: number;
  sourceKey: string;
}

function getIneligibilityReason(
  video: HTMLVideoElement | null
): OnDemandSeekCancelReason | null {
  if (document.visibilityState === "hidden") return "hidden";
  if (navigator.onLine === false) return "offline";
  if (video === null) return "ineligible";
  if (video.ended) return "ended";
  if (video.paused) return "pause";
  return null;
}

export function useOnDemandSeekRecovery(
  options: UseOnDemandSeekRecoveryOptions
): UseOnDemandSeekRecoveryResult {
  const optionsRef = useRef(options);
  const activeGenerationRef = useRef<number | null>(null);
  const activeSourceKeyRef = useRef<string | null>(null);
  const fallbackSeekedGenerationRef = useRef<number | null>(null);
  const activeSeekTimingRef = useRef<ActiveSeekTiming | null>(null);
  const activeFrameRequestRef = useRef<ActiveFrameRequest | null>(null);
  const commitSeekRef = useRef<((targetSeconds: number) => number) | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const cancelActiveFrameRequest = useCallback((): void => {
    const request = activeFrameRequestRef.current;
    if (request === null) return;

    activeFrameRequestRef.current = null;
    request.video.cancelVideoFrameCallback?.(request.id);
  }, []);

  const [controller] = useState(
    () =>
      new OnDemandSeekRecoveryController({
        onRecovery: (recovery) => {
          if (
            activeGenerationRef.current !== recovery.generation ||
            activeSourceKeyRef.current === null ||
            activeSourceKeyRef.current !== optionsRef.current.sourceKey
          ) {
            return;
          }
          const timing = activeSeekTimingRef.current;
          if (timing?.generation === recovery.generation) {
            const meta = {
              generation: timing.generation,
              targetSeconds: timing.targetSeconds,
              mediaKind: timing.mediaKind,
              stage: recovery.stage,
              elapsedMs: Math.round(performance.now() - timing.committedAt),
            };
            logger.debug(LOG_TAG, "seek-recovery-stage", meta);
            if (recovery.stage === "terminal") {
              logger.debug(LOG_TAG, "seek-exhausted", meta);
            }
          }

          if (recovery.stage === "terminal") {
            cancelActiveFrameRequest();
            activeGenerationRef.current = null;
            activeSourceKeyRef.current = null;
            activeSeekTimingRef.current = null;
            optionsRef.current.onTerminal(recovery);
            return;
          }

          const { hls, mediaKind, videoRef } = optionsRef.current;
          if (mediaKind === "native-clip") {
            const video = videoRef.current;
            if (!video || !Number.isFinite(recovery.targetSeconds)) return;

            if (recovery.stage === "hard") {
              video.currentTime = Math.max(0, recovery.targetSeconds - 0.25);
            }
            video.currentTime = recovery.targetSeconds;
            return;
          }

          if (mediaKind !== "hls-vod" || !hls) return;

          if (recovery.stage === "hard") hls.stopLoad();
          hls.startLoad(recovery.targetSeconds);
          if (videoRef.current && Number.isFinite(recovery.targetSeconds)) {
            videoRef.current.currentTime = recovery.targetSeconds;
          }
        },
        onSuccess: (success) => {
          if (
            activeGenerationRef.current !== success.generation ||
            activeSourceKeyRef.current === null ||
            activeSourceKeyRef.current !== optionsRef.current.sourceKey
          ) {
            return;
          }
          const timing = activeSeekTimingRef.current;
          if (timing?.generation === success.generation) {
            const elapsedMs = Math.round(performance.now() - timing.committedAt);
            const common = {
              generation: timing.generation,
              targetSeconds: timing.targetSeconds,
              mediaKind: timing.mediaKind,
            };
            logger.debug(LOG_TAG, "seek-first-matching-frame", {
              ...common,
              presentedSeconds: success.presentedSeconds,
              elapsedMs,
            });
            logger.debug(LOG_TAG, "seek-succeeded", { ...common, elapsedMs });
          }
          cancelActiveFrameRequest();
          activeGenerationRef.current = null;
          activeSourceKeyRef.current = null;
          activeSeekTimingRef.current = null;
          optionsRef.current.onSuccess(success);
        },
      })
  );

  const cancelActiveSeek = useCallback((reason?: OnDemandSeekCancelReason): void => {
    const timing = activeSeekTimingRef.current;
    const cancellation =
      reason !== undefined &&
      timing !== null &&
      timing.generation === activeGenerationRef.current &&
      activeSourceKeyRef.current === optionsRef.current.sourceKey
        ? { reason, timing }
        : null;
    cancelActiveFrameRequest();
    activeGenerationRef.current = null;
    activeSourceKeyRef.current = null;
    fallbackSeekedGenerationRef.current = null;
    activeSeekTimingRef.current = null;
    controller.cancel();

    if (cancellation === null) return;
    logger.debug(LOG_TAG, "seek-cancelled", {
      generation: cancellation.timing.generation,
      targetSeconds: cancellation.timing.targetSeconds,
      mediaKind: cancellation.timing.mediaKind,
      reason: cancellation.reason,
      elapsedMs: Math.round(performance.now() - cancellation.timing.committedAt),
    });
    optionsRef.current.onCancel?.(cancellation.reason);
  }, [cancelActiveFrameRequest, controller]);

  useLayoutEffect(() => {
    if (
      activeSourceKeyRef.current !== null &&
      activeSourceKeyRef.current !== options.sourceKey
    ) {
      cancelActiveSeek();
    }
  }, [cancelActiveSeek, options.sourceKey]);

  useEffect(() => {
    const video = options.videoRef.current;
    const sourceKey = options.sourceKey;
    const logTiming = (message: string): void => {
      const timing = activeSeekTimingRef.current;
      if (
        timing === null ||
        timing.generation !== activeGenerationRef.current ||
        activeSourceKeyRef.current !== sourceKey ||
        optionsRef.current.sourceKey !== sourceKey
      ) {
        return;
      }
      logger.debug(LOG_TAG, message, {
        generation: timing.generation,
        targetSeconds: timing.targetSeconds,
        mediaKind: timing.mediaKind,
        elapsedMs: Math.round(performance.now() - timing.committedAt),
      });
    };
    const noteSeeking = (): void => {
      if (
        activeGenerationRef.current === null &&
        video !== null &&
        Number.isFinite(video.currentTime)
      ) {
        commitSeekRef.current?.(video.currentTime);
      }
      logTiming("seek-seeking");
    };
    const noteSeeked = (): void => {
      if (
        activeSourceKeyRef.current !== sourceKey ||
        optionsRef.current.sourceKey !== sourceKey
      ) {
        return;
      }
      fallbackSeekedGenerationRef.current = activeGenerationRef.current;
      logTiming("seek-acknowledged");
    };
    const noteStalled = (): void => logTiming("seek-stalled");
    const cancelWhenHidden = (): void => {
      if (document.visibilityState === "hidden") cancelActiveSeek("hidden");
    };
    const cancelWhenOffline = (): void => cancelActiveSeek("offline");
    const cancelWhenPaused = (): void => cancelActiveSeek("pause");
    const cancelWhenEnded = (): void => cancelActiveSeek("ended");
    const removeEligibilityListeners = (): void => {
      document.removeEventListener("visibilitychange", cancelWhenHidden);
      window.removeEventListener("offline", cancelWhenOffline);
      video?.removeEventListener("pause", cancelWhenPaused);
      video?.removeEventListener("ended", cancelWhenEnded);
      video?.removeEventListener("seeking", noteSeeking);
      video?.removeEventListener("seeked", noteSeeked);
      video?.removeEventListener("stalled", noteStalled);
    };

    document.addEventListener("visibilitychange", cancelWhenHidden);
    window.addEventListener("offline", cancelWhenOffline);

    if (!video) {
      return () => {
        removeEligibilityListeners();
        cancelActiveSeek();
      };
    }

    video.addEventListener("pause", cancelWhenPaused);
    video.addEventListener("ended", cancelWhenEnded);
    video.addEventListener("seeking", noteSeeking);
    video.addEventListener("seeked", noteSeeked);
    video.addEventListener("stalled", noteStalled);
    if (typeof video.requestVideoFrameCallback === "function") {
      return () => {
        removeEligibilityListeners();
        cancelActiveSeek();
      };
    }

    const notePresentedMedia = (): void => {
      const generation = activeGenerationRef.current;
      if (
        generation === null ||
        activeSourceKeyRef.current !== sourceKey ||
        optionsRef.current.sourceKey !== sourceKey ||
        fallbackSeekedGenerationRef.current !== generation ||
        video.readyState < HAVE_CURRENT_DATA
      ) {
        return;
      }
      controller.notePresentedFrame(generation, video.currentTime);
    };

    video.addEventListener("timeupdate", notePresentedMedia);
    video.addEventListener("playing", notePresentedMedia);

    return () => {
      removeEligibilityListeners();
      video.removeEventListener("timeupdate", notePresentedMedia);
      video.removeEventListener("playing", notePresentedMedia);
      cancelActiveSeek();
    };
  }, [cancelActiveSeek, controller, options.sourceKey, options.videoRef]);

  const observePresentedFrames = useCallback(function observe(
    generation: number,
    sourceKey: string
  ): void {
    const video = optionsRef.current.videoRef.current;
    if (
      !video ||
      typeof video.requestVideoFrameCallback !== "function" ||
      activeGenerationRef.current !== generation ||
      activeSourceKeyRef.current !== sourceKey ||
      optionsRef.current.sourceKey !== sourceKey
    ) {
      return;
    }

    const id = video.requestVideoFrameCallback((_now, metadata) => {
      const request = activeFrameRequestRef.current;
      if (
        request?.video !== video ||
        request.id !== id ||
        request.generation !== generation ||
        request.sourceKey !== sourceKey
      ) {
        return;
      }
      activeFrameRequestRef.current = null;
      if (
        activeGenerationRef.current !== generation ||
        activeSourceKeyRef.current !== sourceKey ||
        optionsRef.current.sourceKey !== sourceKey
      ) {
        return;
      }

      controller.notePresentedFrame(generation, metadata.mediaTime);
      if (
        activeGenerationRef.current === generation &&
        activeSourceKeyRef.current === sourceKey
      ) {
        observe(generation, sourceKey);
      }
    });
    activeFrameRequestRef.current = { video, id, generation, sourceKey };
  }, [controller]);

  const commitSeek = useCallback(
    (targetSeconds: number): number => {
      cancelActiveFrameRequest();
      const generation = controller.commitSeek(targetSeconds);
      activeGenerationRef.current = generation;
      fallbackSeekedGenerationRef.current = null;
      const { mediaKind, sourceKey } = optionsRef.current;
      activeSourceKeyRef.current = sourceKey;
      activeSeekTimingRef.current = {
        generation,
        targetSeconds,
        mediaKind,
        committedAt: performance.now(),
      };
      logger.debug(LOG_TAG, "seek-committed", { generation, targetSeconds, mediaKind });
      const video = optionsRef.current.videoRef.current;
      const ineligibleReason = getIneligibilityReason(video);
      if (ineligibleReason !== null) {
        cancelActiveSeek(ineligibleReason);
        return generation;
      }
      observePresentedFrames(generation, sourceKey);
      return generation;
    },
    [cancelActiveFrameRequest, cancelActiveSeek, controller, observePresentedFrames]
  );

  useLayoutEffect(() => {
    commitSeekRef.current = commitSeek;
    return () => {
      commitSeekRef.current = null;
    };
  }, [commitSeek]);

  return { commitSeek };
}
