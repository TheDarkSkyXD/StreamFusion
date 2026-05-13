import { Link, useSearch } from "@tanstack/react-router";
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

import { ClipCard } from "./ClipCard";
import { ClipDialog } from "./ClipDialog";
import { ContentTabs, type SortOption } from "./ContentTabs";
import type { RelatedContentProps, VideoOrClip } from "./types";
import { VideoCard } from "./VideoCard";

export type TimeRange = "day" | "week" | "month" | "all";

export function RelatedContent({
  platform,
  channelName,
  channelData,
  onClipSelectionChange,
}: RelatedContentProps) {
  const { tab: urlTab } = useSearch({ from: "/_app/stream/$platform/$channel" });
  const [savedTab, setSavedTab] = useState<"home" | "videos" | "clips">(() => {
    try {
      const s = localStorage.getItem("stream-tab-preference");
      return s === "home" || s === "videos" || s === "clips" ? s : "home";
    } catch {
      return "home";
    }
  });
  const activeTab = urlTab ?? savedTab;

  useEffect(() => {
    if (!urlTab) return;
    setSavedTab(urlTab);
    try {
      localStorage.setItem("stream-tab-preference", urlTab);
    } catch (error) {
      console.warn("Failed to save stream tab preference:", error);
    }
  }, [urlTab]);

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
      console.warn("Failed to load sort preference:", error);
      return "views";
    }
  });

  // Persist sort preference to localStorage when it changes

  useEffect(() => {
    try {
      localStorage.setItem("content-sort-preference", sortBy);
    } catch (error) {
      console.error("Failed to save sort preference:", error);
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
      console.warn("Failed to load time range preference:", error);
      return "all";
    }
  });

  // Persist time range preference to localStorage when it changes

  useEffect(() => {
    try {
      localStorage.setItem("clips-filter-preference", timeRange);
    } catch (error) {
      console.error("Failed to save time range preference:", error);
    }
  }, [timeRange]);

  // Pagination State
  const [videoCursor, setVideoCursor] = useState<string | undefined>(undefined);
  const [clipCursor, setClipCursor] = useState<string | undefined>(undefined);
  const [hasMoreVideos, setHasMoreVideos] = useState(true);
  const [hasMoreClips, setHasMoreClips] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  // Intersection Observer for infinite scroll
  // Intersection Observer for infinite scroll
  const loadMoreRef = React.useRef<HTMLDivElement>(null);
  const errorTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  const [clipLoading, setClipLoading] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  // Notify parent about clip selection state (for muting main player)
  useEffect(() => {
    onClipSelectionChange?.(!!selectedClip);
  }, [selectedClip, onClipSelectionChange]);

  // Initial Fetch (Resets list)
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      setError(null);
      setVideoCursor(undefined);
      setClipCursor(undefined);
      setHasMoreVideos(true);
      setHasMoreClips(true);

      try {
        const api = (window as any).electronAPI;
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
              sort: "views", // Popular clips
              timeRange: "all",
            }),
          ]);

          if (videosResult.success) {
            setVideos(videosResult.data || []);
            // No cursor needed for home view
          }

          if (clipsResult.success) {
            setClips(clipsResult.data || []);
          }

          if (!videosResult.success && !clipsResult.success) {
            setError("Failed to load home content");
          }
        } else if (targetTab === "videos") {
          const result = await api.videos.getByChannel({
            platform,
            channelName,
            channelId: channelData?.id,
            limit: 5, // Initial load limit
            sort: sortBy === "views" ? "views" : "date",
          });
          if (result.success) {
            setVideos(result.data || []);
            setVideoCursor(result.cursor);
            setHasMoreVideos(!!result.cursor && (result.data?.length || 0) >= 5);
            setDebugInfo(result.debug || null);
          } else {
            setError(result.error || "Failed to fetch videos");
          }
        } else if (targetTab === "clips") {
          const result = await api.clips.getByChannel({
            platform,
            channelName,
            channelId: channelData?.id,
            limit: 5, // Initial load limit
            sort: sortBy === "views" ? "views" : "date",
            timeRange: timeRange,
          });
          if (result.success) {
            setClips(result.data || []);
            setClipCursor(result.cursor);
            setHasMoreClips(!!result.cursor && (result.data?.length || 0) >= 5);
          } else {
            setError(result.error || "Failed to fetch clips");
          }
        }
      } catch (error) {
        console.error("Failed to fetch content:", error);
        setError("Failed to load content");
      } finally {
        setIsLoading(false);
      }
    };

    if (platform && channelName && channelData?.id) {
      fetchInitialData();
    }
  }, [activeTab, platform, channelName, channelData?.id, sortBy, timeRange]);

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
      const api = (window as any).electronAPI;
      if (!api) {
        console.error("API not available for loading more items");
        return;
      }

      if (targetTab === "videos") {
        const result = await api.videos.getByChannel({
          platform,
          channelName,
          channelId: channelData?.id,
          limit: 5,
          cursor: videoCursor,
          sort: sortBy === "views" ? "views" : "date",
        });
        if (result.success) {
          const newVideos = result.data || [];

          // Stop if no videos returned
          if (newVideos.length === 0) {
            console.debug("[RelatedContent] No more videos to fetch");
            setHasMoreVideos(false);
            return;
          }

          // Filter duplicates
          const existingIds = new Set(videos.map((v) => v.id));
          const uniqueNewVideos = newVideos.filter((v: VideoOrClip) => !existingIds.has(v.id));

          // Stop if all returned videos are duplicates (we've looped back)
          if (uniqueNewVideos.length === 0) {
            console.debug("[RelatedContent] All videos are duplicates, stopping");
            setHasMoreVideos(false);
            return;
          }

          // Stop if cursor hasn't changed (stuck in a loop)
          if (result.cursor && result.cursor === videoCursor) {
            console.debug("[RelatedContent] Cursor unchanged, stopping");
            setHasMoreVideos(false);
            return;
          }

          setVideos((prev) => [...prev, ...uniqueNewVideos]);
          setVideoCursor(result.cursor);

          // Stop if no cursor returned or got fewer than requested
          if (!result.cursor || newVideos.length < 5) {
            console.debug("[RelatedContent] No cursor or partial page, stopping");
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
          limit: 5,
          cursor: clipCursor,
          sort: sortBy === "views" ? "views" : "date",
          timeRange: timeRange,
        });
        if (result.success) {
          const newClips = result.data || [];

          // Stop if no clips returned
          if (newClips.length === 0) {
            console.debug("[RelatedContent] No more clips to fetch");
            setHasMoreClips(false);
            return;
          }

          // Filter duplicates
          const existingIds = new Set(clips.map((c) => c.id));
          const uniqueNewClips = newClips.filter((c: VideoOrClip) => !existingIds.has(c.id));

          // Stop if all returned clips are duplicates
          if (uniqueNewClips.length === 0) {
            console.debug("[RelatedContent] All clips are duplicates, stopping");
            setHasMoreClips(false);
            return;
          }

          // Stop if cursor hasn't changed
          if (result.cursor && result.cursor === clipCursor) {
            console.debug("[RelatedContent] Clip cursor unchanged, stopping");
            setHasMoreClips(false);
            return;
          }

          setClips((prev) => [...prev, ...uniqueNewClips]);
          setClipCursor(result.cursor);

          // Stop if no cursor returned or got fewer than requested
          if (!result.cursor || newClips.length < 5) {
            console.debug("[RelatedContent] No cursor or partial page, stopping clips");
            setHasMoreClips(false);
          }
        } else {
          // API error - stop trying
          setHasMoreClips(false);
        }
      }
    } catch (err) {
      console.error("Error loading more items:", err);
      // Clear any existing error timeout
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
      setError("Failed to load more items. Please try again.");
      errorTimeoutRef.current = setTimeout(() => {
        setError(null);
        errorTimeoutRef.current = null;
      }, 3000);
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
        const api = (window as any).electronAPI;
        if (!api) {
          throw new Error("Electron API not found");
        }

        const clipUrlToUse = selectedClip.embedUrl || selectedClip.url;

        const result = await api.clips.getPlaybackUrl({
          platform,
          clipId: selectedClip.id,
          clipUrl: clipUrlToUse,
        });

        if (result.success && result.data) {
          setClipPlaybackUrl(result.data.url);
          setClipQualities(result.data.qualities);
        } else {
          console.error("[RelatedContent] Failed to get clip URL:", result.error);
          // For Twitch, we'll fall back to iframe embed
          if (platform === "twitch") {
            setClipPlaybackUrl(null); // Signal to use iframe
          } else {
            setClipError(result.error || "Failed to load clip");
          }
        }
      } catch (err) {
        console.error("[RelatedContent] Error fetching clip URL:", err);
        // For Twitch, we'll fall back to iframe embed
        if (platform === "twitch") {
          setClipPlaybackUrl(null);
        } else {
          setClipError("Failed to load clip");
        }
      } finally {
        setClipLoading(false);
      }
    };

    fetchClipUrl();
  }, [selectedClip, platform]);

  const handleClipPlaybackError = () => {
    if (platform === "twitch") {
      setClipPlaybackUrl(null);
    } else {
      setClipError("Failed to play clip");
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
                  <span className="text-[var(--color-foreground)] font-bold">Filter by:</span>
                  <Select
                    value={timeRange}
                    onValueChange={(value) => setTimeRange(value as TimeRange)}
                  >
                    <SelectTrigger className="w-auto min-w-[100px] h-10 bg-[var(--color-background-secondary)] border-none font-bold px-4 text-base">
                      <SelectValue placeholder="Time" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="day" className="font-bold">
                        Last Day
                      </SelectItem>
                      <SelectItem value="week" className="font-bold">
                        Last Week
                      </SelectItem>
                      <SelectItem value="month" className="font-bold">
                        Last Month
                      </SelectItem>
                      <SelectItem value="all" className="font-bold">
                        All Time
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <span className="text-[var(--color-foreground)] font-bold">Sort by:</span>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                <SelectTrigger className="w-auto min-w-[90px] h-10 bg-[var(--color-background-secondary)] border-none font-bold px-4 text-base">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="recent" className="font-bold">
                    Most Recent
                  </SelectItem>
                  <SelectItem value="views" className="font-bold">
                    Views
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
                <h3 className="text-xl font-bold">Stream Videos</h3>
                <Link
                  from="/stream/$platform/$channel"
                  search={{ tab: "videos" }}
                  className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                >
                  View all
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
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[var(--color-foreground-muted)]">No recent videos found.</p>
              )}
            </section>

            {/* Clips Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">Popular Clips</h3>
                <Link
                  from="/stream/$platform/$channel"
                  search={{ tab: "clips" }}
                  className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                >
                  View all
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
                <p className="text-[var(--color-foreground-muted)]">No popular clips found.</p>
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
                  Retry
                </Button>
              </div>
            ) : activeTab === "videos" ? (
              videos.length > 0 ? (
                videos.map((video) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    platform={platform}
                    channelName={channelName}
                    channelData={channelData}
                  />
                ))
              ) : (
                <div className="col-span-full py-12 text-center text-[var(--color-foreground-muted)]">
                  No videos found
                  {debugInfo && <p className="text-xs mt-2 opacity-50 font-mono">{debugInfo}</p>}
                </div>
              )
            ) : clips.length > 0 ? (
              clips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  onClick={() => setSelectedClip(clip)}
                  platform={platform}
                  channelName={channelName}
                  channelData={channelData}
                />
              ))
            ) : (
              <div className="col-span-full py-12 text-center text-[var(--color-foreground-muted)]">
                No clips found
              </div>
            )}

            {/* Sentinel for infinite scroll - only render when there's more data */}
            {((activeTab === "videos" && hasMoreVideos && videos.length > 0) ||
              (activeTab === "clips" && hasMoreClips && clips.length > 0)) && (
              <div ref={loadMoreRef} className="col-span-full h-4 w-full" />
            )}

            {isFetchingMore && (
              <div className="col-span-full py-4 flex justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
              </div>
            )}
          </div>
        )}
      </div>

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
    </div>
  );
}

// Re-export types for external use
export type { RelatedContentProps, VideoOrClip } from "./types";
