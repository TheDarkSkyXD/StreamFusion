import type Hls from "hls.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSeekPreview } from "@/components/player/hooks/use-seek-preview";
import { TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { logger } from "@/renderer/logging/logger";

import { useDefaultQuality } from "../hooks/use-default-quality";
import { useFullscreen } from "../hooks/use-fullscreen";
import { usePictureInPicture } from "../hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "../hooks/use-player-keyboard";
import { useResumePlayback } from "../hooks/use-resume-playback";
import { useTimedText } from "../hooks/use-timed-text";
import { useVolume } from "../hooks/use-volume";
import type { Platform, PlayerError, QualityLevel } from "../types";
import { CaptionOverlay } from "../caption-overlay";

import { TwitchVodHlsPlayer } from "./twitch-vod-hls-player";
import { TwitchVodPlayerControls } from "./twitch-vod-player-controls";

export interface TwitchVodPlayerProps {
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
  // VOD specific
  videoId?: string;
  title?: string;
  thumbnail?: string;
  qualities?: { quality: string; url: string }[];
}

export function TwitchVodPlayer(props: TwitchVodPlayerProps) {
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
  const [hls, setHls] = useState<Hls | null>(null);

  // Persistent volume
  const { volume, isMuted, handleVolumeChange, handleToggleMute, syncFromVideoElement } = useVolume(
    {
      videoRef: videoRef as React.RefObject<HTMLVideoElement>,
      initialMuted,
    }
  );
  const timedText = useTimedText(hls, streamUrl, videoRef.current);

  // Hooks
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
  const { isPip, togglePip } = usePictureInPicture(videoRef);

  // Resume playback hook (for VODs with videoId)
  useResumePlayback({
    platform: "twitch" as Platform,
    videoId: videoId || "",
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    title,
    thumbnail,
    enabled: !!videoId,
  });

  // State
  const [readiness, setReadiness] = useState(() => ({
    source: streamUrl,
    isReady: false,
    isKeyboardReady: false,
  }));
  if (readiness.source !== streamUrl) {
    setReadiness({ source: streamUrl, isReady: false, isKeyboardReady: false });
  }
  const isReady = readiness.source === streamUrl && readiness.isReady;
  const isKeyboardReady = readiness.source === streamUrl && readiness.isKeyboardReady;
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
  const [currentQualityId, setCurrentQualityId] = useState<string>("auto");
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<TimeRanges | undefined>(undefined);
  const [playbackRate, setPlaybackRate] = useState(1);

  const [hasError, setHasError] = useState(false);

  // Seek Preview Hook
  const { previewImage, handleSeekHover } = useSeekPreview({
    streamUrl,
    thumbnail: thumbnail || poster,
  });

  // Apply user's default quality preference
  useDefaultQuality(availableQualities, currentQualityId, setCurrentQualityId);

  // Reset error state when streamUrl changes
  useEffect(() => {
    setHasError(false);
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
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handleProgress = () => setBuffered(video.buffered);
    const handleRateChange = () => setPlaybackRate(video.playbackRate);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("volumechange", handleVideoVolumeChange);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("progress", handleProgress);
    video.addEventListener("ratechange", handleRateChange);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("volumechange", handleVideoVolumeChange);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("progress", handleProgress);
      video.removeEventListener("ratechange", handleRateChange);
    };
  }, [syncFromVideoElement]);

  // Volume initialization is handled by useVolume hook

  // Handlers
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((error) => logger.error("Player:Twitch:VOD", "play failed", { error }));
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = handleToggleMute;

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
      setReadiness((current) =>
        current.source === streamUrl ? { ...current, isKeyboardReady: true } : current
      );
    },
    [streamUrl]
  );

  const handleCanPlay = useCallback(() => {
    if (isReady) return;
    setReadiness({ source: streamUrl, isReady: true, isKeyboardReady: true });
    setIsLoading(false);
    onReady?.();
  }, [isReady, onReady, streamUrl]);

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
    disabled: !isKeyboardReady,
  });

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full bg-black overflow-hidden group ${className || ""}`}
    >
      {streamUrl ? (
        <TwitchVodHlsPlayer
          ref={videoRef}
          src={streamUrl}
          poster={poster}
          muted={isMuted}
          autoPlay={autoPlay}
          currentLevel={currentQualityId}
          sources={props.qualities}
          onQualityLevels={handleQualityLevels}
          onHlsInstance={setHls}
          onCanPlay={handleCanPlay}
          onError={(error) => {
            setHasError(true);
            onError?.(error);
          }}
          className="size-full object-contain cursor-pointer"
          controls={false}
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white z-0">
          <p>No Stream Source</p>
        </div>
      )}

      {/* Centered Loading Spinner - Twitch Purple */}
      {isLoading && streamUrl && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <TwitchLoadingSpinner />
        </div>
      )}

      <CaptionOverlay cues={timedText.activeCues} />

      {/* Controls Overlay - VOD with progress bar */}
      {streamUrl && !hasError && duration > 0 && (
        <TwitchVodPlayerControls
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
          onSeek={handleSeek}
          buffered={buffered}
          playbackRate={playbackRate}
          onPlaybackRateChange={handlePlaybackRateChange}
          onSeekHover={handleSeekHover}
          previewImage={previewImage}
          timedTextTracks={timedText.tracks}
          currentTimedTextTrackKey={timedText.selectedTrackKey}
          onTimedTextTrackChange={timedText.selectTrack}
        />
      )}
    </div>
  );
}
