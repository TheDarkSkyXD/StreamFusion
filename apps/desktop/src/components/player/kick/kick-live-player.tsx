import type Hls from "hls.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { KickLoadingSpinner } from "@/components/ui/loading-spinner";

import { HlsPlayer } from "../hls-player";
import { useDefaultQuality } from "../hooks/use-default-quality";
import { useFullscreen } from "../hooks/use-fullscreen";
import { usePictureInPicture } from "../hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "../hooks/use-player-keyboard";
import { useResumePlayback } from "../hooks/use-resume-playback";
import { useVolume } from "../hooks/use-volume";
import type { Platform, PlayerError, QualityLevel } from "../types";

import { KickLivePlayerControls } from "./kick-live-player-controls";

// Maximum auto-retry attempts before showing error to user
const MAX_AUTO_RETRY_ATTEMPTS = 2;
// Delay between retry attempts (exponential backoff base)
const RETRY_DELAY_BASE_MS = 1500;

export interface KickLivePlayerProps {
  streamUrl: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  quality?: QualityLevel;
  onReady?: () => void;
  onError?: (error: PlayerError) => void;
  onQualityChange?: (quality: QualityLevel) => void;
  className?: string;
  isTheater?: boolean;
  onToggleTheater?: () => void;
  // Stream identification for resume playback
  channelName?: string;
  title?: string;
  thumbnail?: string;
  startedAt?: string | null; // Stream start time for uptime calculation, or null if unknown
  // Auto-refresh callback - called when player needs a fresh URL (token expired, etc.)
  onRefresh?: () => void;
}

export function KickLivePlayer(props: KickLivePlayerProps) {
  const {
    streamUrl,
    poster,
    autoPlay = false,
    muted: initialMuted = false,
    quality,
    onReady,
    onError,
    onQualityChange,
    className,
    isTheater,
    onToggleTheater,
    channelName,
    title,
    thumbnail,
    startedAt,
    onRefresh,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

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

  // Resume playback hook (for live streams with DVR)
  useResumePlayback({
    platform: "kick" as Platform,
    videoId: channelName ? `live-${channelName}` : "",
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    title: title || channelName,
    thumbnail,
    enabled: false, // Disabled: Always start at live edge (no DVR support)
  });

  // State
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
  const [currentQualityId, setCurrentQualityId] = useState<string>("auto");
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<TimeRanges | undefined>(undefined);
  const [seekableRange, setSeekableRange] = useState<{ start: number; end: number } | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hasError, setHasError] = useState(false);

  // Auto-retry state for handling stale tokens/URLs
  const autoRetryCountRef = useRef(0);
  const isRetryingRef = useRef(false);

  // Apply user's default quality preference
  useDefaultQuality(availableQualities, currentQualityId, setCurrentQualityId);

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
            console.error("[KickPlayer] Failed to resume after window restore:", e);
          }
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Uptime Calculation Effect
  useEffect(() => {
    if (!startedAt || !isPlaying) return;

    const updateUptime = () => {
      const now = Date.now();
      const start = new Date(startedAt).getTime();
      const uptime = (now - start) / 1000;
      const video = videoRef.current;

      // Set duration to uptime (growing constantly)
      setDuration(uptime);

      if (hlsRef.current?.playingDate) {
        // Precise absolute time from HLS Program Date Time
        const current = (hlsRef.current.playingDate.getTime() - start) / 1000;
        setCurrentTime(current);

        // Calculate seekable range in uptime coordinates
        if (video && video.seekable.length > 0) {
          const seekableStartVideo = video.seekable.start(0);
          const seekableEndVideo = video.seekable.end(video.seekable.length - 1);
          const currentVideo = video.currentTime;

          // Offset: currentUptime - currentVideoTime
          const offset = current - currentVideo;

          const calculatedStart = seekableStartVideo + offset;
          const calculatedEnd = seekableEndVideo + offset;

          setSeekableRange({
            start: calculatedStart,
            end: calculatedEnd,
          });
        }
      } else if (video && video.seekable.length > 0) {
        // Fallback: Estimate time based on "Live Edge" assumption
        // We assume video.seekable.end() is "Now" (uptime)
        const seekableEnd = video.seekable.end(video.seekable.length - 1);
        const secondsFromLive = seekableEnd - video.currentTime;
        const current = Math.max(0, uptime - secondsFromLive);
        setCurrentTime(current);

        // In this fallback model, seekable.end maps to uptime
        // So seekable.start maps to uptime - (seekable.end - seekable.start)
        const windowDuration = seekableEnd - video.seekable.start(0);
        const calculatedStart = Math.max(0, uptime - windowDuration);

        setSeekableRange({
          start: calculatedStart,
          end: uptime,
        });
      }
    };

    const interval = setInterval(updateUptime, 250); // Higher frequency for smoother UI
    return () => clearInterval(interval);
  }, [startedAt, isPlaying]);

  // Setup event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleVideoVolumeChange = () => {
      syncFromVideoElement();
    };
    const handleWait = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    // We use the interval above for time updates when startedAt is present
    const handleTimeUpdate = () => {
      if (!startedAt) {
        setCurrentTime(video.currentTime);
      }
    };
    const handleDurationChange = () => {
      // For live streams, duration might be Infinity or a large number
      const dur = video.duration;
      if (!startedAt && Number.isFinite(dur) && dur > 0) {
        setDuration(dur);
      }
    };
    const handleProgress = () => setBuffered(video.buffered);
    const handleRateChange = () => setPlaybackRate(video.playbackRate);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("volumechange", handleVideoVolumeChange);
    video.addEventListener("waiting", handleWait);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("progress", handleProgress);
    video.addEventListener("ratechange", handleRateChange);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("volumechange", handleVideoVolumeChange);
      video.removeEventListener("waiting", handleWait);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("progress", handleProgress);
      video.removeEventListener("ratechange", handleRateChange);
    };
  }, [startedAt, syncFromVideoElement]);

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

  const handleSeek = useCallback(
    (targetTime: number) => {
      const video = videoRef.current;
      if (!video) return;

      if (startedAt) {
        // Delta Seeking: Calculate difference from current UI time
        // usage: targetTime is "seconds since stream start"
        // currentTime is "seconds since stream start" (state)

        // We recalculate precise currentTime here just in case state is stale
        let currentStreamTime = currentTime;

        // If we have HLS playingDate, use it for base truth
        if (hlsRef.current?.playingDate) {
          const start = new Date(startedAt).getTime();
          currentStreamTime = (hlsRef.current.playingDate.getTime() - start) / 1000;
        } else if (video.seekable.length > 0) {
          // Fallback calculations
          const now = Date.now();
          const start = new Date(startedAt).getTime();
          const uptime = (now - start) / 1000;
          const seekableEnd = video.seekable.end(video.seekable.length - 1);
          const secondsFromLive = seekableEnd - video.currentTime;
          currentStreamTime = uptime - secondsFromLive;
        }

        const diff = targetTime - currentStreamTime;
        let newTime = video.currentTime + diff;

        // Clamp to seekable, but allow a bit of buffer
        if (video.seekable.length > 0) {
          const start = video.seekable.start(0);
          const end = video.seekable.end(video.seekable.length - 1);

          if (newTime < start) {
            newTime = start;
          }
          if (newTime > end) {
            newTime = end;
          }
        }

        video.currentTime = newTime;
      } else {
        video.currentTime = targetTime;
      }
    },
    [startedAt, currentTime]
  );

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
        // Only stop loading immediately if we are NOT auto-playing
        // If auto-playing, wait for the actual 'playing' event to clear the spinner
        if (!autoPlay) {
          setIsLoading(false);
        }
        onReady?.();
      }
    },
    [isReady, onReady, autoPlay]
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

  const handleHlsInstance = useCallback((hls: Hls) => {
    hlsRef.current = hls;
  }, []);

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
        <HlsPlayer
          ref={videoRef}
          src={streamUrl}
          poster={poster}
          muted={isMuted}
          autoPlay={autoPlay}
          currentLevel={currentQualityId}
          onQualityLevels={handleQualityLevels}
          onError={(error) => {
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
                `[KickPlayer] ${error.code} error detected, auto-retrying (attempt ${attemptNum}/${MAX_AUTO_RETRY_ATTEMPTS}) in ${delay}ms...`
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
              `[KickPlayer] Player error (retries: ${autoRetryCountRef.current}):`,
              error
            );
            setHasError(true);
            setIsLoading(false);
            isRetryingRef.current = false;
            onError?.(error);
          }}
          onHlsInstance={handleHlsInstance}
          className="size-full object-contain object-center cursor-pointer"
          controls={false}
          onDoubleClick={toggleFullscreen}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white z-0">
          <p>No Stream Source</p>
        </div>
      )}

      {/* Centered Loading Spinner - Kick Green */}
      {isLoading && streamUrl && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <KickLoadingSpinner />
        </div>
      )}

      {/* Controls Overlay - Live stream with DVR progress bar */}
      {streamUrl && !hasError && (
        <KickLivePlayerControls
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
          currentTime={currentTime}
          duration={duration}
          seekableRange={seekableRange}
          onSeek={handleSeek}
          buffered={buffered}
          playbackRate={playbackRate}
          onPlaybackRateChange={handlePlaybackRateChange}
        />
      )}
    </div>
  );
}
