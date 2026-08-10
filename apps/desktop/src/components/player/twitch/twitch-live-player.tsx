import type Hls from "hls.js";
import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { TWITCH_COLORS } from "@/assets/platforms/twitch";
import { Button } from "@/components/ui/button";
import { TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { useAdElementObserver } from "@/hooks/use-ad-element-observer";
import { createCancellableSleep, type CancellableSleep } from "@/lib/sleep";
import { logger } from "@/renderer/logging/logger";
import type { AdBlockStatus } from "@/shared/adblock-types";
import { useAdBlockStore } from "@/store/adblock-store";

import { useDefaultQuality } from "../hooks/use-default-quality";
import { useDockedPlayerConfig } from "../persistent-player-shell";
import { qualityLevelToPreference } from "../quality-preference";
import { useFullscreen } from "../hooks/use-fullscreen";
import { useLocalLiveCaptions } from "../hooks/use-local-live-captions";
import { usePictureInPicture } from "../hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "../hooks/use-player-keyboard";
import { usePlayerNetworkRecovery } from "../hooks/use-player-network-recovery";
import { useTimedText } from "../hooks/use-timed-text";
import { useVolume } from "../hooks/use-volume";
import { CaptionOverlay } from "../caption-overlay";
import { LOCAL_LIVE_CAPTION_TRACK, type PlayerError, type QualityLevel } from "../types";

import { AdBlockFallbackOverlay } from "./ad-block-fallback-overlay";
import { TwitchHlsPlayer } from "./twitch-hls-player";
import { TwitchLivePlayerControls } from "./twitch-live-player-controls";
import { VideoStatsOverlay } from "./video-stats-overlay";

const MAX_AUTO_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_BASE_MS = 1500;
const PLAYBACK_INTENT_STORAGE_PREFIX = "streamfusion:twitch-live-playback-intent:v1:";

type PlaybackIntent = "playing" | "paused";

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
}

const NO_QUALITY_LEVELS: QualityLevel[] = [];
const ignoreQualityChange = () => {};

export const TwitchLivePlayer = forwardRef<HTMLVideoElement, TwitchLivePlayerProps>(
  function TwitchLivePlayer(props, forwardedVideoRef) {
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
      onQualityChange,
      onAdBlockStatusChange,
      className,
      isTheater,
      onToggleTheater,
      enableAdBlock = true,
      onRefresh,
      recoveryManagedExternally = false,
      compact = false,
    } = props;
    const isDockedChannelSurface = useDockedPlayerConfig() !== null;
    const shouldApplySavedQuality = isDockedChannelSurface;

    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const adPresentationCanvasRef = useRef<HTMLCanvasElement>(null);
    const adPresentationPosterRef = useRef<HTMLImageElement>(null);
    const adPresentationPlaceholderRef = useRef<HTMLDivElement>(null);
    const failedAdPresentationPosterRef = useRef<string | null>(null);
    useImperativeHandle(forwardedVideoRef, () => videoRef.current as HTMLVideoElement);

    // Ad-block store setting
    const storeEnableAdBlock = useAdBlockStore((s) => s.enableAdBlock);
    // Use prop if explicitly set, otherwise use store value
    const effectiveEnableAdBlock =
      enableAdBlock !== undefined ? enableAdBlock && storeEnableAdBlock : storeEnableAdBlock;

    // Ad-block status tracking
    const [adBlockStatus, setAdBlockStatus] = useState<AdBlockStatus | null>(null);
    const [isRecoveringPlayback, setIsRecoveringPlayback] = useState(false);
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
      setIsRecoveringPlayback(false);
      setAdPresentationCover(null);
      failedAdPresentationPosterRef.current = null;
      setHasError(false);
      setIsLoading(true);
      setIsReady(false);
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
    playbackIntentRef.current = playbackIntent;
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
    const hlsRef = useRef<any>(null); // Capture Hls instance
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

    return (
      <div
        ref={containerRef}
        className={`relative w-full h-full bg-black overflow-hidden group flex flex-col justify-center ${className || ""}`}
      >
        {streamUrl ? (
          <TwitchHlsPlayer
            key={networkRecoveryRevision}
            ref={videoRef}
            src={streamUrl}
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
            onPlaybackRecoveryStateChange={setIsRecoveringPlayback}
            onVerifiedCleanAdPresentation={hideAdPresentationCover}
            onError={(error: PlayerError) => {
              if (recoveryManagedExternally) {
                const recoveryScheduled = onError?.(error) === true;
                setHasError(!recoveryScheduled);
                setIsLoading(recoveryScheduled);
                return;
              }

              // Determine if this error is recoverable via URL refresh
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
            }}
            onHlsInstance={(hls: Hls | null) => {
              hlsRef.current = hls;
              setHls(hls);
            }}
            className="size-full object-contain object-center cursor-pointer"
            controls={false}
            onDoubleClick={toggleFullscreen}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white z-0">
            <p>No Stream Source</p>
          </div>
        )}

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
          alt={`${channelName.charAt(0).toUpperCase()}${channelName.slice(1)} live stream`}
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

        {isRecoveringPlayback && !isAdSubstitutionActive && !hasError && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-3"
          >
            <span className="rounded bg-black/80 px-3 py-1.5 text-sm font-medium text-white">
              Stream interrupted — reconnecting…
            </span>
          </div>
        )}

        {isAdSubstitutionActive && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-3 top-3 z-40 rounded bg-black/80 px-3 py-1.5 text-sm font-medium text-white"
          >
            {adBlockStatus?.isMidroll ? "Blocking midroll ads" : "Blocking ads"}
          </div>
        )}

        {/* Ad-Block Fallback Overlay - Full screen when all backup types failed */}
        {adBlockStatus && (
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
            <p className="text-base font-bold text-white">Playback interrupted</p>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              Automatic recovery could not restore this live stream.
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
                Retry playback
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
        {streamUrl && !hasError && !compact && (
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
            onTogglePip={togglePipHandler}
            playbackRate={playbackRate}
            onPlaybackRateChange={handlePlaybackRateChange}
            showVideoStats={showVideoStats}
            onToggleVideoStats={() => setShowVideoStats(!showVideoStats)}
            adBlockStatus={adBlockStatus}
            onSeek={() => {}} // Dummy seek handler for visual progress bar
            onRefresh={onRefresh}
            timedTextTracks={timedText.tracks}
            localTimedTextTrack={LOCAL_LIVE_CAPTION_TRACK}
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
