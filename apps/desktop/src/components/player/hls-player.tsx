import Hls from "hls.js";
import type React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

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
      ...props
    },
    ref
  ) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const isMountedRef = useRef(true);
    const sourcesRef = useRef(sources);

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
          console.debug(`[Player] Switching source to: ${targetUrl}`);
          const currentTime = video.currentTime;
          const wasPaused = video.paused;

          // Restore time after metadata loads
          const onSwitchLoaded = () => {
            video.currentTime = currentTime;
            if (!wasPaused) {
              video.play().catch((e) => console.warn("Play failed after switch:", e));
            }
            video.removeEventListener("loadedmetadata", onSwitchLoaded);
          };

          video.addEventListener("loadedmetadata", onSwitchLoaded);
          video.src = targetUrl;
          video.load();
        }
      }
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
      isMountedRef.current = true;
      // Reset recovery attempt tracker for new stream
      lastRecoveryAttemptRef.current = null;

      let hls: Hls | null = null;
      // Track event handlers for cleanup (used by native HLS and standard playback)
      let handleLoadedMetadata: (() => void) | null = null;
      let handleError: ((e: Event) => void) | null = null;
      let handlePlayReset: (() => void) | null = null;
      // Heartbeat interval for fast offline detection (cleaned up in effect cleanup)
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
      // Memory cleanup interval for long-running streams (cleaned up in effect cleanup)
      let memoryCleanupInterval: ReturnType<typeof setInterval> | null = null;

      // Safe play helper that handles interruption gracefully
      const safePlay = () => {
        if (!isEffectActive || !video) return;

        // Increment request ID to invalidate previous play attempts
        const currentRequestId = ++playRequestIdRef.current;

        // Small delay to let the browser settle after load
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
                console.debug("[HLS] Play request interrupted (expected during source change)");
              } else if (e.name === "NotAllowedError") {
                console.warn(
                  "[HLS] Autoplay blocked by browser policy - user interaction required"
                );
              } else {
                console.error("[HLS] Playback failed with unexpected error:", e);
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

        console.debug(
          `[HLS] Connection type: ${effectiveType}, timeout multiplier: ${timeoutMultiplier}x`
        );

        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          startFragPrefetch: true, // Start fetching fragment immediately for faster start

          // === AGGRESSIVE MEMORY MANAGEMENT FOR LONG-RUNNING STREAMS ===
          // These settings prevent memory creep during 4-12+ hour sessions
          // HLS.js leaks ~5-15MB/hour from segment accumulation without these limits
          backBufferLength: 30, // Reduced from 90: Only keep 30s behind (was causing memory buildup)
          maxBufferLength: 15, // Reduced from 30: 15s forward buffer is plenty for live
          maxMaxBufferLength: 30, // Reduced from 60: Hard cap at 30s to prevent runaway buffering
          maxBufferSize: 20 * 1000 * 1000, // 20MB max buffer size (soft limit)

          // Low-latency live streaming optimizations
          liveSyncDurationCount: 2, // Stay closer to live edge (reduced from 3)
          liveMaxLatencyDurationCount: 6, // Reduced from 8: Jump to live sooner if behind

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
        });
        hlsRef.current = hls;
        if (onHlsInstance) onHlsInstance(hls);

        console.debug("Initializing HLS for:", src);
        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          console.debug("[HLS] Manifest parsed, levels:", data.levels.length);

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
            console.debug(`[HLS] Stream unavailable (${statusCode}), stopping retries`);
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
            console.debug(`[HLS] Proxy/server error (${statusCode}), triggering fallback`);
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
            console.debug(`[HLS] Proxy manifest load failed (status: ${statusCode || "unknown"})`);
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
            console.debug(
              `[HLS] Error: ${data.details}, fatal: ${data.fatal}, type: ${data.type}`,
              statusCode ? `(status: ${statusCode})` : ""
            );
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
                console.debug(
                  "[HLS] Stream ended or became unavailable (network error after retries)"
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
                  console.debug("[HLS] Fatal media error encountered, attempting recovery...");
                  lastRecoveryAttemptRef.current = now;
                  hls?.recoverMediaError();
                } else {
                  const timeSince = Math.round((now - lastAttempt) / 1000);
                  console.warn(
                    `[HLS] Fatal media error - skipping recovery (only ${timeSince}s since last attempt)`
                  );
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
                console.error("[HLS] Unrecoverable error", data);
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
                  console.debug(
                    `[HLS] Buffer gap at start. Seeking from ${currentTime.toFixed(2)}s to ${bufferStart.toFixed(2)}s`
                  );
                  video.currentTime = bufferStart + 0.1;
                }
                // Otherwise let HLS.js handle it via automatic nudging
                // Do NOT call recoverMediaError() - it can cause bufferAppendError
              }
            } else if (data.details === "levelSwitchError") {
              // Don't log - handled automatically
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !isStreamEndingError) {
              // Only log network retries for non-stream-ending errors
              console.debug(`[HLS] Network error (will retry automatically): ${data.details}`);
            }
          }
        });

        // === FAST OFFLINE DETECTION & FRAGMENT TIMEOUT ===
        // For live streams, aggressively detect when fragments stop arriving
        // This catches: token expiration, stream offline, CDN issues, CORS problems
        let lastFragLoadedTime = Date.now();
        let manifestParsedTime: number | null = null;
        let hasReceivedFirstFragment = false;
        let fragErrorCount = 0;
        const MAX_FRAG_ERRORS_BEFORE_REFRESH = 3;
        const INITIAL_FRAGMENT_TIMEOUT_MS = 30000; // 30s timeout for first fragment after manifest
        const ONGOING_FRAGMENT_TIMEOUT_MS = 45000; // 45s timeout during playback

        // Track successful fragment loads
        hls.on(Hls.Events.FRAG_LOADED, () => {
          lastFragLoadedTime = Date.now();
          hasReceivedFirstFragment = true;
          fragErrorCount = 0; // Reset error count on success
        });

        // Reset fragment timer on play so we don't false-positive immediately after resuming from pause
        handlePlayReset = () => {
          lastFragLoadedTime = Date.now();
        };
        video.addEventListener("play", handlePlayReset);

        // Track fragment load errors (may indicate token expiration)
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.details === "fragLoadError" && !data.fatal) {
            fragErrorCount++;
            console.debug(`[HLS] Fragment load error #${fragErrorCount}`);

            // After multiple fragment errors, likely token expired
            if (fragErrorCount >= MAX_FRAG_ERRORS_BEFORE_REFRESH) {
              console.debug("[HLS] Multiple fragment errors - token may have expired");
              if (heartbeatInterval) clearInterval(heartbeatInterval);
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

        // Start heartbeat after manifest is parsed (stream should be playing)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          manifestParsedTime = Date.now();

          // Clear any existing heartbeat
          if (heartbeatInterval) clearInterval(heartbeatInterval);

          // Check every 5 seconds if fragments are arriving (faster detection)
          heartbeatInterval = setInterval(() => {
            if (!isEffectActive || !hls) {
              if (heartbeatInterval) clearInterval(heartbeatInterval);
              return;
            }

            // Skip fragment timeout checks while paused — no new fragments is expected
            if (video && video.paused) {
              lastFragLoadedTime = Date.now(); // Reset timer so we don't false-positive on resume
              return;
            }

            const now = Date.now();
            const timeSinceLastFrag = now - lastFragLoadedTime;
            const timeSinceManifest = manifestParsedTime ? now - manifestParsedTime : 0;

            // CASE 1: No fragment ever received after manifest parsed
            // This is the key fix for the reported issue - fail fast!
            if (!hasReceivedFirstFragment && timeSinceManifest > INITIAL_FRAGMENT_TIMEOUT_MS) {
              console.debug(
                `[HLS] No fragments received in ${Math.round(timeSinceManifest / 1000)}s after manifest - stream unavailable`
              );
              if (heartbeatInterval) clearInterval(heartbeatInterval);
              hls?.destroy();
              onErrorRef.current?.({
                code: "NO_FRAGMENTS",
                message: "No video data received - stream may be offline or token expired",
                fatal: true,
                shouldRefresh: true,
                originalError: null,
              });
              return;
            }

            // CASE 2: Was receiving fragments but they stopped (stream went offline mid-playback)
            if (hasReceivedFirstFragment && timeSinceLastFrag > ONGOING_FRAGMENT_TIMEOUT_MS) {
              console.debug(
                `[HLS] No fragments in ${Math.round(timeSinceLastFrag / 1000)}s - stream appears to have ended`
              );
              if (heartbeatInterval) clearInterval(heartbeatInterval);
              hls?.destroy();
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
              console.debug(
                `[HLS] Heartbeat: No fragments in ${Math.round(timeSinceLastFrag / 1000)}s, attempting reload...`
              );
              try {
                hls.startLoad(-1); // -1 means start from live edge
              } catch (_e) {
                // HLS may be in an invalid state, ignore
              }
            }
          }, 5000); // Check every 5 seconds for faster detection
        });

        // === PERIODIC MEMORY CLEANUP FOR LONG-RUNNING STREAMS ===
        // Every 30 minutes: reset to live edge and trigger browser GC. This
        // is the safety valve that prevented OOM crashes at 2-6 hours before
        // the targeted backBufferLength toggle existed; cadence is loosened
        // from 10 → 30 min because the chat-store trim and badge cache both
        // reduce upstream allocation pressure. --expose-gc itself stays on
        // (see main.ts) so the safety net is intact.
        const memoryCleanupInterval = setInterval(
          () => {
            if (!isEffectActive || !hls) {
              clearInterval(memoryCleanupInterval);
              return;
            }

            try {
              console.debug("[HLS] Periodic cleanup: resetting to live edge and trimming buffers");

              // Reset to live edge (clears accumulated segments in HLS.js internal state)
              hls.startLevel = -1;

              // Force back buffer trim by setting it lower temporarily
              // This clears detached MediaSource buffers that accumulate over time
              const originalBackBuffer = hls.config.backBufferLength;
              hls.config.backBufferLength = 10;

              // Restore after a tick to let HLS.js process the trim
              setTimeout(() => {
                if (hls && isEffectActive) {
                  hls.config.backBufferLength = originalBackBuffer;
                }
              }, 1000);

              // Trigger garbage collection if available (requires --expose-gc flag)
              const globalGc = (globalThis as unknown as { gc?: () => void }).gc;
              if (typeof globalGc === "function") {
                globalGc();
                console.debug("[HLS] Forced garbage collection");
              }
            } catch (e) {
              console.debug("[HLS] Cleanup error (non-fatal):", e);
            }
          },
          30 * 60 * 1000
        ); // Every 30 minutes
      } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS (Safari)
        console.debug("Using native HLS");
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
        isMountedRef.current = false;
        pendingPlayRef.current = null;

        // Clean up heartbeat interval first (before HLS destroy)
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        // Clean up memory cleanup interval
        if (memoryCleanupInterval) {
          clearInterval(memoryCleanupInterval);
          memoryCleanupInterval = null;
        }

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
    }, [src, autoPlay, currentLevel, onHlsInstance]); // Removed callbacks from dependency array
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
