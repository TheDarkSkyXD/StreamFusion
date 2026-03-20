/**
 * useBackgroundThrottle Hook
 *
 * Detects when the application/browser window is in the background (not visible)
 * and throttles video playback to save system resources and bandwidth.
 *
 * Features:
 * - Page Visibility API monitoring (document.hidden, visibilitychange)
 * - Window blur/focus detection
 * - Configurable throttling behaviors (pause, reduce quality, mute)
 * - Grace period before throttling kicks in
 * - Automatic restoration when returning to foreground
 *
 * Use Cases:
 * - Multi-stream viewing where non-focused streams should use fewer resources
 * - Saving bandwidth when user switches to another application
 * - Reducing system load from background streams
 *
 * @module player/use-background-throttle
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ThrottleAction = "pause" | "reduceQuality" | "mute" | "none";

export interface BackgroundThrottleOptions {
  /** Reference to the video element */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Whether throttling is enabled (default: true) */
  enabled?: boolean;
  /** Action to take when backgrounded (default: 'pause') */
  throttleAction?: ThrottleAction;
  /** Delay before throttling kicks in (ms, default: 5000) */
  gracePeriod?: number;
  /** Whether to track window focus in addition to visibility (default: true) */
  trackWindowFocus?: boolean;
  /** Callback when throttle state changes */
  onThrottleChange?: (isThrottled: boolean, action: ThrottleAction) => void;
  /** Quality change callback (for reduceQuality action) */
  onQualityChange?: (qualityId: string) => void;
  /** Current quality ID (for restoring after unthrottle) */
  currentQualityId?: string;
  /** Available qualities (for reduceQuality action) */
  qualities?: Array<{ id: string; height: number; isAuto?: boolean }>;
}

export interface BackgroundThrottleState {
  /** Whether the page/window is currently visible */
  isVisible: boolean;
  /** Whether the window is currently focused */
  isFocused: boolean;
  /** Whether throttling is currently active */
  isThrottled: boolean;
  /** Current throttle action being applied */
  activeAction: ThrottleAction;
  /** Time since last visibility change */
  timeSinceHidden: number | null;
}

/**
 * Hook to throttle video playback when the application is in the background
 */
export function useBackgroundThrottle({
  videoRef,
  enabled = true,
  throttleAction = "none",
  gracePeriod = 5000,
  trackWindowFocus = true,
  onThrottleChange,
  onQualityChange,
  currentQualityId,
  qualities,
}: BackgroundThrottleOptions): BackgroundThrottleState {
  const [state, setState] = useState<BackgroundThrottleState>({
    isVisible: !document.hidden,
    isFocused: document.hasFocus(),
    isThrottled: false,
    activeAction: "none",
    timeSinceHidden: null,
  });

  // Refs for tracking state across closures
  const wasPlayingRef = useRef<boolean>(false);
  const wasMutedRef = useRef<boolean>(false);
  const previousQualityRef = useRef<string | null>(null);
  const throttleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenTimestampRef = useRef<number | null>(null);

  // Apply throttle action
  const applyThrottle = useCallback(() => {
    const video = videoRef.current;
    if (!video || !enabled) return;

    switch (throttleAction) {
      case "pause":
        wasPlayingRef.current = !video.paused;
        if (!video.paused) {
          video.pause();
          console.debug("[BackgroundThrottle] Paused video");
        }
        break;

      case "mute":
        // Capture original muted state before modifying
        wasMutedRef.current = video.muted;
        if (!video.muted) {
          video.muted = true;
          console.debug("[BackgroundThrottle] Muted video");
        }
        break;

      case "reduceQuality":
        if (onQualityChange && qualities && qualities.length > 0) {
          // Save current quality
          if (currentQualityId && currentQualityId !== "auto") {
            previousQualityRef.current = currentQualityId;
          }
          // Find lowest quality
          const sortedQualities = [...qualities]
            .filter((q) => !q.isAuto && q.height > 0)
            .sort((a, b) => a.height - b.height);

          if (sortedQualities.length > 0) {
            const lowestQuality = sortedQualities[0];
            if (lowestQuality.id !== currentQualityId) {
              onQualityChange(lowestQuality.id);
              console.debug("[BackgroundThrottle] Reduced quality to:", lowestQuality.id);
            }
          }
        }
        break;
      default:
        break;
    }

    setState((prev) => ({
      ...prev,
      isThrottled: true,
      activeAction: throttleAction,
    }));

    onThrottleChange?.(true, throttleAction);
  }, [
    videoRef,
    enabled,
    throttleAction,
    onQualityChange,
    qualities,
    currentQualityId,
    onThrottleChange,
  ]);

  // Remove throttle action
  const removeThrottle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    switch (throttleAction) {
      case "pause":
        if (wasPlayingRef.current) {
          video.play().catch((e) => {
            // Ignore autoplay policy errors
            if (e.name !== "NotAllowedError") {
              console.error("[BackgroundThrottle] Failed to resume:", e);
            }
          });
          wasPlayingRef.current = false;
          console.debug("[BackgroundThrottle] Resumed video");
        }
        break;

      case "mute":
        if (!wasMutedRef.current) {
          video.muted = false;
          console.debug("[BackgroundThrottle] Unmuted video");
        }
        break;

      case "reduceQuality":
        if (onQualityChange && previousQualityRef.current) {
          onQualityChange(previousQualityRef.current);
          console.debug("[BackgroundThrottle] Restored quality to:", previousQualityRef.current);
          previousQualityRef.current = null;
        }
        break;
      default:
        break;
    }

    setState((prev) => ({
      ...prev,
      isThrottled: false,
      activeAction: "none",
    }));

    onThrottleChange?.(false, "none");
  }, [videoRef, throttleAction, onQualityChange, onThrottleChange]);

  // Handle visibility/focus change
  const handleVisibilityChange = useCallback(
    (isVisible: boolean, isFocused: boolean) => {
      const shouldBeVisible = isVisible && (trackWindowFocus ? isFocused : true);

      if (shouldBeVisible) {
        // Returning to foreground
        hiddenTimestampRef.current = null;

        // Cancel pending throttle
        if (throttleTimeoutRef.current) {
          clearTimeout(throttleTimeoutRef.current);
          throttleTimeoutRef.current = null;
        }

        // Remove throttle if active
        if (state.isThrottled) {
          removeThrottle();
        }

        setState((prev) => ({
          ...prev,
          isVisible,
          isFocused,
          timeSinceHidden: null,
        }));
      } else {
        // Going to background
        hiddenTimestampRef.current = Date.now();

        setState((prev) => ({
          ...prev,
          isVisible,
          isFocused,
        }));

        // Start grace period timer
        if (enabled && !state.isThrottled && throttleAction !== "none") {
          throttleTimeoutRef.current = setTimeout(() => {
            applyThrottle();
          }, gracePeriod);
        }
      }
    },
    [
      enabled,
      trackWindowFocus,
      gracePeriod,
      throttleAction,
      state.isThrottled,
      applyThrottle,
      removeThrottle,
    ]
  );

  // Monitor Page Visibility API
  useEffect(() => {
    if (!enabled) return;

    const handleVisibility = () => {
      handleVisibilityChange(!document.hidden, document.hasFocus());
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, handleVisibilityChange]);

  // Monitor window focus/blur
  useEffect(() => {
    if (!enabled || !trackWindowFocus) return;

    const handleFocus = () => {
      setState((prev) => ({ ...prev, isFocused: true }));
      handleVisibilityChange(!document.hidden, true);
    };

    const handleBlur = () => {
      setState((prev) => ({ ...prev, isFocused: false }));
      handleVisibilityChange(!document.hidden, false);
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [enabled, trackWindowFocus, handleVisibilityChange]);

  // Track time since hidden (for UI display)
  useEffect(() => {
    if (!hiddenTimestampRef.current) return;

    const interval = setInterval(() => {
      if (hiddenTimestampRef.current) {
        const elapsed = Date.now() - hiddenTimestampRef.current;
        setState((prev) => ({ ...prev, timeSinceHidden: elapsed }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, []);

  // Store playing state on mount for restoration
  // Note: Using videoRef.current in deps is unconventional but necessary
  // to re-run when the underlying video element changes

  return state;
}

/**
 * Hook specifically for multistream scenarios where we want to throttle
 * streams that are not the currently focused one.
 */
export function useMultistreamThrottle({
  videoRef,
  isFocused,
  enabled = true,
  throttleAction = "mute",
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isFocused: boolean;
  enabled?: boolean;
  /** Throttle action - only 'mute' and 'none' are supported in multistream mode */
  throttleAction?: "mute" | "none";
}): { isThrottled: boolean } {
  const [isThrottled, setIsThrottled] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const video = videoRef.current;
    if (!video) return;

    if (!isFocused) {
      // Stream is not focused - apply throttle
      if (throttleAction === "mute" && !video.muted) {
        video.muted = true;
      }
      setIsThrottled(true);
    } else {
      // Stream is focused - remove throttle
      if (throttleAction === "mute") {
        // Don't auto-unmute - let the user control audio for focused stream
      }
      setIsThrottled(false);
    }
  }, [isFocused, enabled, throttleAction, videoRef]);

  return { isThrottled };
}
