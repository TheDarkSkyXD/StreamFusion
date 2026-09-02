import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import React, { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { prewarmViewportImages } from "@/lib/viewport-image-prewarm";
import { logger } from "@/renderer/logging/logger";

import { ClipCard } from "./ClipCard";
import { ClipDialog } from "./ClipDialog";
import { ContentTabs, type SortOption } from "./ContentTabs";
import {
  parsePlaybackQualities,
  parseVideoOrClips,
  type RelatedContentProps,
  type VideoOrClip,
} from "./types";
import { VideoCard } from "./VideoCard";

export type TimeRange = "day" | "week" | "month" | "all";

const EAGER_RELATED_CARD_COUNT = 9;
const RELATED_CARD_ROOT_MARGIN = "320px 0px";
const relatedContentRequestCache = new Map<string, Promise<void>>();

function prewarmRelatedContentImages(requestKey: string, items: VideoOrClip[]): void {
  if (relatedContentRequestCache.has(requestKey)) return;

  const imageUrls = items.map((item) => item.thumbnailUrl);
  if (imageUrls.length === 0) return;

  const request = prewarmViewportImages(imageUrls);
  relatedContentRequestCache.set(requestKey, request);
}

export function _resetRelatedContentRequestCache(): void {
  relatedContentRequestCache.clear();
}

function LazyRelatedCard({ eager, children }: { eager: boolean; children: React.ReactNode }) {
  const { t } = useTranslation();
  const [shouldRender, setShouldRender] = useState(eager);
  const ref = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setShouldRender(entry.isIntersecting);
        }
      },
      { rootMargin: RELATED_CARD_ROOT_MARGIN }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="min-h-[220px]"
      data-related-card-mounted={shouldRender ? "true" : "false"}
    >
      {shouldRender ? (
        children
      ) : (
        <div
          aria-hidden="true"
          data-testid="deferred-related-card"
          className="h-full min-h-[220px] rounded-md bg-[var(--color-background-secondary)]/40"
        />
      )}
    </div>
  );
}

export function RelatedContent({
  platform,
  channelName,
  channelData,
  streamStartedAt,
  onClipSelectionChange,
}: RelatedContentProps) {
  const { t } = useTranslation();
  const urlTab = useRouterState({
    select: (state) => {
      const tab = state.location.search.tab;
      return tab === "home" || tab === "videos" || tab === "clips" ? tab : undefined;
    },
  });
  const activeTab = urlTab ?? "home";

  const [isLoading, setIsLoading] = useState(true);
  const [videos, setVideos] = useState<VideoOrClip[]>([]);
  const [clips, setClips] = useState<VideoOrClip[]>([]);
  const [selectedClip, setSelectedClip] = useState<VideoOrClip | null>(null);
  const [clipPlaybackUrl, setClipPlaybackUrl] = useState<string | null>(null);
  const [clipQualities, setClipQualities] = useState<
    { quality: string; url: string }[] | undefined
  >(undefined);
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    try {
      // Load saved preference from localStorage
      const saved = localStorage.getItem("content-sort-preference");
      return saved === "recent" || saved === "views" ? saved : "views";
    } catch (error) {
      logger.warn("Stream:Related", "failed to load sort preference", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "views";
    }
  });

  // Persist sort preference to localStorage when it changes

  useEffect(() => {
    try {
      localStorage.setItem("content-sort-preference", sortBy);
    } catch (error) {
      logger.error("Stream:Related", "failed to save sort preference", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [sortBy]);

  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    try {
      // Load saved preference from localStorage
      const saved = localStorage.getItem("clips-filter-preference");
      return saved === "day" || saved === "week" || saved === "month" || saved === "all"
        ? saved
        : "all";
    } catch (error) {
      logger.warn("Stream:Related", "failed to load time range preference", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "all";
    }
  });

  // Persist time range preference to localStorage when it changes

  useEffect(() => {
    try {
      localStorage.setItem("clips-filter-preference", timeRange);
    } catch (error) {
      logger.error("Stream:Related", "failed to save time range preference", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [timeRange]);

  // Bumped to force the initial-fetch effect to rerun (e.g. when the stream
  // ends and the latest VOD needs to appear).
  const [reloadKey, setReloadKey] = useState(0);

  // Detect the stream's live→offline transition. The new VOD record is
  // published right around stream end (created_at is stream start), so a short
  // delay lets Kick/Twitch finalize it before we refetch. Fires at most once
  // per transition; if the stream comes back live and ends again, it rearms.
  const prevStartedAtRef = React.useRef<string | null | undefined>(streamStartedAt);
  const offlineRefetchTimer = useManagedTimeout(
    useCallback(() => {
      setReloadKey((k) => k + 1);
    }, [])
  );
  useEffect(() => {
    const wasLive = Boolean(prevStartedAtRef.current);
    const isLive = Boolean(streamStartedAt);
    prevStartedAtRef.current = streamStartedAt;
    if (wasLive && !isLive) {
      offlineRefetchTimer.start(5000);
    }
  }, [streamStartedAt, offlineRefetchTimer]);

  // Pagination State
  const [videoCursor, setVideoCursor] = useState<string | undefined>(undefined);
  const [clipCursor, setClipCursor] = useState<string | undefined>(undefined);
  const [hasMoreVideos, setHasMoreVideos] = useState(true);
  const [hasMoreClips, setHasMoreClips] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  // Intersection Observer for infinite scroll
  // Intersection Observer for infinite scroll
  const loadMoreRef = React.useRef<HTMLDivElement>(null);
  const errorDismissTimer = useManagedTimeout(
    useCallback(() => {
      setError(null);
    }, [])
  );

  const [clipLoading, setClipLoading] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  // Notify parent about clip selection state (for muting main player)
  useEffect(() => {
    onClipSelectionChange?.(!!selectedClip);
  }, [selectedClip, onClipSelectionChange]);

  // Initial Fetch (Resets list)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` is the user-triggered re-fetch counter; the body doesn't read it
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      setError(null);
      setVideoCursor(undefined);
      setClipCursor(undefined);
      setHasMoreVideos(true);
      setHasMoreClips(true);

      try {
        const api = window.electronAPI;
        if (!api) return;

        const targetTab = activeTab || "home";

        if (targetTab === "home") {
          // Fetch both recent videos and popular clips for the home dashboard
          const [videosResult, clipsResult] = await Promise.all([
            api.videos.getByChannel({
              platform,
              channelName,
              channelId: channelData?.id,
              limit: 5,
              sort: "date", // Recent videos
            }),
            api.clips.getByChannel({
              platform,
              channelName,
              channelId: channelData?.id,
              limit: 5,
              sort: t("playback.views"), // Popular clips
              timeRange: "all",
            }),
          ]);

          if (videosResult.success) {
            const nextVideos = parseVideoOrClips(videosResult.data);
            setVideos(nextVideos);
            prewarmRelatedContentImages(
              `${platform}:${channelName}:home`,
              nextVideos.concat(clipsResult.success ? parseVideoOrClips(clipsResult.data) : [])
            );
            // No cursor needed for home view
          }

          if (clipsResult.success) {
            setClips(parseVideoOrClips(clipsResult.data));
            if (!videosResult.success) {
              prewarmRelatedContentImages(
                `${platform}:${channelName}:home`,
                parseVideoOrClips(clipsResult.data)
              );
            }
          }

          if (!videosResult.success && !clipsResult.success) {
            setError(t("playback.failedToLoadHomeContent"));
          }
        } else if (targetTab === "videos") {
          const result = await api.videos.getByChannel({
            platform,
            channelName,
            channelId: channelData?.id,
            limit: 20,
            sort: sortBy === "views" ? "views" : "date",
          });
          if (result.success) {
            const nextVideos = parseVideoOrClips(result.data);
            setVideos(nextVideos);
            prewarmRelatedContentImages(`${platform}:${channelName}:videos`, nextVideos);
            setVideoCursor(result.cursor);
            setHasMoreVideos(!!result.cursor);
            setDebugInfo(result.debug || null);
          } else {
            setError(result.error || t("playback.failedToFetchVideos"));
          }
        } else if (targetTab === "clips") {
          const result = await api.clips.getByChannel({
            platform,
            channelName,
            channelId: channelData?.id,
            limit: 20,
            sort: sortBy === "views" ? "views" : "date",
            timeRange: timeRange,
          });
          if (result.success) {
            const nextClips = parseVideoOrClips(result.data);
            setClips(nextClips);
            prewarmRelatedContentImages(`${platform}:${channelName}:clips`, nextClips);
            setClipCursor(result.cursor);
            setHasMoreClips(!!result.cursor);
          } else {
            setError(result.error || t("playback.failedToFetchClips"));
          }
        }
      } catch (error) {
        logger.error("Stream:Related", "failed to fetch content", {
          error: error instanceof Error ? error.message : String(error),
        });
        setError(t("playback.failedToLoadContent"));
      } finally {
        setIsLoading(false);
      }
    };

    if (platform && channelName) {
      fetchInitialData();
    }
  }, [activeTab, platform, channelName, channelData?.id, sortBy, timeRange, reloadKey, t]);

  // Load More Function
  const loadMore = useCallback(async () => {
    if (isFetchingMore || isLoading) return;

    const targetTab = activeTab || "home";
    // Home tab doesn't use infinite scroll
    if (targetTab === "home") return;
    if (targetTab === "videos" && !hasMoreVideos) return;
    if (targetTab === "clips" && !hasMoreClips) return;

    setIsFetchingMore(true);
    try {
      const api = window.electronAPI;
      if (!api) {
        logger.error("Stream:Related", "API not available for loading more items");
        return;
      }

      if (targetTab === "videos") {
        const result = await api.videos.getByChannel({
          platform,
          channelName,
          channelId: channelData?.id,
          limit: 20,
          cursor: videoCursor,
          sort: sortBy === "views" ? "views" : "date",
        });
        if (result.success) {
          const newVideos = parseVideoOrClips(result.data);

          // Stop if no videos returned
          if (newVideos.length === 0) {
            logger.debug("Stream:Related", "no more videos to fetch");
            setHasMoreVideos(false);
            return;
          }

          // Filter duplicates
          const existingIds = new Set(videos.map((v) => v.id));
          const uniqueNewVideos = newVideos.filter((v: VideoOrClip) => !existingIds.has(v.id));

          // Stop if all returned videos are duplicates (we've looped back)
          if (uniqueNewVideos.length === 0) {
            logger.debug("Stream:Related", "all videos are duplicates, stopping");
            setHasMoreVideos(false);
            return;
          }

          // Stop if cursor hasn't changed (stuck in a loop)
          if (result.cursor && result.cursor === videoCursor) {
            logger.debug("Stream:Related", "video cursor unchanged, stopping");
            setHasMoreVideos(false);
            return;
          }

          setVideos((prev) => [...prev, ...uniqueNewVideos]);
          setVideoCursor(result.cursor);

          // Trust the cursor: if upstream said "more", believe it. A partial
          // page with a cursor is a legitimate intermediate state.
          if (!result.cursor) {
            logger.debug("Stream:Related", "no cursor, stopping videos");
            setHasMoreVideos(false);
          }
        } else {
          // API error - stop trying
          setHasMoreVideos(false);
        }
      } else if (targetTab === "clips") {
        const result = await api.clips.getByChannel({
          platform,
          channelName,
          channelId: channelData?.id,
          limit: 20,
          cursor: clipCursor,
          sort: sortBy === "views" ? "views" : "date",
          timeRange: timeRange,
        });
        if (result.success) {
          const newClips = parseVideoOrClips(result.data);

          // Stop if no clips returned
          if (newClips.length === 0) {
            logger.debug("Stream:Related", "no more clips to fetch");
            setHasMoreClips(false);
            return;
          }

          // Filter duplicates
          const existingIds = new Set(clips.map((c) => c.id));
          const uniqueNewClips = newClips.filter((c: VideoOrClip) => !existingIds.has(c.id));

          // Stop if all returned clips are duplicates
          if (uniqueNewClips.length === 0) {
            logger.debug("Stream:Related", "all clips are duplicates, stopping");
            setHasMoreClips(false);
            return;
          }

          // Stop if cursor hasn't changed
          if (result.cursor && result.cursor === clipCursor) {
            logger.debug("Stream:Related", "clip cursor unchanged, stopping");
            setHasMoreClips(false);
            return;
          }

          setClips((prev) => [...prev, ...uniqueNewClips]);
          setClipCursor(result.cursor);

          // Trust the cursor: if upstream said "more", believe it. A partial
          // page with a cursor is a legitimate intermediate state.
          if (!result.cursor) {
            logger.debug("Stream:Related", "no cursor, stopping clips");
            setHasMoreClips(false);
          }
        } else {
          // API error - stop trying
          setHasMoreClips(false);
        }
      }
    } catch (err) {
      logger.error("Stream:Related", "error loading more items", {
        error: err instanceof Error ? err.message : String(err),
      });
      setError(t("playback.failedToLoadMoreItems"));
      errorDismissTimer.start(3000);
    } finally {
      setIsFetchingMore(false);
    }
  }, [
    isFetchingMore,
    isLoading,
    activeTab,
    hasMoreVideos,
    hasMoreClips,
    platform,
    channelName,
    channelData?.id,
    sortBy,
    timeRange,
    videoCursor,
    clipCursor,
    videos,
    clips,
    errorDismissTimer,
    t,
  ]);

  // Intersection Observer Effect
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [loadMore]);

  // Fetch clip playback URL when a clip is selected
  useEffect(() => {
    if (!selectedClip) {
      setClipPlaybackUrl(null);
      setClipQualities(undefined);
      setClipError(null);
      return;
    }

    const fetchClipUrl = async () => {
      setClipLoading(true);
      setClipError(null);

      try {
        const api = window.electronAPI;
        if (!api) {
          throw new Error("Electron API not found");
        }

        const clipUrlToUse = selectedClip.embedUrl || selectedClip.url;

        const clipPlatform = selectedClip.platform ?? platform;
        const result = await api.clips.getPlaybackUrl({
          platform: clipPlatform,
          clipId: selectedClip.id,
          clipUrl: clipUrlToUse,
        });

        if (result.success && result.data) {
          setClipPlaybackUrl(result.data.url);
          setClipQualities(parsePlaybackQualities(result.data));
        } else {
          logger.error("Stream:Related", "failed to get clip URL", { error: result.error });
          // For Twitch, we'll fall back to iframe embed
          if (clipPlatform === "twitch") {
            setClipPlaybackUrl(null); // Signal to use iframe
          } else {
            setClipError(result.error || t("playback.failedToLoadClip"));
          }
        }
      } catch (err) {
        logger.error("Stream:Related", "error fetching clip URL", {
          error: err instanceof Error ? err.message : String(err),
        });
        // For Twitch, we'll fall back to iframe embed
        if ((selectedClip.platform ?? platform) === "twitch") {
          setClipPlaybackUrl(null);
        } else {
          setClipError(t("playback.failedToLoadClip"));
        }
      } finally {
        setClipLoading(false);
      }
    };

    fetchClipUrl();
  }, [selectedClip, platform, t]);

  const handleClipPlaybackError = () => {
    if ((selectedClip?.platform ?? platform) === "twitch") {
      setClipPlaybackUrl(null);
    } else {
      setClipError(t("playback.failedToPlayClip"));
    }
  };

  return (
    <div className="space-y-6">
      {/* Tabs Navigation */}
      <ContentTabs activeTab={activeTab} />

      {/* Tab Content */}
      <div className="space-y-4">
        <div className="flex items-center justify-start gap-4">
          {/* Sort Dropdown - Relocated here */}
          {!activeTab || activeTab === "home" ? null : (
            <div className="flex items-center gap-2 text-sm">
              {activeTab === "clips" && (
                <div className="flex items-center gap-2 mr-4">
                  <span className="text-[var(--color-foreground)] font-bold">
                    {t("playback.filterBy")}
                  </span>
                  <Select
                    value={timeRange}
                    onValueChange={(value) => setTimeRange(value as TimeRange)}
                  >
                    <SelectTrigger className="w-auto min-w-[100px] h-10 bg-[var(--color-background-secondary)] border-none font-bold px-4 text-base">
                      <SelectValue placeholder={t("playback.time")} />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="day" className="font-bold">
                        {t("playback.lastDay")}
                      </SelectItem>
                      <SelectItem value="week" className="font-bold">
                        {t("playback.lastWeek")}
                      </SelectItem>
                      <SelectItem value="month" className="font-bold">
                        {t("playback.lastMonth")}
                      </SelectItem>
                      <SelectItem value="all" className="font-bold">
                        {t("playback.allTime")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <span className="text-[var(--color-foreground)] font-bold">
                {t("playback.sortBy")}
              </span>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                <SelectTrigger className="w-auto min-w-[90px] h-10 bg-[var(--color-background-secondary)] border-none font-bold px-4 text-base">
                  <SelectValue placeholder={t("playback.sort")} />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="recent" className="font-bold">
                    {t("playback.mostRecent")}
                  </SelectItem>
                  <SelectItem value={t("playback.views")} className="font-bold">
                    {t("playback.views2")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {!activeTab || activeTab === "home" ? (
          <div className="space-y-10 animate-in fade-in duration-300">
            {/* Videos Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">{t("playback.streamVideos")}</h3>
                <Link
                  from="/stream/$platform/$channel"
                  search={{ tab: "videos" }}
                  className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                >
                  {t("playback.viewAll")}
                </Link>
              </div>
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="space-y-3">
                      <Skeleton className="aspect-video rounded-xl" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ))}
                </div>
              ) : videos.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {videos.slice(0, 4).map((video) => (
                    <VideoCard
                      key={video.id}
                      video={video}
                      platform={platform}
                      channelName={channelName}
                      channelData={channelData}
                      showWatchProgress
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[var(--color-foreground-muted)]">
                  {t("playback.noRecentVideosFound")}
                </p>
              )}
            </section>

            {/* Clips Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">{t("playback.popularClips")}</h3>
                <Link
                  from="/stream/$platform/$channel"
                  search={{ tab: "clips" }}
                  className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                >
                  {t("playback.viewAll")}
                </Link>
              </div>
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="space-y-3">
                      <Skeleton className="aspect-video rounded-xl" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ))}
                </div>
              ) : clips.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {clips.slice(0, 4).map((clip) => (
                    <ClipCard
                      key={clip.id}
                      clip={clip}
                      onClick={() => setSelectedClip(clip)}
                      platform={platform}
                      channelName={channelName}
                      channelData={channelData}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[var(--color-foreground-muted)]">
                  {t("playback.noPopularClipsFound")}
                </p>
              )}
            </section>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="aspect-video rounded-xl" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))
            ) : error ? (
              <div className="col-span-full py-12 text-center text-red-400">
                <p>{error}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.location.reload()}
                  className="mt-2"
                >
                  {t("playback.retry")}
                </Button>
              </div>
            ) : activeTab === "videos" ? (
              videos.length > 0 ? (
                videos.map((video, index) => (
                  <LazyRelatedCard key={video.id} eager={index < EAGER_RELATED_CARD_COUNT}>
                    <VideoCard
                      video={video}
                      platform={platform}
                      channelName={channelName}
                      channelData={channelData}
                      showWatchProgress
                    />
                  </LazyRelatedCard>
                ))
              ) : (
                <div className="col-span-full py-12 text-center text-[var(--color-foreground-muted)]">
                  {t("playback.noVideosFound")}
                  {debugInfo && <p className="text-xs mt-2 opacity-50 font-mono">{debugInfo}</p>}
                </div>
              )
            ) : clips.length > 0 ? (
              clips.map((clip, index) => (
                <LazyRelatedCard key={clip.id} eager={index < EAGER_RELATED_CARD_COUNT}>
                  <ClipCard
                    clip={clip}
                    onClick={() => setSelectedClip(clip)}
                    platform={platform}
                    channelName={channelName}
                    channelData={channelData}
                  />
                </LazyRelatedCard>
              ))
            ) : (
              <div className="col-span-full py-12 text-center text-[var(--color-foreground-muted)]">
                {t("playback.noClipsFound")}
              </div>
            )}

            {/* Sentinel for infinite scroll - only render when there's more data */}
            {((activeTab === "videos" && hasMoreVideos && videos.length > 0) ||
              (activeTab === "clips" && hasMoreClips && clips.length > 0)) && (
              <div ref={loadMoreRef} className="col-span-full h-4 w-full" />
            )}

            {isFetchingMore &&
              [...Array(3)].map((_, i) => (
                <div key={`load-more-skeleton-${i}`} className="space-y-3">
                  <Skeleton className="aspect-video rounded-xl" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {selectedClip ? (
        <ClipDialog
          selectedClip={selectedClip}
          onClose={() => setSelectedClip(null)}
          clipLoading={clipLoading}
          clipError={clipError}
          clipPlaybackUrl={clipPlaybackUrl}
          clipQualities={clipQualities}
          platform={platform}
          channelName={channelName}
          channelData={channelData}
          onPlaybackError={handleClipPlaybackError}
        />
      ) : null}
    </div>
  );
}

// Re-export types for external use
export type { RelatedContentProps, VideoOrClip } from "./types";
