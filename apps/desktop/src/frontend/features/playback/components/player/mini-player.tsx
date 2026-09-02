/**
 * MiniPlayer Component
 * Keeps one live-player surface mounted while moving it between the stream-page dock and mini mode.
 */
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuMaximize2, LuPause, LuPlay, LuVolume2, LuVolumeX, LuX } from "react-icons/lu";

import { KickLivePlayer } from "@/features/playback/components/player/kick/kick-live-player";
import { usePlayerNetworkRecovery } from "@/features/playback/components/player/hooks/use-player-network-recovery";
import { useTwitchLiveRecovery } from "@/features/playback/components/player/hooks/use-twitch-live-recovery";
import { OfflineOverlay } from "@/features/playback/components/player/offline-overlay";
import { useDockedPlayerConfig } from "@/features/playback/components/player/persistent-player-shell";
import { TwitchLivePlayer } from "@/features/playback/components/player/twitch/twitch-live-player";
import type { PlayerError } from "@/features/playback/components/player/types";
import { Button } from "@/components/ui/button";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStreamByChannel } from "@/features/discovery/data/queries/useStreams";
import { useStreamPlayback } from "@/features/playback/data/useStreamPlayback";
import { cn } from "@/lib/utils";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@shared/auth-types";
import { useAdBlockStore } from "@/store/adblock-store";
import { usePipStore } from "@/store/pip-store";
import { useVolumeStore } from "@/store/volume-store";

// Mini player dimensions
const MINI_PLAYER_WIDTH = 400;
const MINI_PLAYER_HEIGHT = 225;
const PADDING = 16;
const MAX_REFRESH_ATTEMPTS = 2;

function getPlayerErrorStatusCode(error: PlayerError): number | null {
  if (!error.originalError || typeof error.originalError !== "object") return null;

  const originalError = error.originalError as {
    response?: { code?: unknown; status?: unknown };
    networkDetails?: { status?: unknown };
  };
  const statusCode =
    originalError.response?.code ??
    originalError.response?.status ??
    originalError.networkDetails?.status;
  return typeof statusCode === "number" ? statusCode : null;
}

function shouldRefreshMiniPlayback(error: PlayerError): boolean {
  if (error.shouldRefresh === true || error.code === "TOKEN_EXPIRED") return true;
  if (error.code !== "STREAM_OFFLINE") return false;

  const statusCode = getPlayerErrorStatusCode(error);
  return statusCode !== 403 && statusCode !== 404;
}

function isConfirmedOfflinePlayerError(error: PlayerError): boolean {
  if (error.shouldRefresh === true) return false;
  if (error.code !== "STREAM_OFFLINE") return false;
  const statusCode = getPlayerErrorStatusCode(error);
  return statusCode === 403 || statusCode === 404;
}

function isExplicitPlaybackUnavailable(error: Error | null): boolean {
  if (!error) return false;
  const message = error.message.trim().toLowerCase();
  return (
    message === "channel is offline" ||
    message.startsWith("channel not found") ||
    message === "no stream token found. the channel might be offline."
  );
}

function normalizeChannelName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function MiniPlayer() {
  const { t } = useTranslation();
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
  const isExclusiveMediaRoute =
    location.pathname.startsWith("/video/") || location.pathname === "/multistream";
  // Stream-to-stream navigation updates the route before the new stream has
  // finished replacing the active player snapshot. Treat every stream route
  // as docked so that brief identity mismatch cannot flash mini mode.
  const isDocked = isViewingStreamRoute;
  const [playerHost] = useState(() => document.createElement("div"));

  // Keep one React portal container for the lifetime of the player. Moving this
  // host between the route dock and document.body preserves the video DOM node
  // (and therefore its HLS instance and buffered media) across navigation.
  useLayoutEffect(() => {
    const movePlayerHost = () => {
      const target = isDocked
        ? document.getElementById("persistent-live-player-dock")
        : document.body;
      if (!target) return false;

      playerHost.dataset.playerMode = isDocked ? "docked" : "mini";
      playerHost.style.width = isDocked ? "100%" : "";
      playerHost.style.height = isDocked ? "100%" : "";
      target.appendChild(playerHost);
      return true;
    };

    if (movePlayerHost()) return;

    const observer = new MutationObserver(() => {
      if (movePlayerHost()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isDocked, playerHost]);

  useEffect(() => () => playerHost.remove(), [playerHost]);

  // Resolve once for the active stream in both modes so the handoff reuses the same URL and player.
  const platform = (currentStream?.platform ?? "kick") as Platform;
  const channelName = currentStream?.channelName ?? "";
  const {
    playback,
    error: playbackError,
    reload,
    reloadAttempts,
    playbackRevision,
  } = useStreamPlayback(platform, channelName);
  const {
    data: streamStatus,
    dataUpdatedAt: streamStatusUpdatedAt,
    isPlaceholderData: isStreamStatusPlaceholder,
    isSuccess: isStreamStatusSuccess,
    refetch: refetchStreamStatus,
  } = useStreamByChannel(channelName, platform);

  // Keep the last verified URL through loading and transient resolver failures.
  // Only an explicit offline/not-found response may retire active playback.
  const playbackIdentity = `${platform}:${channelName.toLowerCase()}`;
  const playbackIdentityRef = useRef(playbackIdentity);
  const streamStatusUpdatedAtRef = useRef(streamStatusUpdatedAt);
  const [offlinePlayerSignal, setOfflinePlayerSignal] = useState<{
    identity: string;
    statusUpdatedAt: number;
  } | null>(null);
  const lastVerifiedPlaybackRef = useRef({ identity: playbackIdentity, url: "" });
  const hasExplicitUnavailablePlaybackError = isExplicitPlaybackUnavailable(playbackError);
  const streamStatusMatchesCurrentIdentity =
    streamStatus != null &&
    streamStatus.platform === platform &&
    normalizeChannelName(streamStatus.channelName) === normalizeChannelName(channelName);
  const hasConfirmedOfflineStreamStatus =
    !isDocked &&
    isStreamStatusSuccess &&
    !isStreamStatusPlaceholder &&
    (platform === "twitch"
      ? streamStatus == null ||
        (streamStatusMatchesCurrentIdentity && streamStatus?.isLive === false)
      : streamStatusMatchesCurrentIdentity && streamStatus?.isLive === false);
  const hasConfirmedLiveStreamStatus =
    !isDocked &&
    isStreamStatusSuccess &&
    !isStreamStatusPlaceholder &&
    streamStatusMatchesCurrentIdentity &&
    streamStatus?.isLive === true;
  const confirmedOfflineStatusIdentityRef = useRef<string | null>(null);
  const hasConfirmedOfflinePlayerSignal = offlinePlayerSignal?.identity === playbackIdentity;
  const isConfirmedOffline =
    !isDocked &&
    (hasExplicitUnavailablePlaybackError ||
      hasConfirmedOfflineStreamStatus ||
      hasConfirmedOfflinePlayerSignal);
  const lastVerifiedPlaybackUrl =
    lastVerifiedPlaybackRef.current.identity === playbackIdentity
      ? lastVerifiedPlaybackRef.current.url
      : "";
  const streamUrl =
    playback?.url || (!hasExplicitUnavailablePlaybackError ? lastVerifiedPlaybackUrl : "");
  const playbackRefreshRef = useRef({
    identity: playbackIdentity,
    revision: playbackRevision,
    url: playback?.url ?? "",
  });
  const [sameUrlRecoveryRevision, setSameUrlRecoveryRevision] = useState(0);
  useLayoutEffect(() => {
    playbackIdentityRef.current = playbackIdentity;
    streamStatusUpdatedAtRef.current = streamStatusUpdatedAt;

    if (lastVerifiedPlaybackRef.current.identity !== playbackIdentity) {
      lastVerifiedPlaybackRef.current = { identity: playbackIdentity, url: playback?.url ?? "" };
    } else if (playback?.url) {
      lastVerifiedPlaybackRef.current.url = playback.url;
    }
  }, [playback?.url, playbackIdentity, streamStatusUpdatedAt]);

  useEffect(() => {
    const previous = playbackRefreshRef.current;
    const nextUrl = playback?.url;
    if (!nextUrl) {
      if (previous.identity !== playbackIdentity) {
        playbackRefreshRef.current = {
          identity: playbackIdentity,
          revision: playbackRevision,
          url: "",
        };
      }
      return;
    }
    const isSameStreamRefresh =
      previous.identity === playbackIdentity &&
      previous.revision !== playbackRevision &&
      previous.url !== "" &&
      previous.url === nextUrl;

    playbackRefreshRef.current = {
      identity: playbackIdentity,
      revision: playbackRevision,
      url: nextUrl,
    };
    if (isSameStreamRefresh) {
      setSameUrlRecoveryRevision((revision) => revision + 1);
    }
  }, [playback?.url, playbackIdentity, playbackRevision]);

  useEffect(() => {
    setOfflinePlayerSignal((current) => (current?.identity === playbackIdentity ? current : null));
  }, [playbackIdentity]);

  useEffect(() => {
    if (!hasExplicitUnavailablePlaybackError) return;
    setOfflinePlayerSignal((current) =>
      current?.identity === playbackIdentity
        ? current
        : { identity: playbackIdentity, statusUpdatedAt: streamStatusUpdatedAt }
    );
  }, [hasExplicitUnavailablePlaybackError, playbackIdentity, streamStatusUpdatedAt]);

  useEffect(() => {
    if (hasConfirmedOfflineStreamStatus) {
      confirmedOfflineStatusIdentityRef.current = playbackIdentity;
      return;
    }

    const hasConfirmedOfflineStatusTransition =
      confirmedOfflineStatusIdentityRef.current === playbackIdentity;
    const hasNewerLiveStatusForPlayerSignal =
      offlinePlayerSignal?.identity === playbackIdentity &&
      streamStatusUpdatedAt > offlinePlayerSignal.statusUpdatedAt;

    if (!hasConfirmedOfflineStatusTransition && !hasNewerLiveStatusForPlayerSignal) {
      confirmedOfflineStatusIdentityRef.current = null;
      return;
    }
    if (!hasConfirmedLiveStreamStatus) return;

    confirmedOfflineStatusIdentityRef.current = null;
    if (hasNewerLiveStatusForPlayerSignal) {
      setOfflinePlayerSignal(null);
    }
    reload();
  }, [
    hasConfirmedLiveStreamStatus,
    hasConfirmedOfflineStreamStatus,
    offlinePlayerSignal,
    playbackIdentity,
    reload,
    streamStatusUpdatedAt,
  ]);

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
  useLayoutEffect(() => {
    isDockedRef.current = isDocked;
  }, [isDocked]);

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
    const handleEnded = () => {
      if (isDockedRef.current || playbackIdentityRef.current !== playbackIdentity) return;
      setHasError(false);
      setOfflinePlayerSignal({
        identity: playbackIdentity,
        statusUpdatedAt: streamStatusUpdatedAtRef.current,
      });
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
    };
  }, [playbackIdentity, videoElement]);

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
      if (playbackIdentityRef.current !== playbackIdentity) return;

      if (isConfirmedOfflinePlayerError(error)) {
        setHasError(false);
        setOfflinePlayerSignal({
          identity: playbackIdentity,
          statusUpdatedAt: streamStatusUpdatedAtRef.current,
        });
        return;
      }

      if (
        error.fatal &&
        reloadAttempts >= MAX_REFRESH_ATTEMPTS &&
        (error.shouldRefresh === true || error.code === "NO_FRAGMENTS")
      ) {
        setHasError(false);
        setOfflinePlayerSignal({
          identity: playbackIdentity,
          statusUpdatedAt: streamStatusUpdatedAtRef.current,
        });
        return;
      }

      if (shouldRefreshMiniPlayback(error) && reloadAttempts < MAX_REFRESH_ATTEMPTS) {
        logger.debug("Player:Mini", "refreshing URL after recoverable live-player error", {
          platform,
          code: error.code,
          attempt: reloadAttempts + 1,
          maxAttempts: MAX_REFRESH_ATTEMPTS,
        });
        setPlayerRecoveryRevision((revision) => revision + 1);
        reload();
        return;
      }

      logger.error("Player:Mini", "player error", { error });
      setHasError(true);
    },
    [platform, playbackIdentity, reload, reloadAttempts]
  );

  const miniTwitchRecovery = useTwitchLiveRecovery({
    sessionKey: `mini-player:${playbackIdentity}`,
    sourceRevision: `${playbackRevision}:${sameUrlRecoveryRevision}:${playerRecoveryRevision}`,
    onRefresh: reload,
    onExhausted: (error) =>
      handleError({
        ...error,
        code: "PLAYBACK_RECOVERY_EXHAUSTED",
        message: "Playback stopped after two automatic recovery attempts",
        shouldRefresh: false,
      }),
  });
  const handleMiniTwitchError = useCallback(
    (error: PlayerError): boolean | void => {
      if (isConfirmedOfflinePlayerError(error)) {
        handleError(error);
        return false;
      }
      return miniTwitchRecovery.handleError(error);
    },
    [handleError, miniTwitchRecovery]
  );

  const handlePlaybackRetry = useCallback(() => {
    setHasError(false);
    setPlayerRecoveryRevision((revision) => revision + 1);
    reload();
  }, [reload]);
  usePlayerNetworkRecovery(hasError, handlePlaybackRetry);

  const miniPlayerButtonClass = "cursor-pointer disabled:cursor-not-allowed";

  // Don't render if not active or no stream
  if (!currentStream || isExclusiveMediaRoute || (!streamUrl && !isConfirmedOffline)) {
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
        !isConfirmedOffline &&
        streamUrl &&
        (isTwitchStream ? (
          <TwitchLivePlayer
            key={`twitch:${currentStream.channelName}:${sameUrlRecoveryRevision}:${playerRecoveryRevision}`}
            ref={handleVideoRef}
            streamUrl={streamUrl}
            channelName={currentStream.channelName}
            poster={dockedConfig?.poster ?? currentStream.poster}
            enableAdBlock={storeEnableAdBlock}
            muted={isDocked ? (dockedConfig?.muted ?? false) : isMuted}
            autoPlay={true}
            compact={!isDocked}
            isTheater={isDocked ? dockedConfig?.isTheater : false}
            onToggleTheater={isDocked ? dockedConfig?.onToggleTheater : undefined}
            onError={isDocked && dockedConfig ? dockedConfig.onError : handleMiniTwitchError}
            onCleanPresentedFrame={
              isDocked && dockedConfig
                ? dockedConfig.onCleanPresentedFrame
                : miniTwitchRecovery.markPlaybackHealthy
            }
            onRefresh={isDocked && dockedConfig ? dockedConfig.onRefresh : reload}
            recoveryManagedExternally
            className="size-full"
          />
        ) : (
          <KickLivePlayer
            key={`kick:${currentStream.channelName}:${sameUrlRecoveryRevision}:${playerRecoveryRevision}`}
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

      {isConfirmedOffline && (
        <OfflineOverlay
          platform={platform}
          channelName={currentStream.channelName}
          displayName={currentStream.channelDisplayName}
          avatarUrl={currentStream.channelAvatar}
          categoryName={currentStream.categoryName}
          lastStreamTitle={currentStream.title}
          onCheckAgain={() => {
            void refetchStreamStatus();
            if (hasExplicitUnavailablePlaybackError || hasConfirmedOfflinePlayerSignal) {
              setOfflinePlayerSignal(null);
              reload();
            }
          }}
          compact
        />
      )}

      {/* Error State */}
      {!isDocked && hasError && (
        <div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/80"
          role="alert"
        >
          <p className="text-white/70 text-sm">{t("playback.streamUnavailable")}</p>
          <Button size="sm" onClick={handlePlaybackRetry}>
            {t("playback.retryPlayback")}
          </Button>
        </div>
      )}

      {/* Controls Overlay */}
      {!isDocked && (
        <div
          className={cn(
            "absolute inset-0 z-30 bg-gradient-to-t from-black/80 via-transparent to-black/50",
            "transition-opacity duration-200",
            isConfirmedOffline
              ? "pointer-events-none opacity-100"
              : isHovered
                ? "opacity-100"
                : "opacity-0"
          )}
        >
          {/* Top Bar - Close & Expand */}
          <div className="pointer-events-auto absolute top-0 left-0 right-0 p-2 flex justify-between items-start">
            <div className="flex items-center gap-2">
              {/* Live indicator */}
              <span className="flex items-center gap-1.5 bg-red-600 px-2 py-0.5 rounded text-xs font-bold text-white">
                {!isConfirmedOffline && (
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                )}
                {isConfirmedOffline ? t("playback.offline") : t("playback.live")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleExpand}
                    aria-label={t("playback.restoreStream")}
                    className={cn(
                      "p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors",
                      miniPlayerButtonClass
                    )}
                  >
                    <LuMaximize2 size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent container={containerRef.current}>
                  {t("playback.expand")}
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={closePip}
                    aria-label={t("playback.closeMiniPlayer")}
                    className={cn(
                      "p-1.5 rounded-full bg-black/50 hover:bg-red-500/80 text-white transition-colors",
                      miniPlayerButtonClass
                    )}
                  >
                    <LuX size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent container={containerRef.current}>
                  {t("playback.close")}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Bottom Bar - Stream Info & Controls */}
          {!isConfirmedOffline && (
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
                        aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
                        className={cn(
                          "p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors",
                          miniPlayerButtonClass
                        )}
                      >
                        {isPlaying ? <LuPause size={16} /> : <LuPlay size={16} />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent container={containerRef.current}>
                      {isPlaying ? t("playback.pause") : t("playback.play")}
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
                            className={cn(
                              "p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors z-10",
                              miniPlayerButtonClass
                            )}
                          >
                            {isMuted ? <LuVolumeX size={16} /> : <LuVolume2 size={16} />}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent container={containerRef.current}>
                          {isMuted ? t("playback.unmute") : t("playback.mute")}
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
                    {t("playback.viewerCount", {
                      value: currentStream.viewerCount.toLocaleString(),
                      defaultValue: "{{value}} viewers",
                    })}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
    playerHost
  );
}

// Add volume to MiniPlayerProps if needed, but it seems to use store.
