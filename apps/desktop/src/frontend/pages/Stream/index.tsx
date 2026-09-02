import { useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { PlayerError } from "@/features/playback/components/player/types";
import { useTwitchLiveRecovery } from "@/features/playback/components/player/hooks/use-twitch-live-recovery";
import { useRegisterDockedPlayerConfig } from "@/features/playback/components/player/persistent-player-shell";
import { OfflineOverlay } from "@/features/playback/components/player/offline-overlay";
import { StreamRecordingControl } from "@/features/media-library/components/recording/stream-recording-control";
import { StreamInfo } from "@/features/playback/components/stream-info";
import { RaidHandoffPopup } from "@/features/playback/components/raid-handoff/raid-handoff-popup";
import { useRaidHandoff } from "@/features/playback/data/use-raid-handoff";
import { useChatDisplay } from "@/features/settings/data/use-chat-display";
import { KickLoadingSpinner, TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { useChannelByUsername } from "@/features/discovery/data/queries/useChannels";
import {
  removeFollowedStreamFromCache,
  useStreamByChannel,
} from "@/features/discovery/data/queries/useStreams";
import { useAfterFirstPaint } from "@/hooks/useAfterFirstPaint";
import { i18n } from "@/i18n";
import { useStreamPlayback } from "@/features/playback/data/useStreamPlayback";
import { logger } from "@/renderer/logging/logger";
import { requirePlatform } from "@/features/playback/routes/route-boundaries";
import { useAppStore } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import { usePipStore } from "@/store/pip-store";
import type { RaidSource, RaidTarget } from "@shared/raid-handoff-types";

let chatPanelModulePromise:
  Promise<typeof import("@/features/chat/components/chat/ChatPanel")> | undefined;
const loadChatPanelModule = () =>
  (chatPanelModulePromise ??= import("@/features/chat/components/chat/ChatPanel"));
const loadChatPanel = () => loadChatPanelModule().then((module) => ({ default: module.ChatPanel }));

const ChatPanel = lazy(loadChatPanel);
const KickLivePlayer = lazy(() =>
  import("@/features/playback/components/player/kick/kick-live-player").then((module) => ({
    default: module.KickLivePlayer,
  }))
);
const TwitchLivePlayer = lazy(() =>
  import("@/features/playback/components/player/twitch/twitch-live-player").then((module) => ({
    default: module.TwitchLivePlayer,
  }))
);
const RelatedContent = lazy(() =>
  import("@/features/playback/components/related-content/index").then((module) => ({
    default: module.RelatedContent,
  }))
);

function normalizeChannelLogin(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function twitchLivePreviewUrl(channelName: string): string {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${normalizeChannelLogin(channelName)}-440x248.jpg`;
}

function isTwitchRecoveryCandidate(error: PlayerError): boolean {
  return (
    error.shouldRefresh === true ||
    error.code === "TOKEN_EXPIRED" ||
    error.code === "NO_FRAGMENTS" ||
    error.code === "STREAM_OFFLINE" ||
    error.code === "DECODER_STALL" ||
    error.code === "PLAYBACK_STALL"
  );
}

function selectChannelDisplayName(
  channelLogin: string,
  channelDisplayName: string | undefined,
  streamDisplayName: string | undefined
): string {
  const login = channelLogin.trim();
  const channelDisplay = channelDisplayName?.trim() ?? "";
  const streamDisplay = streamDisplayName?.trim() ?? "";
  const streamMatchesChannel =
    streamDisplay.length > 0 &&
    normalizeChannelLogin(streamDisplay) === normalizeChannelLogin(login);
  const channelDisplayIsLoginFallback = channelDisplay.length === 0 || channelDisplay === login;

  if (streamMatchesChannel && channelDisplayIsLoginFallback) {
    return streamDisplay;
  }

  return channelDisplay || streamDisplay || login;
}

export function StreamPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const registerDockedConfig = useRegisterDockedPlayerConfig();
  const hasPersistentPlayerShell = registerDockedConfig !== null;
  const canMountHeavyContent = useAfterFirstPaint();
  const { platform, channel: channelName } = useParams({ from: "/_app/stream/$platform/$channel" });
  const routePlatform = requirePlatform(platform);

  // Real data fetching
  const {
    data: channelData,
    isLoading: isChannelLoading,
    isError: isChannelError,
    isPlaceholderData: isChannelPlaceholderData,
    refetch: refetchChannel,
  } = useChannelByUsername(channelName, routePlatform);
  const {
    data: streamData,
    isLoading: isStreamLoading,
    isError: isStreamError,
    isSuccess: isStreamSuccess,
    isPlaceholderData: isStreamPlaceholderData,
    refetch: refetchStream,
  } = useStreamByChannel(channelName, routePlatform);

  const channelDataMatchesRoute =
    channelData != null &&
    channelData.platform === routePlatform &&
    normalizeChannelLogin(channelData.username) === normalizeChannelLogin(channelName);

  useEffect(() => {
    if (
      !channelData ||
      isChannelPlaceholderData !== false ||
      channelData.platform !== routePlatform ||
      normalizeChannelLogin(channelData.username) === normalizeChannelLogin(channelName)
    ) {
      return;
    }

    void navigate({
      to: "/stream/$platform/$channel",
      params: { platform: routePlatform, channel: channelData.username },
      replace: true,
    });
  }, [channelData, channelName, isChannelPlaceholderData, navigate, routePlatform]);
  const streamDataMatchesRoute =
    streamData != null &&
    streamData.platform === routePlatform &&
    normalizeChannelLogin(streamData.channelName) === normalizeChannelLogin(channelName);
  const detailChannelData =
    channelDataMatchesRoute && !isChannelPlaceholderData ? channelData : null;
  const detailStreamData =
    streamDataMatchesRoute && !isStreamPlaceholderData ? streamData : undefined;
  const twitchPoster =
    routePlatform === "twitch"
      ? detailStreamData?.thumbnailUrl?.trim() || twitchLivePreviewUrl(channelName)
      : undefined;
  const visibleDisplayName = selectChannelDisplayName(
    detailChannelData?.username || channelName,
    detailChannelData?.displayName,
    detailStreamData?.channelDisplayName
  );
  const displayChannelData = useMemo(() => {
    if (!detailChannelData || detailChannelData.displayName === visibleDisplayName) {
      return detailChannelData;
    }

    return { ...detailChannelData, displayName: visibleDisplayName };
  }, [detailChannelData, visibleDisplayName]);
  const raidSource = useMemo<RaidSource | null>(() => {
    if (!detailChannelData?.id) return null;
    if (routePlatform === "twitch") {
      return {
        platform: "twitch",
        channelId: detailChannelData.id,
        channelSlug: channelName,
      };
    }
    const broadcasterUserId = detailChannelData.kickUserId || detailChannelData.id;
    return broadcasterUserId
      ? { platform: "kick", broadcasterUserId, channelSlug: channelName }
      : null;
  }, [channelName, detailChannelData, routePlatform]);
  const isRaidSourceCurrent = useCallback(
    (source: RaidSource) =>
      source.platform === routePlatform &&
      normalizeChannelLogin(source.channelSlug) === normalizeChannelLogin(channelName),
    [channelName, routePlatform]
  );
  const joinRaidTarget = useCallback(
    (target: RaidTarget) => {
      if (!raidSource || target.platform !== routePlatform || !isRaidSourceCurrent(raidSource)) {
        return;
      }
      void navigate({
        to: "/stream/$platform/$channel",
        params: { platform: target.platform, channel: target.channelSlug },
        search: { tab: "home" },
        replace: true,
      });
    },
    [isRaidSourceCurrent, navigate, raidSource, routePlatform]
  );
  const raidHandoff = useRaidHandoff({
    source: raidSource,
    isSourceCurrent: isRaidSourceCurrent,
    onJoin: joinRaidTarget,
  });
  const hasRouteMatchedStreamLiveEvidence =
    streamDataMatchesRoute && !isStreamPlaceholderData && streamData?.isLive === true;
  const hasRouteMatchedChannelLiveEvidence =
    channelDataMatchesRoute && !isChannelPlaceholderData && channelData?.isLive === true;
  const hasRouteMatchedStreamOfflineEvidence =
    streamDataMatchesRoute && !isStreamPlaceholderData && streamData?.isLive === false;
  const hasRouteMatchedChannelOfflineEvidence =
    channelDataMatchesRoute && !isChannelPlaceholderData && channelData?.isLive === false;
  const hasAuthoritativeTwitchStreamStatus =
    routePlatform === "twitch" &&
    isStreamSuccess &&
    !isStreamPlaceholderData &&
    (streamData == null || streamDataMatchesRoute);
  const hasMismatchedSuccessfulTwitchStreamStatus =
    routePlatform === "twitch" &&
    isStreamSuccess &&
    !isStreamPlaceholderData &&
    streamData != null &&
    !streamDataMatchesRoute;
  const isStreamLive = hasAuthoritativeTwitchStreamStatus
    ? hasRouteMatchedStreamLiveEvidence
    : hasRouteMatchedStreamLiveEvidence || hasRouteMatchedChannelLiveEvidence;
  const playbackIdentifier =
    routePlatform === "twitch" ? (isStreamLive ? channelName : "") : channelName;

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
  const { cd: chatDisplay } = useChatDisplay();
  const canMountChatPanel =
    routePlatform === "kick"
      ? Boolean(
          channelDataMatchesRoute &&
          channelData?.id &&
          channelData?.kickChannelId &&
          channelData?.chatroomId
        )
      : Boolean(channelDataMatchesRoute && channelData?.id);

  // Theater Mode Logic - synced with app store for sidebar auto-collapse
  const { isTheaterModeActive: isTheater, setTheaterModeActive } = useAppStore();
  const handleToggleTheater = useCallback(
    () => setTheaterModeActive(!isTheater),
    [isTheater, setTheaterModeActive]
  );

  // Player error state (e.g., stream offline even though URL was provided)
  const [playerError, setPlayerError] = useState<PlayerError | null>(null);
  const [blockedPlaybackRevision, setBlockedPlaybackRevision] = useState<number | null>(null);
  const livePlaybackRecheckRef = useRef<{
    streamIdentity: string;
    playbackRevision: number;
  } | null>(null);
  const twitchStatusRecheckRef = useRef<{
    streamIdentity: string;
    playbackRevision: number;
  } | null>(null);

  const handleCheckAgain = useCallback(() => {
    setPlayerError(null);
    void Promise.all([refetchChannel(), refetchStream()]);
  }, [refetchChannel, refetchStream]);

  const handlePlaybackCheckAgain = useCallback(() => {
    setPlayerError(null);
    void Promise.all([refetchChannel(), refetchStream()]);
    reloadPlayback();
  }, [refetchChannel, refetchStream, reloadPlayback]);

  // Track clip dialog state to mute main player
  const [isClipDialogOpen, setIsClipDialogOpen] = useState(false);

  const isStreamMetadataPending = Boolean(
    isChannelLoading || isStreamLoading || isChannelPlaceholderData || isStreamPlaceholderData
  );
  const isStreamMetadataSettled = !isStreamMetadataPending;
  const hasTerminalTwitchStreamError =
    isStreamError &&
    !isStreamLoading &&
    !isStreamPlaceholderData &&
    !hasRouteMatchedStreamLiveEvidence;
  const hasTerminalTwitchMetadataError =
    routePlatform === "twitch" &&
    !hasAuthoritativeTwitchStreamStatus &&
    (hasMismatchedSuccessfulTwitchStreamStatus ||
      hasTerminalTwitchStreamError ||
      (isStreamMetadataSettled && isChannelError));
  const hasAuthoritativeTwitchOfflineStatus = hasAuthoritativeTwitchStreamStatus && !isStreamLive;
  const hasConfirmedKickOfflineStatus =
    routePlatform === "kick" &&
    isStreamMetadataSettled &&
    !isChannelError &&
    !isStreamError &&
    (hasRouteMatchedStreamOfflineEvidence ||
      (hasRouteMatchedChannelOfflineEvidence && !playback?.url));
  const hasConfirmedOfflineMetadata =
    routePlatform === "twitch"
      ? hasAuthoritativeTwitchOfflineStatus ||
        (!hasTerminalTwitchMetadataError &&
          isStreamMetadataSettled &&
          !isStreamLive &&
          isStreamSuccess === undefined &&
          isStreamError === undefined)
      : hasConfirmedKickOfflineStatus;
  const hasConfirmedLiveMetadata =
    (hasAuthoritativeTwitchStreamStatus && hasRouteMatchedStreamLiveEvidence) ||
    (isStreamMetadataSettled && isStreamLive);
  const shouldSuppressPendingTwitchPlayback =
    routePlatform === "twitch" &&
    isStreamMetadataPending &&
    !hasRouteMatchedStreamLiveEvidence &&
    !hasRouteMatchedChannelLiveEvidence;
  const streamIdentity = `${routePlatform}:${normalizeChannelLogin(channelName)}`;
  const playbackIdentity = `${streamIdentity}:${playbackRevision}`;
  const confirmedOfflineStreamRef = useRef<string | null>(null);
  const lastPlaybackIdentityRef = useRef(playbackIdentity);
  const currentPlaybackIdentityRef = useRef(playbackIdentity);

  useLayoutEffect(() => {
    currentPlaybackIdentityRef.current = playbackIdentity;
  }, [playbackIdentity]);

  useEffect(() => {
    if (routePlatform !== "kick" || !hasRouteMatchedStreamOfflineEvidence) return;
    removeFollowedStreamFromCache(queryClient, routePlatform, channelName);
  }, [channelName, hasRouteMatchedStreamOfflineEvidence, queryClient, routePlatform]);

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

      const recheck = {
        streamIdentity,
        playbackRevision,
      };
      livePlaybackRecheckRef.current = recheck;

      logger.debug("Page:Stream", "rechecking live playback", {
        platform: routePlatform,
        channelName,
        code: reason.code,
        message: reason.message,
        playbackRevision,
      });
      if (routePlatform !== "kick") {
        reloadPlayback();
        return;
      }

      void (async () => {
        try {
          const result = await refetchStream();
          if (livePlaybackRecheckRef.current !== recheck) return;
          if (currentPlaybackIdentityRef.current !== playbackIdentity) return;

          const refreshedStream = result.data;
          const refreshedStreamMatchesRoute =
            refreshedStream != null &&
            refreshedStream.platform === routePlatform &&
            normalizeChannelLogin(refreshedStream.channelName) ===
              normalizeChannelLogin(channelName);
          if (!result.isError && refreshedStreamMatchesRoute && refreshedStream.isLive === false) {
            return;
          }

          reloadPlayback();
        } catch {
          if (
            livePlaybackRecheckRef.current === recheck &&
            currentPlaybackIdentityRef.current === playbackIdentity
          ) {
            reloadPlayback();
          }
        }
      })();
    },
    [
      channelName,
      playbackIdentity,
      playbackRevision,
      refetchStream,
      reloadPlayback,
      routePlatform,
      streamIdentity,
    ]
  );

  const recheckTwitchStreamStatus = useCallback(
    (reason: { code: string; message?: string }) => {
      const lastRecheck = twitchStatusRecheckRef.current;
      if (
        lastRecheck?.streamIdentity === streamIdentity &&
        lastRecheck.playbackRevision === playbackRevision
      ) {
        logger.debug("Page:Stream", "Twitch status recheck already attempted for revision", {
          channelName,
          code: reason.code,
          playbackRevision,
        });
        return;
      }

      const recheck = {
        streamIdentity,
        playbackRevision,
      };
      twitchStatusRecheckRef.current = recheck;

      logger.debug("Page:Stream", "rechecking Twitch stream status", {
        channelName,
        code: reason.code,
        message: reason.message,
        playbackRevision,
      });
      void (async () => {
        try {
          const result = await refetchStream();
          if (twitchStatusRecheckRef.current !== recheck) return;

          if (currentPlaybackIdentityRef.current !== playbackIdentity) {
            twitchStatusRecheckRef.current = null;
            return;
          }

          if (result.isError) {
            twitchStatusRecheckRef.current = null;
            return;
          }

          const refreshedStream = result.data;
          const refreshedStreamMatchesRoute =
            refreshedStream != null &&
            refreshedStream.platform === routePlatform &&
            normalizeChannelLogin(refreshedStream.channelName) ===
              normalizeChannelLogin(channelName);

          if (refreshedStreamMatchesRoute && refreshedStream.isLive === true) {
            reloadPlayback();
          }
        } catch {
          if (twitchStatusRecheckRef.current === recheck) {
            twitchStatusRecheckRef.current = null;
          }
        }
      })();
    },
    [
      channelName,
      playbackIdentity,
      playbackRevision,
      refetchStream,
      reloadPlayback,
      routePlatform,
      streamIdentity,
    ]
  );

  const handleTwitchRecoveryExhausted = useCallback(
    (error: PlayerError) => {
      const exhaustedError: PlayerError = {
        ...error,
        code: "PLAYBACK_RECOVERY_EXHAUSTED",
        message: i18n.t("common.playbackRecoveryExhausted"),
        shouldRefresh: false,
      };
      logger.error("Page:Stream", "Twitch playback recovery exhausted", {
        channelName,
        originalCode: error.code,
      });
      setTheaterModeActive(false);
      setPlayerError(exhaustedError);
    },
    [channelName, setTheaterModeActive]
  );
  const twitchRecovery = useTwitchLiveRecovery({
    sessionKey: `stream-page:${streamIdentity}`,
    sourceRevision: playbackRevision,
    onRefresh: reloadPlayback,
    onExhausted: handleTwitchRecoveryExhausted,
  });
  const { handleError: handleTwitchRecoveryError, markPlaybackHealthy: markTwitchPlaybackHealthy } =
    twitchRecovery;

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
        recheckTwitchStreamStatus({ code: error.code, message: error.message });
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
      isUsingProxy,
      isStreamLive,
      routePlatform,
      triggerProxyFallback,
      setTheaterModeActive,
      recheckLivePlayback,
      recheckTwitchStreamStatus,
    ]
  );

  const handleTwitchPlayerError = useCallback(
    (error: PlayerError): boolean | void => {
      if (isTwitchRecoveryCandidate(error)) {
        return handleTwitchRecoveryError(error);
      }
      handlePlayerError(error);
      return false;
    },
    [handlePlayerError, handleTwitchRecoveryError]
  );

  useEffect(() => {
    if (!registerDockedConfig) return;

    return registerDockedConfig({
      muted: isClipDialogOpen,
      isTheater,
      startedAt: detailStreamData?.startedAt,
      poster: twitchPoster,
      onError: routePlatform === "twitch" ? handleTwitchPlayerError : handlePlayerError,
      onCleanPresentedFrame: routePlatform === "twitch" ? markTwitchPlaybackHealthy : undefined,
      onRefresh: reloadPlayback,
      onToggleTheater: handleToggleTheater,
    });
  }, [
    handlePlayerError,
    handleTwitchPlayerError,
    handleToggleTheater,
    isClipDialogOpen,
    isTheater,
    registerDockedConfig,
    reloadPlayback,
    detailStreamData?.startedAt,
    twitchPoster,
    routePlatform,
    markTwitchPlaybackHealthy,
  ]);

  const hasPlayback = Boolean(playback?.url);
  const shouldHoldLivePlayback =
    hasConfirmedLiveMetadata && blockedPlaybackRevision === playbackRevision;
  const shouldSuppressPlayback =
    hasConfirmedOfflineMetadata || shouldHoldLivePlayback || shouldSuppressPendingTwitchPlayback;
  const effectiveStreamUrl = shouldSuppressPlayback
    ? ""
    : playback?.url || (isStreamLive && playback?.url ? playback.url : "");
  const hasEffectiveStreamUrl = Boolean(effectiveStreamUrl);
  const overlayChannelData = displayChannelData ?? undefined;
  const overlayStreamData =
    streamDataMatchesRoute && !isStreamPlaceholderData ? streamData : undefined;
  const overlayDisplayName =
    overlayChannelData?.displayName || overlayStreamData?.channelDisplayName;
  const overlayAvatarUrl = overlayChannelData?.avatarUrl || overlayStreamData?.channelAvatar;
  const overlayBannerUrl = overlayChannelData?.bannerUrl;
  const overlayCategoryName = overlayChannelData?.categoryName || overlayStreamData?.categoryName;
  const overlayStreamTitle = overlayChannelData?.lastStreamTitle || overlayStreamData?.title;
  const shouldShowMetadataErrorOverlay =
    !isPlaybackLoading && !hasEffectiveStreamUrl && !playerError && hasTerminalTwitchMetadataError;
  const shouldShowPlaybackErrorOverlay =
    !isPlaybackLoading &&
    !isStreamMetadataPending &&
    !hasEffectiveStreamUrl &&
    !playerError &&
    Boolean(playbackError) &&
    !hasTerminalTwitchMetadataError &&
    !hasConfirmedOfflineMetadata &&
    !shouldHoldLivePlayback;
  const shouldShowPlayerErrorOverlay = Boolean(playerError);
  const shouldShowOfflineOverlay =
    !isPlaybackLoading &&
    !hasEffectiveStreamUrl &&
    !playerError &&
    (hasConfirmedOfflineMetadata || (shouldHoldLivePlayback && isStreamMetadataSettled));
  const shouldMountLivePlayer =
    canMountHeavyContent &&
    hasEffectiveStreamUrl &&
    !shouldShowMetadataErrorOverlay &&
    !shouldShowPlaybackErrorOverlay &&
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
    const badges = routePlatform === "kick" ? detailChannelData?.subscriberBadges : undefined;
    // Only update reference if badges actually changed
    return badges;
  }, [routePlatform, detailChannelData?.subscriberBadges]);

  // Memoize stream info to prevent effect from running on every streamData update
  // streamData changes every 30s (viewer count), but we only care about title/category changes
  const pipStreamInfo = useMemo(
    () => ({
      platform: routePlatform,
      channelName: channelName,
      channelDisplayName: visibleDisplayName || channelName,
      channelAvatar: detailChannelData?.avatarUrl,
      poster: twitchPoster,
      streamUrl: effectiveStreamUrl,
      title: detailStreamData?.title,
      categoryName: detailStreamData?.categoryName,
      viewerCount: detailStreamData?.viewerCount,
    }),
    [
      routePlatform,
      channelName,
      visibleDisplayName,
      detailChannelData?.avatarUrl,
      twitchPoster,
      effectiveStreamUrl,
      detailStreamData?.title,
      detailStreamData?.categoryName,
      detailStreamData?.viewerCount,
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
            id={hasPersistentPlayerShell ? "persistent-live-player-dock" : undefined}
            className={`${isTheater ? "h-full aspect-video max-w-full" : "aspect-video shrink-0 w-full"} bg-black relative`}
          >
            {/* Platform-specific live stream players */}
            {shouldMountLivePlayer && !hasPersistentPlayerShell && (
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
                    onToggleTheater={handleToggleTheater}
                    startedAt={detailStreamData?.startedAt}
                    channelName={channelName}
                    onRefresh={reloadPlayback}
                  />
                ) : (
                  <TwitchLivePlayer
                    key={`twitch:${channelName}`}
                    streamUrl={effectiveStreamUrl}
                    channelName={channelName}
                    poster={twitchPoster}
                    autoPlay={true}
                    muted={isClipDialogOpen}
                    onReady={() => logger.debug("Page:Stream", "twitch live player ready")}
                    onError={handleTwitchPlayerError}
                    onCleanPresentedFrame={markTwitchPlaybackHealthy}
                    recoveryManagedExternally
                    isTheater={isTheater}
                    onToggleTheater={handleToggleTheater}
                    onRefresh={reloadPlayback}
                  />
                )}
              </Suspense>
            )}
            {/* Show loading only when fetching data */}
            {(isPlaybackLoading || isStreamMetadataPending) &&
              !effectiveStreamUrl &&
              !playbackError &&
              !playerError &&
              !hasTerminalTwitchMetadataError &&
              !hasConfirmedOfflineMetadata && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-20 pointer-events-none">
                  <div className="flex flex-col items-center gap-2">
                    {routePlatform === "kick" ? <KickLoadingSpinner /> : <TwitchLoadingSpinner />}
                  </div>
                </div>
              )}

            {shouldShowMetadataErrorOverlay && (
              <OfflineOverlay
                platform={routePlatform}
                channelName={channelName}
                displayName={overlayDisplayName}
                avatarUrl={overlayAvatarUrl}
                bannerUrl={overlayBannerUrl}
                statusMessage="Unable to check stream status"
                onCheckAgain={handleCheckAgain}
              />
            )}

            {shouldShowPlaybackErrorOverlay && (
              <OfflineOverlay
                platform={routePlatform}
                channelName={channelName}
                displayName={overlayDisplayName}
                avatarUrl={overlayAvatarUrl}
                bannerUrl={overlayBannerUrl}
                statusMessage="Unable to load stream"
                onCheckAgain={handlePlaybackCheckAgain}
              />
            )}

            {shouldShowPlayerErrorOverlay && (
              <OfflineOverlay
                platform={routePlatform}
                channelName={channelName}
                displayName={overlayDisplayName}
                avatarUrl={overlayAvatarUrl}
                bannerUrl={overlayBannerUrl}
                categoryName={overlayCategoryName}
                lastStreamTitle={overlayStreamTitle}
                statusMessage="Playback interrupted"
                onCheckAgain={handlePlaybackCheckAgain}
              />
            )}
            {/* Show offline only after metadata confirms the stream is offline.
                Playback URL/HLS failures can be transient while the channel is
                still live, so those paths recheck instead of showing offline. */}
            {shouldShowOfflineOverlay && (
              <OfflineOverlay
                platform={routePlatform}
                channelName={channelName}
                displayName={overlayDisplayName}
                avatarUrl={overlayAvatarUrl}
                bannerUrl={overlayBannerUrl}
                categoryName={overlayCategoryName}
                lastStreamTitle={overlayStreamTitle}
                onCheckAgain={handleCheckAgain}
              />
            )}
            {raidHandoff.popup && <RaidHandoffPopup model={raidHandoff.popup} />}
          </div>

          <div className={`${isTheater ? "hidden" : "block"} p-6 space-y-6`}>
            <StreamInfo
              channel={displayChannelData}
              stream={detailStreamData}
              isLoading={isChannelLoading || Boolean(isChannelPlaceholderData)}
              recordingAction={
                detailStreamData?.id ? (
                  <StreamRecordingControl
                    platform={routePlatform}
                    channelName={channelName}
                    streamId={detailStreamData.id}
                    title={detailStreamData.title || visibleDisplayName || channelName}
                    isPlayable={hasEffectiveStreamUrl && !playerError}
                  />
                ) : null
              }
            />

            {canMountHeavyContent && (
              <Suspense fallback={null}>
                <RelatedContent
                  platform={routePlatform}
                  channelName={channelName}
                  channelData={displayChannelData}
                  streamStartedAt={detailStreamData?.startedAt}
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
            width: chatDisplay.chatWidthPx,
            minWidth: chatDisplay.chatWidthPx,
            maxWidth: chatDisplay.chatWidthPx,
            boxSizing: "border-box",
          }}
          className="bg-[var(--color-background-secondary)] flex flex-col shrink-0 relative border-l border-[var(--color-border)]"
        >
          {canMountHeavyContent && canMountChatPanel && (
            <Suspense fallback={null}>
              <ChatPanel
                initialPlatform={routePlatform as "twitch" | "kick"}
                initialChannel={channelName}
                channelId={channelData?.id}
                kickChannelId={routePlatform === "kick" ? channelData?.kickChannelId : undefined}
                chatroomId={routePlatform === "kick" ? channelData?.chatroomId : undefined}
                kickUserId={routePlatform === "kick" ? channelData?.kickUserId : undefined}
                isPartnerChannel={routePlatform === "kick" ? channelData?.isPartner : undefined}
                subscriberBadges={memoizedSubscriberBadges}
                badgeCatalogState={
                  routePlatform !== "kick"
                    ? undefined
                    : isChannelLoading
                      ? "loading"
                      : isChannelError
                        ? "failed"
                        : "ready"
                }
                retryBadgeCatalog={() => void refetchChannel()}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
