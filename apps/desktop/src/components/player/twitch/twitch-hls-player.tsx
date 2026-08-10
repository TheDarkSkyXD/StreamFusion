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
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { logger } from "@/renderer/logging/logger";
import type { AdBlockStatus } from "@/shared/adblock-types";
import { DEFAULT_BUFFER_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { resolveHlsBufferConfig } from "../hls-buffer-config";
import { useLivePlaybackStallRecovery } from "../hooks/use-live-playback-stall-recovery";
import { resolvePreferredQualityId, type PlayerQualityPreference } from "../quality-preference";
import type { PlayerError, QualityLevel } from "../types";

import { resolvePlaybackAdvancedAdBlockOverrides } from "./playback-advanced-config";
import { getAdBlockHlsConfig } from "./twitch-adblock-loader";
import {
  clearStreamInfo,
  getAdBlockConfig,
  getAdBlockStatus,
  initAdBlockService,
  isAdBlockEnabled,
  type PlayerReloadReason,
  setAuthHeaders,
  setPlayerCallbacks,
  subscribeAdBlockStatus,
  updateAdBlockConfig,
} from "./twitch-adblock-service";

export interface TwitchHlsPlayerProps extends Omit<
  React.VideoHTMLAttributes<HTMLVideoElement>,
  "onError"
> {
  src: string;
  channelName: string;
  onQualityLevels?: (levels: QualityLevel[]) => void;
  onActiveQualityChange?: (qualityId: string) => void;
  onError?: (error: PlayerError) => void;
  onHlsInstance?: (hls: Hls | null) => void;
  onCleanPresentedFrame?: () => void;
  onPlaybackRecoveryStateChange?: (recovering: boolean) => void;
  onBeforeAdPresentationShield?: () => void;
  onVerifiedCleanAdPresentation?: () => void;
  onAdBlockStatusChange?: (status: AdBlockStatus) => void;
  autoPlay?: boolean;
  currentLevel?: string;
  preferredQuality?: PlayerQualityPreference | string;
  enableAdBlock?: boolean;
  volume?: number;
}

const TWITCH_AD_PRESENTATION_SHIELD_ATTRIBUTE = "data-streamfusion-ad-presentation-shielded";
const LIVE_MEMORY_CLEANUP_INTERVAL_MS = 60 * 1000;
const AD_BLOCK_RECOVERY_REFRESH_MS = 15_000;

function applyPreferredQuality(
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

function isUnsafeAdPresentation(status: AdBlockStatus): boolean {
  return (
    status.isUsingFallbackMode ||
    status.isStrippingSegments ||
    (status.isShowingAd && status.activePlayerType === null)
  );
}

interface CleanPresentationTarget {
  sn: number | string;
  url: string;
  start: number;
}

function cleanPresentationTargetKey(sn: number | string, url: string): string {
  return JSON.stringify([sn, url]);
}

export const TwitchHlsPlayer = forwardRef<HTMLVideoElement, TwitchHlsPlayerProps>(
  (
    {
      src,
      channelName,
      onQualityLevels,
      onActiveQualityChange,
      onError,
      onHlsInstance,
      onCleanPresentedFrame,
      onPlaybackRecoveryStateChange,
      onBeforeAdPresentationShield,
      onVerifiedCleanAdPresentation,
      onAdBlockStatusChange,
      autoPlay = false,
      currentLevel,
      preferredQuality,
      enableAdBlock = true,
      volume,
      muted = false,
      ...props
    },
    ref
  ) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const autoPlayRef = useRef(autoPlay);
    autoPlayRef.current = autoPlay;
    const isMountedRef = useRef(true);
    const pendingPlayRef = useRef<Promise<void> | null>(null);
    const playRequestIdRef = useRef(0);
    const lastRecoveryAttemptRef = useRef<number | null>(null);
    const [_adBlockStatus, setAdBlockStatus] = useState<AdBlockStatus | null>(null);
    const isPresentationShieldedRef = useRef(false);
    const unshieldedOpacityRef = useRef("");
    const requestedMutedRef = useRef(muted);
    const cleanPresentationTargetsRef = useRef<Map<string, CleanPresentationTarget>>(new Map());
    const pendingSafeStatusRef = useRef<AdBlockStatus | null>(null);
    const frameCallbackIdRef = useRef<number | null>(null);
    const presentationGenerationRef = useRef(0);
    const onAdBlockStatusChangeRef = useRef(onAdBlockStatusChange);
    const onPlaybackRecoveryStateChangeRef = useRef(onPlaybackRecoveryStateChange);
    const onBeforeAdPresentationShieldRef = useRef(onBeforeAdPresentationShield);
    const onVerifiedCleanAdPresentationRef = useRef(onVerifiedCleanAdPresentation);
    const onErrorRef = useRef(onError);

    // Mutable player state shared with timer callbacks.
    const isEffectActiveRef = useRef(false);
    const adBlockStatusRef = useRef<AdBlockStatus | null>(null);
    const adBlockRecoveryArmedRef = useRef(false);
    const adBlockRecoveryAttemptsRef = useRef(0);
    const adBlockRecoveryActionRef = useRef<(() => void) | null>(null);
    const safePlayActionRef = useRef<(() => void) | null>(null);
    const memoryRestoreActionRef = useRef<(() => void) | null>(null);

    const safePlayTimeout = useManagedTimeout(() => safePlayActionRef.current?.());
    const memoryRestoreTimeout = useManagedTimeout(() => memoryRestoreActionRef.current?.());
    const adBlockRecoveryTimeout = useManagedTimeout(() => {
      adBlockRecoveryArmedRef.current = false;
      adBlockRecoveryActionRef.current?.();
    });

    const publishAdBlockStatus = useCallback((status: AdBlockStatus) => {
      adBlockStatusRef.current = status;
      setAdBlockStatus(status);
      onAdBlockStatusChangeRef.current?.(status);
    }, []);

    const clearAdBlockRecoveryWatchdog = useCallback(() => {
      adBlockRecoveryArmedRef.current = false;
      adBlockRecoveryAttemptsRef.current = 0;
      adBlockRecoveryActionRef.current = null;
      adBlockRecoveryTimeout.clear();
    }, [adBlockRecoveryTimeout]);

    const armAdBlockRecoveryWatchdog = useCallback(
      (reset = false) => {
        if (adBlockRecoveryArmedRef.current && !reset) return;

        adBlockRecoveryArmedRef.current = true;
        adBlockRecoveryActionRef.current = () => {
          const status = adBlockStatusRef.current;
          if (!isEffectActiveRef.current || !status || !isUnsafeAdPresentation(status)) return;

          if (adBlockRecoveryAttemptsRef.current >= 1) {
            logger.warn("Player:Twitch:HLS", "ad-block hold remained stale; refreshing source", {
              channelName,
              isShowingAd: status.isShowingAd,
              isStrippingSegments: status.isStrippingSegments,
              isUsingFallbackMode: status.isUsingFallbackMode,
            });
            onErrorRef.current?.({
              code: "AD_BLOCK_STALL",
              message: "Twitch ad-block recovery remained stalled",
              fatal: true,
              shouldRefresh: true,
            });
            return;
          }

          logger.warn("Player:Twitch:HLS", "ad-block hold stalled; refreshing playback path", {
            channelName,
            isShowingAd: status.isShowingAd,
            isStrippingSegments: status.isStrippingSegments,
            isUsingFallbackMode: status.isUsingFallbackMode,
          });
          try {
            hlsRef.current?.startLoad(-1);
          } catch (error) {
            logger.warn("Player:Twitch:HLS", "ad-block recovery startLoad failed", {
              channelName,
              errorName: error instanceof Error ? error.name : "unknown",
            });
          }
          adBlockRecoveryAttemptsRef.current += 1;
          adBlockRecoveryArmedRef.current = true;
          adBlockRecoveryTimeout.start(AD_BLOCK_RECOVERY_REFRESH_MS);
        };
        adBlockRecoveryTimeout.start(AD_BLOCK_RECOVERY_REFRESH_MS);
      },
      [adBlockRecoveryTimeout, channelName]
    );

    // Delay state: null = paused, number = running. Set on MANIFEST_PARSED, cleared on teardown.
    const [memoryCleanupDelay, setMemoryCleanupDelay] = useState<number | null>(null);

    // Apple volume on mount and change
    useEffect(() => {
      if (videoRef.current && volume !== undefined) {
        videoRef.current.volume = Math.max(0, Math.min(1, volume));
      }
    }, [volume]);

    useEffect(() => {
      requestedMutedRef.current = muted;
      if (videoRef.current && !isPresentationShieldedRef.current) {
        videoRef.current.muted = muted;
      }
    }, [muted]);

    const invalidatePresentationRecovery = useCallback(() => {
      const video = videoRef.current;
      presentationGenerationRef.current += 1;
      cleanPresentationTargetsRef.current.clear();
      pendingSafeStatusRef.current = null;
      if (video && frameCallbackIdRef.current !== null && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(frameCallbackIdRef.current);
      }
      frameCallbackIdRef.current = null;
    }, []);

    const shieldAdPresentation = useCallback(() => {
      if (!isPresentationShieldedRef.current) {
        onBeforeAdPresentationShieldRef.current?.();
      }
      invalidatePresentationRecovery();
      const video = videoRef.current;
      if (!video) return;
      if (!isPresentationShieldedRef.current) {
        unshieldedOpacityRef.current = video.style.opacity;
      }
      isPresentationShieldedRef.current = true;
      video.setAttribute(TWITCH_AD_PRESENTATION_SHIELD_ATTRIBUTE, "true");
      video.style.opacity = "0";
      video.muted = true;
    }, [invalidatePresentationRecovery]);

    const clearPresentationShield = useCallback(() => {
      invalidatePresentationRecovery();
      const video = videoRef.current;
      if (!video || !isPresentationShieldedRef.current) return;

      isPresentationShieldedRef.current = false;
      video.removeAttribute(TWITCH_AD_PRESENTATION_SHIELD_ATTRIBUTE);
      video.style.opacity = unshieldedOpacityRef.current;
      video.muted = requestedMutedRef.current;
    }, [invalidatePresentationRecovery]);

    const revealOnCleanPresentation = useCallback(
      (target: CleanPresentationTarget) => {
        const video = videoRef.current;
        if (!video || typeof video.requestVideoFrameCallback !== "function") return;
        const generation = presentationGenerationRef.current;

        const requestNextFrame = () => {
          frameCallbackIdRef.current = video.requestVideoFrameCallback((_now, metadata) => {
            frameCallbackIdRef.current = null;
            if (
              generation !== presentationGenerationRef.current ||
              !isPresentationShieldedRef.current
            ) {
              return;
            }
            if (metadata.mediaTime < target.start) {
              requestNextFrame();
              return;
            }

            const safeStatus = pendingSafeStatusRef.current;
            pendingSafeStatusRef.current = null;
            isPresentationShieldedRef.current = false;
            video.muted = requestedMutedRef.current;
            video.removeAttribute(TWITCH_AD_PRESENTATION_SHIELD_ATTRIBUTE);
            video.style.opacity = unshieldedOpacityRef.current;
            onVerifiedCleanAdPresentationRef.current?.();
            if (safeStatus) publishAdBlockStatus(safeStatus);
          });
        };

        requestNextFrame();
      },
      [publishAdBlockStatus]
    );

    // Expose video ref to parent
    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

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

        // Restore after a tick to let HLS.js process the trim.
        memoryRestoreActionRef.current = () => {
          if (hls && isEffectActiveRef.current) {
            hls.config.backBufferLength = originalBackBuffer;
          }
        };
        memoryRestoreTimeout.start(1000);

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
    const onActiveQualityChangeRef = useRef(onActiveQualityChange);
    const onHlsInstanceRef = useRef(onHlsInstance);
    const onCleanPresentedFrameRef = useRef(onCleanPresentedFrame);
    const currentLevelRef = useRef(currentLevel);
    const preferredQualityRef = useRef(preferredQuality);
    const parsedQualityLevelsRef = useRef<QualityLevel[]>([]);
    const appliedPreferredQualityRef = useRef<string | null>(null);

    const stallRecovery = useLivePlaybackStallRecovery({
      sourceKey: src,
      enabled: true,
      videoRef,
      hlsRef,
      onErrorRef,
      onCleanPresentedFrameRef,
      onRecoveryStateChangeRef: onPlaybackRecoveryStateChangeRef,
      onHlsInstanceRef,
      isActiveRef: isEffectActiveRef,
      shouldSuppress: () => {
        const status = adBlockStatusRef.current;
        return (
          enableAdBlock &&
          !!status &&
          (status.isShowingAd || status.isStrippingSegments || status.isUsingFallbackMode)
        );
      },
    });

    useEffect(() => {
      onQualityLevelsRef.current = onQualityLevels;
      onActiveQualityChangeRef.current = onActiveQualityChange;
      onErrorRef.current = onError;
      onAdBlockStatusChangeRef.current = onAdBlockStatusChange;
      onHlsInstanceRef.current = onHlsInstance;
      onCleanPresentedFrameRef.current = onCleanPresentedFrame;
      onPlaybackRecoveryStateChangeRef.current = onPlaybackRecoveryStateChange;
      onBeforeAdPresentationShieldRef.current = onBeforeAdPresentationShield;
      onVerifiedCleanAdPresentationRef.current = onVerifiedCleanAdPresentation;
      currentLevelRef.current = currentLevel;
      preferredQualityRef.current = preferredQuality;
    }, [
      onQualityLevels,
      onActiveQualityChange,
      onError,
      onAdBlockStatusChange,
      onHlsInstance,
      onCleanPresentedFrame,
      onPlaybackRecoveryStateChange,
      onBeforeAdPresentationShield,
      onVerifiedCleanAdPresentation,
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

    // Initialize ad-block service
    useEffect(() => {
      let unsubscribeStatus: (() => void) | undefined;
      const handleStatus = (status: AdBlockStatus) => {
        if (isUnsafeAdPresentation(status)) {
          armAdBlockRecoveryWatchdog();
          shieldAdPresentation();
          publishAdBlockStatus(status);
          return;
        }
        clearAdBlockRecoveryWatchdog();
        if (isPresentationShieldedRef.current) {
          pendingSafeStatusRef.current = status;
          return;
        }
        publishAdBlockStatus(status);
      };

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

        unsubscribeStatus = subscribeAdBlockStatus(channelName, (status) => {
          if (status.channelName?.trim().toLowerCase() !== channelName.trim().toLowerCase()) return;
          handleStatus(status);
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
        handleStatus(initialStatus);

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
        clearPresentationShield();
        publishAdBlockStatus(inactiveStatus);
      }

      return () => {
        unsubscribeStatus?.();
        clearAdBlockRecoveryWatchdog();
        invalidatePresentationRecovery();
        // Clear stream info on unmount
        if (channelName) {
          clearStreamInfo(channelName, { preservePlayerReloadGuard: true });
        }
      };
    }, [
      enableAdBlock,
      channelName,
      armAdBlockRecoveryWatchdog,
      clearAdBlockRecoveryWatchdog,
      clearPresentationShield,
      invalidatePresentationRecovery,
      publishAdBlockStatus,
      shieldAdPresentation,
    ]);

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

    // Ad lifecycle notifications never own playback or HLS loading state.
    const handleAdBlockTransition = useCallback((reason: PlayerReloadReason) => {
      const hls = hlsRef.current;
      if (!hls) return;

      logger.debug("Player:Twitch:HLS", "ad-block playlist transition", { reason });
      if (reason === "ad-started") {
        return;
      }

      if (reason === "ad-ended") {
        const preferred = preferredQualityRef.current;
        const levels = parsedQualityLevelsRef.current;
        if (preferred !== undefined && levels.length > 0) {
          applyPreferredQuality(hls, levels, preferred);
          appliedPreferredQualityRef.current = String(preferred).toLowerCase();
        }
        logger.debug(
          "Player:Twitch:HLS",
          "resuming original Twitch session after ad-block completion"
        );
      }
    }, []);

    // Register player callbacks with ad-block service
    useEffect(() => {
      if (enableAdBlock) {
        return setPlayerCallbacks(channelName, handleAdBlockTransition);
      }
      return undefined;
    }, [channelName, enableAdBlock, handleAdBlockTransition]);

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
      parsedQualityLevelsRef.current = [];
      appliedPreferredQualityRef.current = null;
      if (adBlockStatusRef.current && isUnsafeAdPresentation(adBlockStatusRef.current)) {
        armAdBlockRecoveryWatchdog();
      }

      let hls: Hls | null = null;
      let handleLoadedMetadata: (() => void) | null = null;
      let handleError: ((e: Event) => void) | null = null;
      let handleLivePauseStopLoad: (() => void) | null = null;
      let handleLivePlayStartLoad: (() => void) | null = null;

      const releaseHls = () => {
        const instance = hls;
        if (!instance || hlsRef.current !== instance) return;
        try {
          instance.stopLoad();
        } catch {
          // The loader may already be stopped.
        }
        try {
          instance.detachMedia();
        } catch {
          // The media pipeline may already be detached.
        }
        try {
          instance.destroy();
        } catch (error) {
          logger.warn("Player:Twitch:HLS", "HLS destruction failed", {
            errorName: error instanceof Error ? error.name : "unknown",
          });
        }
        hlsRef.current = null;
        onHlsInstanceRef.current?.(null);
      };

      const safePlay = () => {
        if (!isEffectActive || !video || !autoPlayRef.current) return;

        const currentRequestId = ++playRequestIdRef.current;

        safePlayActionRef.current = () => {
          if (!isEffectActive || currentRequestId !== playRequestIdRef.current) return;
          if (!autoPlayRef.current) return;
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
        };
        safePlayTimeout.start(50);
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
          // Keep long-lived segment buffers out of the worker transfer boundary.
          enableWorker: false,
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

        handleLivePauseStopLoad = () => {
          if (!isEffectActive || !hlsRef.current) return;
          hlsRef.current.stopLoad();
        };
        handleLivePlayStartLoad = () => {
          if (!isEffectActive || !hlsRef.current) return;
          hlsRef.current.startLoad(-1);
        };
        video.addEventListener("pause", handleLivePauseStopLoad);
        video.addEventListener("play", handleLivePlayStartLoad);

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          // console.debug("[TwitchHLS] Manifest parsed, levels:", data.levels.length);

          const rawLevels: QualityLevel[] = data.levels.map((level, index) => ({
            id: index.toString(),
            label: level.name
              ? level.name
              : level.height
                ? `${level.height}p${level.frameRate ? Math.round(level.frameRate) : ""}`
                : `Level ${index}`,
            width: level.width,
            height: level.height,
            bitrate: level.bitrate,
            frameRate: level.frameRate,
            isAuto: false,
            isSource: /\bsource\b/i.test(level.name ?? ""),
            name: level.name,
          }));
          const labelCounts = new Map<string, number>();
          rawLevels.forEach((level) =>
            labelCounts.set(level.label, (labelCounts.get(level.label) || 0) + 1)
          );
          const levels: QualityLevel[] = rawLevels.map((level) => {
            let label = level.label;
            if (labelCounts.get(level.label)! > 1 && level.bitrate > 0) {
              label = `${label} (${Math.round(level.bitrate / 1000)}k)`;
            }
            return { ...level, label };
          });
          parsedQualityLevelsRef.current = levels;

          if (autoPlayRef.current && isMountedRef.current) {
            safePlay();
          }

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
            onQualityLevelsRef.current([
              { id: "auto", label: "Auto", width: 0, height: 0, bitrate: 0, isAuto: true },
              ...levels,
            ]);
          }
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          onActiveQualityChangeRef.current?.(String(data.level));
        });

        hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
          const latestStatus = getAdBlockStatus(channelName);
          if (isUnsafeAdPresentation(latestStatus)) {
            shieldAdPresentation();
            publishAdBlockStatus(latestStatus);
            return;
          }
          if (!isPresentationShieldedRef.current) return;

          pendingSafeStatusRef.current = latestStatus;
          const fragments = data.details?.fragments ?? [];
          const safeTargets = new Map<string, CleanPresentationTarget>();
          for (const fragment of fragments) {
            if (
              (typeof fragment.sn !== "number" && typeof fragment.sn !== "string") ||
              typeof fragment.url !== "string" ||
              typeof fragment.start !== "number"
            ) {
              continue;
            }
            const target = { sn: fragment.sn, url: fragment.url, start: fragment.start };
            safeTargets.set(cleanPresentationTargetKey(target.sn, target.url), target);
          }
          cleanPresentationTargetsRef.current = safeTargets;
        });

        hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
          const fragment = data.frag;
          if (
            (typeof fragment.sn !== "number" && typeof fragment.sn !== "string") ||
            typeof fragment.url !== "string"
          ) {
            return;
          }
          const target = cleanPresentationTargetsRef.current.get(
            cleanPresentationTargetKey(fragment.sn, fragment.url)
          );
          if (!target || !isPresentationShieldedRef.current) {
            return;
          }

          cleanPresentationTargetsRef.current.clear();
          video.currentTime = target.start;
          revealOnCleanPresentation(target);
        });

        // Error handling
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) stallRecovery.noteNetworkError();
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

          if (data.details === "manifestLoadError" && statusCode === 403) {
            logger.debug("Player:Twitch:HLS", "playback token rejected", { statusCode });
            releaseHls();
            onErrorRef.current?.({
              code: "TOKEN_EXPIRED",
              message: "Twitch playback token expired or was rejected",
              fatal: true,
              shouldRefresh: true,
              originalError: data,
            });
            return;
          }

          if (data.details === "manifestLoadError" && statusCode === 404) {
            logger.debug("Player:Twitch:HLS", "stream unavailable", { statusCode });
            releaseHls();
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
                    releaseHls();
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
                  releaseHls();
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
                  releaseHls();
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
                releaseHls();
                break;
            }
          }
        });

        // Fragment loading tracker for offline detection
        hls.on(Hls.Events.FRAG_LOADED, () => {
          stallRecovery.noteFragmentLoaded();
          if (adBlockStatusRef.current && isUnsafeAdPresentation(adBlockStatusRef.current)) {
            armAdBlockRecoveryWatchdog(true);
          }
        });

        // Activate heartbeat and memory cleanup via useInterval.
        // The actual interval logic lives in the useInterval hooks above.
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          stallRecovery.noteManifestParsed();
          setMemoryCleanupDelay(LIVE_MEMORY_CLEANUP_INTERVAL_MS);
        });

        try {
          hls.loadSource(src);
          hls.attachMedia(video);
        } catch (e) {
          logger.error("Player:Twitch:HLS", "error setting up HLS", { error: e });
        }
      } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS (Safari)
        logger.debug("Player:Twitch:HLS", "using native HLS");
        video.src = src;
        handleLoadedMetadata = () => {
          if (autoPlayRef.current && isMountedRef.current) safePlay();
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
          if (autoPlayRef.current && isMountedRef.current) safePlay();

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
        playRequestIdRef.current += 1;
        safePlayActionRef.current = null;
        memoryRestoreActionRef.current = null;
        safePlayTimeout.clear();
        memoryRestoreTimeout.clear();
        clearAdBlockRecoveryWatchdog();
        invalidatePresentationRecovery();

        setMemoryCleanupDelay(null);

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
          try {
            currentVideo.pause();
          } catch {
            // The media element may already be detached during shutdown.
          }
        }

        if (hlsRef.current === hls) releaseHls();
        else if (hls === null) onHlsInstanceRef.current?.(null);

        try {
          currentVideo.removeAttribute("src");
          currentVideo.load();
        } catch {
          // Best-effort release of the native media pipeline.
        }

        // Clear stream info
        if (channelName) {
          clearStreamInfo(channelName, { preservePlayerReloadGuard: true });
        }
      };
    }, [
      src,
      channelName,
      enableAdBlock,
      armAdBlockRecoveryWatchdog,
      clearAdBlockRecoveryWatchdog,
      invalidatePresentationRecovery,
      publishAdBlockStatus,
      revealOnCleanPresentation,
      safePlayTimeout,
      shieldAdPresentation,
      stallRecovery,
      memoryRestoreTimeout,
    ]);

    return <video ref={videoRef} playsInline className="size-full object-contain" {...props} />;
  }
);

TwitchHlsPlayer.displayName = "TwitchHlsPlayer";
