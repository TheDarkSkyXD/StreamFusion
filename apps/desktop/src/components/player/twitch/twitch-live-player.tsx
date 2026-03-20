import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { useAdElementObserver } from "@/hooks/use-ad-element-observer";
import type { AdBlockStatus } from "@/shared/adblock-types";
import { useAdBlockStore } from "@/store/adblock-store";

import { useDefaultQuality } from "../hooks/use-default-quality";
import { useFullscreen } from "../hooks/use-fullscreen";
import { usePictureInPicture } from "../hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "../hooks/use-player-keyboard";
import { useVolume } from "../hooks/use-volume";
import type { PlayerError, QualityLevel } from "../types";

import { AdBlockFallbackOverlay } from "./ad-block-fallback-overlay";
import { TwitchHlsPlayer } from "./twitch-hls-player";
import { TwitchLivePlayerControls } from "./twitch-live-player-controls";
import { VideoStatsOverlay } from "./video-stats-overlay";

// Maximum auto-retry attempts before showing error to user
const MAX_AUTO_RETRY_ATTEMPTS = 2;
// Delay between retry attempts (exponential backoff base)
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
  // Auto-refresh callback - called when player needs a fresh URL (token expired, etc.)
  onRefresh?: () => void;
}

export function TwitchLivePlayer(props: TwitchLivePlayerProps) {
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
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Ad-block store setting
  const storeEnableAdBlock = useAdBlockStore((s) => s.enableAdBlock);
  // Use prop if explicitly set, otherwise use store value
  const effectiveEnableAdBlock =
    enableAdBlock !== undefined ? enableAdBlock && storeEnableAdBlock : storeEnableAdBlock;

  // Ad-block status tracking
  const [adBlockStatus, setAdBlockStatus] = useState<AdBlockStatus | null>(null);

  // Persistent volume
  const { volume, isMuted, handleVolumeChange, handleToggleMute, syncFromVideoElement } = useVolume(
    {
      videoRef: videoRef as React.RefObject<HTMLVideoElement>,
      initialMuted,
      watch: `${streamUrl}-${initialMuted}`, // Reset when either changes
      forcedMuted: initialMuted,
    }
  );

  // Hooks
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
  const { isPip, togglePip } = usePictureInPicture(videoRef);

  // Watch for and hide any ad elements that slip through (DOM-based ad blocking)
  useAdElementObserver(effectiveEnableAdBlock);

  // State
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
  const [currentQualityId, setCurrentQualityId] = useState<string>("auto");
  const [isLoading, setIsLoading] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hasError, setHasError] = useState(false);
  const [showVideoStats, setShowVideoStats] = useState(false);

  // Auto-retry state for handling stale tokens/URLs
  const autoRetryCountRef = useRef(0);
  const isRetryingRef = useRef(false);

  // Refs for stats
  const hlsRef = useRef<any>(null); // Capture Hls instance

  // Track mute state before fallback mode for restoration
  const _preFallbackMuteRef = useRef<boolean>(false);

  // Apply user's default quality preference
  useDefaultQuality(availableQualities, currentQualityId, setCurrentQualityId);

  // NOTE: Muting during ads is DISABLED - we want seamless ad blocking at the HLS level
  // The network-level blocking and HLS segment stripping should handle ads silently
  // without any interruption to the user experience

  // Reset error/ready state on mount (original effect)
  useEffect(() => {
    setHasError(false);
    setIsReady(false);
  }, []);

  // Reset auto-retry state when streamUrl changes (new stream)
  useEffect(() => {
    void streamUrl; // Used as dependency trigger
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
            console.error("[TwitchPlayer] Failed to resume after window restore:", e);
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
          console.error("Play error:", e);
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
      setCurrentQualityId(id);
      if (onQualityChange) {
        const level = availableQualities.find((q) => q.id === id);
        if (level) onQualityChange(level);
      }
    },
    [availableQualities, onQualityChange]
  );

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
          ref={videoRef}
          src={streamUrl}
          channelName={channelName}
          enableAdBlock={effectiveEnableAdBlock}
          poster={poster}
          muted={isMuted}
          autoPlay={autoPlay}
          currentLevel={currentQualityId}
          onQualityLevels={handleQualityLevels}
          onAdBlockStatusChange={(status) => {
            setAdBlockStatus(status);
            onAdBlockStatusChange?.(status);
          }}
          onError={(error: PlayerError) => {
            // Determine if this error is recoverable via URL refresh
            const isRefreshableError =
              error.shouldRefresh === true ||
              error.code === "NO_FRAGMENTS" ||
              error.code === "TOKEN_EXPIRED" ||
              error.code === "STREAM_OFFLINE"; // Sometimes stream "offline" is just stale URL

            // Check if we should auto-retry
            const canRetry =
              isRefreshableError &&
              onRefresh &&
              autoRetryCountRef.current < MAX_AUTO_RETRY_ATTEMPTS &&
              !isRetryingRef.current;

            if (canRetry) {
              // Mark as retrying to prevent concurrent retries
              isRetryingRef.current = true;
              autoRetryCountRef.current += 1;

              const attemptNum = autoRetryCountRef.current;
              const delay = RETRY_DELAY_BASE_MS * attemptNum; // Exponential backoff: 1.5s, 3s

              console.debug(
                `[TwitchPlayer] ${error.code} error detected, auto-retrying (attempt ${attemptNum}/${MAX_AUTO_RETRY_ATTEMPTS}) in ${delay}ms...`
              );

              // Show loading state during retry
              setIsLoading(true);

              // Wait before retrying (gives CDN time to update, prevents hammering)
              setTimeout(() => {
                if (isRetryingRef.current) {
                  isRetryingRef.current = false;
                  onRefresh(); // Request fresh playback URL from parent
                }
              }, delay);

              return; // Don't show error to user yet
            }

            // Either not a refreshable error, or retries exhausted - show error to user
            console.error(
              `[TwitchPlayer] Player error (retries: ${autoRetryCountRef.current}):`,
              error
            );
            setHasError(true);
            setIsLoading(false);
            isRetryingRef.current = false;
            onError?.(error);
          }}
          onHlsInstance={(hls: import("hls.js").default) => {
            hlsRef.current = hls;
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
      {adBlockStatus?.isShowingAd && !adBlockStatus?.isUsingFallbackMode && (
        <div className="absolute top-2 left-2 z-40 pointer-events-none">
          <span className="bg-black/80 text-white text-sm font-medium px-2 py-1 rounded">
            {adBlockStatus.isMidroll ? "Blocking midroll ads" : "Blocking ads"}
          </span>
        </div>
      )}

      {/* Ad-Block Fallback Overlay - Full screen when all backup types failed */}
      {adBlockStatus && <AdBlockFallbackOverlay status={adBlockStatus} channelName={channelName} />}

      {/* Centered Loading Spinner - Twitch Purple */}
      {isLoading && streamUrl && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <TwitchLoadingSpinner />
        </div>
      )}

      {/* Video Stats Overlay */}
      {showVideoStats && (
        <VideoStatsOverlay
          hls={hlsRef.current}
          video={videoRef.current}
          onClose={() => setShowVideoStats(false)}
        />
      )}

      {/* Controls Overlay - Live stream (no progress bar) */}
      {streamUrl && !hasError && (
        <TwitchLivePlayerControls
          isPlaying={isPlaying}
          isLoading={isLoading}
          volume={volume}
          muted={isMuted}
          qualities={availableQualities}
          currentQualityId={currentQualityId}
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
        />
      )}
    </div>
  );
}
