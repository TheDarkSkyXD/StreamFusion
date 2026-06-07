import Hls from "hls.js";
import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { useInterval } from "@/hooks/useInterval";
import { logger } from "@/renderer/logging/logger";
import { DEFAULT_BUFFER_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { resolveHlsBufferConfig } from "./hls-buffer-config";
import { createKickClipPlaylistLoader, isKickClipPlaylistUrl } from "./kick/kick-clip-loader";
import type { PlayerError, QualityLevel } from "./types";

export interface HlsPlayerProps
  extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "onError"> {
  src: string;
  onQualityLevels?: (levels: QualityLevel[]) => void;
  onError?: (error: PlayerError) => void;
  onHlsInstance?: (hls: Hls) => void;
  autoPlay?: boolean;
  currentLevel?: string; // 'auto' or level index as string
  volume?: number;
  sources?: { quality: string; url: string }[];
  /**
   * Whether this is a LIVE stream. The user's buffer/latency prefs are applied
   * only when live — the live-tuning keys are inert on VOD, and VOD buffer
   * controls are out of scope (U10). Defaults to false (VOD) since this shared
   * player serves Kick/Twitch VOD; the Kick live player passes `isLive`.
   */
  isLive?: boolean;
}

export const HlsPlayer = forwardRef<HTMLVideoElement, HlsPlayerProps>(
  (
    {
      src,
      onQualityLevels,
      onError,
      onHlsInstance,
      autoPlay = false,
      currentLevel,
      sources,
      volume,
      isLive = false,
      ...props
    },
    ref
  ) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const isMountedRef = useRef(true);
    const sourcesRef = useRef(sources);

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
    const [stallWatchdogDelay, setStallWatchdogDelay] = useState<number | null>(null);

    // Stall watchdog state. See the useInterval block below for the escalation
    // ladder; the fragment heartbeat watches INPUT, this one watches OUTPUT.
    const lastTimeRef = useRef(0);
    const lastTimeAdvancedAtRef = useRef(Date.now());
    const stallRecoveryCountRef = useRef(0);

    useEffect(() => {
      sourcesRef.current = sources;
    }, [sources]);

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

    // Heartbeat: check every 5s that fragments are still arriving (fast offline detection).
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
      if (!hasReceivedFirstFragmentRef.current && timeSinceManifest > 30000) {
        logger.debug("Player:HLS", "no fragments received after manifest - stream unavailable", {
          secondsSinceManifest: Math.round(timeSinceManifest / 1000),
        });
        setHeartbeatDelay(null);
        hls.destroy();
        onErrorRef.current?.({
          code: "NO_FRAGMENTS",
          message: "No video data received - stream may be offline or token expired",
          fatal: true,
          shouldRefresh: true,
          originalError: null,
        });
        return;
      }

      // CASE 2: Was receiving fragments but they stopped
      if (hasReceivedFirstFragmentRef.current && timeSinceLastFrag > 45000) {
        logger.debug("Player:HLS", "no fragments - stream appears to have ended", {
          secondsSinceLastFragment: Math.round(timeSinceLastFrag / 1000),
        });
        setHeartbeatDelay(null);
        hls.destroy();
        onErrorRef.current?.({
          code: "STREAM_OFFLINE",
          message: "Stream ended or became unavailable",
          fatal: true,
          originalError: null,
        });
        return;
      }

      // CASE 3: Mild delay - try to recover by reloading
      if (timeSinceLastFrag > 15000) {
        logger.debug("Player:HLS", "heartbeat: no fragments, attempting reload", {
          secondsSinceLastFragment: Math.round(timeSinceLastFrag / 1000),
        });
        try {
          hls.startLoad(-1);
        } catch (_e) {
          // HLS may be in an invalid state, ignore
        }
      }
    }, heartbeatDelay);

    // Stall watchdog: catches decoder hangs where currentTime stops advancing
    // while fragments still flow (the heartbeat above can't tell). Escalates
    // nudge → startLoad → recoverMediaError → fatal shouldRefresh.
    useInterval(() => {
      const hls = hlsRef.current;
      const video = videoRefForInterval.current;
      if (!isEffectActiveRef.current || !video) {
        setStallWatchdogDelay(null);
        return;
      }

      const now = Date.now();

      // Not a stall: paused / ended / not enough data buffered yet.
      // HAVE_FUTURE_DATA = 3 (enough to play at least one frame past current position).
      if (video.paused || video.ended || video.readyState < 3) {
        lastTimeRef.current = video.currentTime;
        lastTimeAdvancedAtRef.current = now;
        return;
      }

      if (video.currentTime !== lastTimeRef.current) {
        lastTimeRef.current = video.currentTime;
        lastTimeAdvancedAtRef.current = now;
        stallRecoveryCountRef.current = 0;
        return;
      }

      const stuckMs = now - lastTimeAdvancedAtRef.current;
      if (stuckMs < 8000) return;

      const attempt = ++stallRecoveryCountRef.current;
      const fragLoadedAgo = Math.round((now - lastFragLoadedTimeRef.current) / 1000);
      logger.debug("Player:HLS", "stall-w7d3: currentTime stuck, attempting recovery", {
        currentTime: Number(video.currentTime.toFixed(2)),
        stuckSeconds: Math.round(stuckMs / 1000),
        readyState: video.readyState,
        buffered: video.buffered.length,
        fragLoadedAgoSeconds: fragLoadedAgo,
        attempt,
      });

      try {
        if (attempt === 1) {
          video.currentTime = video.currentTime + 0.1;
          // Mirror the nudge into lastTimeRef so the next tick doesn't read
          // our own write as a real advance and reset escalation. A genuine
          // decoder recovery moves past the nudged value and resets normally.
          lastTimeRef.current = video.currentTime;
        } else if (attempt === 2 && hls) {
          hls.startLoad(-1);
        } else if (attempt === 3 && hls) {
          hls.recoverMediaError();
        } else {
          logger.debug(
            "Player:HLS",
            "stall-w7d3: recovery exhausted, escalating to fatal with shouldRefresh"
          );
          setStallWatchdogDelay(null);
          hls?.destroy();
          onErrorRef.current?.({
            code: "DECODER_STALL",
            message: "Video decoder stalled — reloading stream",
            fatal: true,
            shouldRefresh: true,
            originalError: null,
          });
          return;
        }
        // Give the recovery 4s of grace before the next escalation rung.
        lastTimeAdvancedAtRef.current = now - 8000 + 4000;
      } catch (e) {
        logger.debug("Player:HLS", "stall-w7d3: recovery threw", { error: e });
      }
    }, stallWatchdogDelay);

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
        hls.config.backBufferLength = 10;

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
      let listenerVideo: HTMLVideoElement | null = null;
      let registeredListener: (() => void) | null = null;

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

          listenerVideo = video;
          registeredListener = onSwitchLoaded;
          video.addEventListener("loadedmetadata", onSwitchLoaded);
          video.src = targetUrl;
          video.load();
        }
      }

      return () => {
        if (listenerVideo && registeredListener) {
          listenerVideo.removeEventListener("loadedmetadata", registeredListener);
        }
      };
    }, [currentLevel, src]);

    // Store callbacks in refs to prevent re-initialization loop
    const onQualityLevelsRef = useRef(onQualityLevels);
    const onErrorRef = useRef(onError);

    useEffect(() => {
      onQualityLevelsRef.current = onQualityLevels;
      onErrorRef.current = onError;
    }, [onQualityLevels, onError]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !src) return;

      // Scoped active flag to handle rapid stream switching robustly
      let isEffectActive = true;
      isEffectActiveRef.current = true;
      isMountedRef.current = true;
      // Reset recovery attempt tracker for new stream
      lastRecoveryAttemptRef.current = null;

      // Reset heartbeat mutable state for this stream
      lastFragLoadedTimeRef.current = Date.now();
      manifestParsedTimeRef.current = null;
      hasReceivedFirstFragmentRef.current = false;
      fragErrorCountRef.current = 0;
      videoRefForInterval.current = video;

      // Reset stall watchdog state for this stream
      lastTimeRef.current = 0;
      lastTimeAdvancedAtRef.current = Date.now();
      stallRecoveryCountRef.current = 0;

      let hls: Hls | null = null;
      // Track event handlers for cleanup (used by native HLS and standard playback)
      let handleLoadedMetadata: (() => void) | null = null;
      let handleError: ((e: Event) => void) | null = null;
      let handlePlayReset: (() => void) | null = null;

      // Safe play helper that handles interruption gracefully
      const safePlay = () => {
        if (!isEffectActive || !video) return;

        // Increment request ID to invalidate previous play attempts
        const currentRequestId = ++playRequestIdRef.current;

        // Small delay to let the browser settle after load
        // timer-allowlist: HLS.js safePlay browser-settle delay (SP2 explicitly out-of-scope)
        setTimeout(() => {
          // Check if this request is still valid
          if (!isEffectActive || currentRequestId !== playRequestIdRef.current) {
            return;
          }

          // Don't play if video is already playing
          if (!video.paused) return;

          pendingPlayRef.current = video.play();
          pendingPlayRef.current
            .then(() => {
              if (isEffectActive && currentRequestId === playRequestIdRef.current) {
                pendingPlayRef.current = null;
              }
            })
            .catch((e: Error) => {
              if (isEffectActive && currentRequestId === playRequestIdRef.current) {
                pendingPlayRef.current = null;
              }

              // If effect is inactive (stream switched) or request is stale, fully ignore errors
              if (!isEffectActive || currentRequestId !== playRequestIdRef.current) return;

              // AbortError: play() was interrupted by a new load request
              // NotAllowedError: autoplay was prevented by browser policy
              if (e.name === "AbortError") {
                // Silently ignore - this is expected during rapid source changes
                logger.debug(
                  "Player:HLS",
                  "play request interrupted (expected during source change)"
                );
              } else if (e.name === "NotAllowedError") {
                logger.warn(
                  "Player:HLS",
                  "autoplay blocked by browser policy - user interaction required"
                );
              } else {
                logger.error("Player:HLS", "playback failed with unexpected error", { error: e });
              }
            });
        }, 50); // 50ms delay helps avoid race conditions
      };

      const isHls = src.includes(".m3u8") || src.includes("usher.ttvnw.net");

      if (isHls && Hls.isSupported()) {
        // Detect if this is a proxy URL (for faster failure on proxy errors)
        const isProxyUrl = src.includes("cdn-perfprod.com") || src.includes("luminous.dev");

        // === ADAPTIVE TIMEOUTS BASED ON CONNECTION QUALITY ===
        // Use Network Information API to adjust timeouts for slower connections
        // This prevents premature failures on 3G/slow connections while keeping fast detection on WiFi/4G
        const connection =
          (navigator as any).connection ||
          (navigator as any).mozConnection ||
          (navigator as any).webkitConnection;
        const effectiveType = connection?.effectiveType || "4g"; // Default to 4g if not available

        // Timeout multipliers based on connection quality
        let timeoutMultiplier = 1.0;
        if (effectiveType === "slow-2g" || effectiveType === "2g") {
          timeoutMultiplier = 2.0; // Double timeouts for 2G
        } else if (effectiveType === "3g") {
          timeoutMultiplier = 1.5; // 50% longer for 3G
        }
        // 4g and faster keep base timeouts (1.0x)

        logger.debug("Player:HLS", "connection type detected", {
          effectiveType,
          timeoutMultiplier,
        });

        // User buffer/latency prefs apply only on LIVE streams (these keys are
        // inert on VOD, and VOD buffer controls are out of scope, U10). Read at
        // construction so the value applies on the next stream load (R18); the
        // periodic cleanup below only mutates backBufferLength, not these.
        const bufferConfig = resolveHlsBufferConfig(
          isLive
            ? (useAuthStore.getState().preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES)
            : DEFAULT_BUFFER_PREFERENCES
        );

        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: bufferConfig.lowLatencyMode,
          startFragPrefetch: true, // Start fetching fragment immediately for faster start

          // === AGGRESSIVE MEMORY MANAGEMENT FOR LONG-RUNNING STREAMS ===
          // These settings prevent memory creep during 4-12+ hour sessions
          // HLS.js leaks ~5-15MB/hour from segment accumulation without these limits
          backBufferLength: 30, // Reduced from 90: Only keep 30s behind (was causing memory buildup)
          maxBufferLength: bufferConfig.maxBufferLength, // Forward buffer (user-tunable on live)
          maxMaxBufferLength: bufferConfig.maxMaxBufferLength, // Hard cap (user-tunable on live)
          maxBufferSize: bufferConfig.maxBufferSize, // Scaled with maxMaxBufferLength so it isn't clamped

          // Low-latency live streaming optimizations
          liveSyncDurationCount: bufferConfig.liveSyncDurationCount, // Target live latency (user-tunable on live)
          liveMaxLatencyDurationCount: bufferConfig.liveMaxLatencyDurationCount, // Derived > liveSync so config stays valid

          // Buffer stall recovery settings (HLS.js handles these automatically)
          maxBufferHole: 0.5, // Increased tolerance for buffer gaps (default 0.1)
          highBufferWatchdogPeriod: 3, // Seconds before nudging starts (default 3)
          nudgeOffset: 0.2, // Nudge amount per retry (default 0.1)
          nudgeMaxRetry: 5, // Max nudge attempts before fatal (default 3)
          // Buffer append error retry settings
          appendErrorMaxRetry: 5, // Retry buffer append up to 5 times (default 3)

          // === ADAPTIVE FAST OFFLINE DETECTION SETTINGS ===
          // Manifest loading - detect offline quickly (stream ended/unavailable)
          // Adaptive: longer timeouts on slow connections to prevent false positives
          manifestLoadingTimeOut: isProxyUrl
            ? Math.round(5000 * timeoutMultiplier)
            : Math.round(8000 * timeoutMultiplier),
          manifestLoadingMaxRetry: isProxyUrl ? 0 : 1, // Minimal retries - if manifest 404s, stream is gone
          manifestLoadingRetryDelay: 500, // Very short delay between retries (default 1000)
          manifestLoadingMaxRetryTimeout: isProxyUrl
            ? Math.round(5000 * timeoutMultiplier)
            : Math.round(10000 * timeoutMultiplier),

          // Level/playlist loading - also needs fast detection for offline
          levelLoadingTimeOut: isProxyUrl
            ? Math.round(5000 * timeoutMultiplier)
            : Math.round(8000 * timeoutMultiplier),
          levelLoadingMaxRetry: isProxyUrl ? 0 : 1, // Minimal retries
          levelLoadingRetryDelay: 500, // Short delay
          levelLoadingMaxRetryTimeout: isProxyUrl
            ? Math.round(5000 * timeoutMultiplier)
            : Math.round(10000 * timeoutMultiplier),

          // Fragment loading - more tolerant since transient errors are common during live playback
          // Adaptive: significantly longer on slow connections (fragments take longer to download)
          fragLoadingTimeOut: Math.round(15000 * timeoutMultiplier), // 15s base, up to 30s on 2G
          fragLoadingMaxRetry: 4, // Reduced from 6, still handles transient errors
          fragLoadingRetryDelay: 500, // Faster retry (was 1000)
          fragLoadingMaxRetryTimeout: Math.round(20000 * timeoutMultiplier), // Cap total retry time

          xhrSetup: (xhr, _url) => {
            xhr.withCredentials = false; // Important to avoid CORS issues with wildcards
          },

          // Kick clips are cut mid-GOP, so seg 0 has no keyframe and hls.js
          // opens an audio-only MediaSource that can't accept the video that
          // shows up in seg 1. See kick-clip-loader.ts.
          ...(isKickClipPlaylistUrl(src) ? { pLoader: createKickClipPlaylistLoader() } : {}),
        });
        hlsRef.current = hls;
        if (onHlsInstance) onHlsInstance(hls);

        logger.debug("Player:HLS", "initializing HLS", { src });
        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          logger.debug("Player:HLS", "manifest parsed", { levels: data.levels.length });

          if (autoPlay && isMountedRef.current) {
            safePlay();
          }

          // Restore current level if set (with validation)
          if (currentLevel !== undefined) {
            if (currentLevel === "auto") {
              hls!.currentLevel = -1;
            } else {
              const levelIndex = parseInt(currentLevel, 10);
              if (!Number.isNaN(levelIndex) && levelIndex >= 0 && levelIndex < data.levels.length) {
                hls!.currentLevel = levelIndex;
              }
            }
          }

          if (onQualityLevelsRef.current && data.levels) {
            const levels: QualityLevel[] = data.levels.map((level, index) => {
              const heightLabel = level.height ? `${level.height}p` : "";
              const fpsLabel =
                level.frameRate && level.frameRate > 30 ? Math.round(level.frameRate) : "";
              let label = heightLabel ? `${heightLabel}${fpsLabel}` : `Level ${index}`;
              // If single level and no height, assume it's Source
              if (data.levels.length === 1 && !level.height) label = "Source";

              return {
                id: index.toString(),
                label,
                width: level.width || 0,
                height: level.height || 0,
                bitrate: level.bitrate || 0,
                frameRate: level.frameRate || 0,
                isAuto: false,
                name: level.name,
              };
            });
            // Add Auto level
            onQualityLevelsRef.current([
              { id: "auto", label: "Auto", width: 0, height: 0, bitrate: 0, isAuto: true },
              ...levels,
            ]);
          }
        });

        // Handle HLS errors - distinguish between expected stream-ending scenarios and actual errors
        hls.on(Hls.Events.ERROR, (_event, data) => {
          // Non-fatal errors that HLS.js recovers from automatically - don't spam the console
          // - bufferStalledError: temporary buffer underrun, recovered via nudging
          // - levelSwitchError: quality switch failed, HLS.js retries
          // - fragLoadError: transient network errors, HLS.js retries
          // - fragParsingError: corrupted segment, HLS.js skips to next
          const silentErrors = [
            "bufferStalledError",
            "levelSwitchError",
            "fragLoadError",
            "fragParsingError",
          ];

          // Check for 404/403/500 on manifest load - indicates stream is definitely gone or proxy error
          // Stop retrying immediately to prevent console noise
          const statusCode =
            (data.response as any)?.code ||
            (data.response as any)?.status ||
            (data.networkDetails as any)?.status;

          // Handle critical manifest errors early - no point retrying these
          // With preflight URL validation in the resolver, 404 means the stream just went offline
          // Refreshing won't help - the resolver will now immediately detect offline state
          if (data.details === "manifestLoadError" && (statusCode === 404 || statusCode === 403)) {
            logger.debug("Player:HLS", "stream unavailable, stopping retries", { statusCode });
            hls?.destroy();
            onErrorRef.current?.({
              code: "STREAM_OFFLINE",
              message: "Stream offline or unavailable",
              fatal: true,
              shouldRefresh: false, // Don't refresh - preflight validation means offline is confirmed
              originalError: data,
            });
            return;
          }

          // Handle 500 errors specially - likely proxy server error
          if (data.details === "manifestLoadError" && statusCode === 500) {
            logger.debug("Player:HLS", "proxy/server error, triggering fallback", { statusCode });
            hls?.destroy();
            onErrorRef.current?.({
              code: "PROXY_ERROR",
              message: "Proxy server error (500)",
              fatal: true,
              originalError: data,
            });
            return;
          }

          // For proxy URLs, treat any fatal manifest error as proxy failure
          if (isProxyUrl && data.details === "manifestLoadError" && data.fatal) {
            logger.debug("Player:HLS", "proxy manifest load failed", {
              statusCode: statusCode || "unknown",
            });
            hls?.destroy();
            onErrorRef.current?.({
              code: "PROXY_ERROR",
              message: `Proxy error: ${statusCode || "manifest load failed"}`,
              fatal: true,
              originalError: data,
            });
            return;
          }

          // Only log errors that are fatal or unexpected (not in silent list)
          const shouldLog = data.fatal || !silentErrors.includes(data.details);
          if (shouldLog) {
            logger.debug("Player:HLS", "error", {
              details: data.details,
              fatal: data.fatal,
              type: data.type,
              statusCode: statusCode ?? null,
            });
          }

          const isStreamEndingError =
            data.details === "manifestLoadError" ||
            data.details === "levelLoadError" ||
            data.details === "fragLoadError";

          if (data.fatal) {
            // Fatal error means all internal retries have been exhausted
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // Stream likely ended - this is expected behavior, not an error
                // Log as debug instead of error to reduce console noise
                logger.debug(
                  "Player:HLS",
                  "stream ended or became unavailable (network error after retries)"
                );
                onErrorRef.current?.({
                  code: "STREAM_OFFLINE",
                  message: "Stream offline or unavailable",
                  fatal: true,
                  originalError: data,
                });
                hls?.destroy();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR: {
                // Rate limit recovery attempts to prevent infinite recovery loops
                // Per HLS.js docs: only attempt recovery if 5+ seconds since last attempt
                const now = Date.now();
                const lastAttempt = lastRecoveryAttemptRef.current;

                if (!lastAttempt || now - lastAttempt > 5000) {
                  logger.debug("Player:HLS", "fatal media error encountered, attempting recovery");
                  lastRecoveryAttemptRef.current = now;
                  hls?.recoverMediaError();
                } else {
                  const timeSince = Math.round((now - lastAttempt) / 1000);
                  logger.warn("Player:HLS", "fatal media error - skipping recovery", {
                    secondsSinceLastAttempt: timeSince,
                  });
                  // If we can't recover, report the error
                  onErrorRef.current?.({
                    code: "MEDIA_ERROR",
                    message: `Fatal media error: ${data.details}`,
                    fatal: true,
                    originalError: data,
                  });
                  hls?.destroy();
                }
                break;
              }
              default:
                logger.error("Player:HLS", "unrecoverable error", { data });
                onErrorRef.current?.({
                  code: "HLS_FATAL",
                  message: `Fatal HLS Error: ${data.details}`,
                  fatal: true,
                  originalError: data,
                });
                hls?.destroy();
                break;
            }
          } else {
            // Non-fatal error - HLS.js handles these internally
            // IMPORTANT: Do NOT call recoverMediaError() for non-fatal errors!
            // HLS.js automatically handles buffer stalls via nudging (configured above)
            if (data.details === "bufferStalledError") {
              const video = videoRef.current;
              if (video && !video.paused && video.buffered.length > 0) {
                const currentTime = video.currentTime;
                const bufferStart = video.buffered.start(0);

                // If we're at position 0 (or very close) and buffer starts later,
                // seek to where the buffer actually begins (startup edge case)
                if (currentTime < 1 && bufferStart > currentTime + 0.5) {
                  logger.debug("Player:HLS", "buffer gap at start, seeking forward", {
                    fromSeconds: Number(currentTime.toFixed(2)),
                    toSeconds: Number(bufferStart.toFixed(2)),
                  });
                  video.currentTime = bufferStart + 0.1;
                }
                // Otherwise let HLS.js handle it via automatic nudging
                // Do NOT call recoverMediaError() - it can cause bufferAppendError
              }
            } else if (data.details === "levelSwitchError") {
              // Don't log - handled automatically
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !isStreamEndingError) {
              // Only log network retries for non-stream-ending errors
              logger.debug("Player:HLS", "network error (will retry automatically)", {
                details: data.details,
              });
            }
          }
        });

        // === FAST OFFLINE DETECTION & FRAGMENT TIMEOUT ===
        // For live streams, aggressively detect when fragments stop arriving
        // This catches: token expiration, stream offline, CDN issues, CORS problems
        const MAX_FRAG_ERRORS_BEFORE_REFRESH = 3;

        // Track successful fragment loads
        hls.on(Hls.Events.FRAG_LOADED, () => {
          lastFragLoadedTimeRef.current = Date.now();
          hasReceivedFirstFragmentRef.current = true;
          fragErrorCountRef.current = 0; // Reset error count on success
        });

        // Reset fragment timer on play so we don't false-positive immediately after resuming from pause
        handlePlayReset = () => {
          lastFragLoadedTimeRef.current = Date.now();
        };
        video.addEventListener("play", handlePlayReset);

        // Track fragment load errors (may indicate token expiration)
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.details === "fragLoadError" && !data.fatal) {
            fragErrorCountRef.current++;
            logger.debug("Player:HLS", "fragment load error", {
              errorCount: fragErrorCountRef.current,
            });

            // After multiple fragment errors, likely token expired
            if (fragErrorCountRef.current >= MAX_FRAG_ERRORS_BEFORE_REFRESH) {
              logger.debug("Player:HLS", "multiple fragment errors - token may have expired");
              setHeartbeatDelay(null);
              hls?.destroy();
              onErrorRef.current?.({
                code: "TOKEN_EXPIRED",
                message: "Playback token may have expired - reload required",
                fatal: true,
                shouldRefresh: true,
                originalError: data,
              });
            }
          }
        });

        // Start heartbeat after manifest is parsed (stream should be playing).
        // The actual interval logic lives in the useInterval hook above; here we
        // record manifestParsedTime and activate the interval via state.
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          manifestParsedTimeRef.current = Date.now();
          // Activate heartbeat (5 000 ms) and memory cleanup (30 min) via useInterval
          setHeartbeatDelay(5000);
          setMemoryCleanupDelay(30 * 60 * 1000);
          setStallWatchdogDelay(2000);
        });
      } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS (Safari)
        logger.debug("Player:HLS", "using native HLS");
        video.src = src;
        handleLoadedMetadata = () => {
          if (autoPlay && isMountedRef.current) safePlay();
        };
        handleError = (e: Event) => {
          onErrorRef.current?.({
            code: "NATIVE_ERROR",
            message: "Native playback error",
            fatal: true,
            originalError: e,
          });
        };
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("error", handleError);
      } else {
        // Standard Native Playback (e.g. MP4)
        handleLoadedMetadata = () => {
          if (autoPlay && isMountedRef.current) safePlay();

          // Emit quality levels for native playback
          if (onQualityLevelsRef.current) {
            if (sourcesRef.current && sourcesRef.current.length > 0) {
              // If provided explicit sources (e.g. clips with multiple qualities)
              const levels = sourcesRef.current.map((s, i) => ({
                id: i.toString(),
                label: s.quality,
                width: 0,
                height: 0,
                bitrate: 0,
                isAuto: false,
              }));

              onQualityLevelsRef.current([
                { id: "auto", label: "Auto (Best)", width: 0, height: 0, bitrate: 0, isAuto: true },
                ...levels,
              ]);
            } else if (video.videoHeight) {
              // Fallback: Single source
              onQualityLevelsRef.current([
                { id: "auto", label: "Auto", width: 0, height: 0, bitrate: 0, isAuto: true },
                {
                  id: "source",
                  label: `${video.videoHeight}p (Source)`,
                  width: video.videoWidth,
                  height: video.videoHeight,
                  bitrate: 0,
                  isAuto: false,
                },
              ]);
            }
          }
        };
        handleError = (e: Event) => {
          // Only report error if we really fail
          onErrorRef.current?.({
            code: "PLAYBACK_ERROR",
            message: "Playback failed",
            fatal: true,
            originalError: e,
          });
        };
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("error", handleError);
        video.src = src;
      }

      // Store reference for cleanup
      const currentVideo = video;

      return () => {
        // Mark as inactive to filter out stale errors
        isEffectActive = false;
        isEffectActiveRef.current = false;
        isMountedRef.current = false;
        pendingPlayRef.current = null;

        // Pause the useInterval hooks (they read isEffectActiveRef, but null delay is cleaner)
        setHeartbeatDelay(null);
        setMemoryCleanupDelay(null);
        setStallWatchdogDelay(null);

        if (hls) {
          hls.destroy();
        }
        hlsRef.current = null;

        // Remove event listeners from video element to prevent memory leaks
        if (currentVideo) {
          if (handleLoadedMetadata) {
            currentVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
          }
          if (handleError) {
            currentVideo.removeEventListener("error", handleError);
          }
          if (handlePlayReset) {
            currentVideo.removeEventListener("play", handlePlayReset);
          }

          // Force Chromium to release the underlying media decoder + GPU
          // buffers. hls.destroy() drops the JS HLS state but the <video>
          // element holds onto decoded frames until src is cleared and
          // load() resets the resource. Frees 5-20 MB per stream nav.
          //
          // Skipped during app shutdown: Chromium frees everything when the
          // process dies, and walking these synchronously can wedge the
          // close path on a heap-pressured renderer.
          const isShuttingDown =
            (window as unknown as { __shuttingDown?: boolean }).__shuttingDown === true;
          if (!isShuttingDown) {
            try {
              currentVideo.pause();
              currentVideo.removeAttribute("src");
              currentVideo.load();
            } catch {
              // Element may already be torn down in StrictMode — ignore.
            }
          }
        }
      };
    }, [src, autoPlay, currentLevel, onHlsInstance, isLive]); // Removed callbacks from dependency array
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
