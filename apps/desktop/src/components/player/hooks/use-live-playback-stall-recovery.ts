import type Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";

import { useInterval } from "@/hooks/useInterval";
import { logger } from "@/renderer/logging/logger";

import {
  LivePlaybackStallController,
  type LivePlaybackStallAction,
} from "../live-playback-stall-controller";
import type { PlayerError } from "../types";

interface UseLivePlaybackStallRecoveryOptions {
  sourceKey: string;
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
  onErrorRef: RefObject<((error: PlayerError) => void) | undefined>;
  onCleanPresentedFrameRef?: RefObject<(() => void) | undefined>;
  onRecoveryStateChangeRef?: RefObject<((recovering: boolean) => void) | undefined>;
  onHlsInstanceRef?: RefObject<((hls: Hls | null) => void) | undefined>;
  isActiveRef: RefObject<boolean>;
  shouldSuppress?: () => boolean;
}

interface LivePlaybackStallRecovery {
  noteFragmentLoaded: () => void;
  noteManifestParsed: () => void;
  noteNetworkError: () => void;
}

const WATCHDOG_INTERVAL_MS = 500;

function bufferedAheadSeconds(video: HTMLVideoElement): number {
  const currentTime = video.currentTime;
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (video.buffered.start(index) <= currentTime && video.buffered.end(index) >= currentTime) {
      return video.buffered.end(index) - currentTime;
    }
  }
  return 0;
}

export function useLivePlaybackStallRecovery({
  sourceKey,
  enabled,
  videoRef,
  hlsRef,
  onErrorRef,
  onCleanPresentedFrameRef,
  onRecoveryStateChangeRef,
  onHlsInstanceRef,
  isActiveRef,
  shouldSuppress,
}: UseLivePlaybackStallRecoveryOptions): LivePlaybackStallRecovery {
  const generationRef = useRef(0);
  const controllerRef = useRef<LivePlaybackStallController | null>(null);
  const suppressRef = useRef(shouldSuppress);
  const lastPresentedFrameAtRef = useRef<number | null>(null);
  const lastFragmentLoadedAtRef = useRef<number | null>(null);
  const lastEvaluatedCurrentTimeRef = useRef(0);
  const cleanFrameNotifiedRef = useRef(false);

  useEffect(() => {
    suppressRef.current = shouldSuppress;
  }, [shouldSuppress]);

  if (!controllerRef.current) {
    controllerRef.current = new LivePlaybackStallController((transition) => {
      logger.info("Player:HLS", "live playback stall transition", {
        generation: generationRef.current,
        ...transition,
      });
      if (transition.to === "soft" || transition.to === "hard") {
        onRecoveryStateChangeRef?.current?.(true);
      } else if (
        transition.to === "healthy" ||
        transition.to === "startup" ||
        transition.to === "exhausted"
      ) {
        onRecoveryStateChangeRef?.current?.(false);
      }
    });
  }

  useEffect(() => {
    const video = videoRef.current;
    const controller = controllerRef.current;
    if (!enabled || !video || !controller) return;

    const generation = ++generationRef.current;
    controller.resetSource(generation, Date.now(), video.currentTime);

    let frameCallbackId: number | null = null;
    const supportsVideoFrameCallbacks = typeof video.requestVideoFrameCallback === "function";
    const cancelFrameCallback = () => {
      if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameCallbackId);
      }
      frameCallbackId = null;
    };
    const scheduleFrameCallback = () => {
      if (!supportsVideoFrameCallbacks || frameCallbackId !== null) return;
      frameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
        frameCallbackId = null;
        if (generation !== generationRef.current || !isActiveRef.current) return;
        const now = Date.now();
        lastPresentedFrameAtRef.current = now;
        controller.notePresentedFrame(now, metadata.mediaTime);
        if (
          !cleanFrameNotifiedRef.current &&
          !document.hidden &&
          !(suppressRef.current?.() ?? false)
        ) {
          cleanFrameNotifiedRef.current = true;
          onCleanPresentedFrameRef?.current?.();
        }
        scheduleFrameCallback();
      });
    };
    const resetFrameHeartbeat = () => {
      lastPresentedFrameAtRef.current = null;
      cancelFrameCallback();
      scheduleFrameCallback();
    };
    const onPlay = () => {
      controller.notePlay(Date.now(), video.currentTime);
      resetFrameHeartbeat();
    };
    const onPlaying = () => controller.notePlaying(Date.now(), video.currentTime);
    const onWaiting = () => controller.noteWaiting(Date.now());
    const onStalled = () => controller.noteStalled(Date.now());
    const onSeeking = () => {
      controller.noteSeeking(Date.now());
      resetFrameHeartbeat();
    };
    const onSeeked = () => {
      controller.noteSeeked(Date.now(), video.currentTime);
      resetFrameHeartbeat();
    };
    const onPause = () => controller.notePause();
    const onEnded = () => controller.noteEnded();
    const onVisibilityChange = () => {
      controller.noteVisibilityChange(Date.now(), video.currentTime);
      resetFrameHeartbeat();
    };
    const onConnectivityChange = () => {
      controller.noteConnectivityChange(Date.now(), video.currentTime);
      lastPresentedFrameAtRef.current = null;
      cancelFrameCallback();
      if (navigator.onLine !== false) scheduleFrameCallback();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onConnectivityChange);
    window.addEventListener("offline", onConnectivityChange);
    lastPresentedFrameAtRef.current = null;
    lastFragmentLoadedAtRef.current = null;
    lastEvaluatedCurrentTimeRef.current = video.currentTime;
    cleanFrameNotifiedRef.current = false;
    scheduleFrameCallback();

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onConnectivityChange);
      window.removeEventListener("offline", onConnectivityChange);
      cancelFrameCallback();
      generationRef.current = generation + 1;
      controller.resetSource(generation + 1, Date.now(), 0);
    };
  }, [enabled, isActiveRef, onCleanPresentedFrameRef, onRecoveryStateChangeRef, sourceKey, videoRef]);

  useInterval(
    () => {
      const video = videoRef.current;
      const controller = controllerRef.current;
      if (!enabled || !video || !controller || !isActiveRef.current) return;

      const action = controller.evaluate(Date.now(), {
        currentTime: video.currentTime,
        paused: video.paused,
        ended: video.ended,
        seeking: video.seeking,
        hidden: document.hidden,
        online: navigator.onLine !== false,
        readyState: video.readyState,
        bufferedAheadSeconds: bufferedAheadSeconds(video),
        adBlockHolding: suppressRef.current?.() ?? false,
        videoFrameCallbacksSupported: typeof video.requestVideoFrameCallback === "function",
        lastPresentedFrameAt: lastPresentedFrameAtRef.current,
      });
      if (action) {
        const now = Date.now();
        const currentTimeDelta = video.currentTime - lastEvaluatedCurrentTimeRef.current;
        applyRecoveryAction(
          action,
          video,
          hlsRef,
          onErrorRef,
          onHlsInstanceRef,
          controller,
          {
            generation: generationRef.current,
            frameAgeMs:
              lastPresentedFrameAtRef.current === null
                ? null
                : now - lastPresentedFrameAtRef.current,
            currentTimeDelta,
            bufferedAheadSeconds: bufferedAheadSeconds(video),
            fragmentAgeMs:
              lastFragmentLoadedAtRef.current === null
                ? null
                : now - lastFragmentLoadedAtRef.current,
          }
        );
      }
      lastEvaluatedCurrentTimeRef.current = video.currentTime;
    },
    enabled ? WATCHDOG_INTERVAL_MS : null
  );

  const noteFragmentLoaded = useCallback(() => {
    const now = Date.now();
    lastFragmentLoadedAtRef.current = now;
    controllerRef.current?.noteFragmentLoaded(now);
  }, []);

  const noteManifestParsed = useCallback(() => {
    controllerRef.current?.noteManifestParsed(Date.now());
  }, []);

  const noteNetworkError = useCallback(() => {
    controllerRef.current?.noteNetworkError(Date.now());
  }, []);

  return useMemo(
    () => ({ noteFragmentLoaded, noteManifestParsed, noteNetworkError }),
    [noteFragmentLoaded, noteManifestParsed, noteNetworkError]
  );
}

function applyRecoveryAction(
  action: LivePlaybackStallAction,
  video: HTMLVideoElement,
  hlsRef: RefObject<Hls | null>,
  onErrorRef: RefObject<((error: PlayerError) => void) | undefined>,
  onHlsInstanceRef: RefObject<((hls: Hls | null) => void) | undefined> | undefined,
  controller: LivePlaybackStallController,
  telemetry: {
    generation: number;
    frameAgeMs: number | null;
    currentTimeDelta: number;
    bufferedAheadSeconds: number;
    fragmentAgeMs: number | null;
  }
): void {
  const hls = hlsRef.current;
  const log = action.type === "fatal" ? logger.warn : logger.info;
  log("Player:HLS", "live playback stall recovery", {
    action: action.type,
    stage: action.stage,
    reason: action.reason,
    ...telemetry,
  });

  try {
    switch (action.type) {
      case "start-load":
        hls?.startLoad(-1);
        break;
      case "nudge":
        video.currentTime += 0.1;
        controller.noteRecoveryNudge(video.currentTime);
        break;
      case "recover-media":
        hls?.recoverMediaError();
        break;
      case "fatal": {
        try {
          hls?.stopLoad();
        } catch {
          // The loader may already be stopped.
        }
        try {
          hls?.detachMedia();
        } catch {
          // The media pipeline may already be detached.
        }
        try {
          hls?.destroy();
        } catch (error) {
          logger.warn("Player:HLS", "live playback HLS destruction failed", {
            errorName: error instanceof Error ? error.name : "unknown",
            ...telemetry,
          });
        }
        if (hlsRef.current === hls) hlsRef.current = null;
        onHlsInstanceRef?.current?.(null);
        const decoderStall = action.reason === "decoder-stall";
        const noFragments = !decoderStall && telemetry.fragmentAgeMs === null;
        onErrorRef.current?.({
          code: decoderStall ? "DECODER_STALL" : noFragments ? "NO_FRAGMENTS" : "PLAYBACK_STALL",
          message: decoderStall
            ? "Video decoder stopped making progress"
            : "Live video stopped receiving playable data",
          fatal: true,
          shouldRefresh: true,
          originalError: null,
        });
        break;
      }
    }
    log("Player:HLS", "live playback stall recovery result", {
      action: action.type,
      stage: action.stage,
      reason: action.reason,
      outcome: "applied",
      ...telemetry,
    });
  } catch (error) {
    logger.warn("Player:HLS", "live playback stall recovery failed", {
      action: action.type,
      stage: action.stage,
      reason: action.reason,
      errorName: error instanceof Error ? error.name : "unknown",
      ...telemetry,
    });
  }
}
