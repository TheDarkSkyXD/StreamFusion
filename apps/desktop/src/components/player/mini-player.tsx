/**
 * MiniPlayer Component
 * A draggable, persistent mini-player for live streams that appears when navigating away from a stream
 */
import { useNavigate } from "@tanstack/react-router";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuMaximize2, LuPause, LuPlay, LuVolume2, LuVolumeX, LuX } from "react-icons/lu";

import { HlsPlayer } from "@/components/player/hls-player";
import { TwitchHlsPlayer } from "@/components/player/twitch/twitch-hls-player";
import type { PlayerError } from "@/components/player/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStreamPlayback } from "@/hooks/useStreamPlayback";
import { cn } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";
import { useAdBlockStore } from "@/store/adblock-store";
import { usePipStore } from "@/store/pip-store";

import { useVolume } from "./hooks/use-volume";

// Mini player dimensions
const MINI_PLAYER_WIDTH = 400;
const MINI_PLAYER_HEIGHT = 225;
const PADDING = 16;
// Max URL-refresh attempts before giving up and closing PiP
const MAX_REFRESH_ATTEMPTS = 2;

export function MiniPlayer() {
  const navigate = useNavigate();
  const { currentStream, isPipActive, closePip, isOnStreamPage } = usePipStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Ad-block store setting
  const storeEnableAdBlock = useAdBlockStore((s) => s.enableAdBlock);

  // Determine if this is a Twitch stream that needs ad-blocking
  const isTwitchStream = currentStream?.platform === "twitch";

  // Fetch a fresh playback URL for the mini player. The URL stored in the pip
  // store is a snapshot from when the user was on the stream page; its JWT
  // token expires after ~30-90 minutes. We refetch independently so the mini
  // player can survive past that expiry. When the mini player is hidden (no
  // currentStream, or user is on the stream page) we pass an empty channel
  // name which short-circuits the fetch.
  const platform = (currentStream?.platform ?? "kick") as Platform;
  const channelName = !isOnStreamPage && currentStream ? currentStream.channelName : "";
  const { playback, reload, reloadAttempts } = useStreamPlayback(platform, channelName);

  // Prefer the freshly-fetched URL; fall back to the snapshot until the first
  // fetch resolves so playback starts as quickly as possible.
  const streamUrl = playback?.url || currentStream?.streamUrl || "";

  // Persistent volume
  const { isMuted, handleToggleMute, syncFromVideoElement, volume, handleVolumeChange } = useVolume(
    {
      videoRef: videoRef as React.RefObject<HTMLVideoElement>,
      watch: streamUrl,
    }
  );

  // Dragging state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isVolumeDragging, setIsVolumeDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 0, y: 0 });

  // Player state
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Initialize position to bottom-right corner
  useEffect(() => {
    const updatePosition = () => {
      setPosition({
        x: window.innerWidth - MINI_PLAYER_WIDTH - PADDING,
        y: window.innerHeight - MINI_PLAYER_HEIGHT - PADDING - 60, // Account for title bar
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, []);

  // Reset error state whenever a fresh URL arrives (e.g. after a reload())
  useEffect(() => {
    if (streamUrl) setHasError(false);
  }, [streamUrl]);

  // Dragging handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Ignore if clicking on buttons
      if ((e.target as HTMLElement).closest("button")) return;

      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      positionStart.current = { ...position };
      e.preventDefault();
    },
    [position]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      // Calculate new position with bounds checking
      const newX = Math.max(
        PADDING,
        Math.min(window.innerWidth - MINI_PLAYER_WIDTH - PADDING, positionStart.current.x + dx)
      );
      const newY = Math.max(
        PADDING + 60,
        Math.min(window.innerHeight - MINI_PLAYER_HEIGHT - PADDING, positionStart.current.y + dy)
      );

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleVolumeChange = () => syncFromVideoElement();

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("volumechange", handleVolumeChange);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("volumechange", handleVolumeChange);
    };
  }, [syncFromVideoElement]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(console.error);
    } else {
      video.pause();
    }
  }, []);

  const handleExpand = useCallback(() => {
    if (!currentStream) return;

    // Navigate back to the stream page
    navigate({
      to: "/stream/$platform/$channel",
      params: {
        platform: currentStream.platform,
        channel: currentStream.channelName,
      },
      search: { tab: "videos" },
    });
  }, [currentStream, navigate]);

  const handleError = useCallback(
    (error: PlayerError) => {
      // Treat 403/404/token-expired errors as a stale URL first: ask the
      // backend for a fresh playback URL and let HlsPlayer re-init. Only after
      // MAX_REFRESH_ATTEMPTS exhausted do we assume the stream is truly gone.
      const isRefreshable =
        error.code === "STREAM_OFFLINE" ||
        error.code === "TOKEN_EXPIRED" ||
        error.code === "NO_FRAGMENTS" ||
        error.shouldRefresh === true;

      if (isRefreshable && reloadAttempts < MAX_REFRESH_ATTEMPTS) {
        console.debug(
          `[MiniPlayer] ${error.code} - refreshing URL (attempt ${reloadAttempts + 1}/${MAX_REFRESH_ATTEMPTS})`
        );
        reload();
        return;
      }

      console.error("[MiniPlayer] Error (refresh exhausted):", error);
      setHasError(true);
      if (error.code === "STREAM_OFFLINE") {
        closePip();
      }
    },
    [closePip, reload, reloadAttempts]
  );

  // Don't render if not active or no stream
  if (!isPipActive || !currentStream || isOnStreamPage) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed z-50 rounded-xl overflow-hidden shadow-2xl",
        "bg-black border border-[var(--color-border)]",
        "transition-shadow duration-200",
        isDragging ? "cursor-grabbing shadow-3xl" : "cursor-grab",
        isHovered && "ring-2 ring-white/30"
      )}
      style={{
        width: MINI_PLAYER_WIDTH,
        height: MINI_PLAYER_HEIGHT,
        left: position.x,
        top: position.y,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Video Player - Use TwitchHlsPlayer for Twitch (ad-blocking), HlsPlayer for others */}
      {!hasError &&
        streamUrl &&
        (isTwitchStream ? (
          <TwitchHlsPlayer
            ref={videoRef}
            src={streamUrl}
            channelName={currentStream.channelName}
            enableAdBlock={storeEnableAdBlock}
            muted={isMuted}
            volume={volume / 100}
            autoPlay={true}
            currentLevel="auto"
            onError={handleError}
            className="w-full h-full object-contain"
            controls={false}
          />
        ) : (
          <HlsPlayer
            ref={videoRef}
            src={streamUrl}
            muted={isMuted}
            volume={volume / 100}
            autoPlay={true}
            currentLevel="auto"
            onError={handleError}
            className="w-full h-full object-contain"
            controls={false}
          />
        ))}

      {/* Error State */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-white/70 text-sm">Stream unavailable</p>
        </div>
      )}

      {/* Controls Overlay */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/50",
          "transition-opacity duration-200",
          isHovered ? "opacity-100" : "opacity-0"
        )}
      >
        {/* Top Bar - Close & Expand */}
        <div className="absolute top-0 left-0 right-0 p-2 flex justify-between items-start">
          <div className="flex items-center gap-2">
            {/* Live indicator */}
            <span className="flex items-center gap-1.5 bg-red-600 px-2 py-0.5 rounded text-xs font-bold text-white">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              LIVE
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleExpand}
                  className="p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
                >
                  <LuMaximize2 size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent container={containerRef.current}>Expand</TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={closePip}
                  className="p-1.5 rounded-full bg-black/50 hover:bg-red-500/80 text-white transition-colors"
                >
                  <LuX size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent container={containerRef.current}>Close</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Bottom Bar - Stream Info & Controls */}
        <div className="absolute bottom-0 left-0 right-0 p-2">
          {/* Stream Info */}
          <div className="flex items-center gap-2 mb-2">
            {currentStream.channelAvatar && (
              <img
                src={currentStream.channelAvatar}
                alt={currentStream.channelDisplayName}
                className="w-6 h-6 rounded-full"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">
                {currentStream.channelDisplayName}
              </p>
              {currentStream.categoryName && (
                <p className="text-white/60 text-xs truncate">{currentStream.categoryName}</p>
              )}
            </div>
          </div>

          {/* Playback Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={togglePlay}
                    className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
                  >
                    {isPlaying ? <LuPause size={16} /> : <LuPlay size={16} />}
                  </button>
                </TooltipTrigger>
                <TooltipContent container={containerRef.current}>
                  {isPlaying ? "Pause" : "Play"}
                </TooltipContent>
              </Tooltip>

              {/* Volume Control */}
              <div
                className="flex items-center group/volume"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(true)}
              >
                <div className="flex items-center" onMouseEnter={() => {}}>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleMute();
                        }}
                        className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors z-10"
                      >
                        {isMuted ? <LuVolumeX size={16} /> : <LuVolume2 size={16} />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent container={containerRef.current}>
                      {isMuted ? "Unmute" : "Mute"}
                    </TooltipContent>
                  </Tooltip>

                  <div className="w-0 group-hover/volume:w-20 group-hover/volume:ml-2 group-hover/volume:opacity-100 opacity-0 overflow-hidden transition-all duration-300 ease-out">
                    <div
                      className="relative w-20 h-4 flex items-center cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setIsVolumeDragging(true);

                        // Capture rect immediately to avoid e.currentTarget being null in event listeners
                        const rect = e.currentTarget.getBoundingClientRect();

                        const updateVolume = (clientX: number) => {
                          const percent = Math.max(
                            0,
                            Math.min(100, ((clientX - rect.left) / rect.width) * 100)
                          );
                          handleVolumeChange(percent);
                        };

                        updateVolume(e.clientX);

                        const handleMouseMove = (moveEvent: MouseEvent) => {
                          updateVolume(moveEvent.clientX);
                        };

                        const handleMouseUp = () => {
                          setIsVolumeDragging(false);
                          document.removeEventListener("mousemove", handleMouseMove);
                          document.removeEventListener("mouseup", handleMouseUp);
                        };

                        document.addEventListener("mousemove", handleMouseMove);
                        document.addEventListener("mouseup", handleMouseUp);
                      }}
                    >
                      {/* Track */}
                      <div className="absolute w-full h-1 bg-white/30 rounded-full" />
                      {/* Fill */}
                      <div
                        className="absolute h-1 bg-white rounded-full"
                        style={{ width: `${isMuted ? 0 : volume}%` }}
                      />
                      {/* Thumb */}
                      <Tooltip delayDuration={0} open={isVolumeDragging || undefined}>
                        <TooltipTrigger asChild>
                          <div
                            className="absolute w-3 h-3 bg-white rounded-full shadow-sm"
                            style={{ left: `calc(${isMuted ? 0 : volume}% - 6px)` }}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>{Math.round(isMuted ? 0 : volume)}%</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Viewer count */}
            {currentStream.viewerCount !== undefined && (
              <span className="text-white/60 text-xs ml-auto">
                {currentStream.viewerCount.toLocaleString()} viewers
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Add volume to MiniPlayerProps if needed, but it seems to use store.
