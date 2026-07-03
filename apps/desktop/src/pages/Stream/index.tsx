import { useParams } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PlayerError } from "@/components/player/types";
import { StreamInfo } from "@/components/stream/stream-info";
import { Button } from "@/components/ui/button";
import { KickLoadingSpinner, TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useChannelByUsername } from "@/hooks/queries/useChannels";
import { useStreamByChannel } from "@/hooks/queries/useStreams";
import { useAfterFirstPaint } from "@/hooks/useAfterFirstPaint";
import { useStreamPlayback } from "@/hooks/useStreamPlayback";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@/shared/auth-types";
import { useAppStore } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import { usePipStore } from "@/store/pip-store";

const CHAT_CONTENT_WIDTH_PX = 340;
const CHAT_BORDER_WIDTH_PX = 1;
const CHAT_RAIL_WIDTH_PX = CHAT_CONTENT_WIDTH_PX + CHAT_BORDER_WIDTH_PX;

const ChatPanel = lazy(() =>
  import("@/components/chat").then((module) => ({ default: module.ChatPanel }))
);
const KickLivePlayer = lazy(() =>
  import("@/components/player/kick").then((module) => ({ default: module.KickLivePlayer }))
);
const TwitchLivePlayer = lazy(() =>
  import("@/components/player/twitch").then((module) => ({ default: module.TwitchLivePlayer }))
);
const RelatedContent = lazy(() =>
  import("@/components/stream/related-content").then((module) => ({
    default: module.RelatedContent,
  }))
);

function normalizeChannelLogin(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

interface OfflineOverlayProps {
  platform: Platform;
  channelName: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  categoryName?: string;
  lastStreamTitle?: string;
  onCheckAgain: () => void;
}

function OfflineOverlay({
  platform,
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
          <ProxiedImage
            src={avatarUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-40"
            fallback={<div className="absolute inset-0 bg-[var(--color-background-secondary)]" />}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/50 via-neutral-900 to-black" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/55 to-black/80" />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
        {avatarUrl && !bannerUrl && (
          <div className="mb-6">
            <PlatformAvatar
              src={avatarUrl}
              alt={name}
              platform={platform}
              size="w-24 h-24"
              className="border-4 border-white/20 shadow-2xl"
              disablePlatformBorder
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
  const canMountHeavyContent = useAfterFirstPaint();
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
    playbackRevision,
  } = useStreamPlayback(routePlatform, playbackIdentifier);

  // U5 — hide-chat-panel reuses the existing ChatPreferences.position field.
  // When "hidden" the panel (and the chat service it mounts) is never
  // rendered, so there's no socket to tear down — the safe path per the
  // websocket-connecting-state learning. The toggle that SETS this lives in U6.
  const isChatHidden = useAuthStore((s) => s.preferences?.chat?.position === "hidden");
  const channelDataMatchesRoute =
    channelData?.platform === routePlatform &&
    normalizeChannelLogin(channelData.username) === normalizeChannelLogin(channelName);
  const canMountChatPanel =
    routePlatform === "kick"
      ? Boolean(channelDataMatchesRoute && channelData?.id && channelData?.chatroomId)
      : Boolean(channelDataMatchesRoute && channelData?.id);

  // Theater Mode Logic - synced with app store for sidebar auto-collapse
  const { isTheaterModeActive: isTheater, setTheaterModeActive } = useAppStore();

  // Player error state (e.g., stream offline even though URL was provided)
  const [playerError, setPlayerError] = useState<PlayerError | null>(null);
  const [blockedPlaybackRevision, setBlockedPlaybackRevision] = useState<number | null>(null);
  const livePlaybackRecheckRef = useRef<{
    streamIdentity: string;
    playbackRevision: number;
  } | null>(null);

  // Track clip dialog state to mute main player
  const [isClipDialogOpen, setIsClipDialogOpen] = useState(false);

  // Determine if stream is truly live - allow playback if URL exists (optimistic) or confirmed live
  // This allows the player to start buffering while metadata is still fetching
  const isStreamLive = Boolean(streamData?.startedAt || channelData?.isLive);
  const isStreamMetadataSettled = !isChannelLoading && !isStreamLoading;
  const hasConfirmedOfflineMetadata = isStreamMetadataSettled && !isStreamLive;
  const hasConfirmedLiveMetadata = isStreamMetadataSettled && isStreamLive;
  const streamIdentity = `${routePlatform}:${normalizeChannelLogin(channelName)}`;
  const playbackIdentity = `${streamIdentity}:${playbackRevision}`;
  const confirmedOfflineStreamRef = useRef<string | null>(null);
  const lastPlaybackIdentityRef = useRef(playbackIdentity);

  useEffect(() => {
    if (lastPlaybackIdentityRef.current === playbackIdentity) return;
    lastPlaybackIdentityRef.current = playbackIdentity;
    setBlockedPlaybackRevision(null);
  }, [playbackIdentity]);

  // Helper to trigger proxy fallback
  const triggerProxyFallback = useCallback(() => {
    logger.debug("Page:Stream", "triggering fallback to direct stream");
    retryWithoutProxy();
  }, [retryWithoutProxy]);

  const recheckLivePlayback = useCallback(
    (reason: { code: string; message?: string }) => {
      const lastRecheck = livePlaybackRecheckRef.current;
      setBlockedPlaybackRevision(playbackRevision);

      if (
        lastRecheck?.streamIdentity === streamIdentity &&
        lastRecheck.playbackRevision === playbackRevision
      ) {
        logger.debug("Page:Stream", "live playback recheck already attempted for revision", {
          platform: routePlatform,
          channelName,
          code: reason.code,
          playbackRevision,
        });
        return;
      }

      livePlaybackRecheckRef.current = {
        streamIdentity,
        playbackRevision,
      };

      logger.debug("Page:Stream", "rechecking live playback", {
        platform: routePlatform,
        channelName,
        code: reason.code,
        message: reason.message,
        playbackRevision,
      });
      reloadPlayback();
    },
    [channelName, playbackRevision, reloadPlayback, routePlatform, streamIdentity]
  );

  const handlePlayerError = useCallback(
    (error: PlayerError) => {
      logger.debug("Page:Stream", "handlePlayerError called", {
        code: error.code,
        isUsingProxy,
        platform: routePlatform,
        message: error.message,
        shouldRefresh: error.shouldRefresh,
      });

      const isTwitchWatchdogSignal =
        routePlatform === "twitch" &&
        (error.code === "NO_FRAGMENTS" ||
          error.code === "STREAM_OFFLINE" ||
          error.code === "DECODER_STALL");
      if (isStreamLive && isTwitchWatchdogSignal) {
        logger.debug("Page:Stream", "ignoring Twitch watchdog signal while metadata is live", {
          code: error.code,
          channelName,
        });
        return;
      }

      const shouldRecheckLivePlayback =
        isStreamLive &&
        (error.code === "TOKEN_EXPIRED" ||
          (routePlatform === "kick" &&
            (error.shouldRefresh === true ||
              error.code === "NO_FRAGMENTS" ||
              error.code === "STREAM_OFFLINE" ||
              error.code === "DECODER_STALL")));
      if (shouldRecheckLivePlayback) {
        recheckLivePlayback({ code: error.code, message: error.message });
        return;
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
      channelName,
      isUsingProxy,
      isStreamLive,
      routePlatform,
      triggerProxyFallback,
      setTheaterModeActive,
      recheckLivePlayback,
    ]
  );

  const hasPlayback = Boolean(playback?.url);
  const shouldHoldLivePlayback =
    hasConfirmedLiveMetadata && blockedPlaybackRevision === playbackRevision;
  const shouldSuppressPlayback = hasConfirmedOfflineMetadata || shouldHoldLivePlayback;
  const effectiveStreamUrl = shouldSuppressPlayback
    ? ""
    : playback?.url || (isStreamLive && playback?.url ? playback.url : "");
  const hasEffectiveStreamUrl = Boolean(effectiveStreamUrl);
  const offlineCategoryName = channelData?.categoryName || streamData?.categoryName;
  const offlineStreamTitle = channelData?.lastStreamTitle || streamData?.title;
  const shouldShowPlayerErrorOverlay = Boolean(playerError) && hasConfirmedOfflineMetadata;
  const shouldShowOfflineOverlay =
    !isPlaybackLoading &&
    !hasEffectiveStreamUrl &&
    !playerError &&
    (hasConfirmedOfflineMetadata || shouldHoldLivePlayback);
  const shouldMountLivePlayer =
    canMountHeavyContent &&
    hasEffectiveStreamUrl &&
    !shouldShowPlayerErrorOverlay &&
    !shouldShowOfflineOverlay;

  // Reset player error when playback changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: the URL is the recovery boundary for stale player errors.
  useEffect(() => {
    setPlayerError(null);
  }, [effectiveStreamUrl, playbackRevision]);

  useEffect(() => {
    if (
      !hasConfirmedLiveMetadata ||
      !playbackError ||
      isPlaybackLoading ||
      hasPlayback ||
      reloadAttempts >= 3
    ) {
      return;
    }

    recheckLivePlayback({ code: "PLAYBACK_URL_ERROR", message: playbackError.message });
  }, [
    hasConfirmedLiveMetadata,
    hasPlayback,
    isPlaybackLoading,
    playbackError,
    reloadAttempts,
    recheckLivePlayback,
  ]);

  useEffect(() => {
    if (hasConfirmedOfflineMetadata) {
      confirmedOfflineStreamRef.current = streamIdentity;
      return;
    }

    if (!hasConfirmedLiveMetadata || confirmedOfflineStreamRef.current !== streamIdentity) return;

    confirmedOfflineStreamRef.current = null;
    logger.debug("Page:Stream", "stream returned online, refreshing playback", {
      platform: routePlatform,
      channelName,
    });
    setPlayerError(null);
    reloadPlayback();
  }, [
    channelName,
    hasConfirmedLiveMetadata,
    hasConfirmedOfflineMetadata,
    reloadPlayback,
    routePlatform,
    streamIdentity,
  ]);

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
  // activate mini-player even if metadata is still catching up. Clear it once
  // this page has proven the stream is offline so stale live state cannot
  // activate the mini-player on the next route.
  useEffect(() => {
    if (effectiveStreamUrl && !playerError) {
      setCurrentStream(pipStreamInfo);
      return;
    }

    if (shouldShowPlayerErrorOverlay || shouldShowOfflineOverlay) {
      setCurrentStream(null);
    }
  }, [
    effectiveStreamUrl,
    pipStreamInfo,
    playerError,
    setCurrentStream,
    shouldShowOfflineOverlay,
    shouldShowPlayerErrorOverlay,
  ]);

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
            {shouldMountLivePlayer && (
              <Suspense fallback={null}>
                {routePlatform === "kick" ? (
                  <KickLivePlayer
                    key={`kick:${channelName}:${playbackRevision}`}
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
                    key={`twitch:${channelName}:${playbackRevision}`}
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
              </Suspense>
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

            {shouldShowPlayerErrorOverlay && (
              <OfflineOverlay
                platform={routePlatform}
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
            {/* Show offline only after metadata confirms the stream is offline.
                Playback URL/HLS failures can be transient while the channel is
                still live, so those paths recheck instead of showing offline. */}
            {shouldShowOfflineOverlay && (
              <OfflineOverlay
                platform={routePlatform}
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

            {canMountHeavyContent && (
              <Suspense fallback={null}>
                <RelatedContent
                  platform={routePlatform}
                  channelName={channelName}
                  channelData={channelData}
                  streamStartedAt={streamData?.startedAt}
                  onClipSelectionChange={setIsClipDialogOpen}
                />
              </Suspense>
            )}
          </div>
        </div>
      </div>

      {/* Chat Panel — hidden entirely when the viewer set
          chat position to "hidden" (U5). Not rendering the panel keeps the
          chat service unmounted, so there's no CONNECTING socket to tear down. */}
      {!isChatHidden && (
        <div
          data-testid="stream-chat-rail"
          style={{
            width: CHAT_RAIL_WIDTH_PX,
            minWidth: CHAT_RAIL_WIDTH_PX,
            maxWidth: CHAT_RAIL_WIDTH_PX,
          }}
          className="bg-[var(--color-background-secondary)] flex flex-col shrink-0 relative border-l border-[var(--color-border)]"
        >
          {canMountHeavyContent && canMountChatPanel && (
            <Suspense fallback={null}>
              <ChatPanel
                initialPlatform={routePlatform as "twitch" | "kick"}
                initialChannel={channelName}
                channelId={channelData?.id}
                chatroomId={routePlatform === "kick" ? channelData?.chatroomId : undefined}
                kickUserId={routePlatform === "kick" ? channelData?.kickUserId : undefined}
                subscriberBadges={memoizedSubscriberBadges}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
