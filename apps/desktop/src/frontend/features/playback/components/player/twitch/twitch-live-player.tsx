import type Hls from "hls.js";
import { useTranslation } from "react-i18next";
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
import { TWITCH_COLORS } from "@/assets/platforms/twitch";
import { Button } from "@/components/ui/button";
import { TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { useAdElementObserver } from "@/features/playback/components/hooks/use-ad-element-observer";
import { isTwitchPlaylistProxyMode } from "@/features/playback/adapters/browser/twitch/twitch-playlist-proxy";
import { createCancellableSleep, type CancellableSleep } from "@shared/utils/sleep";
import { logger } from "@/renderer/logging/logger";
import type { AdBlockStatus } from "@shared/adblock-types";
import type { ProtectedPlaybackFailure } from "@shared/protected-playback-types";
import type { TwitchMediaProtection } from "../../../capabilities/twitch-media-protection";
import { protectedPlaybackController } from "@/features/playback/composition/protected-playback";
import {
  measureProtectedPlayerLayout,
  observeProtectedPlayerLayout,
  observeProtectedPlayerOcclusion,
} from "@/features/playback/adapters/electron/protected-player-layout";
import { useAdBlockStore } from "@/features/playback/components/state/adblock-store";
import { useVolumeStore } from "@/features/playback/components/state/volume-store";
import { useAuthStore } from "@/features/auth/components/state/auth-store";

import { useDefaultQuality } from "../hooks/use-default-quality";
import { useDockedPlayerConfig } from "../persistent-player-shell";
import { qualityLevelToPreference } from "../../../domain/quality-preference";
import { useFullscreen } from "../hooks/use-fullscreen";
import { useLocalLiveCaptions } from "../hooks/use-local-live-captions";
import { usePictureInPicture } from "../hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "../hooks/use-player-keyboard";
import { usePlayerNetworkRecovery } from "../hooks/use-player-network-recovery";
import { useTimedText } from "../hooks/use-timed-text";
import { useVolume } from "../hooks/use-volume";
import { CaptionOverlay } from "../caption-overlay";
import {
  LOCAL_LIVE_CAPTION_TRACK,
  type PlayerError,
  type QualityLevel,
} from "../../../capabilities/media-types";

import { AdBlockFallbackOverlay } from "./ad-block-fallback-overlay";
import { TwitchHlsPlayer } from "./twitch-hls-player";
import { TwitchLivePlayerControls } from "./twitch-live-player-controls";
import { VideoStatsOverlay } from "./video-stats-overlay";

const MAX_AUTO_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_BASE_MS = 1500;
const PLAYBACK_INTENT_STORAGE_PREFIX = "streamfusion:twitch-live-playback-intent:v1:";

type PlaybackIntent = "playing" | "paused";
type ProtectedMode =
  | { kind: "opening" }
  | { kind: "opened" }
  | { kind: "closed" }
  | { kind: "failed"; reason: ProtectedPlaybackFailure };

function playbackIntentStorageKey(channelName: string): string {
  return `${PLAYBACK_INTENT_STORAGE_PREFIX}${channelName.trim().toLowerCase()}`;
}

function readPlaybackIntent(channelName: string, autoPlay: boolean): PlaybackIntent {
  try {
    const storedIntent = window.sessionStorage.getItem(playbackIntentStorageKey(channelName));
    if (storedIntent === "playing" || storedIntent === "paused") return storedIntent;
  } catch {
    // The renderer can continue with its configured default when storage is unavailable.
  }
  return autoPlay ? "playing" : "paused";
}

function persistPlaybackIntent(channelName: string, intent: PlaybackIntent): void {
  try {
    window.sessionStorage.setItem(playbackIntentStorageKey(channelName), intent);
  } catch {
    // Playback controls must remain usable when storage is unavailable.
  }
}

export interface TwitchLivePlayerProps {
  streamUrl: string;
  channelName: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  quality?: QualityLevel;
  onReady?: () => void;
  onError?: (error: PlayerError) => boolean | void;
  onCleanPresentedFrame?: () => void;
  onProtectedPlaybackSelected?: () => void;
  onProtectedAction?: (
    action:
      "expand" | "close" | "theater" | "back" | "forward" | "tab-next" | "tab-previous" | "drag",
    delta?: { dx: number; dy: number }
  ) => void;
  onQualityChange?: (quality: QualityLevel) => void;
  onAdBlockStatusChange?: (status: AdBlockStatus) => void;
  className?: string;
  isTheater?: boolean;
  onToggleTheater?: () => void;
  enableAdBlock?: boolean;
  // Error/ad-block recovery refresh callback.
  onRefresh?: () => void;
  /** A stable parent surface owns the retry budget across keyed player remounts. */
  recoveryManagedExternally?: boolean;
  compact?: boolean;
  protection?: TwitchMediaProtection;
}

const NO_QUALITY_LEVELS: QualityLevel[] = [];
const ignoreQualityChange = () => {};

export const TwitchLivePlayer = forwardRef<HTMLVideoElement, TwitchLivePlayerProps>(
  function TwitchLivePlayer(props, forwardedVideoRef) {
    const { t } = useTranslation();
    const {
      streamUrl,
      channelName,
      poster,
      autoPlay = false,
      muted: initialMuted = false,
      quality,
      onReady,
      onError,
      onCleanPresentedFrame,
      onProtectedPlaybackSelected,
      onProtectedAction,
      onQualityChange,
      onAdBlockStatusChange,
      className,
      isTheater,
      onToggleTheater,
      enableAdBlock = true,
      onRefresh,
      recoveryManagedExternally = false,
      compact = false,
      protection,
    } = props;
    const isDockedChannelSurface = useDockedPlayerConfig() !== null;
    const shouldApplySavedQuality = isDockedChannelSurface || protection?.kind === "widevine";
    const protectedOwnerId = useMemo(
      () =>
        `protected-${channelName.replace(/[^a-zA-Z0-9_]/g, "")}-${Math.random().toString(36).slice(2)}`,
      [channelName]
    );
    const [protectedMode, setProtectedMode] = useState<ProtectedMode | null>(null);
    const protectedProbeRef = useRef<"unchecked" | "checking" | "not-encrypted">("unchecked");
    const protectedProbeGenerationRef = useRef(0);
    const protectedLayoutRevisionRef = useRef(0);
    const protectedLayoutKeyRef = useRef("");
    const onProtectedActionRef = useRef(onProtectedAction);
    useLayoutEffect(() => {
      onProtectedActionRef.current = onProtectedAction;
    }, [onProtectedAction]);

    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const adPresentationCanvasRef = useRef<HTMLCanvasElement>(null);
    const adPresentationPosterRef = useRef<HTMLImageElement>(null);
    const adPresentationPlaceholderRef = useRef<HTMLDivElement>(null);
    const failedAdPresentationPosterRef = useRef<string | null>(null);
    useImperativeHandle(forwardedVideoRef, () => videoRef.current as HTMLVideoElement);

    // Ad-block store setting
    const storeEnableAdBlock = useAdBlockStore((s) => s.enableAdBlock);
    const isPlaylistProxyMode = useAuthStore(
      (state) => protection?.kind !== "widevine" && isTwitchPlaylistProxyMode(state.preferences)
    );
    // Use prop if explicitly set, otherwise use store value
    const requestedEnableAdBlock = enableAdBlock && storeEnableAdBlock;
    const effectiveEnableAdBlock = !isPlaylistProxyMode && requestedEnableAdBlock;

    // Ad-block status tracking
    const [adBlockStatus, setAdBlockStatus] = useState<AdBlockStatus | null>(null);
    const [adPresentationCover, setAdPresentationCover] = useState<
      "frame" | "poster" | "placeholder" | null
    >(null);

    useLayoutEffect(() => {
      if (adPresentationCanvasRef.current) adPresentationCanvasRef.current.hidden = true;
      if (adPresentationPosterRef.current) adPresentationPosterRef.current.hidden = true;
      if (adPresentationPlaceholderRef.current) {
        adPresentationPlaceholderRef.current.hidden = true;
      }
      setAdBlockStatus(null);
      setAdPresentationCover(null);
      failedAdPresentationPosterRef.current = null;
      setHasError(false);
      setIsLoading(true);
      setIsReady(false);
      protectedProbeRef.current = "unchecked";
      protectedProbeGenerationRef.current += 1;
      setProtectedMode(null);
    }, [channelName]);

    const showAdPresentationCover = useCallback((cover: "frame" | "poster" | "placeholder") => {
      if (adPresentationCanvasRef.current) {
        adPresentationCanvasRef.current.hidden = cover !== "frame";
        adPresentationCanvasRef.current.classList.toggle("hidden", cover !== "frame");
      }
      if (adPresentationPosterRef.current) {
        adPresentationPosterRef.current.hidden = cover !== "poster";
      }
      if (adPresentationPlaceholderRef.current) {
        adPresentationPlaceholderRef.current.hidden = cover !== "placeholder";
      }
      setAdPresentationCover(cover);
    }, []);

    useLayoutEffect(() => {
      if (
        poster &&
        poster !== failedAdPresentationPosterRef.current &&
        adPresentationCover === "placeholder"
      ) {
        showAdPresentationCover("poster");
      }
    }, [adPresentationCover, poster, showAdPresentationCover]);

    const hideAdPresentationCover = useCallback(() => {
      if (adPresentationCanvasRef.current) {
        adPresentationCanvasRef.current.hidden = true;
        adPresentationCanvasRef.current.classList.add("hidden");
      }
      if (adPresentationPosterRef.current) adPresentationPosterRef.current.hidden = true;
      if (adPresentationPlaceholderRef.current) {
        adPresentationPlaceholderRef.current.hidden = true;
      }
      setAdPresentationCover(null);
    }, []);

    useLayoutEffect(() => {
      if (!isPlaylistProxyMode) return;
      hideAdPresentationCover();
      setAdBlockStatus(null);
    }, [hideAdPresentationCover, isPlaylistProxyMode]);

    const coverUnsafeAdPresentation = useCallback(() => {
      if (
        adPresentationCanvasRef.current?.hidden === false ||
        adPresentationPosterRef.current?.hidden === false ||
        adPresentationPlaceholderRef.current?.hidden === false
      ) {
        return;
      }
      const video = videoRef.current;
      const canvas = adPresentationCanvasRef.current;
      if (
        video &&
        canvas &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        try {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext("2d");
          if (context) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            showAdPresentationCover("frame");
            return;
          }
        } catch (error) {
          logger.warn("Player:Twitch:Live", "could not freeze clean frame for ad cover", {
            errorName: error instanceof Error ? error.name : "unknown",
          });
        }
      }
      showAdPresentationCover(poster ? "poster" : "placeholder");
    }, [poster, showAdPresentationCover]);

    // Persistent volume
    const { volume, isMuted, handleVolumeChange, handleToggleMute } = useVolume({
      videoRef: videoRef as React.RefObject<HTMLVideoElement>,
      initialMuted,
      watch: `${streamUrl}-${initialMuted}`, // Reset when either changes
      forcedMuted: initialMuted,
    });

    // Hooks
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const { isPip, togglePip } = usePictureInPicture(videoRef);

    // Watch for and hide any ad elements that slip through (DOM-based ad blocking)
    useAdElementObserver(effectiveEnableAdBlock);

    // State
    const [isReady, setIsReady] = useState(false);
    const [playbackIntent, setPlaybackIntent] = useState<PlaybackIntent>(() =>
      readPlaybackIntent(channelName, autoPlay)
    );
    const playbackIntentRef = useRef(playbackIntent);
    useLayoutEffect(() => {
      playbackIntentRef.current = playbackIntent;
    }, [playbackIntent]);
    useEffect(() => {
      if (protection?.kind === "widevine" || !protectedPlaybackController.isAvailable()) return;
      const unsubscribe = protectedPlaybackController.onState((state) => {
        if (state.ownerId !== protectedOwnerId) return;
        if (state.kind === "volume") {
          useVolumeStore.getState().setVolume(state.volume);
          useVolumeStore.getState().setMuted(state.muted);
          return;
        }
        if (state.kind === "action") {
          if (state.action === "back") {
            window.history.back();
            return;
          }
          if (state.action === "forward") {
            window.history.forward();
            return;
          }
          if (state.action === "tab-next" || state.action === "tab-previous") {
            const slot = containerRef.current;
            if (!slot) return;
            const candidates = [
              ...document.querySelectorAll<HTMLElement>(
                'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
              ),
            ].filter(
              (candidate) => !slot.contains(candidate) && candidate.getClientRects().length > 0
            );
            const next =
              state.action === "tab-next"
                ? (candidates.find((candidate) =>
                    Boolean(
                      slot.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING
                    )
                  ) ?? candidates[0])
                : (candidates
                    .reverse()
                    .find((candidate) =>
                      Boolean(
                        slot.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_PRECEDING
                      )
                    ) ?? candidates[0]);
            next?.focus();
            return;
          }
          onProtectedActionRef.current?.(state.action);
          return;
        }
        if (state.kind === "drag") {
          onProtectedActionRef.current?.("drag", { dx: state.dx, dy: state.dy });
          return;
        }
        if (state.kind === "fullscreen") return;
        setProtectedMode((current) => {
          if (!current) return current;
          return state.kind === "closed"
            ? { kind: "closed" }
            : { kind: "failed", reason: state.reason };
        });
      });
      return () => {
        protectedProbeGenerationRef.current += 1;
        unsubscribe();
        void protectedPlaybackController.close(protectedOwnerId);
      };
    }, [protectedOwnerId, protection?.kind]);

    useLayoutEffect(() => {
      if (protectedMode?.kind !== "opening" && protectedMode?.kind !== "opened") return;
      const element = containerRef.current;
      if (!element) return;
      let occluded = false;
      const update = () => {
        const presentation = {
          layout: occluded ? { kind: "hidden" as const } : measureProtectedPlayerLayout(element),
          presentation: compact
            ? ("mini" as const)
            : isTheater
              ? ("theater" as const)
              : ("docked" as const),
          blockerEnabled: requestedEnableAdBlock,
        };
        const key = JSON.stringify(presentation);
        if (key === protectedLayoutKeyRef.current) return Promise.resolve();
        protectedLayoutKeyRef.current = key;
        return protectedPlaybackController.present({
          ownerId: protectedOwnerId,
          revision: ++protectedLayoutRevisionRef.current,
          ...presentation,
        });
      };
      const stopLayout = observeProtectedPlayerLayout(element, () => {
        void update();
      });
      const stopOcclusion = observeProtectedPlayerOcclusion(element, (value) => {
        occluded = value;
        return update();
      });
      return () => {
        stopLayout();
        stopOcclusion();
      };
    }, [protectedMode?.kind, compact, isTheater, requestedEnableAdBlock, protectedOwnerId]);

    useEffect(() => {
      if (protectedMode?.kind === "closed" || protectedMode?.kind === "failed") {
        protectedLayoutKeyRef.current = "";
      }
    }, [protectedMode?.kind]);

    useEffect(() => {
      if (protectedMode?.kind !== "opening") return;
      if (!protectedPlaybackController.isAvailable()) return;
      let active = true;
      void protectedPlaybackController
        .open({
          ownerId: protectedOwnerId,
          channelSlug: channelName,
          muted: useVolumeStore.getState().isMuted,
          volume: useVolumeStore.getState().volume,
          blockerEnabled: requestedEnableAdBlock,
          forcedMuted: initialMuted,
        })
        .then((result) => {
          if (!active) return;
          setProtectedMode((current) => {
            if (current?.kind !== "opening") return current;
            return result.kind === "opened"
              ? { kind: "opened" }
              : { kind: "failed", reason: result.reason };
          });
        })
        .catch(() => {
          if (active) setProtectedMode({ kind: "failed", reason: "host-start-failed" });
        });
      return () => {
        active = false;
      };
    }, [channelName, requestedEnableAdBlock, initialMuted, protectedMode?.kind, protectedOwnerId]);

    useEffect(() => {
      if (protectedMode?.kind !== "opened") return;
      void protectedPlaybackController.mute(protectedOwnerId, initialMuted);
    }, [initialMuted, protectedMode?.kind, protectedOwnerId]);
    const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
    const [activeQualityId, setActiveQualityId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [hasError, setHasError] = useState(false);
    const [showVideoStats, setShowVideoStats] = useState(false);

    const autoRetryCountRef = useRef(0);
    const isRetryingRef = useRef(false);
    const retryDelayRef = useRef<CancellableSleep | null>(null);

    // Refs for stats
    const hlsRef = useRef<Hls | null>(null); // Capture Hls instance
    const [hls, setHls] = useState<Hls | null>(null);
    const [networkRecoveryRevision, setNetworkRecoveryRevision] = useState(0);
    const recoverFromNetworkError = useCallback(() => {
      retryDelayRef.current?.cancel();
      retryDelayRef.current = null;
      autoRetryCountRef.current = 0;
      isRetryingRef.current = false;
      hlsRef.current = null;
      setHls(null);
      setHasError(false);
      setIsLoading(true);
      setIsReady(false);
      setNetworkRecoveryRevision((revision) => revision + 1);
    }, []);
    usePlayerNetworkRecovery(hasError, recoverFromNetworkError);
    const timedText = useTimedText(hls, streamUrl, videoRef.current);
    const localCaptions = useLocalLiveCaptions({
      videoRef,
      sessionId: streamUrl,
      sourceKey: streamUrl,
      muted: isMuted,
      volume,
      allowLocalCaptions: protection?.kind !== "widevine",
    });

    // Track mute state before fallback mode for restoration
    const _preFallbackMuteRef = useRef<boolean>(false);

    const defaultQualityResult = useDefaultQuality(NO_QUALITY_LEVELS, "auto", ignoreQualityChange);
    const defaultQuality = defaultQualityResult?.defaultQuality ?? "auto";

    const [qualityPreference, setQualityPreference] = useState<string | null>(() =>
      shouldApplySavedQuality ? String(defaultQuality) : null
    );
    const qualitySessionKeyRef = useRef(channelName);
    const hasSeededSavedQualityRef = useRef(shouldApplySavedQuality);
    useEffect(() => {
      if (qualitySessionKeyRef.current !== channelName) {
        qualitySessionKeyRef.current = channelName;
        hasSeededSavedQualityRef.current = shouldApplySavedQuality;
        setQualityPreference(shouldApplySavedQuality ? String(defaultQuality) : null);
        setActiveQualityId(null);
        return;
      }

      if (shouldApplySavedQuality && !hasSeededSavedQualityRef.current) {
        hasSeededSavedQualityRef.current = true;
        setQualityPreference(String(defaultQuality));
      }
    }, [channelName, defaultQuality, shouldApplySavedQuality]);

    // NOTE: Muting during ads is DISABLED - we want seamless ad blocking at the HLS level
    // The network-level blocking and HLS segment stripping should handle ads silently
    // without any interruption to the user experience

    // Reset error/ready state on mount (original effect)
    useEffect(() => {
      setHasError(false);
      setIsReady(false);
    }, []);

    useEffect(() => {
      void streamUrl;
      retryDelayRef.current?.cancel();
      retryDelayRef.current = null;
      isRetryingRef.current = false;
    }, [streamUrl]);

    useEffect(
      () => () => {
        retryDelayRef.current?.cancel();
        retryDelayRef.current = null;
      },
      []
    );

    // Resume playback if Chromium auto-paused the video when the window was minimized
    useEffect(() => {
      const handleVisibilityChange = () => {
        const video = videoRef.current;
        if (!video) return;

        if (!document.hidden && playbackIntentRef.current === "playing" && video.paused) {
          video.play().catch((e) => {
            if (e.name !== "AbortError" && e.name !== "NotAllowedError") {
              logger.error("Player:Twitch:Live", "failed to resume after window restore", {
                error: e,
              });
            }
          });
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, []);

    // Setup event listeners
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handleWaiting = () => {
        setIsLoading(true);
      };
      const handlePlaying = () => {
        setIsLoading(false);
      };
      const handleRateChange = () => setPlaybackRate(video.playbackRate);

      video.addEventListener("waiting", handleWaiting);
      video.addEventListener("playing", handlePlaying);
      video.addEventListener("ratechange", handleRateChange);

      return () => {
        video.removeEventListener("waiting", handleWaiting);
        video.removeEventListener("playing", handlePlaying);
        video.removeEventListener("ratechange", handleRateChange);
      };
    }, []);

    // Volume initialization is handled by useVolume hook

    // Handlers
    const togglePlay = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      if (playbackIntent === "paused") {
        setPlaybackIntent("playing");
        persistPlaybackIntent(channelName, "playing");
        // For live streams: seek to live edge before playing
        // This ensures we're watching "live" when resuming playback
        if (video.seekable.length > 0) {
          const liveEdge = video.seekable.end(video.seekable.length - 1);
          video.currentTime = liveEdge;
        }
        video.play().catch((e) => {
          // Ignore AbortError (interrupted by load) and NotAllowedError (autoplay policy)
          if (e.name !== "AbortError" && e.name !== "NotAllowedError") {
            logger.error("Player:Twitch:Live", "play error", { error: e });
          }
        });
      } else {
        setPlaybackIntent("paused");
        persistPlaybackIntent(channelName, "paused");
        video.pause();
      }
    }, [channelName, playbackIntent]);

    const toggleMute = handleToggleMute;

    const togglePipHandler = useCallback(async () => {
      await togglePip();
    }, [togglePip]);

    const handlePlaybackRateChange = useCallback((rate: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.playbackRate = rate;
    }, []);

    const handleQualityLevels = useCallback(
      (levels: QualityLevel[]) => {
        setAvailableQualities(levels);
        setActiveQualityId(null);
        if (!isReady) {
          setIsReady(true);
          setIsLoading(false);
          onReady?.();
        }
      },
      [isReady, onReady]
    );

    const handleQualitySet = useCallback(
      (id: string) => {
        const level = availableQualities.find((qualityLevel) => qualityLevel.id === id);
        if (!level) return;
        setQualityPreference(qualityLevelToPreference(level));
        const hls = hlsRef.current;
        if (hls) {
          if (id === "auto") {
            hls.currentLevel = -1;
          } else {
            const levelIndex = Number.parseInt(id, 10);
            if (!Number.isNaN(levelIndex) && levelIndex >= 0 && levelIndex < hls.levels.length) {
              hls.currentLevel = levelIndex;
            }
          }
        }
        if (onQualityChange) {
          onQualityChange(level);
        }
      },
      [availableQualities, onQualityChange]
    );

    const handleTimedTextTrackChange = useCallback(
      (trackKey: string | null) => {
        if (trackKey === LOCAL_LIVE_CAPTION_TRACK.key) {
          void localCaptions.selectLocal();
          return;
        }
        void localCaptions.stop();
        timedText.selectTrack(trackKey);
      },
      [localCaptions, timedText]
    );
    const currentTimedTextTrackKey = localCaptions.selected
      ? LOCAL_LIVE_CAPTION_TRACK.key
      : timedText.selectedTrackKey;

    // Keyboard shortcuts
    usePlayerKeyboard({
      onTogglePlay: togglePlay,
      onToggleMute: toggleMute,
      onVolumeUp: () => handleVolumeChange((v) => v + 10),
      onVolumeDown: () => handleVolumeChange((v) => v - 10),
      onToggleFullscreen: toggleFullscreen,
      disabled: !isReady,
    });

    const isAdSubstitutionActive =
      effectiveEnableAdBlock &&
      adBlockStatus?.isActive === true &&
      (adBlockStatus.isShowingAd ||
        adBlockStatus.isStrippingSegments ||
        adBlockStatus.isUsingFallbackMode);

    const handleRegularPlaybackError = (error: PlayerError) => {
      if (recoveryManagedExternally) {
        const recoveryScheduled = onError?.(error) === true;
        setHasError(!recoveryScheduled);
        setIsLoading(recoveryScheduled);
        return;
      }

      const isRefreshableError =
        error.shouldRefresh === true ||
        error.code === "TOKEN_EXPIRED" ||
        error.code === "NO_FRAGMENTS" ||
        error.code === "STREAM_OFFLINE" ||
        error.code === "DECODER_STALL" ||
        error.code === "PLAYBACK_STALL";

      const canRetry =
        isRefreshableError &&
        onRefresh &&
        autoRetryCountRef.current < MAX_AUTO_RETRY_ATTEMPTS &&
        !isRetryingRef.current;

      if (canRetry) {
        isRetryingRef.current = true;
        autoRetryCountRef.current += 1;
        const attemptNum = autoRetryCountRef.current;
        const delay = RETRY_DELAY_BASE_MS * attemptNum;
        logger.debug("Player:Twitch:Live", "twitch error detected, auto-refreshing", {
          code: error.code,
          attempt: attemptNum,
          maxAttempts: MAX_AUTO_RETRY_ATTEMPTS,
          delayMs: delay,
        });
        setIsLoading(true);
        const retryDelay = createCancellableSleep(delay);
        retryDelayRef.current = retryDelay;
        void retryDelay.result.then((result) => {
          if (retryDelayRef.current !== retryDelay) return;
          retryDelayRef.current = null;
          if (!result.ok || !isRetryingRef.current) return;
          isRetryingRef.current = false;
          onRefresh();
        });
        return;
      }

      logger.error("Player:Twitch:Live", "player error", {
        refreshable: isRefreshableError,
        retries: autoRetryCountRef.current,
        error,
      });
      setHasError(true);
      setIsLoading(false);
      isRetryingRef.current = false;
      onError?.(error);
    };

    const handlePlaybackError = (error: PlayerError) => {
      if (protection?.kind === "widevine") {
        handleRegularPlaybackError(error);
        return;
      }
      const hasProtectedPlayback = protectedPlaybackController.isAvailable();
      if (
        protectedMode ||
        (error.code === "TOKEN_EXPIRED" && protectedProbeRef.current === "checking")
      )
        return;
      if (
        error.code !== "TOKEN_EXPIRED" ||
        protectedProbeRef.current !== "unchecked" ||
        !hasProtectedPlayback
      ) {
        handleRegularPlaybackError(error);
        return;
      }
      protectedProbeRef.current = "checking";
      const generation = protectedProbeGenerationRef.current;
      void protectedPlaybackController
        .check(channelName)
        .then((encrypted) => {
          if (
            protectedProbeGenerationRef.current !== generation ||
            protectedProbeRef.current !== "checking"
          )
            return;
          if (!encrypted) {
            protectedProbeRef.current = "not-encrypted";
            handleRegularPlaybackError(error);
            return;
          }
          retryDelayRef.current?.cancel();
          retryDelayRef.current = null;
          isRetryingRef.current = false;
          onProtectedPlaybackSelected?.();
          hideAdPresentationCover();
          setIsLoading(false);
          setHasError(false);
          setProtectedMode(
            playbackIntentRef.current === "playing" ? { kind: "opening" } : { kind: "closed" }
          );
        })
        .catch(() => {
          if (
            protectedProbeGenerationRef.current !== generation ||
            protectedProbeRef.current !== "checking"
          )
            return;
          protectedProbeRef.current = "unchecked";
          handleRegularPlaybackError(error);
        });
    };

    useEffect(() => {
      if (
        protection?.kind === "widevine" ||
        !autoPlay ||
        !streamUrl ||
        !protectedPlaybackController.isAvailable() ||
        protectedMode ||
        protectedProbeRef.current !== "unchecked"
      )
        return;
      protectedProbeRef.current = "checking";
      const generation = protectedProbeGenerationRef.current;
      let active = true;
      void protectedPlaybackController
        .check(channelName)
        .then((encrypted) => {
          if (!active || generation !== protectedProbeGenerationRef.current) return;
          if (!encrypted) {
            protectedProbeRef.current = "not-encrypted";
            return;
          }
          onProtectedPlaybackSelected?.();
          hideAdPresentationCover();
          setIsLoading(false);
          setHasError(false);
          setProtectedMode({ kind: "opening" });
        })
        .catch(() => {
          if (active && generation === protectedProbeGenerationRef.current) {
            protectedProbeRef.current = "unchecked";
          }
        });
      return () => {
        active = false;
        if (
          generation === protectedProbeGenerationRef.current &&
          protectedProbeRef.current === "checking"
        ) {
          protectedProbeRef.current = "unchecked";
          protectedProbeGenerationRef.current += 1;
        }
      };
    }, [
      autoPlay,
      channelName,
      hideAdPresentationCover,
      onProtectedPlaybackSelected,
      protectedMode,
      protection?.kind,
      streamUrl,
    ]);

    return (
      <div
        ref={containerRef}
        className={`relative w-full h-full bg-black overflow-hidden group flex flex-col justify-center ${className || ""}`}
      >
        {protectedMode?.kind === "opened" && (
          <button
            type="button"
            className="sr-only"
            aria-label="Focus player"
            onFocus={() => {
              void protectedPlaybackController.focus(protectedOwnerId);
            }}
          />
        )}
        {protectedMode && protectedMode.kind !== "opened" && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black px-5 text-center text-white">
            <p className="text-base font-semibold">
              {protectedMode.kind === "opening"
                ? t("multistream.loadingStream")
                : protectedMode.kind === "failed"
                  ? protectedMode.reason === "unsupported-platform"
                    ? t("playback.protectedWindowsOnly")
                    : protectedMode.reason === "runtime-missing"
                      ? t("playback.protectedRuntimeMissing")
                      : t("playback.streamUnavailable")
                  : t("playback.streamUnavailable")}
            </p>
            <div className="flex gap-2">
              {protectedMode.kind === "failed" && protectedMode.reason === "runtime-missing" && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    void protectedPlaybackController.installRuntime();
                  }}
                >
                  {t("playback.installWebView2Runtime")}
                </Button>
              )}
              {(protectedMode.kind === "closed" ||
                (protectedMode.kind === "failed" &&
                  protectedMode.reason !== "unsupported-platform")) && (
                <Button variant="secondary" onClick={() => setProtectedMode({ kind: "opening" })}>
                  {t("playback.retryPlayback")}
                </Button>
              )}
            </div>
          </div>
        )}
        {streamUrl && !protectedMode ? (
          <TwitchHlsPlayer
            key={networkRecoveryRevision}
            ref={videoRef}
            src={streamUrl}
            protection={protection}
            channelName={channelName}
            enableAdBlock={effectiveEnableAdBlock}
            poster={poster}
            muted={isMuted}
            volume={volume / 100}
            autoPlay={playbackIntent === "playing"}
            preferredQuality={
              shouldApplySavedQuality && !compact ? (qualityPreference ?? undefined) : undefined
            }
            onQualityLevels={handleQualityLevels}
            onActiveQualityChange={setActiveQualityId}
            onAdBlockStatusChange={(status) => {
              if (isPlaylistProxyMode) return;
              setAdBlockStatus(status);
              onAdBlockStatusChange?.(status);
            }}
            onBeforeAdPresentationShield={coverUnsafeAdPresentation}
            onCleanPresentedFrame={() => {
              retryDelayRef.current?.cancel();
              retryDelayRef.current = null;
              autoRetryCountRef.current = 0;
              isRetryingRef.current = false;
              setHasError(false);
              setIsLoading(false);
              onCleanPresentedFrame?.();
            }}
            onVerifiedCleanAdPresentation={hideAdPresentationCover}
            onError={handlePlaybackError}
            onHlsInstance={(hls: Hls | null) => {
              hlsRef.current = hls;
              setHls(hls);
            }}
            className="size-full object-contain object-center cursor-pointer"
            controls={false}
            onDoubleClick={toggleFullscreen}
          />
        ) : !streamUrl ? (
          <div className="absolute inset-0 flex items-center justify-center text-white z-0">
            <p>{t("playback.noStreamSource")}</p>
          </div>
        ) : null}

        <canvas
          ref={adPresentationCanvasRef}
          data-testid="twitch-ad-clean-frame-cover"
          aria-hidden="true"
          hidden={adPresentationCover !== "frame"}
          className={`pointer-events-none absolute inset-0 z-20 size-full object-contain ${
            adPresentationCover === "frame" ? "" : "hidden"
          }`}
        />

        <img
          ref={adPresentationPosterRef}
          src={poster}
          alt={t("playback.liveStreamAlt", {
            channel: `${channelName.charAt(0).toUpperCase()}${channelName.slice(1)}`,
          })}
          hidden={adPresentationCover !== "poster"}
          className="pointer-events-none absolute inset-0 z-20 size-full object-cover"
          onError={() => {
            failedAdPresentationPosterRef.current = poster ?? null;
            showAdPresentationCover("placeholder");
          }}
        />
        <div
          ref={adPresentationPlaceholderRef}
          data-testid="twitch-ad-placeholder-cover"
          hidden={adPresentationCover !== "placeholder"}
          className="pointer-events-none absolute inset-0 z-20 bg-[#18181b]"
        />

        {!isPlaylistProxyMode && isAdSubstitutionActive && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-3 top-3 z-40 rounded bg-black/80 px-3 py-1.5 text-sm font-medium text-white"
          >
            {adBlockStatus?.isMidroll
              ? t("playback.blockingMidrollAds")
              : t("playback.blockingAds")}
          </div>
        )}

        {/* Ad-Block Fallback Overlay - Full screen when all backup types failed */}
        {!isPlaylistProxyMode && adBlockStatus && (
          <AdBlockFallbackOverlay status={adBlockStatus} channelName={channelName} />
        )}

        {/* Centered Loading Spinner - Twitch Purple */}
        {isLoading && streamUrl && adPresentationCover === null && !isAdSubstitutionActive && (
          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
            <TwitchLoadingSpinner />
          </div>
        )}

        {hasError && streamUrl && (
          <div
            className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center"
            role="alert"
          >
            <p className="text-base font-bold text-white">{t("playback.playbackInterrupted")}</p>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              {t("playback.automaticRecoveryCouldNotRestoreThisLiveStream")}
            </p>
            {onRefresh && (
              <Button
                variant="secondary"
                onClick={() => {
                  setHasError(false);
                  setIsLoading(true);
                  onRefresh();
                }}
              >
                {t("playback.retryPlayback")}
              </Button>
            )}
          </div>
        )}

        <CaptionOverlay
          cues={[...timedText.activeCues, ...localCaptions.activeCues]}
          localHighlightColor={TWITCH_COLORS.accent}
        />

        {/* Video Stats Overlay */}
        {showVideoStats && (
          <VideoStatsOverlay
            hls={hlsRef.current}
            video={videoRef.current}
            onClose={() => setShowVideoStats(false)}
          />
        )}

        {/* Controls Overlay - Live stream (no progress bar) */}
        {streamUrl && !protectedMode && !hasError && !compact && (
          <TwitchLivePlayerControls
            isPlaying={playbackIntent === "playing"}
            isLoading={isLoading}
            volume={volume}
            muted={isMuted}
            qualities={availableQualities}
            currentQualityId={activeQualityId ?? "auto"}
            isFullscreen={isFullscreen}
            onTogglePlay={togglePlay}
            onToggleMute={toggleMute}
            onVolumeChange={handleVolumeChange}
            onQualityChange={handleQualitySet}
            onToggleFullscreen={toggleFullscreen}
            onToggleTheater={onToggleTheater}
            isTheater={isTheater}
            onTogglePip={protection?.kind === "widevine" ? undefined : togglePipHandler}
            playbackRate={playbackRate}
            onPlaybackRateChange={handlePlaybackRateChange}
            showVideoStats={showVideoStats}
            onToggleVideoStats={() => setShowVideoStats(!showVideoStats)}
            adBlockStatus={isPlaylistProxyMode ? null : adBlockStatus}
            onSeek={() => {}} // Dummy seek handler for visual progress bar
            onRefresh={onRefresh}
            timedTextTracks={timedText.tracks}
            currentTimedTextTrackKey={currentTimedTextTrackKey}
            onTimedTextTrackChange={handleTimedTextTrackChange}
            localCaptionModel={localCaptions.modelState}
            localCaptionPhase={localCaptions.phase}
            localCaptionError={localCaptions.error}
            onLocalCaptionModelDownload={localCaptions.downloadModel}
            onLocalCaptionModelCancel={localCaptions.cancelModelDownload}
            onLocalCaptionModelRemove={localCaptions.removeModel}
            onLocalCaptionRetry={localCaptions.retry}
          />
        )}
      </div>
    );
  }
);
