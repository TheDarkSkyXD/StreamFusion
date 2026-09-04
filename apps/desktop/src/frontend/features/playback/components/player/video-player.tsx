import type React from "react";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Platform } from "@streamfusion/core/platform";

import { useSeekPreview } from "@/features/playback/components/player/hooks/use-seek-preview";
import { logger } from "@/renderer/logging/logger";

import { HlsPlayer } from "./hls-player";
import { useDefaultQuality } from "./hooks/use-default-quality";
import { useFullscreen } from "./hooks/use-fullscreen";
import { usePictureInPicture } from "./hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "./hooks/use-player-keyboard";
import { useResumePlayback } from "./hooks/use-resume-playback";
import { useVolume } from "./hooks/use-volume";
import { PlayerControls } from "./player-controls";
import type { PlayerError, QualityLevel } from "./types";

export interface VideoPlayerProps {
  streamUrl: string;
  platform: Platform;
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
  // Resume playback props (for VODs)
  videoId?: string;
  title?: string;
  thumbnail?: string;
}

export function VideoPlayer(props: VideoPlayerProps) {
  const { t } = useTranslation();
  const {
    streamUrl,
    platform,
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
    videoId,
    title,
    thumbnail,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Hooks
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
  const { isPip, togglePip } = usePictureInPicture(videoRef);

  // Persistent Volume Management
  const {
    volume,
    isMuted,
    handleVolumeChange: setVolume,
    handleToggleMute: toggleMute,
    syncFromVideoElement,
  } = useVolume({
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    initialMuted,
    watch: streamUrl,
  });

  // Resume playback hook (only for VODs with videoId)
  useResumePlayback({
    platform,
    videoId: videoId || "",
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    title,
    thumbnail,
    enabled: !!videoId,
  });

  // State
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  // Local volume/mute state removed in favor of useVolume
  const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
  const [currentQualityId, setCurrentQualityId] = useState<string>("auto");
  const [isLoading, setIsLoading] = useState(true); // Initial load
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<TimeRanges | undefined>(undefined);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hasError, setHasError] = useState(false); // Track if player has errored
  const { previewImage, handleSeekHover } = useSeekPreview({ streamUrl });

  // Apply user's default quality preference
  useDefaultQuality(availableQualities, currentQualityId, setCurrentQualityId);

  // Reset error state when streamUrl changes
  useEffect(() => {
    setHasError(false);
  }, []);

  // Sync state with video element
  const _syncState = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsPlaying(!video.paused);
    syncFromVideoElement();
  }, [syncFromVideoElement]);

  // Setup event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleVolumeChange = () => {
      syncFromVideoElement();
    };
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handleProgress = () => setBuffered(video.buffered);
    const handleRateChange = () => setPlaybackRate(video.playbackRate);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("volumechange", handleVolumeChange);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("progress", handleProgress);
    video.addEventListener("ratechange", handleRateChange);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("volumechange", handleVolumeChange);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("progress", handleProgress);
      video.removeEventListener("ratechange", handleRateChange);
    };
  }, [syncFromVideoElement]);

  // Handlers
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((error) => logger.error("Player:Video", "play failed", { error }));
    } else {
      video.pause();
    }
  }, []);

  const togglePipHandler = useCallback(async () => {
    await togglePip();
  }, [togglePip]);

  const handleSeek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(time);
    video.currentTime = time;
  }, []);

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
    onVolumeUp: () => setVolume((v) => v + 10),
    onVolumeDown: () => setVolume((v) => v - 10),
    onToggleFullscreen: toggleFullscreen,
    disabled: !isReady,
  });

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full bg-black overflow-hidden group ${className || ""}`}
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
            setHasError(true);
            onError?.(error);
          }}
          className="size-full object-contain cursor-pointer"
          controls={false} // Disable native controls
          onDoubleClick={toggleFullscreen} // Double click to fullscreen
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white z-0">
          <p>{t("playback.noStreamSource")}</p>
        </div>
      )}

      {/* Controls Overlay - Only show when stream is available and no error */}
      {streamUrl && !hasError && (
        <PlayerControls
          isPlaying={isPlaying}
          isLoading={isLoading}
          volume={volume}
          muted={isMuted}
          qualities={availableQualities}
          currentQualityId={currentQualityId}
          isFullscreen={isFullscreen}
          onTogglePlay={togglePlay}
          onToggleMute={toggleMute}
          onVolumeChange={setVolume}
          onQualityChange={handleQualitySet}
          onToggleFullscreen={toggleFullscreen}
          onToggleTheater={onToggleTheater}
          isTheater={isTheater}
          onTogglePip={togglePipHandler}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          buffered={buffered}
          playbackRate={playbackRate}
          onPlaybackRateChange={handlePlaybackRateChange}
          onSeekHover={handleSeekHover}
          previewImage={previewImage}
        />
      )}
    </div>
  );
}
