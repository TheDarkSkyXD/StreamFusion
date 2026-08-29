import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuMaximize,
  LuMinimize,
  LuPause,
  LuPlay,
  LuVolume1,
  LuVolume2,
  LuVolumeX,
} from "react-icons/lu";
import { TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { formatDuration } from "@/lib/utils";
import { logger } from "@/renderer/logging/logger";
import { useVolumeStore } from "@/store/volume-store";

import { resolveHlsVodBufferConfig } from "../player/hls-buffer-config";
import type { ClipPlayerProps } from "./types";

/**
 * Custom clip player component with volume control on the left
 * Supports both HLS (.m3u8) and MP4 streams
 */
export function ClipPlayer({ src, autoPlay = false, onError }: ClipPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const volumeSliderRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);

  // Persistent volume from store
  const {
    volume: storedVolume,
    isMuted: storedMuted,
    setVolume: setStoredVolume,
    setMuted: setStoredMuted,
  } = useVolumeStore();
  const [volume, setVolume] = useState(storedVolume);
  const [muted, setMuted] = useState(storedMuted);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const hideTimer = useManagedTimeout(() => setShowControls(false));

  // Initialize HLS or native video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let hls: Hls | null = null;
    const isHls = src.includes(".m3u8");
    const handleLoadedMetadata = () => {
      setIsReady(true);
      if (autoPlay)
        video.play().catch((e) =>
          logger.error("Stream:ClipPlayer", "native video play failed", {
            error: e instanceof Error ? e.message : String(e),
          })
        );
    };
    const handleNativeError = () => onError?.();

    logger.debug("Stream:ClipPlayer", "loading source", {
      sourceType: isHls ? "hls" : "native",
    });

    if (isHls && Hls.isSupported()) {
      const bufferConfig = resolveHlsVodBufferConfig();
      // Use HLS.js for HLS streams
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: bufferConfig.lowLatencyMode,
        maxBufferLength: bufferConfig.maxBufferLength,
        maxMaxBufferLength: bufferConfig.maxMaxBufferLength,
        maxBufferSize: bufferConfig.maxBufferSize,
        liveSyncDurationCount: bufferConfig.liveSyncDurationCount,
        liveMaxLatencyDurationCount: bufferConfig.liveMaxLatencyDurationCount,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 30000,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 3,
        levelLoadingRetryDelay: 1000,
        levelLoadingMaxRetryTimeout: 30000,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 30000,
        xhrSetup: (xhr, _url) => {
          xhr.withCredentials = false;
        },
      });
      hlsRef.current = hls;

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        logger.debug("Stream:ClipPlayer", "HLS manifest parsed, ready to play");
        setIsReady(true);
        if (autoPlay) {
          video.play().catch((e) =>
            logger.warn("Stream:ClipPlayer", "autoplay failed", {
              error: e instanceof Error ? e.message : String(e),
            })
          );
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        logger.error("Stream:ClipPlayer", "HLS error", {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
        });
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              logger.error("Stream:ClipPlayer", "fatal network error");
              onError?.();
              hls?.destroy();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              logger.debug("Stream:ClipPlayer", "trying to recover from media error");
              hls?.recoverMediaError();
              break;
            default:
              logger.error("Stream:ClipPlayer", "unrecoverable error");
              onError?.();
              hls?.destroy();
              break;
          }
        }
      });
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari)
      logger.debug("Stream:ClipPlayer", "using native HLS");
      video.src = src;
      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      video.addEventListener("error", handleNativeError);
    } else {
      // MP4 or other native formats
      logger.debug("Stream:ClipPlayer", "using native video playback");
      video.src = src;
      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      video.addEventListener("error", handleNativeError);
    }

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleNativeError);
      if (hls) {
        logger.debug("Stream:ClipPlayer", "destroying HLS instance");
        hls.destroy();
      }
      hlsRef.current = null;
    };
  }, [src, autoPlay, onError]);

  // Apply stored volume on mount
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = storedVolume / 100;
      video.muted = storedMuted;
    }
  }, [storedMuted, storedVolume]);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch((e) =>
        logger.error("Stream:ClipPlayer", "togglePlay play failed", {
          error: e instanceof Error ? e.message : String(e),
        })
      );
    } else {
      video.pause();
    }
  }, []);

  // Handle volume change
  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clampedVolume = Math.max(0, Math.min(100, newVolume));
      setVolume(clampedVolume);
      setStoredVolume(clampedVolume); // Persist to store
      video.volume = clampedVolume / 100;
      if (clampedVolume > 0 && muted) {
        setMuted(false);
        setStoredMuted(false);
        video.muted = false;
      }
    },
    [muted, setStoredVolume, setStoredMuted]
  );

  // Handle mute toggle
  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    setStoredMuted(video.muted); // Persist to store
  }, [setStoredMuted]);

  // Handle seek
  const handleSeek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
  }, []);

  // Handle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration);
    const onVolumeChange = () => {
      const newVol = video.volume * 100;
      setVolume(newVol);
      setMuted(video.muted);
      setStoredVolume(newVol);
      setStoredMuted(video.muted);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("volumechange", onVolumeChange);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("volumechange", onVolumeChange);
    };
  }, [setStoredVolume, setStoredMuted]);

  // Auto-hide controls
  useEffect(() => {
    const handleMouseMove = () => {
      setShowControls(true);
      if (isPlaying) {
        hideTimer.start(3000);
      } else {
        hideTimer.clear();
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("mousemove", handleMouseMove);
      return () => container.removeEventListener("mousemove", handleMouseMove);
    }
  }, [isPlaying, hideTimer]);

  // Get volume icon
  const getVolumeIcon = () => {
    if (muted || volume === 0) return <LuVolumeX className="w-6 h-6" />;
    if (volume < 50) return <LuVolume1 className="w-6 h-6" />;
    return <LuVolume2 className="w-6 h-6" />;
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black group" onClick={togglePlay}>
      <video ref={videoRef} className="w-full h-full object-contain" playsInline />

      {/* Loading indicator - Twitch Purple circle */}
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center">
          <TwitchLoadingSpinner />
        </div>
      )}

      {/* Custom Controls */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent pt-12 pb-3 px-4 transition-opacity duration-300 ${showControls || !isPlaying ? "opacity-100" : "opacity-0"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress Bar */}
        <div className="w-full mb-2">
          <input
            type="range"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="w-full h-1 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between">
          {/* Left: LuPlay + Volume */}
          <div className="flex items-center gap-3">
            {/* LuPlay/LuPause Button */}
            <button
              className="text-white hover:text-white/80 transition-colors"
              onClick={togglePlay}
            >
              {isPlaying ? (
                <LuPause className="w-6 h-6 fill-white" />
              ) : (
                <LuPlay className="w-6 h-6 fill-white" />
              )}
            </button>

            {/* Volume Control - ON THE LEFT */}
            <div className="flex items-center gap-2 group/volume">
              <button
                className="text-white hover:text-white/80 transition-colors"
                onClick={toggleMute}
              >
                {getVolumeIcon()}
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 flex items-center ${isDraggingVolume ? "w-20" : "w-0 group-hover/volume:w-20"}`}
              >
                {/* Custom slider with visible thumb and drag support */}
                <div
                  ref={volumeSliderRef}
                  className="relative w-full h-4 flex items-center cursor-pointer select-none"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setIsDraggingVolume(true);
                    const rect = e.currentTarget.getBoundingClientRect();
                    const percent = Math.max(
                      0,
                      Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)
                    );
                    handleVolumeChange(percent);

                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      const movePercent = Math.max(
                        0,
                        Math.min(100, ((moveEvent.clientX - rect.left) / rect.width) * 100)
                      );
                      handleVolumeChange(movePercent);
                    };

                    const handleMouseUp = () => {
                      setIsDraggingVolume(false);
                      document.removeEventListener("mousemove", handleMouseMove);
                      document.removeEventListener("mouseup", handleMouseUp);
                    };

                    document.addEventListener("mousemove", handleMouseMove);
                    document.addEventListener("mouseup", handleMouseUp);
                  }}
                >
                  {/* Track background */}
                  <div className="absolute w-full h-1 bg-white/30 rounded-full" />
                  {/* Filled track */}
                  <div
                    className="absolute h-1 bg-white rounded-full"
                    style={{ width: `${muted ? 0 : volume}%` }}
                  />
                  {/* Thumb (white circle) - positioned to stay within bounds */}
                  <div
                    className="absolute w-3 h-3 bg-white rounded-full shadow-md cursor-pointer"
                    style={{
                      left: `calc(${(muted ? 0 : volume) / 100} * (100% - 12px))`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Time Display */}
            <div className="text-white text-xs font-mono select-none">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </div>
          </div>

          {/* Right: Fullscreen */}
          <div className="flex items-center gap-2">
            <button
              className="text-white hover:text-white/80 transition-colors"
              onClick={toggleFullscreen}
            >
              {isFullscreen ? (
                <LuMinimize className="w-6 h-6" />
              ) : (
                <LuMaximize className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
