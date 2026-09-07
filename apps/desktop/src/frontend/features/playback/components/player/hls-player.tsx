import {
  startHlsPlaybackSession,
  HlsConfigOverrides,
  LIVE_FRAGMENT_OFFLINE_GRACE_MS,
  applyPreferredQuality,
  isKickLiveCdnUrl,
} from "../../adapters/browser/hls-playback-session";
import Hls from "hls.js";
import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useInterval } from "@/hooks/useInterval";
import { logger } from "@/renderer/logging/logger";
import { DEFAULT_BUFFER_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/features/auth/components/state/auth-store";

import { resolveHlsBufferConfig } from "../../adapters/browser/hls-buffer-config";
import { useLivePlaybackStallRecovery } from "./hooks/use-live-playback-stall-recovery";
import { type PlayerQualityPreference } from "../../domain/quality-preference";
import type { PlayerError, QualityLevel } from "../../capabilities/media-types";

export interface HlsPlayerProps extends Omit<
  React.VideoHTMLAttributes<HTMLVideoElement>,
  "onError"
> {
  src: string;
  onQualityLevels?: (levels: QualityLevel[]) => void;
  onActiveQualityChange?: (qualityId: string) => void;
  onError?: (error: PlayerError) => void;
  onHlsInstance?: (hls: Hls) => void;
  autoPlay?: boolean;
  currentLevel?: string; // 'auto' or level index as string
  preferredQuality?: PlayerQualityPreference | string;
  volume?: number;
  sources?: { quality: string; url: string }[];
  hlsConfig?: HlsConfigOverrides;
  /**
   * Whether this is a LIVE stream. The user's buffer/latency prefs are applied
   * only when live — the live-tuning keys are inert on VOD, and VOD buffer
   * controls are out of scope (U10). Defaults to false (VOD) since this shared
   * player serves Kick/Twitch VOD; the Kick live player passes `isLive`.
   */
  isLive?: boolean;
}

// Keep this above HLS.js's live fragLoadingTimeOut (15s). A 3s grace made
// ordinary Kick CDN jitter look like an ended stream, forcing refresh loops.

export const HlsPlayer = forwardRef<HTMLVideoElement, HlsPlayerProps>(
  (
    {
      src,
      onQualityLevels,
      onActiveQualityChange,
      onError,
      onHlsInstance,
      autoPlay = false,
      currentLevel,
      preferredQuality,
      sources,
      hlsConfig,
      volume,
      isLive = false,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const translateRef = useRef(t);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const isMountedRef = useRef(true);
    const sourcesRef = useRef(sources);
    const hlsConfigRef = useRef(hlsConfig);

    // Mutable heartbeat state lifted into refs so useInterval callbacks can read them
    const isEffectActiveRef = useRef(false);
    const lastFragLoadedTimeRef = useRef(Date.now());
    const manifestParsedTimeRef = useRef<number | null>(null);
    const hasReceivedFirstFragmentRef = useRef(false);
    const fragErrorCountRef = useRef(0);
    const videoRefForInterval = useRef<HTMLVideoElement | null>(null);

    // Delay state: null = paused, number = running. Set when HLS initialises, cleared on teardown.
    const [heartbeatDelay, setHeartbeatDelay] = useState<number | null>(null);
    const [memoryCleanupDelay, setMemoryCleanupDelay] = useState<number | null>(null);

    useEffect(() => {
      translateRef.current = t;
    }, [t]);

    useEffect(() => {
      sourcesRef.current = sources;
    }, [sources]);

    useEffect(() => {
      hlsConfigRef.current = hlsConfig;
    }, [hlsConfig]);

    // Apple volume on mount and change
    useEffect(() => {
      if (videoRef.current && volume !== undefined) {
        videoRef.current.volume = Math.max(0, Math.min(1, volume));
      }
    }, [volume]);

    const pendingPlayRef = useRef<Promise<void> | null>(null);
    const playRequestIdRef = useRef(0); // Track play request to cancel stale ones
    const lastRecoveryAttemptRef = useRef<number | null>(null); // Rate limit recovery attempts

    // Expose video ref to parent
    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

    // Mount-only HLS instance lifecycle (slice 09 of renderer-OOM PRD #51).
    // Owns the destroy(). On src change the src-change effect just calls
    // detachMedia()->loadSource(newSrc)->attachMedia() to reuse the existing
    // instance, avoiding the decoder re-init cost on channel-hop. The actual
    // construction lives in the src-change effect below — this effect only
    // tears down on true unmount.
    useEffect(() => {
      const mountedVideo = videoRef.current;
      return () => {
        const hls = hlsRef.current;
        if (hls) {
          try {
            hls.destroy();
          } catch (_e) {
            // Already destroyed by an in-handler error path; ignore.
          }
          hlsRef.current = null;
        }
        const video = mountedVideo;
        if (video) {
          // Force Chromium to release decoder/GPU buffers held by the <video>
          // element. Skipped during app shutdown — Chromium frees everything
          // when the process dies, and walking these synchronously can wedge
          // a heap-pressured renderer's close path.
          const isShuttingDown =
            (window as unknown as { __shuttingDown?: boolean }).__shuttingDown === true;
          if (!isShuttingDown) {
            try {
              video.pause();
              video.removeAttribute("src");
              video.load();
            } catch {
              // Element may already be torn down in StrictMode; ignore.
            }
          }
        }
      };
    }, []);

    // Heartbeat: check every 1s that fragments are still arriving (fast offline detection).
    // Active only while heartbeatDelay is a number (set by MANIFEST_PARSED, cleared on teardown).
    useInterval(() => {
      const hls = hlsRef.current;
      const video = videoRefForInterval.current;
      if (!isEffectActiveRef.current || !hls) {
        setHeartbeatDelay(null);
        return;
      }

      // Skip while paused — no new fragments is expected
      if (video?.paused) {
        lastFragLoadedTimeRef.current = Date.now();
        return;
      }

      const now = Date.now();
      const timeSinceLastFrag = now - lastFragLoadedTimeRef.current;
      const manifestParsedTime = manifestParsedTimeRef.current;
      const timeSinceManifest = manifestParsedTime ? now - manifestParsedTime : 0;

      // CASE 1: No fragment ever received after manifest parsed
      if (
        !hasReceivedFirstFragmentRef.current &&
        timeSinceManifest >= LIVE_FRAGMENT_OFFLINE_GRACE_MS
      ) {
        logger.debug("Player:HLS", "no fragments received after manifest - stream unavailable", {
          secondsSinceManifest: Math.round(timeSinceManifest / 1000),
        });
        setHeartbeatDelay(null);
        hls.destroy();
        hlsRef.current = null;
        onErrorRef.current?.({
          code: "NO_FRAGMENTS",
          message: translateRef.current("playback.noVideoDataReceived"),
          fatal: true,
          shouldRefresh: true,
          originalError: null,
        });
        return;
      }

      // CASE 2: Was receiving fragments but they stopped
      if (
        hasReceivedFirstFragmentRef.current &&
        timeSinceLastFrag >= LIVE_FRAGMENT_OFFLINE_GRACE_MS
      ) {
        logger.debug("Player:HLS", "no fragments - stream appears to have ended", {
          secondsSinceLastFragment: Math.round(timeSinceLastFrag / 1000),
        });
        setHeartbeatDelay(null);
        hls.destroy();
        hlsRef.current = null;
        onErrorRef.current?.({
          code: "STREAM_OFFLINE",
          message: translateRef.current("playback.streamEndedUnavailable"),
          fatal: true,
          // A fragment drought proves that this source stopped advancing, not
          // that the broadcaster ended. Kick live URLs are signed and can age
          // out during a long watch, so require a fresh resolver generation.
          shouldRefresh: isKickLiveCdnUrl(src),
          originalError: null,
        });
        return;
      }
    }, heartbeatDelay);

    // Memory cleanup every 30 minutes: reset to live edge and trigger browser GC.
    useInterval(() => {
      const hls = hlsRef.current;
      if (!isEffectActiveRef.current || !hls) {
        setMemoryCleanupDelay(null);
        return;
      }

      try {
        logger.debug("Player:HLS", "periodic cleanup: resetting to live edge and trimming buffers");

        hls.startLevel = -1;

        const originalBackBuffer = hls.config.backBufferLength;
        const backBufferLength = resolveHlsBufferConfig(
          useAuthStore.getState().preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES
        ).backBufferLength;
        hls.config.backBufferLength = backBufferLength;

        const video = videoRefForInterval.current;
        const flushEnd = video ? video.currentTime - backBufferLength : 0;
        if (flushEnd > 0) {
          hls.trigger(Hls.Events.BUFFER_FLUSHING, {
            startOffset: 0,
            endOffset: flushEnd,
            endOffsetSubtitles: flushEnd,
            type: null,
          });
        }

        // Restore after a tick to let HLS.js process the trim
        // timer-allowlist: HLS.js backBufferLength restore — no awaitable completion signal (SP2 explicitly out-of-scope)
        setTimeout(() => {
          if (hls && isEffectActiveRef.current) {
            hls.config.backBufferLength = originalBackBuffer;
          }
        }, 1000);

        const globalGc = (globalThis as unknown as { gc?: () => void }).gc;
        if (typeof globalGc === "function") {
          globalGc();
          logger.debug("Player:HLS", "forced garbage collection");
        }
      } catch (e) {
        logger.debug("Player:HLS", "cleanup error (non-fatal)", { error: e });
      }
    }, memoryCleanupDelay);

    // Handle quality change
    useEffect(() => {
      if (hlsRef.current && currentLevel !== undefined) {
        const hls = hlsRef.current;
        if (currentLevel === "auto") {
          hls.currentLevel = -1;
        } else {
          const levelIndex = parseInt(currentLevel, 10);
          // Validate level index exists to prevent levelSwitchError
          if (
            !Number.isNaN(levelIndex) &&
            levelIndex >= 0 &&
            hls.levels &&
            levelIndex < hls.levels.length
          ) {
            hls.currentLevel = levelIndex;
          }
        }
      } else if (!src.includes(".m3u8") && sourcesRef.current && currentLevel !== undefined) {
        // Native Source Switching
        const video = videoRef.current;
        if (!video) return;

        let targetUrl = src; // Default to 'auto' / main src

        if (currentLevel !== "auto") {
          const idx = parseInt(currentLevel, 10);
          if (!Number.isNaN(idx) && sourcesRef.current[idx]) {
            targetUrl = sourcesRef.current[idx].url;
          }
        }

        // Only switch if URL is different
        // Check formatted URL to avoid infinite loops if browser normalizes it
        if (video.src !== targetUrl && video.currentSrc !== targetUrl) {
          logger.debug("Player:HLS", "switching source", { targetUrl });
          const currentTime = video.currentTime;
          const wasPaused = video.paused;

          // Restore time after metadata loads
          const onSwitchLoaded = () => {
            video.currentTime = currentTime;
            if (!wasPaused) {
              video
                .play()
                .catch((e) => logger.warn("Player:HLS", "play failed after switch", { error: e }));
            }
            video.removeEventListener("loadedmetadata", onSwitchLoaded);
          };

          video.addEventListener("loadedmetadata", onSwitchLoaded);
          video.src = targetUrl;
          video.load();
          return () => video.removeEventListener("loadedmetadata", onSwitchLoaded);
        }
      }
    }, [currentLevel, src]);

    // Store callbacks in refs to prevent re-initialization loop
    const onQualityLevelsRef = useRef(onQualityLevels);
    const onActiveQualityChangeRef = useRef(onActiveQualityChange);
    const onErrorRef = useRef(onError);
    const onHlsInstanceRef = useRef(onHlsInstance);
    const currentLevelRef = useRef(currentLevel);
    const preferredQualityRef = useRef(preferredQuality);
    const parsedQualityLevelsRef = useRef<QualityLevel[]>([]);
    const appliedPreferredQualityRef = useRef<string | null>(null);

    const stallRecovery = useLivePlaybackStallRecovery({
      sourceKey: src,
      enabled: isLive,
      videoRef,
      hlsRef,
      onErrorRef,
      isActiveRef: isEffectActiveRef,
    });

    useEffect(() => {
      onQualityLevelsRef.current = onQualityLevels;
      onActiveQualityChangeRef.current = onActiveQualityChange;
      onErrorRef.current = onError;
      onHlsInstanceRef.current = onHlsInstance;
      currentLevelRef.current = currentLevel;
      preferredQualityRef.current = preferredQuality;
    }, [
      onQualityLevels,
      onActiveQualityChange,
      onError,
      onHlsInstance,
      currentLevel,
      preferredQuality,
    ]);

    useEffect(() => {
      if (preferredQuality === undefined) return;
      const normalizedPreference = String(preferredQuality).toLowerCase();
      if (appliedPreferredQualityRef.current === normalizedPreference) return;

      const hls = hlsRef.current;
      const levels = parsedQualityLevelsRef.current;
      if (!hls || levels.length === 0) return;

      applyPreferredQuality(hls, levels, preferredQuality);
      appliedPreferredQualityRef.current = normalizedPreference;
    }, [preferredQuality]);

    useEffect(
      () =>
        startHlsPlaybackSession({
          videoRef,
          src,
          isEffectActiveRef,
          isMountedRef,
          lastRecoveryAttemptRef,
          parsedQualityLevelsRef,
          appliedPreferredQualityRef,
          lastFragLoadedTimeRef,
          manifestParsedTimeRef,
          hasReceivedFirstFragmentRef,
          fragErrorCountRef,
          videoRefForInterval,
          playRequestIdRef,
          pendingPlayRef,
          isLive,
          hlsRef,
          hlsConfigRef,
          onHlsInstanceRef,
          autoPlay,
          preferredQualityRef,
          currentLevelRef,
          onQualityLevelsRef,
          onActiveQualityChangeRef,
          stallRecovery,
          onErrorRef,
          translateRef,
          setHeartbeatDelay,
          setMemoryCleanupDelay,
          sourcesRef,
          bufferPreferences:
            useAuthStore.getState().preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES,
        }),
      [src, autoPlay, isLive, stallRecovery]
    ); // Removed callbacks from dependency array
    // removed currentLevel (except initial read in manifest parsed) to prevent re-init.
    // Logic for dynamic switching is in the first useEffect.

    return (
      <video
        ref={videoRef}
        playsInline
        className="size-full object-contain object-top"
        {...props}
      />
    );
  }
);

HlsPlayer.displayName = "HlsPlayer";
