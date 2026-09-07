import Hls from "hls.js";

import { logger } from "@/renderer/logging/logger";

import { resolveHlsBufferConfig, resolveHlsVodBufferConfig } from "./hls-buffer-config";

import {
  resolvePreferredQualityId,
  type PlayerQualityPreference,
} from "../../domain/quality-preference";

import type { PlayerError, QualityLevel } from "../../capabilities/media-types";

import type { BufferPreferences } from "@shared/auth-types";

interface MutableCell<Value> {
  current: Value;
}

export type HlsConfigOverrides = Partial<NonNullable<ConstructorParameters<typeof Hls>[0]>>;

interface NetworkInformationLike {
  effectiveType?: string;
}

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike;
  mozConnection?: NetworkInformationLike;
  webkitConnection?: NetworkInformationLike;
};

function objectProperty(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined;
}

function numericProperty(value: unknown, key: string): number | undefined {
  const property = objectProperty(value, key);
  return typeof property === "number" ? property : undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  const property = objectProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

const LIVE_MEMORY_CLEANUP_INTERVAL_MS = 60 * 1000;

const VOD_MEMORY_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

const LIVE_FRAGMENT_WATCHDOG_INTERVAL_MS = 1000;

export const LIVE_FRAGMENT_OFFLINE_GRACE_MS = 20_000;

const AUTO_QUALITY_LABEL = "auto";

function formatResolutionLabel(height: number): string {
  return `${height}p`;
}

export function applyPreferredQuality(
  hls: Hls,
  levels: QualityLevel[],
  preference: PlayerQualityPreference | string
): void {
  const qualityId = resolvePreferredQualityId(levels, preference);
  if (qualityId === "auto") {
    hls.currentLevel = -1;
    return;
  }

  const levelIndex = Number.parseInt(qualityId, 10);
  if (!Number.isNaN(levelIndex) && levelIndex >= 0 && levelIndex < levels.length) {
    hls.currentLevel = levelIndex;
  }
}

export function isKickLiveCdnUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).host;
    return host.endsWith(".playback.live-video.net") || host.endsWith(".playlist.live-video.net");
  } catch {
    return false;
  }
}

function summarizeMediaSource(
  source: string,
  sourceType: "hls" | "native"
): { sourceScheme: string; sourceType: "hls" | "native" } {
  try {
    const sourceScheme = new URL(source).protocol.replace(/:$/, "");
    return { sourceScheme: sourceScheme || "unknown", sourceType };
  } catch {
    return { sourceScheme: "unknown", sourceType };
  }
}

interface SessionBindings {
  videoRef: MutableCell<HTMLVideoElement | null>;
  src: string;
  isEffectActiveRef: MutableCell<boolean>;
  isMountedRef: MutableCell<boolean>;
  lastRecoveryAttemptRef: MutableCell<number | null>;
  parsedQualityLevelsRef: MutableCell<QualityLevel[]>;
  appliedPreferredQualityRef: MutableCell<string | null>;
  lastFragLoadedTimeRef: MutableCell<number>;
  manifestParsedTimeRef: MutableCell<number | null>;
  hasReceivedFirstFragmentRef: MutableCell<boolean>;
  fragErrorCountRef: MutableCell<number>;
  videoRefForInterval: MutableCell<HTMLVideoElement | null>;
  playRequestIdRef: MutableCell<number>;
  pendingPlayRef: MutableCell<Promise<void> | null>;
  isLive: boolean;
  hlsRef: MutableCell<Hls | null>;
  hlsConfigRef: MutableCell<Partial<Partial<import("hls.js").HlsConfig>> | undefined>;
  onHlsInstanceRef: MutableCell<((hls: Hls) => void) | undefined>;
  autoPlay: boolean;
  preferredQualityRef: MutableCell<string | undefined>;
  currentLevelRef: MutableCell<string | undefined>;
  onQualityLevelsRef: MutableCell<((levels: QualityLevel[]) => void) | undefined>;
  onActiveQualityChangeRef: MutableCell<((qualityId: string) => void) | undefined>;
  stallRecovery: import("../../capabilities/playback-recovery").PlaybackRecoveryObserver;
  onErrorRef: MutableCell<((error: PlayerError) => void) | undefined>;
  translateRef: MutableCell<import("i18next").TFunction<"translation", undefined>>;
  setHeartbeatDelay: (delay: number | null) => void;
  setMemoryCleanupDelay: (delay: number | null) => void;
  sourcesRef: MutableCell<{ quality: string; url: string }[] | undefined>;
  bufferPreferences: BufferPreferences;
}

export function startHlsPlaybackSession({
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
  bufferPreferences,
}: SessionBindings): (() => void) | undefined {
  const video = videoRef.current;
  if (!video || !src) return;

  // Scoped active flag to handle rapid stream switching robustly
  let isEffectActive = true;
  isEffectActiveRef.current = true;
  isMountedRef.current = true;
  // Reset recovery attempt tracker for new stream
  lastRecoveryAttemptRef.current = null;
  parsedQualityLevelsRef.current = [];
  appliedPreferredQualityRef.current = null;

  // Reset heartbeat mutable state for this stream
  lastFragLoadedTimeRef.current = Date.now();
  manifestParsedTimeRef.current = null;
  hasReceivedFirstFragmentRef.current = false;
  fragErrorCountRef.current = 0;
  videoRefForInterval.current = video;

  let hls: Hls | null = null;
  // Track event handlers for cleanup (used by native HLS and standard playback)
  let handleLoadedMetadata: (() => void) | null = null;
  let handleError: ((e: Event) => void) | null = null;
  let handlePlayReset: (() => void) | null = null;
  let handleLivePauseStopLoad: (() => void) | null = null;
  let handleLivePlayStartLoad: (() => void) | null = null;
  const handleLevelSwitched = (_event: unknown, data: { level: number }) => {
    onActiveQualityChangeRef.current?.(String(data.level));
  };

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
            logger.debug("Player:HLS", "play request interrupted (expected during source change)");
          } else if (e.name === "NotAllowedError") {
            if (!video.muted) {
              logger.warn("Player:HLS", "autoplay blocked, retrying muted playback");
              video.muted = true;
              safePlay();
            } else {
              logger.warn(
                "Player:HLS",
                "autoplay blocked by browser policy - user interaction required"
              );
            }
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
    const networkNavigator: NavigatorWithConnection = navigator;
    const connection =
      networkNavigator.connection ||
      networkNavigator.mozConnection ||
      networkNavigator.webkitConnection;
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
    const bufferConfig = isLive
      ? resolveHlsBufferConfig(bufferPreferences)
      : resolveHlsVodBufferConfig();

    const loadingConfig = isLive
      ? {
          manifestLoadingTimeOut: isProxyUrl
            ? Math.round(5000 * timeoutMultiplier)
            : Math.round(8000 * timeoutMultiplier),
          manifestLoadingMaxRetry: isProxyUrl ? 0 : 1,
          manifestLoadingRetryDelay: 500,
          manifestLoadingMaxRetryTimeout: isProxyUrl
            ? Math.round(5000 * timeoutMultiplier)
            : Math.round(10000 * timeoutMultiplier),
          levelLoadingTimeOut: isProxyUrl
            ? Math.round(5000 * timeoutMultiplier)
            : Math.round(8000 * timeoutMultiplier),
          levelLoadingMaxRetry: isProxyUrl ? 0 : 1,
          levelLoadingRetryDelay: 500,
          levelLoadingMaxRetryTimeout: isProxyUrl
            ? Math.round(5000 * timeoutMultiplier)
            : Math.round(10000 * timeoutMultiplier),
          fragLoadingTimeOut: Math.round(15000 * timeoutMultiplier),
          fragLoadingMaxRetry: 4,
          fragLoadingRetryDelay: 500,
          fragLoadingMaxRetryTimeout: Math.round(20000 * timeoutMultiplier),
        }
      : {
          manifestLoadingTimeOut: Math.round(15000 * timeoutMultiplier),
          manifestLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryTimeout: Math.round(30000 * timeoutMultiplier),
          levelLoadingTimeOut: Math.round(15000 * timeoutMultiplier),
          levelLoadingMaxRetry: 3,
          levelLoadingRetryDelay: 1000,
          levelLoadingMaxRetryTimeout: Math.round(30000 * timeoutMultiplier),
          fragLoadingTimeOut: Math.round(20000 * timeoutMultiplier),
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 1000,
          fragLoadingMaxRetryTimeout: Math.round(30000 * timeoutMultiplier),
        };

    // Slice 09 reuse: if an alive HLS instance exists from a prior src on
    // this mount, swap its source via detachMedia()->loadSource()->attachMedia()
    // instead of constructing a new instance + new decoder. Stale handlers
    // capture old prop closures (autoPlay/currentLevel/onHlsInstance), so
    // off-all and re-register below.
    const isReusingExistingHls = Boolean(hlsRef.current);

    if (hlsRef.current) {
      hls = hlsRef.current;
      hls.off(Hls.Events.MANIFEST_PARSED);
      hls.off(Hls.Events.ERROR);
      hls.off(Hls.Events.FRAG_LOADED);
      logger.debug("Player:HLS", "reusing HLS instance for new source", { src });
      hls.detachMedia();
    } else {
      hls = new Hls({
        // Long-lived live playback avoids cross-thread segment transfers; short-lived
        // VOD/clip playback keeps worker demuxing for UI responsiveness.
        enableWorker: !isLive,
        // Auto quality should not decode more pixels than the mounted player can show.
        // Explicit user-selected levels remain available.
        capLevelToPlayerSize: isLive,
        lowLatencyMode: bufferConfig.lowLatencyMode,
        startFragPrefetch: true, // Start fetching fragment immediately for faster start

        // === AGGRESSIVE MEMORY MANAGEMENT FOR LONG-RUNNING STREAMS ===
        // These settings prevent memory creep during 4-12+ hour sessions
        // HLS.js leaks ~5-15MB/hour from segment accumulation without these limits
        backBufferLength: bufferConfig.backBufferLength, // Live keeps a small tail; VOD/clip keeps a more useful seek-back buffer.
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

        ...loadingConfig,

        xhrSetup: (xhr, _url) => {
          xhr.withCredentials = false; // Important to avoid CORS issues with wildcards
        },

        ...hlsConfigRef.current,
      });
      hlsRef.current = hls;
      onHlsInstanceRef.current?.(hls);
    } // close slice 09 reuse else-branch

    if (isLive) {
      handleLivePauseStopLoad = () => {
        const activeHls = hlsRef.current;
        if (!isEffectActive || !activeHls) return;
        activeHls.stopLoad();
      };
      handleLivePlayStartLoad = () => {
        const activeHls = hlsRef.current;
        if (!isEffectActive || !activeHls) return;
        lastFragLoadedTimeRef.current = Date.now();
        activeHls.startLoad(-1);
      };
      video.addEventListener("pause", handleLivePauseStopLoad);
      video.addEventListener("play", handleLivePlayStartLoad);
    }

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      logger.debug("Player:HLS", "manifest parsed", { levels: data.levels.length });

      const levels: QualityLevel[] = data.levels.map((level, index) => {
        const heightLabel = level.height ? `${level.height}p` : "";
        const fpsLabel = level.frameRate && level.frameRate > 30 ? Math.round(level.frameRate) : "";
        let label = heightLabel ? `${heightLabel}${fpsLabel}` : `Level ${index}`;
        if (data.levels.length === 1 && !level.height) label = "Source";

        return {
          id: index.toString(),
          label,
          width: level.width || 0,
          height: level.height || 0,
          bitrate: level.bitrate || 0,
          frameRate: level.frameRate || 0,
          isAuto: false,
          isSource: /\bsource\b/i.test(level.name ?? ""),
          name: level.name,
        };
      });
      parsedQualityLevelsRef.current = levels;

      if (autoPlay && isMountedRef.current) {
        safePlay();
      }

      // Restore current level if set (with validation)
      const preferred = preferredQualityRef.current;
      if (preferred !== undefined) {
        applyPreferredQuality(hls!, levels, preferred);
        appliedPreferredQualityRef.current = String(preferred).toLowerCase();
      } else if (currentLevelRef.current !== undefined) {
        const initialCurrentLevel = currentLevelRef.current;
        if (initialCurrentLevel === "auto") hls!.currentLevel = -1;
        else {
          const levelIndex = Number.parseInt(initialCurrentLevel, 10);
          if (!Number.isNaN(levelIndex) && levelIndex >= 0 && levelIndex < levels.length) {
            hls!.currentLevel = levelIndex;
          }
        }
      }

      if (onQualityLevelsRef.current && data.levels) {
        // Add Auto level
        onQualityLevelsRef.current([
          {
            id: "auto",
            label: AUTO_QUALITY_LABEL,
            width: 0,
            height: 0,
            bitrate: 0,
            isAuto: true,
          },
          ...levels,
        ]);
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, handleLevelSwitched);

    // Handle HLS errors - distinguish between expected stream-ending scenarios and actual errors
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) stallRecovery.noteNetworkError();
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
        numericProperty(data.response, "code") ||
        numericProperty(data.response, "status") ||
        numericProperty(data.networkDetails, "status");
      const errorUrl =
        stringProperty(data, "url") ||
        stringProperty(data.context, "url") ||
        stringProperty(data.frag, "url") ||
        src;
      const isRefreshableKickLiveCdnError =
        isLive && (isKickLiveCdnUrl(src) || isKickLiveCdnUrl(errorUrl));

      // Handle critical manifest errors early - no point retrying these
      // Generic 404/403 remains a confirmed-offline signal. Kick live CDN
      // URLs are signed and can go stale while metadata still says live, so
      // ask the caller to fetch a fresh playback URL before surfacing offline.
      if (data.details === "manifestLoadError" && (statusCode === 404 || statusCode === 403)) {
        logger.debug("Player:HLS", "stream unavailable, stopping retries", {
          statusCode,
          shouldRefresh: isRefreshableKickLiveCdnError,
        });
        hls?.destroy();
        hlsRef.current = null;
        onErrorRef.current?.({
          code: "STREAM_OFFLINE",
          message: translateRef.current("playback.streamOfflineUnavailable"),
          fatal: true,
          shouldRefresh: isRefreshableKickLiveCdnError,
          originalError: data,
        });
        return;
      }

      // Handle 500 errors specially - likely proxy server error
      if (data.details === "manifestLoadError" && statusCode === 500) {
        logger.debug("Player:HLS", "proxy/server error, triggering fallback", { statusCode });
        hls?.destroy();
        hlsRef.current = null;
        onErrorRef.current?.({
          code: "PROXY_ERROR",
          message: translateRef.current("playback.proxyServerError"),
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
        hlsRef.current = null;
        onErrorRef.current?.({
          code: "PROXY_ERROR",
          message: translateRef.current("playback.proxyError", {
            detail: statusCode || translateRef.current("playback.manifestLoadFailed"),
          }),
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
              message: translateRef.current("playback.streamOfflineUnavailable"),
              fatal: true,
              shouldRefresh:
                isStreamEndingError &&
                (statusCode === 404 || statusCode === 403) &&
                isRefreshableKickLiveCdnError,
              originalError: data,
            });
            hls?.destroy();
            hlsRef.current = null;
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
                message: translateRef.current("playback.fatalMediaError", {
                  detail: data.details,
                }),
                fatal: true,
                originalError: data,
              });
              hls?.destroy();
              hlsRef.current = null;
            }
            break;
          }
          default:
            logger.error("Player:HLS", "unrecoverable error", { data });
            onErrorRef.current?.({
              code: "HLS_FATAL",
              message: translateRef.current("playback.fatalHlsError", {
                detail: data.details,
              }),
              fatal: true,
              originalError: data,
            });
            hls?.destroy();
            hlsRef.current = null;
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
    // For live streams, aggressively detect when fragments stop arriving.
    // VOD/clip HLS can legitimately pause fragment flow while buffering,
    // seeking, or retrying archived segments, so leave that path to HLS.js.
    const MAX_FRAG_ERRORS_BEFORE_REFRESH = 3;

    // Track successful fragment loads
    hls.on(Hls.Events.FRAG_LOADED, () => {
      lastFragLoadedTimeRef.current = Date.now();
      stallRecovery.noteFragmentLoaded();
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
      if (isLive && data.details === "fragLoadError" && !data.fatal) {
        fragErrorCountRef.current++;
        logger.debug("Player:HLS", "fragment load error", {
          errorCount: fragErrorCountRef.current,
        });

        // After multiple fragment errors, likely token expired
        if (fragErrorCountRef.current >= MAX_FRAG_ERRORS_BEFORE_REFRESH) {
          logger.debug("Player:HLS", "multiple fragment errors - token may have expired");
          setHeartbeatDelay(null);
          hls?.destroy();
          hlsRef.current = null;
          onErrorRef.current?.({
            code: "TOKEN_EXPIRED",
            message: translateRef.current("playback.playbackTokenExpiredReload"),
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
      // Activate heartbeat and memory cleanup via useInterval.
      setHeartbeatDelay(isLive ? LIVE_FRAGMENT_WATCHDOG_INTERVAL_MS : null);
      setMemoryCleanupDelay(
        isLive ? LIVE_MEMORY_CLEANUP_INTERVAL_MS : VOD_MEMORY_CLEANUP_INTERVAL_MS
      );
    });

    if (!isReusingExistingHls) {
      logger.debug("Player:HLS", "initializing HLS", summarizeMediaSource(src, "hls"));
    }
    hls.loadSource(src);
    hls.attachMedia(video);
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
        message: translateRef.current("playback.nativePlaybackError"),
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
            {
              id: "auto",
              label: AUTO_QUALITY_LABEL,
              width: 0,
              height: 0,
              bitrate: 0,
              isAuto: true,
            },
            ...levels,
          ]);
        } else if (video.videoHeight) {
          // Fallback: Single source
          onQualityLevelsRef.current([
            {
              id: "auto",
              label: AUTO_QUALITY_LABEL,
              width: 0,
              height: 0,
              bitrate: 0,
              isAuto: true,
            },
            {
              id: "source",
              label: formatResolutionLabel(video.videoHeight),
              width: video.videoWidth,
              height: video.videoHeight,
              bitrate: 0,
              isAuto: false,
              isSource: true,
            },
          ]);
        }
      }
    };
    handleError = (e: Event) => {
      // Only report error if we really fail
      onErrorRef.current?.({
        code: "PLAYBACK_ERROR",
        message: translateRef.current("playback.playbackFailed"),
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
    hls?.off(Hls.Events.LEVEL_SWITCHED, handleLevelSwitched);

    // Live streams keep the slice-09 reuse path for channel-hop perf. VOD
    // startup is more sensitive to StrictMode/effect cleanup races, so archived
    // playback gets a fresh HLS instance on the next setup.
    if (!isLive && hls && hlsRef.current === hls) {
      try {
        hls.destroy();
      } catch (_e) {
        // Already destroyed by an in-handler error path; ignore.
      }
      hlsRef.current = null;
    }

    // Remove event listeners from video element to prevent memory leaks.
    // These are scope-local to each effect run, so they DO need replacing
    // every src change.
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
      if (handleLivePauseStopLoad) {
        currentVideo.removeEventListener("pause", handleLivePauseStopLoad);
      }
      if (handleLivePlayStartLoad) {
        currentVideo.removeEventListener("play", handleLivePlayStartLoad);
      }
    }
  };
}
