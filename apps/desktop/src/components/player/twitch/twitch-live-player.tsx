import type Hls from "hls.js";
import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { TWITCH_COLORS } from "@/assets/platforms/twitch";
import { TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { useAdElementObserver } from "@/hooks/use-ad-element-observer";
import { sleep } from "@/lib/sleep";
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

export interface TwitchLivePlayerProps {
  streamUrl: string;
  channelName: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  quality?: QualityLevel;
  onReady?: () => void;
  onError?: (error: PlayerError) => void;
  onQualityChange?: (quality: QualityLevel) => void;
  onAdBlockStatusChange?: (status: AdBlockStatus) => void;
  className?: string;
  isTheater?: boolean;
  onToggleTheater?: () => void;
  enableAdBlock?: boolean;
  // Error/ad-block recovery refresh callback.
  onRefresh?: () => void;
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
      onQualityChange,
      onAdBlockStatusChange,
      className,
      isTheater,
      onToggleTheater,
      enableAdBlock = true,
      onRefresh,
      compact = false,
    } = props;
    const isDockedChannelSurface = useDockedPlayerConfig() !== null;
    const shouldApplySavedQuality = isDockedChannelSurface;

    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    useImperativeHandle(forwardedVideoRef, () => videoRef.current as HTMLVideoElement);

    // Ad-block store setting
    const storeEnableAdBlock = useAdBlockStore((s) => s.enableAdBlock);
    // Use prop if explicitly set, otherwise use store value
    const effectiveEnableAdBlock =
      enableAdBlock !== undefined ? enableAdBlock && storeEnableAdBlock : storeEnableAdBlock;

    // Ad-block status tracking
    const [adBlockStatus, setAdBlockStatus] = useState<AdBlockStatus | null>(null);

    // Persistent volume
    const { volume, isMuted, handleVolumeChange, handleToggleMute, syncFromVideoElement } =
      useVolume({
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
    const [isPlaying, setIsPlaying] = useState(autoPlay);
    const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
    const [activeQualityId, setActiveQualityId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [hasError, setHasError] = useState(false);
    const [showVideoStats, setShowVideoStats] = useState(false);

    const autoRetryCountRef = useRef(0);
    const isRetryingRef = useRef(false);

    // Refs for stats
    const hlsRef = useRef<any>(null); // Capture Hls instance
    const [hls, setHls] = useState<Hls | null>(null);
    const [networkRecoveryRevision, setNetworkRecoveryRevision] = useState(0);
    const recoverFromNetworkError = useCallback(() => {
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
      autoRetryCountRef.current = 0;
      isRetryingRef.current = false;
    }, [streamUrl]);

    // Resume playback if Chromium auto-paused the video when the window was minimized
    useEffect(() => {
      let wasPlaying = false;

      const handleVisibilityChange = () => {
        const video = videoRef.current;
        if (!video) return;

        if (document.hidden) {
          wasPlaying = !video.paused;
        } else if (wasPlaying) {
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

      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      const handleVideoVolumeChange = () => {
        syncFromVideoElement();
      };
      const handleWaiting = () => setIsLoading(true);
      const handlePlaying = () => setIsLoading(false);
      const handleRateChange = () => setPlaybackRate(video.playbackRate);

      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      video.addEventListener("volumechange", handleVideoVolumeChange);
      video.addEventListener("waiting", handleWaiting);
      video.addEventListener("playing", handlePlaying);
      video.addEventListener("ratechange", handleRateChange);

      return () => {
        video.removeEventListener("play", handlePlay);
        video.removeEventListener("pause", handlePause);
        video.removeEventListener("volumechange", handleVideoVolumeChange);
        video.removeEventListener("waiting", handleWaiting);
        video.removeEventListener("playing", handlePlaying);
        video.removeEventListener("ratechange", handleRateChange);
      };
    }, [syncFromVideoElement]);

    // Volume initialization is handled by useVolume hook

    // Handlers
    const togglePlay = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
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
        video.pause();
      }
    }, []);

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
            autoPlay={autoPlay}
            preferredQuality={
              shouldApplySavedQuality && !compact ? (qualityPreference ?? undefined) : undefined
            }
            onQualityLevels={handleQualityLevels}
            onActiveQualityChange={setActiveQualityId}
            onAdBlockStatusChange={(status) => {
              setAdBlockStatus(status);
              onAdBlockStatusChange?.(status);
            }}
            onAdBlockRecoveryRefresh={onRefresh}
            onError={(error: PlayerError) => {
              // Determine if this error is recoverable via URL refresh
              const isRefreshableError = error.code === "TOKEN_EXPIRED";
              const isAdBlockHoldablePlaybackError =
                error.code === "NO_FRAGMENTS" || error.code === "STREAM_OFFLINE";
              const isAdBlockHoldingPlayback =
                effectiveEnableAdBlock &&
                !!adBlockStatus &&
                (adBlockStatus.isShowingAd ||
                  adBlockStatus.isStrippingSegments ||
                  adBlockStatus.isUsingFallbackMode);

              if (
                (isRefreshableError || isAdBlockHoldablePlaybackError) &&
                isAdBlockHoldingPlayback
              ) {
                logger.debug("Player:Twitch:Live", "suppressing refresh while adblock is active", {
                  code: error.code,
                });
                setIsLoading(false);
                return;
              }

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

                void sleep(delay).then(() => {
                  if (isRetryingRef.current) {
                    isRetryingRef.current = false;
                    onRefresh();
                  }
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
            onHlsInstance={(hls: Hls) => {
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

        {/* Ad-Block Status Overlay - Top Left */}
        {adBlockStatus?.isActive &&
          (adBlockStatus.isShowingAd ||
            adBlockStatus.isStrippingSegments ||
            adBlockStatus.isUsingFallbackMode) && (
            <div
              role="status"
              aria-live="polite"
              className="absolute top-2 left-2 z-40 bg-black/80 text-white text-sm font-medium px-2 py-1 rounded pointer-events-none"
            >
              {adBlockStatus.isMidroll ? "Blocking midroll ads" : "Blocking ads"}
            </div>
          )}

        {/* Ad-Block Fallback Overlay - Full screen when all backup types failed */}
        {adBlockStatus && (
          <AdBlockFallbackOverlay status={adBlockStatus} channelName={channelName} />
        )}

        {/* Centered Loading Spinner - Twitch Purple */}
        {isLoading && streamUrl && (
          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
            <TwitchLoadingSpinner />
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
            isPlaying={isPlaying}
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
