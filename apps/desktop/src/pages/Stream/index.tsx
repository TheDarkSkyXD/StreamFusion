import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "@/components/chat";

import { KickLivePlayer } from "@/components/player/kick";
import { TwitchLivePlayer } from "@/components/player/twitch";
import type { PlayerError } from "@/components/player/types";
import { RelatedContent } from "@/components/stream/related-content";
import { StreamInfo } from "@/components/stream/stream-info";
import { Button } from "@/components/ui/button";
import { KickLoadingSpinner, TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useChannelByUsername } from "@/hooks/queries/useChannels";
import { useStreamByChannel } from "@/hooks/queries/useStreams";
import { useStreamPlayback } from "@/hooks/useStreamPlayback";
import { logger } from "@/renderer/logging/logger";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES, type Platform } from "@/shared/auth-types";
import { useAppStore } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import { usePipStore } from "@/store/pip-store";

// Docked chat width is dragged in px but persisted as a % of the window so it
// scales across displays. Clamp matches the drag handler's 200–600px bounds.
const CHAT_MIN_PX = 200;
const CHAT_MAX_PX = 600;
function pctToPx(pct: number): number {
  const px = Math.round((pct / 100) * window.innerWidth);
  return Math.min(CHAT_MAX_PX, Math.max(CHAT_MIN_PX, px));
}

interface OfflineOverlayProps {
  channelName: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  categoryName?: string;
  lastStreamTitle?: string;
  onCheckAgain: () => void;
}

function OfflineOverlay({
  channelName,
  displayName,
  avatarUrl,
  bannerUrl,
  categoryName,
  lastStreamTitle,
  onCheckAgain,
}: OfflineOverlayProps) {
  const name = displayName || channelName;

  return (
    <div className="absolute inset-0 z-20 overflow-hidden">
      {bannerUrl ? (
        <ProxiedImage
          src={bannerUrl}
          alt="Offline banner"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : avatarUrl ? (
        <>
          <img
            src={avatarUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/50 via-gray-900 to-black" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/55 to-black/80" />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
        {avatarUrl && !bannerUrl && (
          <div className="mb-6">
            <img
              src={avatarUrl}
              alt={name}
              className="w-24 h-24 rounded-full border-4 border-white/20 shadow-2xl"
            />
          </div>
        )}
        <div className="text-center max-w-xl">
          <p className="text-white text-3xl font-bold mb-2 drop-shadow-lg">{name}</p>
          <p className="text-white/70 text-lg mb-4">is currently offline</p>
          {lastStreamTitle && (
            <p className="text-white/90 text-base font-medium line-clamp-2 mb-2">
              {lastStreamTitle}
            </p>
          )}
          {categoryName && (
            <p className="text-white/70 text-sm mb-8">Last streamed in {categoryName}</p>
          )}
          {!categoryName && !lastStreamTitle && <div className="mb-8" />}
          <Button
            variant="outline"
            size="lg"
            className="bg-white/10 border-white/30 hover:bg-white/20 backdrop-blur-sm"
            onClick={onCheckAgain}
          >
            Check Again
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StreamPage() {
  const { platform, channel: channelName } = useParams({ from: "/_app/stream/$platform/$channel" });
  const routePlatform = platform as Platform;

  // Real data fetching
  const { data: channelData, isLoading: isChannelLoading } = useChannelByUsername(
    channelName,
    routePlatform
  );
  const { data: streamData, isLoading: isStreamLoading } = useStreamByChannel(
    channelName,
    routePlatform
  );

  const isKnownTwitchLive =
    routePlatform === "twitch" && (channelData?.isLive === true || Boolean(streamData?.startedAt));
  const playbackIdentifier =
    routePlatform === "twitch" ? (isKnownTwitchLive ? channelName : "") : channelName;

  // Playback URL resolution
  const {
    playback,
    isLoading: isPlaybackLoading,
    error: playbackError,
    reload: reloadPlayback,
    isUsingProxy,
    retryWithoutProxy,
    reloadAttempts,
  } = useStreamPlayback(routePlatform, playbackIdentifier);

  // Chat display prefs — chatWidthPct seeds the docked width; updatePreferences
  // persists the new width (as a %) on drag end. Pre-load `preferences` is null,
  // so the raw pct is undefined until prefs hydrate (see seed effect below).
  const persistedChatWidthPct = useAuthStore((s) => s.preferences?.chatDisplay?.chatWidthPct);
  const updatePreferences = useAuthStore((s) => s.updatePreferences);
  // U5 — hide-chat-panel reuses the existing ChatPreferences.position field.
  // When "hidden" the panel (and the chat service it mounts) is never
  // rendered, so there's no socket to tear down — the safe path per the
  // websocket-connecting-state learning. The toggle that SETS this lives in U6.
  const isChatHidden = useAuthStore((s) => s.preferences?.chat?.position === "hidden");

  // Chat Resizing Logic. Seed from the persisted chatWidthPct (lazy init reads
  // window.innerWidth once); if prefs aren't loaded yet, start at the default %.
  const [chatWidth, setChatWidth] = useState(() =>
    pctToPx(persistedChatWidthPct ?? DEFAULT_CHAT_DISPLAY_PREFERENCES.chatWidthPct)
  );
  const [isResizing, setIsResizing] = useState(false);
  // Prefs load asynchronously after mount, so the lazy seed above may have used
  // the default. Apply the persisted width once it arrives, but only before the
  // user has dragged or toggled theater (those own the width afterward).
  const widthSeededRef = useRef(false);
  // Mirror isResizing into a ref so the global mousemove/mouseup handlers
  // can read the current value without becoming new function identities on
  // each toggle. Lets the listener-attach effect run once per drag start
  // instead of every render.
  const isResizingRef = useRef(false);

  // Theater Mode Logic - synced with app store for sidebar auto-collapse
  const { isTheaterModeActive: isTheater, setTheaterModeActive } = useAppStore();

  // Player error state (e.g., stream offline even though URL was provided)
  const [playerError, setPlayerError] = useState<PlayerError | null>(null);

  // Track clip dialog state to mute main player
  const [isClipDialogOpen, setIsClipDialogOpen] = useState(false);

  // Helper to trigger proxy fallback
  const triggerProxyFallback = useCallback(() => {
    logger.debug("Page:Stream", "triggering fallback to direct stream");
    retryWithoutProxy();
  }, [retryWithoutProxy]);

  const handlePlayerError = useCallback(
    (error: PlayerError) => {
      logger.debug("Page:Stream", "handlePlayerError called", {
        code: error.code,
        isUsingProxy,
        platform: routePlatform,
        message: error.message,
        shouldRefresh: error.shouldRefresh,
      });

      // Handle errors that suggest we need a fresh playback URL
      // TOKEN_EXPIRED: Playback token expired, need new URL
      // NO_FRAGMENTS: No video data received after manifest - likely stale URL or offline
      // STREAM_OFFLINE with shouldRefresh: Stale URL (404/403) but API says live
      if (error.shouldRefresh || error.code === "TOKEN_EXPIRED" || error.code === "NO_FRAGMENTS") {
        // Check if we haven't hit the max retries yet (3)
        if (reloadAttempts < 3) {
          logger.debug("Page:Stream", "attempting automatic refresh", {
            code: error.code,
            attempt: reloadAttempts + 1,
            maxAttempts: 3,
          });

          reloadPlayback(); // Fetch fresh playback URL

          return; // Don't show error, let refresh attempt
        } else {
          logger.debug("Page:Stream", "max reload attempts reached, showing error", {
            code: error.code,
          });
        }
      }

      // PROXY_ERROR is specific to proxy server failures (500 errors)
      if (error.code === "PROXY_ERROR" && isUsingProxy && routePlatform === "twitch") {
        triggerProxyFallback();
        return; // Don't show error, let fallback attempt
      }

      // STREAM_OFFLINE is expected when a stream ends - use debug logging
      if (error.code === "STREAM_OFFLINE") {
        logger.debug("Page:Stream", "stream ended or went offline");

        // If we were using proxy and got a network/offline error, try fallback to direct
        if (isUsingProxy && routePlatform === "twitch") {
          triggerProxyFallback();
          return; // Don't show error yet, let fallback attempt
        }
      } else {
        logger.error("Page:Stream", "player error", {
          code: error.code,
          message: error.message,
          fatal: error.fatal,
        });

        // Also try fallback for other network errors when using proxy
        if (isUsingProxy && routePlatform === "twitch") {
          triggerProxyFallback();
          return;
        }
      }
      // Exit theater mode when stream goes offline for better offline screen visibility
      setTheaterModeActive(false);
      setPlayerError(error);
    },
    [
      isUsingProxy,
      routePlatform,
      triggerProxyFallback,
      setTheaterModeActive,
      reloadPlayback,
      reloadAttempts,
    ]
  );

  // Determine if stream is truly live - allow playback if URL exists (optimistic) or confirmed live
  // This allows the player to start buffering while metadata is still fetching
  const isStreamLive = Boolean(streamData?.startedAt || channelData?.isLive);
  const hasPlayback = Boolean(playback?.url);
  const effectiveStreamUrl = playback?.url || (isStreamLive && playback?.url ? playback.url : "");
  const offlineCategoryName = channelData?.categoryName || streamData?.categoryName;
  const offlineStreamTitle = channelData?.lastStreamTitle || streamData?.title;
  const shouldShowOfflineOverlay =
    !isPlaybackLoading &&
    !hasPlayback &&
    !playerError &&
    (Boolean(playbackError) || (!isChannelLoading && !isStreamLoading && !isStreamLive));

  // Reset player error when playback changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: the URL is the recovery boundary for stale player errors.
  useEffect(() => {
    setPlayerError(null);
  }, [effectiveStreamUrl]);

  // PiP Store Integration - Track when viewing a live stream
  const { setCurrentStream, setIsOnStreamPage } = usePipStore();

  // Mark that we're on the stream page when component mounts
  // Also reset theater mode when leaving the page to restore sidebar state
  useEffect(() => {
    setIsOnStreamPage(true);
    return () => {
      // When leaving stream page, mark as not on stream page (triggers PiP if stream was active)
      setIsOnStreamPage(false);
      // Reset theater mode when leaving the page to restore sidebar to user preference
      setTheaterModeActive(false);
    };
  }, [setIsOnStreamPage, setTheaterModeActive]);

  // Apply the persisted chat width once prefs hydrate (the lazy useState seed
  // above ran before they loaded). One-shot: skips if the user already dragged
  // or toggled theater, so we never stomp an in-session width.
  useEffect(() => {
    if (widthSeededRef.current || persistedChatWidthPct === undefined) return;
    widthSeededRef.current = true;
    setChatWidth(pctToPx(persistedChatWidthPct));
  }, [persistedChatWidthPct]);

  // Match Twitch's exact theater mode chat width (measured at 1920x1080).
  // Skip the initial mount so the persisted chatWidthPct seed isn't clobbered;
  // only snap to 340 on an actual theater toggle.
  const theaterSnapMountedRef = useRef(false);
  useEffect(() => {
    if (!theaterSnapMountedRef.current) {
      theaterSnapMountedRef.current = true;
      return;
    }
    widthSeededRef.current = true; // theater now owns the width; stop seeding
    if (isTheater) {
      setChatWidth(340); // Twitch theater mode: exactly 340px chat width
    } else {
      setChatWidth(340); // Match Twitch's standard chat width
    }
  }, [isTheater]);

  // Memoize subscriber badges to prevent KickChat from re-mounting when channelData refetches
  // Arrays are compared by reference in React, so we serialize to detect actual changes
  const memoizedSubscriberBadges = useMemo(() => {
    const badges = routePlatform === "kick" ? channelData?.subscriberBadges : undefined;
    // Only update reference if badges actually changed
    return badges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePlatform, channelData?.subscriberBadges]);

  // Memoize stream info to prevent effect from running on every streamData update
  // streamData changes every 30s (viewer count), but we only care about title/category changes
  const pipStreamInfo = useMemo(
    () => ({
      platform: routePlatform,
      channelName: channelName,
      channelDisplayName: channelData?.displayName || channelName,
      channelAvatar: channelData?.avatarUrl,
      streamUrl: effectiveStreamUrl,
      title: streamData?.title,
      categoryName: streamData?.categoryName,
      viewerCount: streamData?.viewerCount,
    }),
    [
      routePlatform,
      channelName,
      channelData?.displayName,
      channelData?.avatarUrl,
      effectiveStreamUrl,
      streamData?.title,
      streamData?.categoryName,
      streamData?.viewerCount,
      // Intentionally exclude viewerCount - it changes every 30s but we don't need to update PiP for that
    ]
  );

  // Update PiP store as soon as playback is ready so leaving the page can
  // activate mini-player even if metadata is still catching up.
  useEffect(() => {
    if (effectiveStreamUrl) {
      setCurrentStream(pipStreamInfo);
    }
  }, [effectiveStreamUrl, pipStreamInfo, setCurrentStream]);

  const startResizing = useCallback(() => {
    isResizingRef.current = true;
    widthSeededRef.current = true; // user owns the width now; stop seeding from prefs
    setIsResizing(true);
    // Disable iframe pointer events globally to prevent capturing mouse events during drag
    document.body.style.userSelect = "none";
  }, []);

  // Latest dragged width, mirrored so stopResizing can persist it without
  // becoming a new identity on every width change.
  const chatWidthRef = useRef(chatWidth);

  // Stable callbacks: read isResizing via ref so identity never changes.
  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
    if (!isResizingRef.current) return;
    const newWidth = window.innerWidth - mouseMoveEvent.clientX;
    if (newWidth > CHAT_MIN_PX && newWidth < CHAT_MAX_PX) {
      chatWidthRef.current = newWidth;
      setChatWidth(newWidth);
    }
  }, []);

  const stopResizing = useCallback(() => {
    isResizingRef.current = false;
    setIsResizing(false);
    document.body.style.userSelect = "";
    // Persist the final width as a % of the window. Read the freshest prefs from
    // the store so this callback needs no `cd` dependency (stays stable).
    const current =
      useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
    const chatWidthPct = Math.round((chatWidthRef.current / window.innerWidth) * 100);
    if (chatWidthPct !== current.chatWidthPct) {
      void updatePreferences({ chatDisplay: { ...current, chatWidthPct } });
    }
  }, [updatePreferences]);

  useEffect(() => {
    if (!isResizing) return;
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
    // resize/stopResizing are stable (useCallback deps: []) so the effect
    // only re-runs when isResizing actually toggles.
  }, [isResizing, resize, stopResizing]);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div
          className={`flex-1 no-scrollbar ${isTheater ? "flex flex-col items-center justify-center overflow-hidden py-[5px]" : "overflow-y-auto"}`}
        >
          {/* Video Player Area */}
          <div
            className={`${isTheater ? "h-full aspect-video max-w-full" : "aspect-video shrink-0 w-full"} bg-black relative`}
          >
            {/* Platform-specific live stream players */}
            {routePlatform === "kick" ? (
              <KickLivePlayer
                streamUrl={effectiveStreamUrl}
                autoPlay={true}
                muted={isClipDialogOpen}
                onReady={() => logger.debug("Page:Stream", "kick live player ready")}
                onError={handlePlayerError}
                isTheater={isTheater}
                onToggleTheater={() => setTheaterModeActive(!isTheater)}
                startedAt={streamData?.startedAt}
                channelName={channelName}
                onRefresh={reloadPlayback}
              />
            ) : (
              <TwitchLivePlayer
                streamUrl={effectiveStreamUrl}
                channelName={channelName}
                autoPlay={true}
                muted={isClipDialogOpen}
                onReady={() => logger.debug("Page:Stream", "twitch live player ready")}
                onError={handlePlayerError}
                isTheater={isTheater}
                onToggleTheater={() => setTheaterModeActive(!isTheater)}
                onRefresh={reloadPlayback}
              />
            )}
            {/* Show loading only when fetching data */}
            {(isPlaybackLoading || isChannelLoading || isStreamLoading) &&
              !effectiveStreamUrl &&
              !playbackError &&
              !playerError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-20 pointer-events-none">
                  <div className="flex flex-col items-center gap-2">
                    {routePlatform === "kick" ? <KickLoadingSpinner /> : <TwitchLoadingSpinner />}
                  </div>
                </div>
              )}

            {playerError && (
              <OfflineOverlay
                channelName={channelName}
                displayName={channelData?.displayName}
                avatarUrl={channelData?.avatarUrl}
                bannerUrl={channelData?.bannerUrl}
                categoryName={offlineCategoryName}
                lastStreamTitle={offlineStreamTitle}
                onCheckAgain={() => {
                  setPlayerError(null);
                  reloadPlayback();
                }}
              />
            )}
            {/* Show offline screen only when we have NO working playback URL.
                The metadata fetch (streamData) can time out independently of the
                playback fetch; if HLS is loaded and playing, trust that signal —
                the HLS player will surface a `playerError` if the stream actually
                ends mid-watch, which triggers the dedicated overlay above. */}
            {shouldShowOfflineOverlay && (
              <OfflineOverlay
                channelName={channelName}
                displayName={channelData?.displayName}
                avatarUrl={channelData?.avatarUrl}
                bannerUrl={channelData?.bannerUrl}
                categoryName={offlineCategoryName}
                lastStreamTitle={offlineStreamTitle}
                onCheckAgain={reloadPlayback}
              />
            )}
          </div>

          <div className={`${isTheater ? "hidden" : "block"} p-6 space-y-6`}>
            <StreamInfo
              channel={channelData || null}
              stream={streamData}
              isLoading={isChannelLoading}
            />

            <RelatedContent
              platform={routePlatform}
              channelName={channelName}
              channelData={channelData}
              streamStartedAt={streamData?.startedAt}
              onClipSelectionChange={setIsClipDialogOpen}
            />
          </div>
        </div>
      </div>

      {/* Resize Handle + Chat Panel — hidden entirely when the viewer set
          chat position to "hidden" (U5). Not rendering the panel keeps the
          chat service unmounted, so there's no CONNECTING socket to tear down. */}
      {!isChatHidden && (
        <>
          {/* We use a slightly wider invisible hit area for easier grabbing */}
          <div className="relative z-20 shrink-0">
            <div
              className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize"
              onMouseDown={startResizing}
            />
            <div className="w-1 h-full bg-[var(--color-border)] hover:bg-[var(--color-primary)] transition-colors" />
          </div>

          <div
            style={{ width: chatWidth }}
            className="bg-[var(--color-background-secondary)] flex flex-col shrink-0 relative border-l border-[var(--color-border)]"
          >
            <ChatPanel
              initialPlatform={routePlatform as "twitch" | "kick"}
              initialChannel={channelName}
              channelId={channelData?.id}
              chatroomId={routePlatform === "kick" ? channelData?.chatroomId : undefined}
              kickUserId={routePlatform === "kick" ? channelData?.kickUserId : undefined}
              subscriberBadges={memoizedSubscriberBadges}
            />
          </div>
        </>
      )}
    </div>
  );
}
