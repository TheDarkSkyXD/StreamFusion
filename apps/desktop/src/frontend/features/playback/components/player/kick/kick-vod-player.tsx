import type Hls from "hls.js";
import { useTranslation } from "react-i18next";
import type React from "react";
import type { Platform } from "@streamfusion/core/platform";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSeekPreview } from "@/features/playback/components/player/hooks/use-seek-preview";
import { KickLoadingSpinner } from "@/components/ui/loading-spinner";
import { logger } from "@/renderer/logging/logger";
import { resolveProxiedImageSrc } from "@/lib/proxied-image-url";
import { useSeekIntervalStore } from "@/store/seek-interval-store";

import { useDefaultQuality } from "../hooks/use-default-quality";
import { useFullscreen } from "../hooks/use-fullscreen";
import { useOnDemandSeekRecovery } from "../hooks/use-on-demand-seek-recovery";
import { usePictureInPicture } from "../hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "../hooks/use-player-keyboard";
import { useResumePlayback } from "../hooks/use-resume-playback";
import { useTimedText } from "../hooks/use-timed-text";
import { useVolume } from "../hooks/use-volume";
import type { PlayerError, QualityLevel } from "../types";
import { CaptionOverlay } from "../caption-overlay";
import type { VideoPlaybackSnapshot } from "@shared/chat-replay-types";

import { resolveKickHlsConfig } from "./kick-hls-config";
import { KickHlsPlayer } from "./kick-hls-player";
import { KickVodPlayerControls } from "./kick-vod-player-controls";

export interface KickVodPlayerProps {
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
  onPlaybackStateChange?: (snapshot: VideoPlaybackSnapshot) => void;
  subscribeToSeek?: (listener: (offsetSeconds: number) => void) => () => void;
}

export function KickVodPlayer(props: KickVodPlayerProps) {
  const { t } = useTranslation();
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
    onPlaybackStateChange,
    subscribeToSeek,
  } = props;
  const resolvedThumbnail = resolveProxiedImageSrc(thumbnail || poster) ?? undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackSnapshotRef = useRef<VideoPlaybackSnapshot>({
    currentTime: 0,
    isPlaying: autoPlay,
    playbackRate: 1,
  });
  const [hls, setHls] = useState<Hls | null>(null);
  const rewindSeconds = useSeekIntervalStore((state) => state.rewindSeconds);
  const forwardSeconds = useSeekIntervalStore((state) => state.forwardSeconds);

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
    platform: "kick" as Platform,
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
  const hlsConfig = useMemo(() => resolveKickHlsConfig(streamUrl), [streamUrl]);

  const handleSeekRecoverySettled = useCallback(() => {
    setIsLoading(false);
  }, []);
  const handleSeekRecoveryTerminal = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
    onError?.({
      code: "SEEK_TIMEOUT",
      message: t("playback.seekTimedOut"),
      fatal: true,
    });
  }, [onError, t]);
  const { commitSeek } = useOnDemandSeekRecovery({
    videoRef,
    hls,
    mediaKind: "hls-vod",
    sourceKey: streamUrl,
    onSuccess: handleSeekRecoverySettled,
    onTerminal: handleSeekRecoveryTerminal,
    onCancel: handleSeekRecoverySettled,
  });

  // Seek Preview Hook
  const { previewImage, handleSeekHover } = useSeekPreview({
    streamUrl,
    thumbnail: resolvedThumbnail,
    hlsConfig,
  });

  // Apply user's default quality preference
  useDefaultQuality(availableQualities, currentQualityId, setCurrentQualityId);

  const publishPlaybackState = useCallback(
    (next: Partial<VideoPlaybackSnapshot>) => {
      const snapshot = { ...playbackSnapshotRef.current, ...next };
      playbackSnapshotRef.current = snapshot;
      onPlaybackStateChange?.(snapshot);
    },
    [onPlaybackStateChange]
  );

  // Setup event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      setIsPlaying(true);
      publishPlaybackState({
        currentTime: video.currentTime,
        isPlaying: true,
        playbackRate: video.playbackRate,
      });
    };
    const handlePause = () => {
      setIsPlaying(false);
      publishPlaybackState({
        currentTime: video.currentTime,
        isPlaying: false,
        playbackRate: video.playbackRate,
      });
    };
    const handleVideoVolumeChange = () => {
      syncFromVideoElement();
    };
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      publishPlaybackState({ currentTime: video.currentTime });
    };
    const handleDurationChange = () => setDuration(video.duration);
    const handleProgress = () => setBuffered(video.buffered);
    const handleRateChange = () => {
      setPlaybackRate(video.playbackRate);
      publishPlaybackState({ playbackRate: video.playbackRate });
    };

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
  }, [publishPlaybackState, syncFromVideoElement]);

  // Volume initialization is handled by useVolume hook

  // Handlers
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((error) => logger.error("Player:Kick:VOD", "play failed", { error }));
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = handleToggleMute;

  const togglePipHandler = useCallback(async () => {
    await togglePip();
  }, [togglePip]);

  const handleSeek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      setIsLoading(true);
      setCurrentTime(time);
      commitSeek(time);
      video.currentTime = time;
    },
    [commitSeek]
  );

  const handleSeekBackward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    handleSeek(Math.max(0, video.currentTime - rewindSeconds));
  }, [handleSeek, rewindSeconds]);

  const handleSeekForward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const targetTime = video.currentTime + forwardSeconds;
    handleSeek(Number.isFinite(video.duration) ? Math.min(video.duration, targetTime) : targetTime);
  }, [forwardSeconds, handleSeek]);

  useEffect(() => {
    if (!subscribeToSeek) return;
    return subscribeToSeek(handleSeek);
  }, [handleSeek, subscribeToSeek]);

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
    setHasError(false);
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
    onSeekBackward: handleSeekBackward,
    onSeekForward: handleSeekForward,
    disabled: !isKeyboardReady,
  });

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full bg-black overflow-hidden group ${className || ""}`}
    >
      {streamUrl ? (
        <KickHlsPlayer
          ref={videoRef}
          src={streamUrl}
          poster={resolvedThumbnail}
          muted={isMuted}
          autoPlay={autoPlay}
          currentLevel={currentQualityId}
          onQualityLevels={handleQualityLevels}
          onHlsInstance={setHls}
          onCanPlay={handleCanPlay}
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
          <p>{t("playback.noStreamSource")}</p>
        </div>
      )}

      {/* Centered Loading Spinner - Kick Green */}
      {isLoading && streamUrl && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <KickLoadingSpinner />
        </div>
      )}

      <CaptionOverlay cues={timedText.activeCues} />

      {/* Controls Overlay - VOD with progress bar */}
      {streamUrl && !hasError && duration > 0 && (
        <KickVodPlayerControls
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
          seekBackwardSeconds={rewindSeconds}
          seekForwardSeconds={forwardSeconds}
          onSeekBackward={handleSeekBackward}
          onSeekForward={handleSeekForward}
          seekBackwardDisabled={currentTime <= 0}
          seekForwardDisabled={Number.isFinite(duration) && currentTime >= duration}
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
