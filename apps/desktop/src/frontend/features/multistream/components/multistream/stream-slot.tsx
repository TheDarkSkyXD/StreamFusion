import type React from "react";
import { useEffect, useRef, useState } from "react";
import { LuGripVertical, LuMessageSquare, LuVolume2, LuVolumeX, LuX } from "react-icons/lu";

import { KickLivePlayer } from "@/features/playback/components/player/kick/kick-live-player";
import { TwitchLivePlayer } from "@/features/playback/components/player/twitch/twitch-live-player";
import { useTwitchLiveRecovery } from "@/features/playback/components/player/hooks/use-twitch-live-recovery";
import type { PlayerError } from "@/features/playback/components/player/types";
import { Button } from "@/components/ui/button";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useChannelByUsername } from "@/features/discovery/data/queries/useChannels";
import { useStreamPlayback } from "@/features/playback/data/useStreamPlayback";
import { useTimeout } from "@/hooks/useTimeout";
import { cn } from "@/lib/utils";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@shared/auth-types";
import { useMultiStreamStore } from "@/features/multistream/data/multistream-store";

// Stagger initial HLS.js mount per slot so 6 concurrent decoder allocations
// don't all hit the GPU at once (the same load profile that previously crashed
// the GPU process with exit_code=34). Each slot waits slotIndex * delay before
// starting its first fetch.
const STAGGER_DELAY_MS = 350;
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
  /**
   * Initial position in the multistream grid. Captured on first mount only —
   * reorders don't re-stagger an already-mounted slot.
   */
  slotIndex?: number;
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
  slotIndex = 0,
  lazyMount = false,
}: StreamSlotProps) {
  const { toggleMute, setChatStream, chatStreamId } = useMultiStreamStore();

  // Capture initial slotIndex so reorders don't re-trigger the stagger for an
  // already-mounted slot — the value is read once and never tracks prop updates.
  const initialSlotIndexRef = useRef(slotIndex);
  const [isStaggerReady, setIsStaggerReady] = useState(() => slotIndex === 0);
  const [isVisible, setIsVisible] = useState(() => !lazyMount);
  const slotRootRef = useRef<HTMLDivElement | null>(null);

  // Declarative one-shot: fires once after slotIndex * STAGGER_DELAY_MS,
  // then becomes a no-op (null) because setIsStaggerReady flips the state
  // that gates the delay.
  useTimeout(
    () => setIsStaggerReady(true),
    isStaggerReady ? null : initialSlotIndexRef.current * STAGGER_DELAY_MS
  );

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

  const isMountReady = playbackActive && isStaggerReady && isVisible;
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

  const isChatActive = chatStreamId === streamId;

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
  const [wcvEnabled, setWcvEnabled] = useState<boolean | null>(null);
  const [retryAffordance, setRetryAffordance] = useState(false);
  const placeholderRef = useRef<HTMLDivElement | null>(null);

  // Probe the WCV flag on mount. Unknown (null) until the IPC resolves so we
  // don't briefly render the legacy player while waiting.
  useEffect(() => {
    let cancelled = false;
    const slot = window.electronAPI?.slot;
    if (!slot?.isWcvEnabled) {
      // Older preload (test harness, packaged build with stale electronAPI):
      // assume the legacy path is the safe default.
      setWcvEnabled(false);
      return;
    }
    slot
      .isWcvEnabled()
      .then((enabled) => {
        if (!cancelled) setWcvEnabled(enabled);
      })
      .catch(() => {
        if (!cancelled) setWcvEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            title="Drag to Move"
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
              "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90"
          )}
          onClick={(e) => {
            e.stopPropagation();
            setChatStream(streamId);
          }}
          title="Show Chat"
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
          title={isMuted ? "Unmute" : "Mute"}
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
          title="Remove Stream"
        >
          <LuX className="h-4 w-4" />
        </Button>
      </div>

      {/* Video Player - Only render when we have a valid playback URL */}
      <div className="w-full h-full">
        {!playbackActive ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-zinc-900 to-black px-4 text-center">
            <p className="text-sm font-semibold text-white">Playback suspended</p>
            <p className="text-xs text-white/60">
              Activate this slot to swap it into the playback budget.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                onActivate?.();
              }}
            >
              Activate stream
            </Button>
          </div>
        ) : wcvEnabled ? (
          // Slice 06: the WCV draws the video on top of this placeholder.
          // The host renders only chrome + overlays. ResizeObserver pushes
          // the rect to main so the WCV stays pinned underneath.
          <div ref={placeholderRef} className="absolute inset-0 bg-black">
            {!playback?.url && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-white/60 text-sm">
                {isLoading ? "Loading stream..." : "Stream offline"}
              </div>
            )}
            {retryAffordance && (
              <div
                className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70"
                role="alert"
              >
                <p className="text-white text-sm mb-3">Stream crashed</p>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRetryClick();
                  }}
                  variant="secondary"
                >
                  Click to retry
                </Button>
              </div>
            )}
          </div>
        ) : !isMountReady ? (
          // Stagger placeholder — skeleton with channel label so the wait is
          // clearly a loading state, not a broken/blank slot.
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
                Loading {channelData?.displayName || channelName}…
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
                <span className="text-white/70 text-sm mt-3">Loading stream...</span>
              </div>
            ) : (
              // Offline state with banner/avatar background
              <>
                {/* Background: Offline banner if available, otherwise blurred avatar or gradient */}
                {channelData?.bannerUrl ? (
                  <ProxiedImage
                    src={channelData.bannerUrl}
                    alt="Offline banner"
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
                    <p className="text-white/70 text-sm mb-4">is currently offline</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-white/10 border-white/30 hover:bg-white/20 backdrop-blur-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        reload();
                      }}
                    >
                      Retry
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
            <p className="text-sm font-bold text-white">Playback interrupted</p>
            <Button
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                handleTwitchRetryClick();
              }}
            >
              Retry playback
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
