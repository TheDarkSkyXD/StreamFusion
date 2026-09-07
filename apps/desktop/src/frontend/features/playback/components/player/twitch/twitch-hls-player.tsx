import {
  startTwitchHlsSession,
  TWITCH_AD_PRESENTATION_SHIELD_ATTRIBUTE,
  AD_BLOCK_RECOVERY_REFRESH_MS,
  applyPreferredQuality,
  isUnsafeAdPresentation,
  CleanPresentationTarget,
} from "../../../adapters/browser/twitch-hls-session";
/**
 * Twitch HLS Player with Ad-Blocking
 *
 * A wrapper around HlsPlayer that integrates the VAFT-based ad-blocking system.
 * This component initializes the ad-block service and uses custom HLS.js loaders
 * to intercept and process m3u8 playlists.
 */

import Hls from "hls.js";
import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { useInterval } from "@/hooks/useInterval";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { logger } from "@/renderer/logging/logger";
import type { AdBlockStatus } from "@shared/adblock-types";
import { DEFAULT_BUFFER_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import {
  getEnabledTwitchPlaylistProxySources,
  isTwitchPlaylistProxyMode,
  resolveTwitchPlaylistProxyUrl,
} from "@/features/playback/adapters/browser/twitch/twitch-playlist-proxy";

import { resolveHlsBufferConfig } from "../../../adapters/browser/hls-buffer-config";
import { useLivePlaybackStallRecovery } from "../hooks/use-live-playback-stall-recovery";
import { type PlayerQualityPreference } from "../../../domain/quality-preference";
import type { PlayerError, QualityLevel } from "../../../capabilities/media-types";

import { resolvePlaybackAdvancedAdBlockOverrides } from "../../../adapters/browser/twitch/playback-advanced-config";
import {
  clearStreamInfo,
  getAdBlockConfig,
  getAdBlockStatus,
  initAdBlockService,
  type PlayerReloadReason,
  setAuthHeaders,
  setPlayerCallbacks,
  subscribeAdBlockStatus,
  updateAdBlockConfig,
} from "../../../adapters/browser/twitch/twitch-adblock-service";

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
    const { t } = useTranslation();
    const translateRef = useRef(t);
    const videoRef = useRef<HTMLVideoElement>(null);
    const preferences = useAuthStore((state) => state.preferences);
    const playlistProxyPreferences = preferences?.twitchPlaylistProxy;
    const playlistProxySources = useMemo(
      () => getEnabledTwitchPlaylistProxySources(playlistProxyPreferences?.sources ?? []),
      [playlistProxyPreferences?.sources]
    );
    const playlistProxyRevision = useMemo(
      () =>
        JSON.stringify(
          (playlistProxyPreferences?.sources ?? []).map((source) => [
            source.id,
            source.url,
            source.enabled,
            source.addQueryParams,
          ])
        ),
      [playlistProxyPreferences?.sources]
    );
    const playlistProxyEnabled = isTwitchPlaylistProxyMode(preferences);
    const playlistRouteKey = `${src}\u0000${channelName}\u0000${playlistProxyEnabled}\u0000${playlistProxyRevision}`;
    const [playlistProxyCursor, setPlaylistProxyCursor] = useState({
      key: playlistRouteKey,
      index: 0,
    });

    useEffect(() => {
      translateRef.current = t;
    }, [t]);
    const activePlaylistProxyCursor =
      playlistProxyCursor.key === playlistRouteKey ? playlistProxyCursor.index : 0;
    const playlistProxySource =
      playlistProxyEnabled && activePlaylistProxyCursor < playlistProxySources.length
        ? playlistProxySources[activePlaylistProxyCursor]
        : null;
    const activeSource =
      playlistProxySource === null
        ? src
        : (resolveTwitchPlaylistProxyUrl(playlistProxySource, channelName) ?? src);
    const isPlaylistProxyMode = playlistProxyEnabled;
    const isPlaylistProxyAttempt = playlistProxySource !== null && activeSource !== src;
    const effectiveEnableAdBlock = enableAdBlock && !isPlaylistProxyMode;
    useEffect(() => {
      setPlaylistProxyCursor({ key: playlistRouteKey, index: 0 });
    }, [playlistRouteKey]);
    const advancePlaylistProxySource = useCallback(() => {
      if (!isPlaylistProxyAttempt) return false;
      setPlaylistProxyCursor((current) => {
        if (current.key !== playlistRouteKey) return current;
        return { ...current, index: current.index + 1 };
      });
      return true;
    }, [isPlaylistProxyAttempt, playlistRouteKey]);
    const hlsRef = useRef<Hls | null>(null);
    const autoPlayRef = useRef(autoPlay);
    useLayoutEffect(() => {
      autoPlayRef.current = autoPlay;
    }, [autoPlay]);
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

          logger.warn("Player:Twitch:HLS", "ad-block hold stalled; restarting local loader", {
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
      sourceKey: activeSource,
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
          effectiveEnableAdBlock &&
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

      if (effectiveEnableAdBlock) {
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
      effectiveEnableAdBlock,
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
      if (effectiveEnableAdBlock) {
        return setPlayerCallbacks(channelName, handleAdBlockTransition);
      }
      return undefined;
    }, [channelName, effectiveEnableAdBlock, handleAdBlockTransition]);

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
    // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- The returned cleanup removes media listeners and releaseHls destroys every HLS subscription.
    useEffect(
      () =>
        startTwitchHlsSession({
          videoRef,
          activeSource,
          isEffectActiveRef,
          isMountedRef,
          lastRecoveryAttemptRef,
          parsedQualityLevelsRef,
          appliedPreferredQualityRef,
          adBlockStatusRef,
          armAdBlockRecoveryWatchdog,
          hlsRef,
          onHlsInstanceRef,
          autoPlayRef,
          playRequestIdRef,
          safePlayActionRef,
          pendingPlayRef,
          safePlayTimeout,
          isPlaylistProxyAttempt,
          effectiveEnableAdBlock,
          channelName,
          translateRef,
          preferredQualityRef,
          currentLevelRef,
          onQualityLevelsRef,
          onActiveQualityChangeRef,
          shieldAdPresentation,
          publishAdBlockStatus,
          isPresentationShieldedRef,
          pendingSafeStatusRef,
          cleanPresentationTargetsRef,
          revealOnCleanPresentation,
          stallRecovery,
          advancePlaylistProxySource,
          playlistProxySourceId: playlistProxySource?.id,
          onErrorRef,
          setMemoryCleanupDelay,
          memoryRestoreActionRef,
          memoryRestoreTimeout,
          clearAdBlockRecoveryWatchdog,
          invalidatePresentationRecovery,
          bufferPreferences:
            useAuthStore.getState().preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES,
        }),
      [
        activeSource,
        channelName,
        effectiveEnableAdBlock,
        advancePlaylistProxySource,
        isPlaylistProxyAttempt,
        playlistProxySource?.id,
        armAdBlockRecoveryWatchdog,
        clearAdBlockRecoveryWatchdog,
        invalidatePresentationRecovery,
        publishAdBlockStatus,
        revealOnCleanPresentation,
        safePlayTimeout,
        shieldAdPresentation,
        stallRecovery,
        memoryRestoreTimeout,
      ]
    );

    return <video ref={videoRef} playsInline className="size-full object-contain" {...props} />;
  }
);

TwitchHlsPlayer.displayName = "TwitchHlsPlayer";
