import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuGripVertical, LuMessageSquare, LuVolume2, LuVolumeX, LuX } from "react-icons/lu";

import { KickLivePlayer } from "@/features/playback/components/player/kick/kick-live-player";
import { TwitchLivePlayer } from "@/features/playback/components/player/twitch/twitch-live-player";
import { RaidHandoffPopup } from "@/features/playback/components/raid-handoff/raid-handoff-popup";
import { useRaidHandoff } from "@/features/playback/data/use-raid-handoff";
import { useTwitchLiveRecovery } from "@/features/playback/components/player/hooks/use-twitch-live-recovery";
import type { PlayerError } from "@/features/playback/components/player/types";
import { Button } from "@/components/ui/button";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useChannelByUsername } from "@/features/discovery/data/queries/useChannels";
import { useStreamPlayback } from "@/features/playback/data/useStreamPlayback";
import { cn } from "@/lib/utils";
import { logger } from "@/renderer/logging/logger";
import { Platform } from "@streamfusion/core/platform";
import { useMultiStreamStore } from "@/features/multistream/data/multistream-store";
import type { RaidSource, RaidTarget } from "@shared/raid-handoff-types";

const VISIBILITY_THRESHOLD = 0.25;

interface StreamSlotProps {
  streamId: string;
  platform: Platform;
  channelName: string;
  isMuted: boolean;
  onRemove: () => void;
  onFocus: () => void;
  isFocused: boolean;
  playbackActive?: boolean;
  onActivate?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  wcvEnabled?: boolean | null;
  /**
   * Defer first mount until the slot is at least 25% on-screen. Used for
   * focus-mode side-rail slots which may scroll horizontally off-screen. Once
   * mounted, scrolling out of view does NOT pause or unmount — only the FIRST
   * mount waits for visibility.
   */
  lazyMount?: boolean;
}

export function StreamSlot({
  streamId,
  platform,
  channelName,
  isMuted,
  onRemove,
  onFocus,
  isFocused,
  playbackActive = true,
  onActivate,
  dragHandleProps,
  wcvEnabled = false,
  lazyMount = false,
}: StreamSlotProps) {
  const { t } = useTranslation();
  const toggleMute = useMultiStreamStore((state) => state.toggleMute);
  const setChatStream = useMultiStreamStore((state) => state.setChatStream);
  const setMultiChatView = useMultiStreamStore((state) => state.setMultiChatView);
  const replaceRaidSource = useMultiStreamStore((state) => state.replaceRaidSource);
  const isChatActive = useMultiStreamStore(
    (state) => state.multiChatView === "tabs" && state.chatStreamId === streamId
  );

  const [isVisible, setIsVisible] = useState(() => !lazyMount);
  const slotRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!lazyMount || isVisible) return;
    const node = slotRootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: VISIBILITY_THRESHOLD }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazyMount, isVisible]);

  const isMountReady = playbackActive && isVisible;
  // Passing an empty identifier short-circuits the playback fetch — both the
  // IPC round-trip and HLS.js init are deferred until the slot is ready.
  const effectiveChannelName = isMountReady ? channelName : "";
  const { playback, isLoading, reload, playbackRevision } = useStreamPlayback(
    platform,
    effectiveChannelName
  );
  const [twitchRecoveryError, setTwitchRecoveryError] = useState<PlayerError | null>(null);
  const [twitchManualRetryRevision, setTwitchManualRetryRevision] = useState(0);
  const twitchRecovery = useTwitchLiveRecovery({
    sessionKey: `multistream:${streamId}:${platform}:${channelName.toLowerCase()}`,
    sourceRevision: `${playbackRevision}:${twitchManualRetryRevision}`,
    onRefresh: reload,
    onExhausted: (error) => {
      logger.error("Player:MultiStream", "Twitch playback recovery exhausted", {
        streamId,
        channelName,
        code: error.code,
      });
      setTwitchRecoveryError(error);
    },
  });
  const handleTwitchRetryClick = () => {
    setTwitchRecoveryError(null);
    setTwitchManualRetryRevision((revision) => revision + 1);
    reload();
  };

  // Fetch channel data to get offline banner, avatar, and display name
  const { data: channelData } = useChannelByUsername(playbackActive ? channelName : "", platform);
  const raidSource = useMemo<RaidSource | null>(() => {
    if (!playbackActive || !channelData?.id) return null;
    if (platform === "twitch") {
      return { platform: "twitch", channelId: channelData.id, channelSlug: channelName };
    }
    const broadcasterUserId = channelData.kickUserId || channelData.id;
    return broadcasterUserId
      ? { platform: "kick", broadcasterUserId, channelSlug: channelName }
      : null;
  }, [channelData, channelName, platform, playbackActive]);
  const isRaidSourceCurrent = useCallback(
    (source: RaidSource) => {
      const current = useMultiStreamStore
        .getState()
        .streams.find((stream) => stream.id === streamId);
      return (
        current?.platform === source.platform &&
        current.channelName.trim().toLowerCase() === source.channelSlug.trim().toLowerCase()
      );
    },
    [streamId]
  );
  const joinRaidTarget = useCallback(
    (target: RaidTarget) => {
      replaceRaidSource(streamId, target);
    },
    [replaceRaidSource, streamId]
  );
  const raidHandoff = useRaidHandoff({
    source: raidSource,
    isSourceCurrent: isRaidSourceCurrent,
    onJoin: joinRaidTarget,
  });

  // ===== Slice 06: WCV-per-slot path (gated by env flag during dogfood) =====
  // When the controller has its WCV path enabled, this slot:
  //   - tells main to create/destroy its per-slot WCV on mount/unmount
  //   - pushes the placeholder div's screen rect to main via ResizeObserver
  //     so the WCV stays pinned under our placeholder as the grid resizes
  //   - pushes the resolved playback URL down so the WCV's slot-renderer
  //     can attach HLS and play
  //   - subscribes to retry-affordance so the overlay can render after the
  //     second crash in the 5-min window (slice 06 retry policy)
  // Renders a placeholder div (the WCV draws on top) instead of mounting
  // the in-process KickLivePlayer / TwitchLivePlayer.
  const [retryAffordance, setRetryAffordance] = useState(false);
  const placeholderRef = useRef<HTMLDivElement | null>(null);

  // Slot lifecycle on the main side: create on mount, destroy on unmount.
  // Only fires when the WCV path is active so the legacy renderer stays
  // hands-off when the flag is off.
  useEffect(() => {
    if (!wcvEnabled || !playbackActive) return;
    const slot = window.electronAPI?.slot;
    if (!slot) return;
    slot.createSlot(streamId).catch(() => {
      /* main will log the failure via web-contents-log-forwarder */
    });
    return () => {
      slot.destroySlot(streamId).catch(() => {
        /* ignore — main may already be tearing down */
      });
    };
  }, [playbackActive, wcvEnabled, streamId]);

  // Push the resolved playback URL into the WCV when it changes.
  useEffect(() => {
    if (!wcvEnabled || !playbackActive) return;
    if (!playback?.url) return;
    const slot = window.electronAPI?.slot;
    if (!slot) return;
    slot.loadStream(streamId, { platform, channelName, playbackUrl: playback.url }).catch(() => {
      /* surfaced via the slot's own console + log-forwarder */
    });
  }, [playbackActive, wcvEnabled, streamId, platform, channelName, playback?.url]);

  // ResizeObserver: push the placeholder's screen rect to main so the WCV
  // stays pinned underneath it as the grid resizes.
  useEffect(() => {
    if (!wcvEnabled) return;
    const node = placeholderRef.current;
    const slot = window.electronAPI?.slot;
    if (!node || !slot) return;
    const pushBounds = () => {
      const rect = node.getBoundingClientRect();
      slot
        .setBounds(streamId, {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
        .catch(() => {
          /* destroyed window — main ignores */
        });
    };
    pushBounds();
    const observer = new ResizeObserver(pushBounds);
    observer.observe(node);
    window.addEventListener("scroll", pushBounds, { passive: true, capture: true });
    window.addEventListener("resize", pushBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", pushBounds, true);
      window.removeEventListener("resize", pushBounds);
    };
  }, [wcvEnabled, streamId]);

  // Retry-affordance overlay subscription. Main fires this after the second
  // slot crash within the 5-min window (slice 06 retry policy).
  useEffect(() => {
    if (!wcvEnabled) return;
    const slot = window.electronAPI?.slot;
    if (!slot?.onRetryAffordance) return;
    const unsubscribe = slot.onRetryAffordance(({ slotId: id }) => {
      if (id === streamId) setRetryAffordance(true);
    });
    return unsubscribe;
  }, [wcvEnabled, streamId]);

  const handleRetryClick = () => {
    setRetryAffordance(false);
    window.electronAPI?.slot?.requestRetry(streamId).catch(() => {
      /* main will surface the failure in its own log */
    });
  };

  return (
    <div
      ref={slotRootRef}
      className={cn(
        "relative w-full h-full bg-black group border-2 transition-colors",
        isFocused
          ? "border-[var(--color-primary)]"
          : "border-transparent hover:border-[var(--color-border)]"
      )}
      onClick={onFocus}
    >
      {/* Platform Badge */}
      <div className="absolute top-2 left-2 z-20 px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-xs font-medium text-white pointer-events-none">
        <span
          className={cn(
            "font-bold uppercase mr-1",
            platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]"
          )}
        >
          {platform}
        </span>
        {channelData?.displayName || channelName}
      </div>

      {/* Slot Controls (Top Right) */}
      <div className="absolute top-2 right-2 z-20 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {dragHandleProps && (
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 cursor-move"
            {...dragHandleProps}
            title={t("multistream.dragToMove")}
          >
            <LuGripVertical className="h-4 w-4" />
          </Button>
        )}

        <Button
          size="icon"
          variant="secondary"
          className={cn(
            "h-8 w-8",
            isChatActive &&
              "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]/90"
          )}
          onClick={(e) => {
            e.stopPropagation();
            setChatStream(streamId);
            setMultiChatView("tabs");
          }}
          title={t("multistream.showChat")}
        >
          <LuMessageSquare className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            toggleMute(streamId);
          }}
          title={isMuted ? t("multistream.unmute") : t("multistream.mute")}
        >
          {isMuted ? <LuVolumeX className="h-4 w-4" /> : <LuVolume2 className="h-4 w-4" />}
        </Button>

        <Button
          size="icon"
          variant="destructive"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={t("multistream.removeStream")}
        >
          <LuX className="h-4 w-4" />
        </Button>
      </div>

      {/* Video Player - Only render when we have a valid playback URL */}
      <div className="w-full h-full">
        {!playbackActive ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-zinc-900 to-black px-4 text-center">
            <p className="text-sm font-semibold text-white">{t("multistream.playbackSuspended")}</p>
            <p className="text-xs text-white/60">{t("multistream.activateSlotHint")}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                onActivate?.();
              }}
            >
              {t("multistream.activateStream")}
            </Button>
          </div>
        ) : wcvEnabled === null ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black text-sm text-white/60">
            {t("multistream.loadingStream")}
          </div>
        ) : wcvEnabled ? (
          // Slice 06: the WCV draws the video on top of this placeholder.
          // The host renders only chrome + overlays. ResizeObserver pushes
          // the rect to main so the WCV stays pinned underneath.
          <div ref={placeholderRef} className="absolute inset-0 bg-black">
            {!playback?.url && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-white/60 text-sm">
                {isLoading ? t("multistream.loadingStream") : t("multistream.streamOffline")}
              </div>
            )}
            {retryAffordance && (
              <div
                className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70"
                role="alert"
              >
                <p className="text-white text-sm mb-3">{t("multistream.streamCrashed")}</p>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRetryClick();
                  }}
                  variant="secondary"
                >
                  {t("multistream.clickToRetry")}
                </Button>
              </div>
            )}
          </div>
        ) : !isMountReady ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-zinc-900 to-black">
            <div className="absolute inset-0 animate-pulse bg-[var(--color-background-elevated)]/20" />
            <div className="relative z-10 flex flex-col items-center text-center px-4">
              {channelData?.avatarUrl && (
                <ProxiedImage
                  src={channelData.avatarUrl}
                  alt=""
                  className="w-12 h-12 rounded-full mb-3 opacity-60"
                  fallback={<div className="w-12 h-12 rounded-full mb-3 bg-white/10" />}
                />
              )}
              <p className="text-white/60 text-xs">
                {t("multistream.loadingChannel", {
                  channel: channelData?.displayName || channelName,
                })}
              </p>
            </div>
          </div>
        ) : playback?.url ? (
          // Stream is live - render the player
          platform === "kick" ? (
            <KickLivePlayer
              streamUrl={playback.url}
              autoPlay={true}
              muted={isMuted}
              className="pointer-events-none"
              channelName={channelName}
              onRefresh={reload}
            />
          ) : (
            <TwitchLivePlayer
              key={`twitch:${streamId}:${playbackRevision}:${twitchManualRetryRevision}`}
              streamUrl={playback.url}
              channelName={channelName}
              autoPlay={true}
              muted={isMuted}
              className={twitchRecoveryError ? undefined : "pointer-events-none"}
              onRefresh={reload}
              onError={twitchRecovery.handleError}
              onCleanPresentedFrame={twitchRecovery.markPlaybackHealthy}
              recoveryManagedExternally
            />
          )
        ) : (
          // No playback URL - show loading or offline state
          <div className="absolute inset-0 z-10 overflow-hidden">
            {isLoading ? (
              // Loading state with gradient background
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-black/60 to-black">
                <div
                  className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                  style={{
                    borderColor: platform === "kick" ? "#53FC18" : "#9146FF",
                    borderTopColor: "transparent",
                  }}
                />
                <span className="text-white/70 text-sm mt-3">{t("multistream.loadingStream")}</span>
              </div>
            ) : (
              // Offline state with banner/avatar background
              <>
                {/* Background: Offline banner if available, otherwise blurred avatar or gradient */}
                {channelData?.bannerUrl ? (
                  <ProxiedImage
                    src={channelData.bannerUrl}
                    alt={t("multistream.offlineBanner")}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : channelData?.avatarUrl ? (
                  <>
                    {/* Blurred, scaled-up avatar as background */}
                    <ProxiedImage
                      src={channelData.avatarUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-40"
                      fallback={
                        <div className="absolute inset-0 bg-[var(--color-background-secondary)]" />
                      }
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black" />
                  </>
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        platform === "twitch"
                          ? "linear-gradient(to bottom, rgba(145, 70, 255, 0.3), rgb(0, 0, 0))"
                          : "linear-gradient(to bottom, rgba(83, 252, 24, 0.2), rgb(0, 0, 0))",
                    }}
                  />
                )}

                {/* Content overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {/* Avatar (if available and no banner) */}
                  {channelData?.avatarUrl && !channelData?.bannerUrl && (
                    <div className="mb-4">
                      <ProxiedImage
                        src={channelData.avatarUrl}
                        alt={channelData.displayName || channelName}
                        className="w-16 h-16 rounded-full border-2 border-white/20 shadow-xl"
                        fallback={<div className="w-16 h-16 rounded-full bg-white/10 shadow-xl" />}
                      />
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-white text-lg font-bold mb-1 drop-shadow-lg">
                      {channelData?.displayName || channelName}
                    </p>
                    <p className="text-white/70 text-sm mb-4">
                      {t("multistream.currentlyOffline")}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-white/10 border-white/30 hover:bg-white/20 backdrop-blur-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        reload();
                      }}
                    >
                      {t("multistream.retry")}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {twitchRecoveryError && !wcvEnabled && (
          <div
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 px-4 text-center"
            role="alert"
          >
            <p className="text-sm font-bold text-white">{t("multistream.playbackInterrupted")}</p>
            <Button
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                handleTwitchRetryClick();
              }}
            >
              {t("multistream.retryPlayback")}
            </Button>
          </div>
        )}
      </div>
      {raidHandoff.popup && <RaidHandoffPopup model={raidHandoff.popup} compact />}
    </div>
  );
}
