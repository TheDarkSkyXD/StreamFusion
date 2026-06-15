/**
 * Twitch HLS Player with Ad-Blocking
 *
 * A wrapper around HlsPlayer that integrates the VAFT-based ad-blocking system.
 * This component initializes the ad-block service and uses custom HLS.js loaders
 * to intercept and process m3u8 playlists.
 */

import Hls from "hls.js";
import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { useInterval } from "@/hooks/useInterval";
import { logger } from "@/renderer/logging/logger";
import type { AdBlockStatus } from "@/shared/adblock-types";
import { DEFAULT_BUFFER_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { resolveHlsBufferConfig } from "../hls-buffer-config";
import type { PlayerError, QualityLevel } from "../types";

import { resolvePlaybackAdvancedAdBlockOverrides } from "./playback-advanced-config";
import { getAdBlockHlsConfig } from "./twitch-adblock-loader";
import {
  clearStreamInfo,
  getAdBlockConfig,
  getAdBlockStatus,
  initAdBlockService,
  isAdBlockEnabled,
  setAuthHeaders,
  setPlayerCallbacks,
  setStatusChangeCallback,
  updateAdBlockConfig,
} from "./twitch-adblock-service";

export interface TwitchHlsPlayerProps
  extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "onError"> {
  src: string;
  channelName: string;
  onQualityLevels?: (levels: QualityLevel[]) => void;
  onError?: (error: PlayerError) => void;
  onHlsInstance?: (hls: Hls) => void;
  onAdBlockStatusChange?: (status: AdBlockStatus) => void;
  autoPlay?: boolean;
  currentLevel?: string;
  enableAdBlock?: boolean;
  volume?: number;
}

const LIVE_MEMORY_CLEANUP_INTERVAL_MS = 60 * 1000;

export const TwitchHlsPlayer = forwardRef<HTMLVideoElement, TwitchHlsPlayerProps>(
  (
    {
      src,
      channelName,
      onQualityLevels,
      onError,
      onHlsInstance,
      onAdBlockStatusChange,
      autoPlay = false,
      currentLevel,
      enableAdBlock = true,
      volume,
      ...props
    },
    ref
  ) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const isMountedRef = useRef(true);
    const pendingPlayRef = useRef<Promise<void> | null>(null);
    const playRequestIdRef = useRef(0);
    const lastRecoveryAttemptRef = useRef<number | null>(null);
    const [_adBlockStatus, setAdBlockStatus] = useState<AdBlockStatus | null>(null);

    // Mutable heartbeat state lifted into refs so useInterval callbacks can read them
    const isEffectActiveRef = useRef(false);
    const lastFragLoadedTimeRef = useRef(Date.now());

    // Delay state: null = paused, number = running. Set on MANIFEST_PARSED, cleared on teardown.
    const [heartbeatDelay, setHeartbeatDelay] = useState<number | null>(null);
    const [memoryCleanupDelay, setMemoryCleanupDelay] = useState<number | null>(null);

    // Apple volume on mount and change
    useEffect(() => {
      if (videoRef.current && volume !== undefined) {
        videoRef.current.volume = Math.max(0, Math.min(1, volume));
      }
    }, [volume]);

    // Expose video ref to parent
    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

    // Heartbeat: check every 10s that fragments are still arriving.
    // Active only while heartbeatDelay is a number (set by MANIFEST_PARSED, cleared on teardown).
    useInterval(() => {
      const hls = hlsRef.current;
      if (!isEffectActiveRef.current || !hls) {
        setHeartbeatDelay(null);
        return;
      }
      const timeSinceLastFrag = Date.now() - lastFragLoadedTimeRef.current;
      if (timeSinceLastFrag > 15000) {
        logger.debug("Player:Twitch:HLS", "no fragments, checking stream", {
          secondsSinceLastFragment: Math.round(timeSinceLastFrag / 1000),
        });
        try {
          hls.startLoad(-1);
        } catch {
          // HLS may be in invalid state
        }
      }
    }, heartbeatDelay);

    // Memory cleanup every 10 minutes: reset to live edge and trigger browser GC.
    useInterval(() => {
      const hls = hlsRef.current;
      if (!isEffectActiveRef.current || !hls) {
        setMemoryCleanupDelay(null);
        return;
      }

      try {
        logger.debug(
          "Player:Twitch:HLS",
          "periodic cleanup: resetting to live edge and trimming buffers"
        );

        hls.startLevel = -1;

        const originalBackBuffer = hls.config.backBufferLength;
        const backBufferLength = resolveHlsBufferConfig(
          useAuthStore.getState().preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES
        ).backBufferLength;
        hls.config.backBufferLength = backBufferLength;

        const video = videoRef.current;
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
          logger.debug("Player:Twitch:HLS", "forced garbage collection");
        }
      } catch (e) {
        logger.debug("Player:Twitch:HLS", "cleanup error (non-fatal)", { error: e });
      }
    }, memoryCleanupDelay);

    // Store callbacks in refs
    const onQualityLevelsRef = useRef(onQualityLevels);
    const onErrorRef = useRef(onError);
    const onAdBlockStatusChangeRef = useRef(onAdBlockStatusChange);
    const onHlsInstanceRef = useRef(onHlsInstance);
    const currentLevelRef = useRef(currentLevel);

    useEffect(() => {
      onQualityLevelsRef.current = onQualityLevels;
      onErrorRef.current = onError;
      onAdBlockStatusChangeRef.current = onAdBlockStatusChange;
      onHlsInstanceRef.current = onHlsInstance;
      currentLevelRef.current = currentLevel;
    }, [onQualityLevels, onError, onAdBlockStatusChange, onHlsInstance, currentLevel]);

    // Initialize ad-block service
    useEffect(() => {
      if (enableAdBlock) {
        initAdBlockService({ enabled: true });

        // Apply the user's advanced stream-token overrides to the ad-block path
        // ONLY (plan U13). Read at mount so they take effect on the next stream
        // load; defaults produce `{}`, so an untouched install is behavior-
        // neutral. These never reach the non-ad-block resolver (different
        // Client-Id pairing — see playback-advanced-config.ts).
        const advancedPrefs = useAuthStore.getState().preferences?.playbackAdvanced;
        const overrides = resolvePlaybackAdvancedAdBlockOverrides(
          advancedPrefs,
          getAdBlockConfig().backupPlayerTypes
        );
        if (Object.keys(overrides).length > 0) {
          updateAdBlockConfig(overrides);
        }

        setStatusChangeCallback((status) => {
          setAdBlockStatus(status);
          onAdBlockStatusChangeRef.current?.(status);
        });

        // Initialize auth headers for backup stream fetching
        // Generate a persistent device ID (stored in localStorage) or use existing
        let deviceId = localStorage.getItem("twitch_adblock_device_id");
        if (!deviceId) {
          const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
          deviceId = "";
          for (let i = 0; i < 32; i++) {
            deviceId += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          localStorage.setItem("twitch_adblock_device_id", deviceId);
        }
        setAuthHeaders(deviceId);

        const initialStatus = getAdBlockStatus(channelName);
        setAdBlockStatus(initialStatus);
        onAdBlockStatusChangeRef.current?.(initialStatus);

        logger.debug("Player:Twitch:HLS", "ad-block initialized with device ID");
      } else {
        const inactiveStatus: AdBlockStatus = {
          isActive: false,
          isShowingAd: false,
          isMidroll: false,
          isStrippingSegments: false,
          numStrippedSegments: 0,
          activePlayerType: null,
          channelName,
          isUsingFallbackMode: false,
          adStartTime: null,
        };
        setAdBlockStatus(inactiveStatus);
        onAdBlockStatusChangeRef.current?.(inactiveStatus);
      }

      return () => {
        // Clear stream info on unmount
        if (channelName) {
          clearStreamInfo(channelName);
        }
      };
    }, [enableAdBlock, channelName]);

    // Handle quality change
    useEffect(() => {
      if (hlsRef.current && currentLevel !== undefined) {
        const hls = hlsRef.current;
        if (currentLevel === "auto") {
          hls.currentLevel = -1;
        } else {
          const levelIndex = parseInt(currentLevel, 10);
          if (
            !Number.isNaN(levelIndex) &&
            levelIndex >= 0 &&
            hls.levels &&
            levelIndex < hls.levels.length
          ) {
            hls.currentLevel = levelIndex;
          }
        }
      }
    }, [currentLevel]);

    // Player control callbacks for ad-block service
    const handlePlayerReload = useCallback(() => {
      const video = videoRef.current;
      const hls = hlsRef.current;
      if (!video || !hls) return;

      logger.debug("Player:Twitch:HLS", "ad-block triggered player reload");
      // Restart from live edge
      hls.startLoad(-1);
    }, []);

    const handlePauseResume = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;

      logger.debug("Player:Twitch:HLS", "ad-block triggered pause/resume");
      if (!video.paused) {
        video.pause();
        // timer-allowlist: ad-block triggered video.play() retry delay (SP2 explicitly out-of-scope)
        setTimeout(() => {
          video.play().catch(() => {});
        }, 100);
      }
    }, []);

    // Register player callbacks with ad-block service
    useEffect(() => {
      if (enableAdBlock) {
        setPlayerCallbacks(handlePlayerReload, handlePauseResume);
      }
    }, [enableAdBlock, handlePlayerReload, handlePauseResume]);

    // Handle quality level changes without re-initializing HLS
    useEffect(() => {
      const hls = hlsRef.current;
      if (!hls || currentLevel === undefined) return;

      if (currentLevel === "auto") {
        hls.currentLevel = -1;
      } else {
        const levelIndex = parseInt(currentLevel, 10);
        // Verify level index is valid before setting
        if (!Number.isNaN(levelIndex) && levelIndex >= 0 && levelIndex < hls.levels.length) {
          hls.currentLevel = levelIndex;
        } else {
          // If levels aren't loaded yet, this might fail, but MANIFEST_PARSED handles initial set
          logger.warn("Player:Twitch:HLS", "invalid level index", { levelIndex });
        }
      }
    }, [currentLevel]);

    // Main HLS initialization effect
    useEffect(() => {
      const video = videoRef.current;

      if (!video || !src) {
        return;
      }

      let isEffectActive = true;
      isEffectActiveRef.current = true;
      isMountedRef.current = true;
      lastRecoveryAttemptRef.current = null;

      // Reset heartbeat mutable state for this stream
      lastFragLoadedTimeRef.current = Date.now();

      let hls: Hls | null = null;
      let handleLoadedMetadata: (() => void) | null = null;
      let handleError: ((e: Event) => void) | null = null;
      let handleLivePauseStopLoad: (() => void) | null = null;
      let handleLivePlayStartLoad: (() => void) | null = null;

      const safePlay = () => {
        if (!isEffectActive || !video) return;

        const currentRequestId = ++playRequestIdRef.current;

        // timer-allowlist: HLS.js safePlay browser-settle delay (SP2 explicitly out-of-scope)
        setTimeout(() => {
          if (!isEffectActive || currentRequestId !== playRequestIdRef.current) return;
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
              if (!isEffectActive || currentRequestId !== playRequestIdRef.current) return;

              if (e.name === "AbortError") {
                logger.debug("Player:Twitch:HLS", "play request interrupted");
              } else if (e.name === "NotAllowedError") {
                logger.warn("Player:Twitch:HLS", "autoplay blocked by browser policy");
                // Try muting and playing again
                if (!video.muted) {
                  video.muted = true;
                  safePlay();
                }
              } else {
                logger.error("Player:Twitch:HLS", "playback failed", { error: e });
              }
            });
        }, 50);
      };

      const isHls = src.includes(".m3u8") || src.includes("usher.ttvnw.net");

      if (isHls && Hls.isSupported()) {
        // Get ad-blocking loaders if enabled
        const adBlockConfig =
          enableAdBlock && isAdBlockEnabled() ? getAdBlockHlsConfig(channelName) : {};

        // User buffer/latency prefs (live-only keys). Read at construction so the
        // value applies on the next stream load (R18); the periodic cleanup below
        // only mutates backBufferLength, so it won't fight these.
        const bufferConfig = resolveHlsBufferConfig(
          useAuthStore.getState().preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES
        );

        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: bufferConfig.lowLatencyMode,
          startFragPrefetch: true,

          // === AGGRESSIVE MEMORY MANAGEMENT FOR LONG-RUNNING STREAMS ===
          // These settings prevent memory creep during 4-12+ hour Twitch sessions
          backBufferLength: bufferConfig.backBufferLength, // Live keeps a small tail to lower long-running media/GPU memory.
          maxBufferLength: bufferConfig.maxBufferLength, // Forward buffer (user-tunable)
          maxMaxBufferLength: bufferConfig.maxMaxBufferLength, // Hard cap (user-tunable)
          maxBufferSize: bufferConfig.maxBufferSize, // Scaled with maxMaxBufferLength so it isn't clamped
          liveSyncDurationCount: bufferConfig.liveSyncDurationCount, // Target live latency (user-tunable)
          liveMaxLatencyDurationCount: bufferConfig.liveMaxLatencyDurationCount, // Derived > liveSync so config stays valid

          // Buffer hole handling - tuned for live streaming resilience
          maxBufferHole: 0.5, // Max gap size before seeking over (seconds)
          highBufferWatchdogPeriod: 3, // Seconds before watchdog checks for stalls
          nudgeOffset: 0.2, // Amount to nudge playhead when stalled (seconds)
          nudgeMaxRetry: 5, // Max nudge attempts before fatal error
          appendErrorMaxRetry: 5,

          // Manifest loading
          manifestLoadingTimeOut: 10000,
          manifestLoadingMaxRetry: 2,
          manifestLoadingRetryDelay: 500,
          manifestLoadingMaxRetryTimeout: 15000,

          // Level loading
          levelLoadingTimeOut: 10000,
          levelLoadingMaxRetry: 2,
          levelLoadingRetryDelay: 500,
          levelLoadingMaxRetryTimeout: 15000,

          // Fragment loading
          fragLoadingTimeOut: 15000,
          fragLoadingMaxRetry: 4,
          fragLoadingRetryDelay: 500,
          fragLoadingMaxRetryTimeout: 20000,

          xhrSetup: (xhr) => {
            xhr.withCredentials = false;
          },

          // Ad-blocking loaders
          ...adBlockConfig,
        });

        hlsRef.current = hls;
        if (onHlsInstanceRef.current) onHlsInstanceRef.current(hls);

        try {
          hls.loadSource(src);
          hls.attachMedia(video);
        } catch (e) {
          logger.error("Player:Twitch:HLS", "error setting up HLS", { error: e });
        }

        handleLivePauseStopLoad = () => {
          if (!isEffectActive || !hlsRef.current) return;
          hlsRef.current.stopLoad();
        };
        handleLivePlayStartLoad = () => {
          if (!isEffectActive || !hlsRef.current) return;
          lastFragLoadedTimeRef.current = Date.now();
          hlsRef.current.startLoad(-1);
        };
        video.addEventListener("pause", handleLivePauseStopLoad);
        video.addEventListener("play", handleLivePlayStartLoad);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          // console.debug("[TwitchHLS] Manifest parsed, levels:", data.levels.length);

          if (autoPlay && isMountedRef.current) {
            safePlay();
          }

          if (currentLevelRef.current !== undefined) {
            if (currentLevelRef.current === "auto") {
              hls!.currentLevel = -1;
            } else {
              const levelIndex = parseInt(currentLevelRef.current, 10);
              if (!Number.isNaN(levelIndex) && levelIndex >= 0 && levelIndex < data.levels.length) {
                hls!.currentLevel = levelIndex;
              }
            }
          }

          if (onQualityLevelsRef.current && data.levels) {
            // Build initial labels
            const rawLevels = data.levels.map((level, index) => {
              const baseLabel = level.name
                ? level.name
                : level.height
                  ? `${level.height}p${level.frameRate ? Math.round(level.frameRate) : ""}`
                  : `Level ${index}`;
              return {
                id: index.toString(),
                label: baseLabel,
                width: level.width,
                height: level.height,
                bitrate: level.bitrate,
                frameRate: level.frameRate,
                isAuto: false,
                name: level.name,
              };
            });

            // Find the source quality (highest bitrate)
            const maxBitrate = Math.max(...rawLevels.map((l) => l.bitrate || 0));

            // Find only the FIRST level with max bitrate to mark as source
            const sourceIndex = rawLevels.findIndex((level) => level.bitrate === maxBitrate);

            // Deduplicate labels by appending bitrate when duplicates exist
            const labelCounts = new Map<string, number>();
            rawLevels.forEach((l) => labelCounts.set(l.label, (labelCounts.get(l.label) || 0) + 1));

            const levels: QualityLevel[] = rawLevels.map((level, index) => {
              let finalLabel = level.label;

              // Mark only the first highest bitrate level as source
              if (index === sourceIndex && maxBitrate > 0) {
                finalLabel = `${finalLabel} (source)`;
              } else if (labelCounts.get(level.label)! > 1 && level.bitrate > 0) {
                // Deduplicate other labels by appending bitrate
                finalLabel = `${finalLabel} (${Math.round(level.bitrate / 1000)}k)`;
              }

              return { ...level, label: finalLabel };
            });

            onQualityLevelsRef.current([
              { id: "auto", label: "Auto", width: 0, height: 0, bitrate: 0, isAuto: true },
              ...levels,
            ]);
          }
        });

        // Error handling
        hls.on(Hls.Events.ERROR, (_event, data) => {
          // Silent errors: non-fatal issues that HLS.js handles automatically
          // - bufferSeekOverHole: HLS.js seeked over a buffer gap to unstuck playback (normal behavior)
          // - bufferNudgeOnStall: HLS.js nudged playhead to recover from stall (normal behavior)
          // - bufferStalledError: Buffer ran out temporarily, will recover
          // - levelSwitchError: Quality switch issue, will fallback
          // - fragLoadError/fragParsingError: Fragment issues, will retry
          const silentErrors = [
            "bufferStalledError",
            "levelSwitchError",
            "fragLoadError",
            "fragParsingError",
            "bufferSeekOverHole", // Auto-handled: seeks over buffer gaps
            "bufferNudgeOnStall", // Auto-handled: nudges playhead when stalled
          ];
          const statusCode =
            data.response?.code ||
            (data.response as any)?.status ||
            (data.networkDetails as any)?.status;

          if (data.details === "manifestLoadError" && (statusCode === 404 || statusCode === 403)) {
            logger.debug("Player:Twitch:HLS", "stream unavailable", { statusCode });
            hls?.destroy();
            onErrorRef.current?.({
              code: "STREAM_OFFLINE",
              message: "Stream offline or unavailable",
              fatal: true,
              originalError: data,
            });
            return;
          }

          const shouldLog = data.fatal || !silentErrors.includes(data.details);
          if (shouldLog) {
            logger.debug("Player:Twitch:HLS", "error", {
              details: data.details,
              fatal: data.fatal,
              statusCode: statusCode ?? null,
            });
          }

          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR: {
                // For transient network errors (SSL handshake failures, connection resets),
                // attempt recovery by restarting the stream load before giving up.
                // This handles CDN edge server rotation and momentary connectivity issues.
                const now = Date.now();
                const lastAttempt = lastRecoveryAttemptRef.current;

                // Allow one recovery attempt every 8 seconds
                if (!lastAttempt || now - lastAttempt > 8000) {
                  logger.debug(
                    "Player:Twitch:HLS",
                    "attempting network error recovery (startLoad)"
                  );
                  lastRecoveryAttemptRef.current = now;
                  try {
                    hls?.startLoad(-1);
                  } catch {
                    // HLS may be in invalid state, fall through to destroy
                    logger.debug("Player:Twitch:HLS", "recovery failed, stream unavailable");
                    onErrorRef.current?.({
                      code: "STREAM_OFFLINE",
                      message: "Stream offline or unavailable",
                      fatal: true,
                      originalError: data,
                    });
                    hls?.destroy();
                  }
                } else {
                  // Already tried recovery recently, stream is likely truly offline
                  logger.debug(
                    "Player:Twitch:HLS",
                    "stream ended or unavailable (recovery exhausted)"
                  );
                  onErrorRef.current?.({
                    code: "STREAM_OFFLINE",
                    message: "Stream offline or unavailable",
                    fatal: true,
                    originalError: data,
                  });
                  hls?.destroy();
                }
                break;
              }
              case Hls.ErrorTypes.MEDIA_ERROR: {
                const now = Date.now();
                const lastAttempt = lastRecoveryAttemptRef.current;
                if (!lastAttempt || now - lastAttempt > 5000) {
                  logger.debug("Player:Twitch:HLS", "attempting media error recovery");
                  lastRecoveryAttemptRef.current = now;
                  hls?.recoverMediaError();
                } else {
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
                logger.error("Player:Twitch:HLS", "unrecoverable error", { data });
                onErrorRef.current?.({
                  code: "HLS_FATAL",
                  message: `Fatal HLS Error: ${data.details}`,
                  fatal: true,
                  originalError: data,
                });
                hls?.destroy();
                break;
            }
          }
        });

        // Fragment loading tracker for offline detection
        hls.on(Hls.Events.FRAG_LOADED, () => {
          lastFragLoadedTimeRef.current = Date.now();
        });

        // Activate heartbeat (10 000 ms) and memory cleanup via useInterval.
        // The actual interval logic lives in the useInterval hooks above.
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setHeartbeatDelay(10000);
          setMemoryCleanupDelay(LIVE_MEMORY_CLEANUP_INTERVAL_MS);
        });
      } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS (Safari)
        logger.debug("Player:Twitch:HLS", "using native HLS");
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
        // Standard playback
        logger.debug("Player:Twitch:HLS", "using standard native playback");
        handleLoadedMetadata = () => {
          if (autoPlay && isMountedRef.current) safePlay();

          // Emit single source quality for native playback so UI shows something
          if (onQualityLevelsRef.current && video.videoHeight) {
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
        };
        handleError = (e: Event) => {
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

      const currentVideo = video;

      return () => {
        isEffectActive = false;
        isEffectActiveRef.current = false;
        isMountedRef.current = false;
        pendingPlayRef.current = null;

        // Pause the useInterval hooks
        setHeartbeatDelay(null);
        setMemoryCleanupDelay(null);

        if (hls) {
          hls.destroy();
        }
        hlsRef.current = null;

        if (currentVideo) {
          if (handleLoadedMetadata) {
            currentVideo.removeEventListener("loadedmetadata", handleLoadedMetadata);
          }
          if (handleError) {
            currentVideo.removeEventListener("error", handleError);
          }
          if (handleLivePauseStopLoad) {
            currentVideo.removeEventListener("pause", handleLivePauseStopLoad);
          }
          if (handleLivePlayStartLoad) {
            currentVideo.removeEventListener("play", handleLivePlayStartLoad);
          }
        }

        // Clear stream info
        if (channelName) {
          clearStreamInfo(channelName);
        }
      };
    }, [src, autoPlay, channelName, enableAdBlock]);

    return <video ref={videoRef} playsInline className="size-full object-contain" {...props} />;
  }
);

TwitchHlsPlayer.displayName = "TwitchHlsPlayer";
