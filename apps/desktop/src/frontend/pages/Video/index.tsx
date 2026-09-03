import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuCircleAlert, LuDownload, LuLock, LuShare2 } from "react-icons/lu";
import { KickVodPlayer } from "@/features/playback/components/player/kick/kick-vod-player";
import { TwitchVodPlayer } from "@/features/playback/components/player/twitch/twitch-vod-player";
import {
  isVideoOrClip,
  type VideoOrClip,
} from "@/features/playback/components/related-content/types";
import { VideoCard } from "@/features/playback/components/related-content/VideoCard";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/components/ui/follow-button";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { useChannelByUsername } from "@/features/discovery/data/queries/useChannels";
import { useHistoryActions } from "@/features/media-library/data/useHistoryQuery";
import { useVodLiveLink } from "@/features/playback/data/useVodLiveLink";
import { useDownloadActions } from "@/features/media-library/data/use-download-actions";
import { useShareAction } from "@/features/playback/data/use-share-action";
import { logger } from "@/renderer/logging/logger";
import { requirePlatform } from "@/features/playback/routes/route-boundaries";
import { useFollowStore } from "@/store/follow-store";
import { ChatReplaySession } from "@/features/chat/components/chat-replay/chat-replay-session";
import { createChatReplayPlaybackStore } from "@/features/chat/data/chat-replay-playback-store";
import { formatCompactNumber } from "@/lib/utils";

interface VideoMetadata {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  channelAvatar: string | null;
  views: number;
  duration: string;
  createdAt: string;
  thumbnailUrl: string;
  description: string;
  type: string;
  platform: string;
  category?: string;
  tags?: string[];
  language?: string;
  isMature?: boolean;
  shareUrl?: string;
}

function formatViews(views: number | string): string {
  const num = typeof views === "string" ? parseInt(views, 10) : views;
  if (Number.isNaN(num)) return "0";
  return formatCompactNumber(num);
}

function formatRelativeDate(dateString: string, language: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (diffDays < 7) return formatter.format(-diffDays, "day");
  if (diffDays < 30) return formatter.format(-Math.floor(diffDays / 7), "week");
  if (diffDays < 365) return formatter.format(-Math.floor(diffDays / 30), "month");
  return formatter.format(-Math.floor(diffDays / 365), "year");
}

function formatLanguage(language: string, displayNames: Intl.DisplayNames): string {
  try {
    return displayNames.of(language) || language;
  } catch {
    return language;
  }
}

export function VideoPage() {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const languageDisplayNames = useMemo(
    () => new Intl.DisplayNames([locale], { type: "language" }),
    [locale]
  );
  const { platform, videoId } = useParams({ from: "/_app/video/$platform/$videoId" });
  const routePlatform = requirePlatform(platform);
  const searchParams = useSearch({ from: "/_app/video/$platform/$videoId" });

  // Extract all metadata from search params
  const {
    src: directSourceUrl,
    title: passedTitle,
    channelName: passedChannelName,
    channelDisplayName: passedChannelDisplayName,
    channelAvatar: passedChannelAvatar,
    thumbnail: passedThumbnail,
    views: passedViews,
    date: passedDate,
    category: passedCategory,
    categoryId: passedCategoryId,
    duration: passedDuration,
    isSubOnly: passedIsSubOnly,
    tags: passedTags,
    language: passedLanguage,
    isMature: passedIsMature,
    shareUrl: passedShareUrl,
  } = searchParams;

  // Check if this is a subscriber-only VOD
  const isSubOnly = passedIsSubOnly === true;

  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [readyPlaybackUrl, setReadyPlaybackUrl] = useState<string | null>(null);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [metadataFailed, setMetadataFailed] = useState(false);
  const [playbackRetryGeneration, setPlaybackRetryGeneration] = useState(0);
  const [_isLoading, setIsLoading] = useState(true);
  const requestGenerationRef = useRef(0);
  const sourceResolvedAtRef = useRef<{ generation: number; resolvedAt: number } | null>(null);
  const activePlaybackRef = useRef<{ generation: number; source: string } | null>(null);
  const retryMetadataRef = useRef<(() => void) | null>(null);
  const playbackRequestsRef = useRef(
    new Map<string, ReturnType<typeof window.electronAPI.videos.getPlaybackUrl>>()
  );
  const metadataRequestsRef = useRef(
    new Map<string, ReturnType<typeof window.electronAPI.videos.getMetadata>>()
  );
  const lastRequestKeyRef = useRef<string | null>(null);
  const lastPlaybackRetryGenerationRef = useRef(0);

  const [relatedVideos, setRelatedVideos] = useState<VideoOrClip[]>([]);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);
  const chatReplaySessionId = `${routePlatform}:${videoId}`;
  const chatReplayPlaybackStore = useMemo(
    () => createChatReplayPlaybackStore(chatReplaySessionId),
    [chatReplaySessionId]
  );
  const canUseDirectSourceUrl = platform === "kick" && Boolean(directSourceUrl);
  const renderedRequestGeneration = requestGenerationRef.current;

  useEffect(() => {
    const requestGeneration = ++requestGenerationRef.current;
    const isCurrentRequest = () => requestGenerationRef.current === requestGeneration;
    const publish = (callback: () => void) => {
      if (isCurrentRequest()) callback();
    };
    const requestKey = `${platform}:${videoId}:${directSourceUrl || ""}`;
    const isPlaybackRetry =
      lastRequestKeyRef.current === requestKey &&
      lastPlaybackRetryGenerationRef.current !== playbackRetryGeneration;
    lastRequestKeyRef.current = requestKey;
    lastPlaybackRetryGenerationRef.current = playbackRetryGeneration;
    const getPlaybackRequest = () => {
      const existingRequest = playbackRequestsRef.current.get(requestKey);
      if (existingRequest) return existingRequest;

      const request = window.electronAPI.videos.getPlaybackUrl({
        platform: platform as "twitch" | "kick",
        videoId,
      });
      playbackRequestsRef.current.set(requestKey, request);
      void request.then(
        () => {
          if (playbackRequestsRef.current.get(requestKey) === request) {
            playbackRequestsRef.current.delete(requestKey);
          }
        },
        () => {
          if (playbackRequestsRef.current.get(requestKey) === request) {
            playbackRequestsRef.current.delete(requestKey);
          }
        }
      );
      return request;
    };
    const getMetadataRequest = () => {
      const existingRequest = metadataRequestsRef.current.get(requestKey);
      if (existingRequest) return existingRequest;

      const request = window.electronAPI.videos.getMetadata({
        platform: platform as "twitch" | "kick",
        videoId,
      });
      metadataRequestsRef.current.set(requestKey, request);
      void request.then(
        () => {
          if (metadataRequestsRef.current.get(requestKey) === request) {
            metadataRequestsRef.current.delete(requestKey);
          }
        },
        () => {
          if (metadataRequestsRef.current.get(requestKey) === request) {
            metadataRequestsRef.current.delete(requestKey);
          }
        }
      );
      return request;
    };

    const fetchVideoData = async () => {
      publish(() => {
        setError(null);
        setStreamUrl(null);
        setReadyPlaybackUrl(null);
        setPlaybackFailed(false);
        setIsLoading(true);
        sourceResolvedAtRef.current = null;
        activePlaybackRef.current = null;
        if (!isPlaybackRetry) {
          setVideoMetadata(null);
          setMetadataFailed(false);
          retryMetadataRef.current = null;
        }
      });

      try {
        if (!window.electronAPI) {
          throw new Error("Electron API not found");
        }

        // Case 0: Subscriber-only VODs - don't try to fetch playback URL
        if (isSubOnly) {
          // Still set metadata for display purposes
          if (passedTitle && passedChannelName) {
            publish(() => {
              setVideoMetadata({
                id: videoId,
                title: passedTitle,
                channelId: "",
                channelName: passedChannelName,
                channelDisplayName: passedChannelDisplayName || passedChannelName,
                channelAvatar: passedChannelAvatar || null,
                views: passedViews ? parseInt(passedViews, 10) : 0,
                duration: passedDuration || "0:00",
                createdAt: passedDate || new Date().toISOString(),
                thumbnailUrl: "",
                description: "",
                type: "archive",
                platform: platform,
                category: passedCategory,
              });
            });
          }
          publish(() => setIsLoading(false));
          return;
        }

        // Case 1: If we have a direct source URL (from video list), use it directly
        // This is the preferred path for Kick VODs since the api/v1/video endpoint
        // requires UUID which we may not have
        if (canUseDirectSourceUrl && directSourceUrl) {
          sourceResolvedAtRef.current = {
            generation: requestGeneration,
            resolvedAt: performance.now(),
          };
          activePlaybackRef.current = { generation: requestGeneration, source: directSourceUrl };
          publish(() => setStreamUrl(directSourceUrl));

          // If we have metadata from search params, use it directly
          if (passedTitle && passedChannelName) {
            publish(() => {
              setVideoMetadata({
                id: videoId,
                title: passedTitle,
                channelId: "",
                channelName: passedChannelName,
                channelDisplayName: passedChannelDisplayName || passedChannelName,
                channelAvatar: passedChannelAvatar || null,
                views: passedViews ? parseInt(passedViews, 10) : 0,
                duration: passedDuration || "0:00",
                createdAt: passedDate || new Date().toISOString(),
                thumbnailUrl: "",
                description: "",
                type: "archive",
                platform: platform,
                category: passedCategory,
              });
            });
            publish(() => setIsLoading(false));
            return;
          }

          // Fallback: fetch presentation data independently from direct playback.
          const fetchMetadata = async () => {
            try {
              const metadataResult = await getMetadataRequest();
              if (!isCurrentRequest()) return;

              if (metadataResult.success && metadataResult.data) {
                setVideoMetadata(metadataResult.data);
                setMetadataFailed(false);
              } else {
                logger.warn("Page:Video", "metadata fetch warning", {
                  error: metadataResult.error,
                });
                setMetadataFailed(true);
              }
            } catch (_metaErr) {
              if (!isCurrentRequest()) return;

              logger.warn("Page:Video", "could not fetch metadata, continuing with video playback");
              setMetadataFailed(true);
            }
          };
          retryMetadataRef.current = () => void fetchMetadata();
          void fetchMetadata();

          publish(() => setIsLoading(false));
          return;
        }

        // Case 2: No direct URL - playback and metadata are independent. The player
        // must not wait for presentation data once its source is resolved.
        void getPlaybackRequest()
          .then((playbackResult) => {
            if (!isCurrentRequest()) return;

            if (playbackResult.success && playbackResult.data) {
              sourceResolvedAtRef.current = {
                generation: requestGeneration,
                resolvedAt: performance.now(),
              };
              activePlaybackRef.current = {
                generation: requestGeneration,
                source: playbackResult.data.url,
              };
              setStreamUrl(playbackResult.data.url);
            } else {
              setError(playbackResult.error || t("playback.failedToResolveVod"));
            }
          })
          .catch((err) => {
            if (!isCurrentRequest()) return;

            logger.error("Page:Video", "failed to resolve video playback", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            setError(t("playback.failedToLoadVideo"));
          })
          .finally(() => publish(() => setIsLoading(false)));

        if (isPlaybackRetry) return;

        const fetchMetadata = async () => {
          try {
            const metadataResult = await getMetadataRequest();
            if (!isCurrentRequest()) return;

            if (metadataResult.success && metadataResult.data) {
              setVideoMetadata(metadataResult.data);
              setMetadataFailed(false);
            } else {
              logger.warn("Page:Video", "metadata fetch warning", { error: metadataResult.error });
              setMetadataFailed(true);
            }
          } catch (_metaErr) {
            if (!isCurrentRequest()) return;

            logger.warn("Page:Video", "could not fetch metadata, continuing with video playback");
            setMetadataFailed(true);
          }
        };
        retryMetadataRef.current = () => void fetchMetadata();
        void fetchMetadata();
      } catch (err) {
        logger.error("Page:Video", "failed to load video", {
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
        publish(() => {
          setError(t("playback.failedToLoadVideo"));
          setIsLoading(false);
        });
      }
    };
    if (videoId) fetchVideoData();
    return () => {
      if (isCurrentRequest()) requestGenerationRef.current += 1;
    };
  }, [
    platform,
    routePlatform,
    videoId,
    directSourceUrl,
    canUseDirectSourceUrl,
    passedTitle,
    passedChannelName,
    passedChannelDisplayName,
    passedChannelAvatar,
    passedViews,
    passedDate,
    passedCategory,
    passedDuration,
    isSubOnly,
    playbackRetryGeneration,
    t,
  ]);

  useEffect(() => {
    const sourceTiming = sourceResolvedAtRef.current;
    if (!streamUrl || !sourceTiming || sourceTiming.generation !== requestGenerationRef.current) {
      return;
    }

    logger.debug("Page:Video", "playback-source-to-player-mounted", {
      platform: routePlatform,
      videoId,
      generation: sourceTiming.generation,
      elapsedMs: Math.round(performance.now() - sourceTiming.resolvedAt),
    });
    sourceResolvedAtRef.current = null;
  }, [routePlatform, streamUrl, videoId]);

  // Use fetched data or passed data or fallbacks
  const hasResolvedVideoTitle = Boolean(videoMetadata?.title || passedTitle);
  const videoTitle =
    videoMetadata?.title ||
    passedTitle ||
    (error ? t("playback.videoUnavailable") : t("playback.loadingVideo"));
  const channelName = videoMetadata?.channelName || passedChannelName || "";
  const hasResolvedChannelName = channelName.trim().length > 0;
  const channelDisplayName =
    videoMetadata?.channelDisplayName || passedChannelDisplayName || passedChannelName || "";
  const visibleChannelName = channelDisplayName || t("playback.channelUnavailable");

  // Resolve the canonical channel for follow identity and as a metadata
  // fallback when a VOD route does not include the channel avatar.
  const { data: channelData } = useChannelByUsername(
    hasResolvedChannelName ? channelName : "",
    routePlatform
  );
  const liveLinkState = useVodLiveLink(hasResolvedChannelName ? channelName : "", routePlatform);
  const canWatchLive = liveLinkState.kind === "available";
  const channelAvatar =
    videoMetadata?.channelAvatar || passedChannelAvatar || channelData?.avatarUrl;
  const canOpenChannel = hasResolvedChannelName;
  const shareUrl =
    videoMetadata?.shareUrl ||
    passedShareUrl ||
    (platform === "twitch" ? `https://www.twitch.tv/videos/${videoId}` : undefined);

  // Save to history
  const { addToHistory, removeFromHistory } = useHistoryActions();
  const historyItemId = `${platform}-video-${videoId}`;
  const historyPlaybackUrl =
    platform === "kick" ? directSourceUrl || streamUrl || undefined : undefined;

  const handlePlaybackReady = (source: string, generation: number) => {
    const activePlayback = activePlaybackRef.current;
    if (activePlayback?.source !== source || activePlayback.generation !== generation) return;

    setReadyPlaybackUrl(source);
  };
  const handlePlaybackError = (source: string, generation: number) => {
    const activePlayback = activePlaybackRef.current;
    if (activePlayback?.source !== source || activePlayback.generation !== generation) return;

    setReadyPlaybackUrl(null);
    setPlaybackFailed(true);
    removeFromHistory(historyItemId);
  };
  const handlePlaybackRetry = () => {
    setPlaybackRetryGeneration((generation) => generation + 1);
  };
  const handleMetadataRetry = () => {
    retryMetadataRef.current?.();
  };

  useEffect(() => {
    if (videoId && hasResolvedVideoTitle) {
      addToHistory({
        id: historyItemId,
        originalId: videoId,
        title: videoTitle,
        thumbnail: videoMetadata?.thumbnailUrl || passedThumbnail || "",
        playbackUrl: historyPlaybackUrl,
        shareUrl,
        platform: routePlatform,
        type: "video",
        channelName: channelName,
        channelDisplayName: channelDisplayName,
        channelAvatar: channelAvatar || null,
      });
    }
  }, [
    routePlatform,
    videoId,
    videoTitle,
    channelName,
    channelDisplayName,
    channelAvatar,
    historyPlaybackUrl,
    passedThumbnail,
    videoMetadata,
    hasResolvedVideoTitle,
    addToHistory,
    historyItemId,
    shareUrl,
  ]);
  const hasViews = videoMetadata ? true : Boolean(passedViews);
  const views = videoMetadata
    ? formatViews(videoMetadata.views)
    : passedViews
      ? formatViews(passedViews)
      : null;
  const hasDate = videoMetadata ? true : Boolean(passedDate);
  const date = videoMetadata
    ? formatRelativeDate(videoMetadata.createdAt, locale)
    : passedDate
      ? formatRelativeDate(passedDate, locale)
      : null;
  const category = videoMetadata?.category || passedCategory;
  const categoryId = passedCategoryId || category;
  const isPlaybackReady = Boolean(
    streamUrl && readyPlaybackUrl === streamUrl && !error && !isSubOnly && !playbackFailed
  );
  const shareAction = useShareAction({
    shareUrl,
    isPlaybackReady,
    contentLabel: "Video",
    contentKey: `${platform}:${videoId}`,
  });
  const { downloadVideo } = useDownloadActions();
  const handleDownload = () => {
    if (!isPlaybackReady || !streamUrl) return;
    void downloadVideo({
      platform: routePlatform,
      videoId,
      title: videoTitle,
      channelName,
      durationSeconds: null,
      thumbnailUrl: videoMetadata?.thumbnailUrl || passedThumbnail,
      playbackUrl: streamUrl,
    });
  };

  const channelForFollow = channelData?.id.trim() ? channelData : null;

  const upgradeFollowIfNeeded = useFollowStore((s) => s.upgradeFollowIfNeeded);
  useEffect(() => {
    if (channelData?.id) {
      upgradeFollowIfNeeded(channelData);
    }
  }, [channelData, upgradeFollowIfNeeded]);

  useEffect(() => {
    let active = true;

    const fetchRelated = async () => {
      if (!hasResolvedChannelName) return;

      setIsRelatedLoading(true);
      try {
        const result = await window.electronAPI.videos.getByChannel({
          platform: routePlatform,
          channelName,
          limit: 100,
        });

        if (active && result.success && Array.isArray(result.data)) {
          setRelatedVideos(result.data.filter(isVideoOrClip));
        }
      } catch (err) {
        logger.error("Page:Video", "failed to fetch related", {
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
      } finally {
        if (active) setIsRelatedLoading(false);
      }
    };

    if (hasResolvedChannelName) void fetchRelated();
    return () => {
      active = false;
    };
  }, [routePlatform, channelName, hasResolvedChannelName]);

  const channelAvatarFallback = visibleChannelName.slice(0, 1).toUpperCase() || "?";
  const channelIdentity = canOpenChannel ? (
    <Link
      to="/stream/$platform/$channel"
      params={{ platform: platform || "twitch", channel: channelName }}
      search={{ tab: "home" }}
      className={`font-bold text-white hover:underline ${platform === "twitch" ? "decoration-[#9146FF]" : "decoration-[#53FC18]"} decoration-2 underline-offset-4`}
    >
      {visibleChannelName}
    </Link>
  ) : (
    <span className="font-bold text-white">{visibleChannelName}</span>
  );

  return (
    <div className="h-full flex overflow-hidden">
      {/* Video Player Area */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className="aspect-video bg-black flex items-center justify-center shrink-0 text-white relative group">
          {isSubOnly ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-purple-600/20 flex items-center justify-center mx-auto mb-4">
                <LuLock className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                {t("playback.subscriberOnlyVod")}
              </h3>
              <p className="text-white/60 max-w-md mx-auto">
                {t("playback.subscriberOnlyVodDescription")}
              </p>
            </div>
          ) : playbackFailed ? (
            <div className="text-center text-red-500">
              <LuCircleAlert className="w-8 h-8 mx-auto mb-2" />
              <p className="mb-3">{t("playback.unableToPlayVideo")}</p>
              <Button type="button" onClick={handlePlaybackRetry}>
                {t("playback.retry")}
              </Button>
            </div>
          ) : streamUrl ? (
            platform === "kick" ? (
              <KickVodPlayer
                streamUrl={streamUrl}
                autoPlay={true}
                className="size-full"
                videoId={videoId}
                title={videoTitle}
                thumbnail={videoMetadata?.thumbnailUrl || passedChannelAvatar || undefined}
                onReady={() => handlePlaybackReady(streamUrl, renderedRequestGeneration)}
                onError={() => handlePlaybackError(streamUrl, renderedRequestGeneration)}
                onPlaybackStateChange={chatReplayPlaybackStore.publish}
                subscribeToSeek={chatReplayPlaybackStore.subscribeToSeek}
              />
            ) : (
              <TwitchVodPlayer
                streamUrl={streamUrl}
                autoPlay={true}
                className="size-full"
                videoId={videoId}
                title={videoTitle}
                thumbnail={videoMetadata?.thumbnailUrl || passedChannelAvatar || undefined}
                onReady={() => handlePlaybackReady(streamUrl, renderedRequestGeneration)}
                onError={() => handlePlaybackError(streamUrl, renderedRequestGeneration)}
                onPlaybackStateChange={chatReplayPlaybackStore.publish}
                subscribeToSeek={chatReplayPlaybackStore.subscribeToSeek}
              />
            )
          ) : error ? (
            <div className="text-center text-red-500">
              <LuCircleAlert className="w-8 h-8 mx-auto mb-2" />
              <p className="mb-3">{error}</p>
              <Button type="button" onClick={handlePlaybackRetry}>
                {t("playback.retry")}
              </Button>
            </div>
          ) : (
            <div className="text-center text-white/50">
              <div className="animate-spin w-8 h-8 border-4 border-white border-t-transparent rounded-full mx-auto mb-2" />
              <p>{t("playback.loadingVod")}</p>
            </div>
          )}
        </div>

        <div className="p-6 space-y-6">
          <div className="flex justify-between items-start gap-4">
            <div className="shrink-0">
              {canOpenChannel ? (
                <Link
                  to="/stream/$platform/$channel"
                  params={{ platform: platform || "twitch", channel: channelName }}
                  search={{ tab: "home" }}
                >
                  {channelAvatar ? (
                    <PlatformAvatar
                      src={channelAvatar}
                      alt={visibleChannelName}
                      platform={routePlatform}
                      size="w-14 h-14"
                      className={`shadow-lg ring-2 ring-offset-2 ring-offset-[var(--color-background)] ${platform === "twitch" ? "ring-[#9146FF] hover:ring-[#9146FF]/80" : "ring-[#53FC18] hover:ring-[#53FC18]/80"} transition-all`}
                      disablePlatformBorder
                    />
                  ) : (
                    <div
                      className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white shadow-lg ${platform === "twitch" ? "bg-[#9146FF]" : "bg-[#53FC18] text-black"} ring-2 ring-offset-2 ring-offset-[var(--color-background)] ${platform === "twitch" ? "ring-[#9146FF] hover:ring-[#9146FF]/80" : "ring-[#53FC18] hover:ring-[#53FC18]/80"} transition-all`}
                    >
                      {channelAvatarFallback}
                    </div>
                  )}
                </Link>
              ) : channelAvatar ? (
                <PlatformAvatar
                  src={channelAvatar}
                  alt={visibleChannelName}
                  platform={routePlatform}
                  size="w-14 h-14"
                  className={`shadow-lg ring-2 ring-offset-2 ring-offset-[var(--color-background)] ${platform === "twitch" ? "ring-[#9146FF] hover:ring-[#9146FF]/80" : "ring-[#53FC18] hover:ring-[#53FC18]/80"} transition-all`}
                  disablePlatformBorder
                />
              ) : (
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white shadow-lg ${platform === "twitch" ? "bg-[#9146FF]" : "bg-[#53FC18] text-black"} ring-2 ring-offset-2 ring-offset-[var(--color-background)] ${platform === "twitch" ? "ring-[#9146FF] hover:ring-[#9146FF]/80" : "ring-[#53FC18] hover:ring-[#53FC18]/80"} transition-all`}
                >
                  {channelAvatarFallback}
                </div>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white mb-1">{videoTitle}</h1>
              <div className="flex items-center gap-3 text-[var(--color-foreground-secondary)] text-sm flex-wrap">
                {channelIdentity}
                {category && (
                  <>
                    <span>•</span>
                    {categoryId ? (
                      <Link
                        to="/categories/$platform/$categoryId"
                        params={{ platform: routePlatform, categoryId }}
                        className={`font-semibold hover:underline ${platform === "twitch" ? "text-[#a970ff] hover:text-[#a970ff]/80" : "text-[#53FC18] hover:text-[#53FC18]/80"}`}
                      >
                        {category}
                      </Link>
                    ) : (
                      <span className="text-[#adadad]">{category}</span>
                    )}
                  </>
                )}
                {hasViews && views ? (
                  <>
                    <span>•</span>
                    <span>
                      {t("playback.viewCount", { value: views, defaultValue: "{{value}} views" })}
                    </span>
                  </>
                ) : null}
                {hasDate && date ? (
                  <>
                    <span>•</span>
                    <span>{date}</span>
                  </>
                ) : null}
              </div>
              {metadataFailed && (
                <Button type="button" variant="ghost" size="sm" onClick={handleMetadataRetry}>
                  {t("playback.retryDetails")}
                </Button>
              )}
              {/* Tags */}
              {(() => {
                const displayLanguage = videoMetadata?.language || passedLanguage;
                const displayIsMature = videoMetadata?.isMature || passedIsMature;
                const displayTags =
                  videoMetadata?.tags ||
                  (passedTags ? (Array.isArray(passedTags) ? passedTags : [passedTags]) : []);
                const hasTags = displayLanguage || displayIsMature || displayTags.length > 0;

                if (!hasTags) return null;

                return (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {/* Language Tag */}
                    {displayLanguage && (
                      <span className="text-xs px-3 py-1 rounded-full font-medium bg-[#4a4d55] text-[#efeff1] hover:bg-[#5a5d66] transition-colors cursor-default">
                        {formatLanguage(displayLanguage, languageDisplayNames)}
                      </span>
                    )}
                    {/* Mature Content Tag */}
                    {displayIsMature && (
                      <span className="text-xs px-3 py-1 rounded-full font-medium bg-[#4a4d55] text-[#efeff1] hover:bg-[#5a5d66] transition-colors cursor-default">
                        18+
                      </span>
                    )}
                    {/* Custom Tags */}
                    {displayTags.length > 0 &&
                      displayTags.map((tag: string, index: number) => (
                        <span
                          key={`${tag}-${index}`}
                          className="text-xs px-3 py-1 rounded-full font-medium bg-[#4a4d55] text-[#efeff1] hover:bg-[#5a5d66] transition-colors cursor-default"
                        >
                          {tag}
                        </span>
                      ))}
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-4">
              {channelForFollow ? <FollowButton channel={channelForFollow} size="sm" /> : null}
              <Button
                className="rounded-full font-bold bg-neutral-800 hover:bg-neutral-700 text-white border-transparent gap-2"
                size="sm"
                onClick={() => void shareAction.share()}
                disabled={!shareAction.canShare}
                title={!shareAction.canShare ? shareAction.unavailableTitle : undefined}
              >
                {shareAction.copied ? (
                  <LuCheck aria-hidden="true" />
                ) : (
                  <LuShare2 aria-hidden="true" />
                )}
                {shareAction.copied ? t("playback.copied") : t("playback.share")}
              </Button>
              <Button
                className="rounded-full font-bold bg-neutral-800 hover:bg-neutral-700 text-white border-transparent gap-2"
                size="sm"
                onClick={handleDownload}
                disabled={!isPlaybackReady}
                title={!isPlaybackReady ? t("playback.videoDownloadReady") : undefined}
              >
                <LuDownload aria-hidden="true" />
                {t("playback.download")}
              </Button>
              {canOpenChannel && canWatchLive && (
                <Link
                  to="/stream/$platform/$channel"
                  params={{ platform: platform || "twitch", channel: channelName }}
                  search={{ tab: "home" }}
                >
                  <Button
                    className="rounded-full font-bold bg-neutral-800 hover:bg-neutral-700 text-white border-transparent gap-2"
                    size="sm"
                  >
                    {t("playback.watchLive")}
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {/* Related Videos */}
          {hasResolvedChannelName ? (
            <div>
              <h2 className="text-lg font-bold text-white mb-4">
                {t("playback.moreFrom", { channel: visibleChannelName })}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {isRelatedLoading ? (
                  Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="space-y-3">
                      <div className="aspect-video bg-[var(--color-background-tertiary)] rounded-xl animate-pulse" />
                      <div className="space-y-2">
                        <div className="h-4 bg-[var(--color-background-tertiary)] rounded w-3/4 animate-pulse" />
                        <div className="h-3 bg-[var(--color-background-tertiary)] rounded w-1/2 animate-pulse" />
                      </div>
                    </div>
                  ))
                ) : relatedVideos.length > 0 ? (
                  relatedVideos
                    .filter((v) => v.id !== videoId)
                    .map((video) => (
                      <div key={video.id} className="h-full">
                        <VideoCard
                          video={video}
                          platform={routePlatform}
                          channelName={channelName}
                          channelData={{
                            id: "",
                            platform: routePlatform,
                            username: channelName,
                            displayName: channelDisplayName || channelName,
                            avatarUrl: channelAvatar || "",
                            isLive: false,
                            isVerified: false,
                            isPartner: false,
                          }}
                        />
                      </div>
                    ))
                ) : (
                  <p className="text-[var(--color-foreground-muted)] col-span-full">
                    {t("playback.noOtherVideos")}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ChatReplaySession
        platform={routePlatform}
        videoId={videoId}
        playbackStore={chatReplayPlaybackStore}
      />
    </div>
  );
}
