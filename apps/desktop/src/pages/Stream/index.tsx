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
import type { Platform } from "@/shared/auth-types";
import { useAppStore } from "@/store/app-store";
import { usePipStore } from "@/store/pip-store";

export function StreamPage() {
  const { platform, channel: channelName } = useParams({ from: "/_app/stream/$platform/$channel" });

  // Playback URL resolution
  const {
    playback,
    isLoading: isPlaybackLoading,
    reload: reloadPlayback,
    isUsingProxy,
    retryWithoutProxy,
    reloadAttempts,
  } = useStreamPlayback(platform as Platform, channelName);

  // Real data fetching
  const { data: channelData, isLoading: isChannelLoading } = useChannelByUsername(
    channelName,
    platform as Platform
  );
  const { data: streamData, isLoading: isStreamLoading } = useStreamByChannel(
    channelName,
    platform as Platform
  );

  // Chat Resizing Logic
  const [chatWidth, setChatWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
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
    console.debug("[StreamPage] Triggering fallback to direct stream");
    retryWithoutProxy();
  }, [retryWithoutProxy]);

  const handlePlayerError = useCallback(
    (error: PlayerError) => {
      console.debug(`[StreamPage] handlePlayerError called:`, {
        code: error.code,
        isUsingProxy,
        platform,
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
          console.debug(
            `[StreamPage] ${error.code} - attempting automatic refresh (${reloadAttempts + 1}/3)`
          );

          reloadPlayback(); // Fetch fresh playback URL

          return; // Don't show error, let refresh attempt
        } else {
          console.debug(
            `[StreamPage] Max reload attempts reached for ${error.code}. Showing error.`
          );
        }
      }

      // PROXY_ERROR is specific to proxy server failures (500 errors)
      if (error.code === "PROXY_ERROR" && isUsingProxy && platform === "twitch") {
        triggerProxyFallback();
        return; // Don't show error, let fallback attempt
      }

      // STREAM_OFFLINE is expected when a stream ends - use debug logging
      if (error.code === "STREAM_OFFLINE") {
        console.debug("Stream ended or went offline");

        // If we were using proxy and got a network/offline error, try fallback to direct
        if (isUsingProxy && platform === "twitch") {
          triggerProxyFallback();
          return; // Don't show error yet, let fallback attempt
        }
      } else {
        console.error("Player error", error);

        // Also try fallback for other network errors when using proxy
        if (isUsingProxy && platform === "twitch") {
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
      platform,
      triggerProxyFallback,
      setTheaterModeActive,
      reloadPlayback,
      reloadAttempts,
    ]
  );

  // Reset player error when playback changes
  useEffect(() => {
    setPlayerError(null);
  }, []);

  // Determine if stream is truly live - allow playback if URL exists (optimistic) or confirmed live
  // This allows the player to start buffering while metadata is still fetching
  const isStreamLive = Boolean(streamData?.startedAt);
  const hasPlayback = Boolean(playback?.url);
  const effectiveStreamUrl = playback?.url || (isStreamLive && playback?.url ? playback.url : "");

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

  // Match Twitch's exact theater mode chat width (measured at 1920x1080)
  useEffect(() => {
    if (isTheater) {
      setChatWidth(340); // Twitch theater mode: exactly 340px chat width
    } else {
      setChatWidth(340); // Match Twitch's standard chat width
    }
  }, [isTheater]);

  // Memoize subscriber badges to prevent KickChat from re-mounting when channelData refetches
  // Arrays are compared by reference in React, so we serialize to detect actual changes
  const memoizedSubscriberBadges = useMemo(() => {
    const badges = platform === "kick" ? channelData?.subscriberBadges : undefined;
    // Only update reference if badges actually changed
    return badges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, channelData?.subscriberBadges]);

  // Memoize stream info to prevent effect from running on every streamData update
  // streamData changes every 30s (viewer count), but we only care about title/category changes
  const pipStreamInfo = useMemo(
    () => ({
      platform: platform as Platform,
      channelName: channelName,
      channelDisplayName: channelData?.displayName || channelName,
      channelAvatar: channelData?.avatarUrl,
      streamUrl: effectiveStreamUrl,
      title: streamData?.title,
      categoryName: streamData?.categoryName,
      viewerCount: streamData?.viewerCount,
    }),
    [
      platform,
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

  // Update PiP store with current stream info when we have a live stream
  useEffect(() => {
    if (isStreamLive && effectiveStreamUrl && channelData) {
      setCurrentStream(pipStreamInfo);
    }
  }, [isStreamLive, effectiveStreamUrl, channelData, pipStreamInfo, setCurrentStream]);

  const startResizing = useCallback(() => {
    isResizingRef.current = true;
    setIsResizing(true);
    // Disable iframe pointer events globally to prevent capturing mouse events during drag
    document.body.style.userSelect = "none";
  }, []);

  // Stable callbacks: read isResizing via ref so identity never changes.
  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
    if (!isResizingRef.current) return;
    const newWidth = window.innerWidth - mouseMoveEvent.clientX;
    if (newWidth > 200 && newWidth < 600) {
      setChatWidth(newWidth);
    }
  }, []);

  const stopResizing = useCallback(() => {
    isResizingRef.current = false;
    setIsResizing(false);
    document.body.style.userSelect = "";
  }, []);

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
            {platform === "kick" ? (
              <KickLivePlayer
                streamUrl={effectiveStreamUrl}
                autoPlay={true}
                muted={isClipDialogOpen}
                onReady={() => console.debug("Kick Live Player ready")}
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
                onReady={() => console.debug("Twitch Live Player ready")}
                onError={handlePlayerError}
                isTheater={isTheater}
                onToggleTheater={() => setTheaterModeActive(!isTheater)}
                onRefresh={reloadPlayback}
              />
            )}
            {/* Show loading only when fetching data */}
            {(isPlaybackLoading || isChannelLoading || isStreamLoading) &&
              !effectiveStreamUrl &&
              !playerError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-20 pointer-events-none">
                  <div className="flex flex-col items-center gap-2">
                    {platform === "kick" ? <KickLoadingSpinner /> : <TwitchLoadingSpinner />}
                  </div>
                </div>
              )}

            {playerError && (
              <div className="absolute inset-0 z-20 overflow-hidden">
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
                    <img
                      src={channelData.avatarUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-40"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black" />
                  </>
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-b from-purple-900/50 via-gray-900 to-black" />
                )}
                {/* Content overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {/* Avatar (if available and no banner) */}
                  {channelData?.avatarUrl && !channelData?.bannerUrl && (
                    <div className="mb-6">
                      <img
                        src={channelData.avatarUrl}
                        alt={channelData.displayName || channelName}
                        className="w-24 h-24 rounded-full border-4 border-white/20 shadow-2xl"
                      />
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-white text-3xl font-bold mb-2 drop-shadow-lg">
                      {channelData?.displayName || channelName}
                    </p>
                    <p className="text-white/70 text-lg mb-8">is currently offline</p>
                    <Button
                      variant="outline"
                      size="lg"
                      className="bg-white/10 border-white/30 hover:bg-white/20 backdrop-blur-sm"
                      onClick={() => {
                        setPlayerError(null);
                        reloadPlayback();
                      }}
                    >
                      Check Again
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {/* Show offline screen only when we have NO working playback URL.
                The metadata fetch (streamData) can time out independently of the
                playback fetch; if HLS is loaded and playing, trust that signal —
                the HLS player will surface a `playerError` if the stream actually
                ends mid-watch, which triggers the dedicated overlay above. */}
            {!isPlaybackLoading &&
              !isChannelLoading &&
              !isStreamLoading &&
              !isStreamLive &&
              !hasPlayback &&
              !playerError && (
                <div className="absolute inset-0 z-20 overflow-hidden">
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
                      <img
                        src={channelData.avatarUrl}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-40"
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-b from-purple-900/50 via-gray-900 to-black" />
                  )}
                  {/* Content overlay */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {/* Avatar (if available and no banner) */}
                    {channelData?.avatarUrl && !channelData?.bannerUrl && (
                      <div className="mb-6">
                        <img
                          src={channelData.avatarUrl}
                          alt={channelData.displayName || channelName}
                          className="w-24 h-24 rounded-full border-4 border-white/20 shadow-2xl"
                        />
                      </div>
                    )}
                    <div className="text-center">
                      <p className="text-white text-3xl font-bold mb-2 drop-shadow-lg">
                        {channelData?.displayName || channelName}
                      </p>
                      <p className="text-white/70 text-lg mb-8">is currently offline</p>
                      <Button
                        variant="outline"
                        size="lg"
                        className="bg-white/10 border-white/30 hover:bg-white/20 backdrop-blur-sm"
                        onClick={reloadPlayback}
                      >
                        Check Again
                      </Button>
                    </div>
                  </div>
                </div>
              )}
          </div>

          <div className={`${isTheater ? "hidden" : "block"} p-6 space-y-6`}>
            <StreamInfo
              channel={channelData || null}
              stream={streamData}
              isLoading={isChannelLoading}
            />

            <RelatedContent
              platform={platform as Platform}
              channelName={channelName}
              channelData={channelData}
              onClipSelectionChange={setIsClipDialogOpen}
            />
          </div>
        </div>
      </div>

      {/* Resize Handle */}
      {/* We use a slightly wider invisible hit area for easier grabbing */}
      <div className="relative z-20 shrink-0">
        <div
          className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize"
          onMouseDown={startResizing}
        />
        <div className="w-1 h-full bg-[var(--color-border)] hover:bg-[var(--color-primary)] transition-colors" />
      </div>

      {/* Chat Panel */}
      <div
        style={{ width: chatWidth }}
        className="bg-[var(--color-background-secondary)] flex flex-col shrink-0 relative border-l border-[var(--color-border)]"
      >
        <ChatPanel
          initialPlatform={platform as "twitch" | "kick"}
          initialChannel={channelName}
          channelId={channelData?.id}
          chatroomId={platform === "kick" ? channelData?.chatroomId : undefined}
          subscriberBadges={memoizedSubscriberBadges}
        />
      </div>
    </div>
  );
}
