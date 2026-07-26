import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { logger } from "@/renderer/logging/logger";

import { HlsPlayer } from "../hls-player";
import { useDefaultQuality } from "../hooks/use-default-quality";
import { useFullscreen } from "../hooks/use-fullscreen";
import { usePictureInPicture } from "../hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "../hooks/use-player-keyboard";
import { useResumePlayback } from "../hooks/use-resume-playback";
import { useVolume } from "../hooks/use-volume";
import type { Platform, PlayerError, QualityLevel } from "../types";

import { KickPlayerControls } from "./kick-player-controls";

export interface KickVideoPlayerProps {
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
  // Resume playback props (for VODs)
  videoId?: string;
  title?: string;
  thumbnail?: string;
}

export function KickVideoPlayer(props: KickVideoPlayerProps) {
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
    platform: "kick" as Platform,
    videoId: videoId || "",
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    title,
    thumbnail,
    enabled: !!videoId,
  });

  // State
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  // Local volume/mute state removed
  const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
  const [currentQualityId, setCurrentQualityId] = useState<string>("auto");
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<TimeRanges | undefined>(undefined);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hasError, setHasError] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | undefined>(undefined);

  // Handle seek hover to update preview image
  const handleSeekHover = useCallback(
    (time: number | null) => {
      if (time === null) {
        setPreviewImage(undefined);
        return;
      }

      // TODO: Implement frame-accurate preview fetching if Kick API supports it.
      // Currently falling back to the main video thumbnail/poster.
      // If we have a storyboard spritesheet logic, it would go here.
      if (thumbnail) {
        setPreviewImage(thumbnail);
      } else if (poster) {
        setPreviewImage(poster);
      }
    },
    [thumbnail, poster]
  );

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
      video.play().catch((error) => logger.error("Player:Kick:Video", "play failed", { error }));
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
          controls={false}
          onDoubleClick={toggleFullscreen}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white z-0">
          <p>No Stream Source</p>
        </div>
      )}

      {/* Controls Overlay - Kick themed */}
      {streamUrl && !hasError && (
        <KickPlayerControls
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
