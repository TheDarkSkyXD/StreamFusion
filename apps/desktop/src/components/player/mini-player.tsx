/**
 * MiniPlayer Component
 * Keeps one live-player surface mounted while moving it between the stream-page dock and mini mode.
 */
import { useLocation, useNavigate } from "@tanstack/react-router";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuMaximize2, LuPause, LuPlay, LuVolume2, LuVolumeX, LuX } from "react-icons/lu";

import { KickLivePlayer } from "@/components/player/kick";
import { usePlayerNetworkRecovery } from "@/components/player/hooks/use-player-network-recovery";
import { useDockedPlayerConfig } from "@/components/player/persistent-player-shell";
import { TwitchLivePlayer } from "@/components/player/twitch";
import type { PlayerError } from "@/components/player/types";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStreamPlayback } from "@/hooks/useStreamPlayback";
import { cn } from "@/lib/utils";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@/shared/auth-types";
import { useAdBlockStore } from "@/store/adblock-store";
import { usePipStore } from "@/store/pip-store";
import { useVolumeStore } from "@/store/volume-store";

// Mini player dimensions
const MINI_PLAYER_WIDTH = 400;
const MINI_PLAYER_HEIGHT = 225;
const PADDING = 16;
const MAX_REFRESH_ATTEMPTS = 2;
export function MiniPlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const dockedConfig = useDockedPlayerConfig();
  const { currentStream, closePip } = usePipStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const handleVideoRef = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    setVideoElement(video);
  }, []);

  // Ad-block store setting
  const storeEnableAdBlock = useAdBlockStore((s) => s.enableAdBlock);

  // Determine if this is a Twitch stream that needs ad-blocking
  const isTwitchStream = currentStream?.platform === "twitch";
  const isViewingStreamRoute = location.pathname.startsWith("/stream/");
  const normalizedPathname = location.pathname.replace(/\/$/, "").toLowerCase();
  const currentStreamPath = currentStream
    ? `/stream/${currentStream.platform}/${currentStream.channelName}`.toLowerCase()
    : "";
  const isDocked = isViewingStreamRoute && normalizedPathname === currentStreamPath;
  const [playerHost] = useState(() => document.createElement("div"));

  // Keep one React portal container for the lifetime of the player. Moving this
  // host between the route dock and document.body preserves the video DOM node
  // (and therefore its HLS instance and buffered media) across navigation.
  useLayoutEffect(() => {
    const target = isDocked
      ? document.getElementById("persistent-live-player-dock")
      : document.body;
    if (!target) return;

    playerHost.dataset.playerMode = isDocked ? "docked" : "mini";
    target.appendChild(playerHost);
  }, [isDocked, playerHost]);

  useEffect(() => () => playerHost.remove(), [playerHost]);

  // Resolve once for the active stream in both modes so the handoff reuses the same URL and player.
  const platform = (currentStream?.platform ?? "kick") as Platform;
  const channelName = currentStream?.channelName ?? "";
  const {
    playback,
    isLoading: isPlaybackLoading,
    error: playbackError,
    reload,
    reloadAttempts,
  } = useStreamPlayback(platform, channelName);

  // Keep the last verified URL only while its shared refresh is in flight.
  // This keeps the live wrapper/video mounted until the replacement URL
  // arrives, without falling back to the potentially expired PiP snapshot.
  const playbackIdentity = `${platform}:${channelName.toLowerCase()}`;
  const lastVerifiedPlaybackRef = useRef({ identity: playbackIdentity, url: "" });
  if (lastVerifiedPlaybackRef.current.identity !== playbackIdentity) {
    lastVerifiedPlaybackRef.current = { identity: playbackIdentity, url: "" };
  }
  if (playback?.url) lastVerifiedPlaybackRef.current.url = playback.url;
  const streamUrl = playback?.url || (isPlaybackLoading ? lastVerifiedPlaybackRef.current.url : "");

  // The live-player wrapper is the only owner that applies/synchronizes the
  // video element. Mini controls update the shared user preference only.
  const volume = useVolumeStore((state) => state.volume);
  const isMuted = useVolumeStore((state) => state.isMuted);
  const setVolume = useVolumeStore((state) => state.setVolume);
  const setMuted = useVolumeStore((state) => state.setMuted);
  const handleToggleMute = useVolumeStore((state) => state.toggleMute);
  const handleVolumeChange = useCallback(
    (nextVolume: number | ((previous: number) => number)) => {
      setVolume(nextVolume);
      const nextState = useVolumeStore.getState();
      if (nextState.volume === 0) setMuted(true);
      else if (nextState.isMuted) setMuted(false);
    },
    [setMuted, setVolume]
  );

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [isVolumeDragging, setIsVolumeDragging] = useState(false);
  // Controlled Tooltip state for the volume thumb. Pairing it with
  // `isVolumeDragging` keeps Radix in controlled mode at all times (otherwise
  // `open={isVolumeDragging || undefined}` would oscillate between controlled
  // and uncontrolled across each drag cycle and emit React's warning).
  const [volumeThumbTooltipOpen, setVolumeThumbTooltipOpen] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 0, y: 0 });
  const positionRef = useRef({
    x: Math.max(PADDING, window.innerWidth - MINI_PLAYER_WIDTH - PADDING),
    y: Math.max(PADDING + 60, window.innerHeight - MINI_PLAYER_HEIGHT - PADDING - 60),
  });
  const pendingPositionRef = useRef<{ x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const isDockedRef = useRef(isDocked);
  isDockedRef.current = isDocked;

  // Player state
  const [isPlaying, setIsPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [playerRecoveryRevision, setPlayerRecoveryRevision] = useState(0);

  // Keep the mini-player position inside the viewport after a resize.
  useEffect(() => {
    const updatePosition = () => {
      const nextPosition = {
        x: Math.max(
          PADDING,
          Math.min(window.innerWidth - MINI_PLAYER_WIDTH - PADDING, positionRef.current.x)
        ),
        y: Math.max(
          PADDING + 60,
          Math.min(window.innerHeight - MINI_PLAYER_HEIGHT - PADDING, positionRef.current.y)
        ),
      };
      positionRef.current = nextPosition;
      if (containerRef.current && !isDocked) {
        containerRef.current.style.transform = `translate3d(${nextPosition.x}px, ${nextPosition.y}px, 0)`;
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [isDocked]);

  // A queued mini-mode frame must never write its fixed-position transform
  // after the same surface has moved into the page dock.
  useLayoutEffect(() => {
    if (!isDocked) return;
    pendingPositionRef.current = null;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setIsDragging(false);
    if (containerRef.current) containerRef.current.style.transform = "";
  }, [isDocked]);

  // Reset error state whenever playback becomes available again.
  useEffect(() => {
    if (streamUrl) setHasError(false);
  }, [streamUrl]);

  useEffect(() => {
    if (!currentStream || isPlaybackLoading || playback?.url) return;
    if (playbackError) {
      logger.debug("Player:Mini", "closing PiP because playback is unavailable", {
        platform,
        channelName: currentStream.channelName,
        error: playbackError.message,
      });
      closePip();
    }
  }, [closePip, currentStream, isPlaybackLoading, platform, playback?.url, playbackError]);

  // Dragging handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isDocked) return;
      // Ignore if clicking on buttons
      if ((e.target as HTMLElement).closest("button")) return;

      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      positionStart.current = { ...positionRef.current };
      e.preventDefault();
    },
    [isDocked]
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

      pendingPositionRef.current = { x: newX, y: newY };
      if (dragFrameRef.current !== null) return;

      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        if (isDockedRef.current) return;
        const nextPosition = pendingPositionRef.current;
        if (!nextPosition) return;
        pendingPositionRef.current = null;
        positionRef.current = nextPosition;
        if (containerRef.current) {
          containerRef.current.style.transform = `translate3d(${nextPosition.x}px, ${nextPosition.y}px, 0)`;
        }
      });
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

  useEffect(
    () => () => {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    },
    []
  );

  // Video event handlers
  useEffect(() => {
    const video = videoElement;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, [videoElement]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch((error) => logger.error("Player:Mini", "play failed", { error }));
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
      search: { tab: "home" },
    });
  }, [currentStream, navigate]);

  const handleError = useCallback(
    (error: PlayerError) => {
      const shouldRefreshForLiveTwitchError =
        isTwitchStream && (error.shouldRefresh === true || error.code === "TOKEN_EXPIRED");

      if (shouldRefreshForLiveTwitchError && reloadAttempts < MAX_REFRESH_ATTEMPTS) {
        logger.debug("Player:Mini", "refreshing URL after live twitch error", {
          code: error.code,
          attempt: reloadAttempts + 1,
          maxAttempts: MAX_REFRESH_ATTEMPTS,
        });
        reload();
        return;
      }

      logger.error("Player:Mini", "player error", { error });
      setHasError(true);
    },
    [isTwitchStream, reload, reloadAttempts]
  );

  const handleConfirmedNetworkRecovery = useCallback(() => {
    setHasError(false);
    setPlayerRecoveryRevision((revision) => revision + 1);
    reload();
  }, [reload]);
  usePlayerNetworkRecovery(hasError, handleConfirmedNetworkRecovery);

  // Don't render if not active or no stream
  if (!currentStream || !streamUrl) {
    return null;
  }

  return createPortal(
    <div
      ref={containerRef}
      className={cn(
        isDocked ? "relative size-full" : "fixed z-50 rounded-xl shadow-2xl",
        "overflow-hidden",
        "bg-black border border-[var(--color-border)]",
        "transition-shadow duration-200",
        !isDocked && (isDragging ? "cursor-grabbing shadow-3xl" : "cursor-grab"),
        !isDocked && isHovered && "ring-2 ring-white/30"
      )}
      style={{
        width: isDocked ? "100%" : MINI_PLAYER_WIDTH,
        height: isDocked ? "100%" : MINI_PLAYER_HEIGHT,
        left: isDocked ? undefined : 0,
        top: isDocked ? undefined : 0,
        transform: isDocked
          ? undefined
          : `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Keep the platform live-player wrapper mounted in both modes. Only its
          controls presentation changes, so the nested video/HLS engine survives. */}
      {!hasError &&
        streamUrl &&
        (isTwitchStream ? (
          <TwitchLivePlayer
            key={`twitch:${currentStream.channelName}:${playerRecoveryRevision}`}
            ref={handleVideoRef}
            streamUrl={streamUrl}
            channelName={currentStream.channelName}
            enableAdBlock={storeEnableAdBlock}
            muted={isDocked ? (dockedConfig?.muted ?? false) : isMuted}
            autoPlay={true}
            compact={!isDocked}
            isTheater={isDocked ? dockedConfig?.isTheater : false}
            onToggleTheater={isDocked ? dockedConfig?.onToggleTheater : undefined}
            onError={isDocked && dockedConfig ? dockedConfig.onError : handleError}
            onRefresh={isDocked && dockedConfig ? dockedConfig.onRefresh : reload}
            className="size-full"
          />
        ) : (
          <KickLivePlayer
            key={`kick:${currentStream.channelName}:${playerRecoveryRevision}`}
            ref={handleVideoRef}
            streamUrl={streamUrl}
            channelName={currentStream.channelName}
            startedAt={isDocked ? dockedConfig?.startedAt : undefined}
            muted={isDocked ? (dockedConfig?.muted ?? false) : isMuted}
            autoPlay={true}
            compact={!isDocked}
            isTheater={isDocked ? dockedConfig?.isTheater : false}
            onToggleTheater={isDocked ? dockedConfig?.onToggleTheater : undefined}
            onError={isDocked && dockedConfig ? dockedConfig.onError : handleError}
            onRefresh={isDocked && dockedConfig ? dockedConfig.onRefresh : reload}
            className="size-full"
          />
        ))}

      {/* Error State */}
      {!isDocked && hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-white/70 text-sm">Stream unavailable</p>
        </div>
      )}

      {/* Controls Overlay */}
      {!isDocked && (
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
                    type="button"
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
                    type="button"
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
                <ProxiedImage
                  src={currentStream.channelAvatar}
                  alt={currentStream.channelDisplayName}
                  className="w-6 h-6 rounded-full"
                  fallback={<div className="w-6 h-6 rounded-full bg-white/10" />}
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
                      type="button"
                      onClick={togglePlay}
                      aria-label={isPlaying ? "Pause" : "Play"}
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
                          type="button"
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
                        <Tooltip
                          delayDuration={0}
                          open={isVolumeDragging || volumeThumbTooltipOpen}
                          onOpenChange={setVolumeThumbTooltipOpen}
                        >
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
      )}
    </div>,
    playerHost
  );
}

// Add volume to MiniPlayerProps if needed, but it seems to use store.
