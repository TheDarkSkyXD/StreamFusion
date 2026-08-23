import { Link } from "@tanstack/react-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuClapperboard,
  LuHeart,
  LuPlay,
  LuRadio,
  LuRefreshCw,
  LuSearch,
  LuTag,
  LuUsers,
} from "react-icons/lu";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedStream,
} from "@/backend/api/unified/platform-types";
import { CategoryGrid } from "@/components/discovery/category-grid";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { ClipCard } from "@/components/stream/related-content/ClipCard";
import { ClipDialog } from "@/components/stream/related-content/ClipDialog";
import { VideoCard } from "@/components/stream/related-content/VideoCard";
import { StreamGrid } from "@/components/stream/stream-grid";
import { StreamVerifiedBadge } from "@/components/stream/stream-verified-badge";
import { Button } from "@/components/ui/button";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { measureCacheInvalidationDispatch } from "@/hooks/queries/cache-performance";
import { useTopCategories } from "@/hooks/queries/useCategories";
import { useChannelByUsername, useFollowedChannels } from "@/hooks/queries/useChannels";
import {
  type FollowedClipTimeRange,
  type FollowedContentItem,
  type FollowedContentSort,
  useFollowedClipPlayback,
  useFollowedClips,
  useFollowedVideos,
} from "@/hooks/queries/useFollowedContent";
import {
  createFollowedStreamSnapshotIdentity,
  useFollowedStreams,
} from "@/hooks/queries/useStreams";
import { useAfterFirstPaint } from "@/hooks/useAfterFirstPaint";
import { useDebounce } from "@/hooks/useDebounce";
import {
  dedupeChannelsByIdentity,
  dedupeStreamsByChannelIdentity,
  getChannelKey,
  getChannelNameKey,
  getStreamKey,
} from "@/lib/id-utils";
import { cn, normalizeCategoryName } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { usePipStore } from "@/store/pip-store";

type FollowingTab = "live" | "videos" | "clips" | "categories" | "channels";

const CONTENT_PAGE_SIZE = 24;
const CATEGORY_THUMBNAIL_PRELOAD_LIMIT = CONTENT_PAGE_SIZE;
const preloadedCategoryThumbnails = new Map<string, HTMLImageElement>();
const EMPTY_FOLLOWED_CHANNELS: UnifiedChannel[] = [];
const EMPTY_STREAM_LOOKUPS = {
  streamByIdMap: new Map<string, UnifiedStream>(),
  streamByNameMap: new Map<string, UnifiedStream>(),
};

const FOLLOWING_TABS: Array<{
  id: FollowingTab;
  label: string;
  icon: typeof LuRadio;
}> = [
  { id: "live", label: "Live", icon: LuRadio },
  { id: "videos", label: "Videos", icon: LuPlay },
  { id: "clips", label: "Clips", icon: LuClapperboard },
  { id: "categories", label: "Categories", icon: LuTag },
  { id: "channels", label: "Channels", icon: LuUsers },
];

type FollowedChannelCard = {
  channel: UnifiedChannel;
  isLive: boolean;
};

function getVisibleContent<T>(items: T[], visibleCount: number) {
  const endIndex = Math.min(Math.max(visibleCount, CONTENT_PAGE_SIZE), items.length);

  return {
    endIndex,
    hasMore: endIndex < items.length,
    items: items.slice(0, endIndex),
    total: items.length,
  };
}

function getCategoryThumbnailUrl(category: UnifiedCategory) {
  if (!category.boxArtUrl) return null;
  return category.boxArtUrl.replace("{width}", "285").replace("{height}", "380");
}

function preloadCategoryThumbnail(url: string) {
  if (typeof Image === "undefined" || preloadedCategoryThumbnails.has(url)) return;

  const image = new Image();
  image.decoding = "async";
  image.src = url;
  preloadedCategoryThumbnails.set(url, image);
}

function manualRefreshResultFailed(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") return true;
  const value = result.value;
  if (typeof value !== "object" || value === null) return false;
  const queryResult = value as { isError?: boolean; status?: unknown };
  return queryResult.isError === true || queryResult.status === "error";
}

function formatFollowSyncFreshness(syncedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(syncedAt));
}

export function FollowingPage() {
  const canRenderContent = useAfterFirstPaint();
  const [activeTab, setActiveTab] = useState<FollowingTab>("live");
  const [filter, setFilter] = useState<Platform | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [videoSort, setVideoSort] = useState<FollowedContentSort>("recent");
  const [clipSort, setClipSort] = useState<FollowedContentSort>("recent");
  const [clipTimeRange, setClipTimeRange] = useState<FollowedClipTimeRange>("all");
  const [visibleVideoCount, setVisibleVideoCount] = useState(CONTENT_PAGE_SIZE);
  const [visibleClipCount, setVisibleClipCount] = useState(CONTENT_PAGE_SIZE);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [manualRefreshFailed, setManualRefreshFailed] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const videoLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const clipLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [selectedClip, setSelectedClip] = useState<FollowedContentItem | null>(null);
  const debouncedSearchQuery = useDebounce(searchQuery.trim(), 500);

  // Auth status
  const {
    twitchConnected,
    kickConnected,
    followSyncInProgress,
    followSyncLastSyncedAt,
    syncConnectedFollows,
    twitchUser,
    kickUser,
    initialized: authInitialized,
  } = useAuthStore();

  // 1. Local follows
  const { localFollows, isHydrated: followsHydrated } = useFollowStore();
  const followedStreamSnapshotIdentity = useMemo(() => {
    if (!canRenderContent || !authInitialized || !followsHydrated) return undefined;
    return createFollowedStreamSnapshotIdentity(
      undefined,
      twitchUser?.id ?? "guest",
      String(kickUser?.id ?? "guest"),
      localFollows
    );
  }, [
    authInitialized,
    canRenderContent,
    followsHydrated,
    kickUser?.id,
    localFollows,
    twitchUser?.id,
  ]);

  // 2. Remote follows
  // Only fetch if connected to respective platform
  const {
    data: twitchFollows,
    isLoading: isLoadingTwitch,
    error: twitchFollowsError,
    refetch: refetchTwitchFollows,
  } = useFollowedChannels("twitch", {
    enabled: twitchConnected,
  });
  const {
    data: kickFollows,
    isLoading: isLoadingKick,
    error: kickFollowsError,
    refetch: refetchKickFollows,
  } = useFollowedChannels("kick", {
    enabled: kickConnected,
  });

  // 3. Live streams (All platforms)
  // Backend now handles fetching streams for local follows even if disconnected
  const {
    data: liveStreams,
    isLoading: isLoadingStreams,
    error: liveStreamsError,
    refetch: refetchFollowedStreams,
  } = useFollowedStreams(undefined, 20, {
    enabled: activeTab === "live",
    snapshotIdentity: followedStreamSnapshotIdentity,
  });
  const currentStream = usePipStore((state) => state.currentStream);
  const shouldUsePrepaintLiveData =
    !canRenderContent && activeTab === "live" && filter === "all" && searchQuery.length === 0;

  const allChannels = useMemo(() => {
    if (shouldUsePrepaintLiveData) return EMPTY_FOLLOWED_CHANNELS;

    // Collect all channels from local and remote sources
    // Key by platform-channelId to deduplicate while preventing cross-platform collisions
    // Uses centralized key generation from id-utils
    const channelMap = new Map<string, UnifiedChannel>();

    // Add local follows
    localFollows.forEach((channel) => {
      // LocalFollows store now returns UnifiedChannel[] (hydrated from backend)
      channelMap.set(getChannelKey(channel), channel);
    });

    // Add remote follows (Twitch) - overwrites local if exists (fresh data)
    if (twitchFollows) {
      twitchFollows.forEach((c) => channelMap.set(getChannelKey(c), c));
    }

    // Add remote follows (Kick)
    if (kickFollows) {
      kickFollows.forEach((c) => channelMap.set(getChannelKey(c), c));
    }

    return dedupeChannelsByIdentity(Array.from(channelMap.values()));
  }, [kickFollows, localFollows, shouldUsePrepaintLiveData, twitchFollows]);

  const { streamByIdMap, streamByNameMap } = useMemo(() => {
    if (shouldUsePrepaintLiveData) return EMPTY_STREAM_LOOKUPS;

    // Map live streams by platform-aware keys for flexible matching
    // Different API endpoints return different ID formats, so we match by both
    // Uses centralized key generation from id-utils
    const streamByIdMap = new Map<string, UnifiedStream>();
    const streamByNameMap = new Map<string, UnifiedStream>();
    if (liveStreams) {
      liveStreams.forEach((s) => {
        // Use centralized key generation for consistency
        streamByIdMap.set(getStreamKey(s), s);
        if (s.channelName) {
          streamByNameMap.set(getChannelNameKey(s.platform, s.channelName), s);
        }
      });
    }

    return { streamByIdMap, streamByNameMap };
  }, [liveStreams, shouldUsePrepaintLiveData]);

  const { liveChannels, hasVisibleFollowedChannels, isLoading } = useMemo(() => {
    const loadingTwitch = twitchConnected && isLoadingTwitch && !twitchFollows;
    const loadingKick = kickConnected && isLoadingKick && !kickFollows;

    if (shouldUsePrepaintLiveData) {
      const live = dedupeStreamsByChannelIdentity(liveStreams ?? []).sort(
        (a, b) => b.viewerCount - a.viewerCount
      );
      const hasFollowedChannels =
        localFollows.length > 0 ||
        Boolean(twitchFollows?.length) ||
        Boolean(kickFollows?.length) ||
        live.length > 0;

      return {
        liveChannels: live,
        hasVisibleFollowedChannels: hasFollowedChannels,
        isLoading: !hasFollowedChannels && (isLoadingStreams || loadingTwitch || loadingKick),
      };
    }

    const live: UnifiedStream[] = [];
    let visibleChannelCount = 0;
    const addedStreamIds = new Set<string>(); // Track added streams to prevent duplicates

    // Live only needs the matching streams and an exact filtered follow count. Channel-card
    // collections are prepared lazily below when a secondary tab actually consumes them.
    allChannels.forEach((c) => {
      // Filter by Platform
      if (filter !== "all" && c.platform !== filter) return;

      // Try matching by platform-ID first, then by platform-username (slug)
      let stream = streamByIdMap.get(getChannelKey(c));
      if (!stream && c.username) {
        stream = streamByNameMap.get(getChannelNameKey(c.platform, c.username));
      }

      // Filter by LuSearch
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName =
          c.displayName.toLowerCase().includes(q) || c.username.toLowerCase().includes(q);
        const matchesGame =
          stream?.categoryName?.toLowerCase().includes(q) ||
          stream?.title?.toLowerCase().includes(q);
        if (!matchesName && !matchesGame) return;
      }

      visibleChannelCount += 1;

      if (stream) {
        // Prevent duplicate streams (same stream matched by different channels)
        const streamKey = getStreamKey(stream);
        if (addedStreamIds.has(streamKey)) {
          return; // Skip - already added this stream
        }
        addedStreamIds.add(streamKey);

        // Channel is live
        // Ensure stream has avatar if missing (fallback to channel avatar)
        // Create a new object to avoid mutating React Query cache
        const needsAvatar = !stream.channelAvatar && c.avatarUrl;
        const needsVerifiedBadge = !stream.channelIsVerified && (c.isVerified || c.isPartner);
        const streamToAdd =
          needsAvatar || needsVerifiedBadge
            ? {
                ...stream,
                ...(needsAvatar && { channelAvatar: c.avatarUrl }),
                ...(needsVerifiedBadge && { channelIsVerified: true }),
              }
            : stream;
        live.push(streamToAdd);
      }
    });

    // Sort live by viewer count
    live.sort((a, b) => b.viewerCount - a.viewerCount);

    // Determine loading state
    return {
      liveChannels: live,
      hasVisibleFollowedChannels: visibleChannelCount > 0,
      isLoading:
        (isLoadingStreams && liveStreams === undefined) ||
        (allChannels.length === 0 && (loadingTwitch || loadingKick)),
    };
  }, [
    allChannels,
    shouldUsePrepaintLiveData,
    twitchFollows,
    kickFollows,
    liveStreams,
    localFollows.length,
    filter,
    searchQuery,
    isLoadingStreams,
    isLoadingTwitch,
    isLoadingKick,
    twitchConnected,
    kickConnected,
    streamByIdMap,
    streamByNameMap,
  ]);

  const shouldPrepareFollowedChannels =
    activeTab === "channels" || activeTab === "videos" || activeTab === "clips";
  const followedChannels = useMemo(() => {
    if (!shouldPrepareFollowedChannels) return [];

    const followed: FollowedChannelCard[] = [];
    allChannels.forEach((channel) => {
      if (filter !== "all" && channel.platform !== filter) return;

      const stream =
        streamByIdMap.get(getChannelKey(channel)) ??
        (channel.username
          ? streamByNameMap.get(getChannelNameKey(channel.platform, channel.username))
          : undefined);
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName =
          channel.displayName.toLowerCase().includes(query) ||
          channel.username.toLowerCase().includes(query);
        const matchesStream =
          stream?.categoryName?.toLowerCase().includes(query) ||
          stream?.title?.toLowerCase().includes(query);
        if (!matchesName && !matchesStream) return;
      }

      followed.push({ channel, isLive: Boolean(stream) });
    });

    followed.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return a.channel.displayName.localeCompare(b.channel.displayName);
    });
    return followed;
  }, [
    allChannels,
    filter,
    searchQuery,
    shouldPrepareFollowedChannels,
    streamByIdMap,
    streamByNameMap,
  ]);

  const followedChannelList = useMemo(() => {
    if (activeTab !== "videos" && activeTab !== "clips") return EMPTY_FOLLOWED_CHANNELS;
    return followedChannels.map(({ channel }) => channel);
  }, [activeTab, followedChannels]);

  const shouldRepairKickSearchSlug =
    filter !== "twitch" &&
    activeTab === "channels" &&
    debouncedSearchQuery.length >= 3 &&
    followedChannels.length === 0 &&
    !isLoading;
  useChannelByUsername(shouldRepairKickSearchSlug ? debouncedSearchQuery : "", "kick");

  const shouldLoadFollowedCategories =
    canRenderContent &&
    (activeTab === "categories" || liveChannels.some((stream) => Boolean(stream.categoryName)));
  const {
    data: topCategories,
    isLoading: isLoadingTopCategories,
    refetch: refetchTopCategories,
  } = useTopCategories(filter === "all" ? undefined : filter, {
    enabled: shouldLoadFollowedCategories,
  });

  const channelLookup = useMemo(() => {
    const lookup = new Map<string, UnifiedChannel>();

    followedChannelList.forEach((channel) => {
      lookup.set(`${channel.platform}:id:${channel.id}`, channel);
      lookup.set(`${channel.platform}:name:${channel.username.toLowerCase()}`, channel);
      lookup.set(`${channel.platform}:display:${channel.displayName.toLowerCase()}`, channel);
    });

    return lookup;
  }, [followedChannelList]);

  const {
    data: followedVideos = [],
    isLoading: isLoadingVideos,
    refetch: refetchFollowedVideos,
  } = useFollowedVideos(followedChannelList, {
    enabled: activeTab === "videos",
    sort: videoSort,
  });
  const {
    data: followedClips = [],
    isLoading: isLoadingClips,
    refetch: refetchFollowedClips,
  } = useFollowedClips(followedChannelList, {
    enabled: activeTab === "clips",
    sort: clipSort,
    timeRange: clipTimeRange,
  });
  const visibleVideos = useMemo(
    () => getVisibleContent(followedVideos, visibleVideoCount),
    [followedVideos, visibleVideoCount]
  );
  const visibleClips = useMemo(
    () => getVisibleContent(followedClips, visibleClipCount),
    [followedClips, visibleClipCount]
  );
  const {
    data: clipPlayback,
    isLoading: isClipPlaybackLoading,
    error: clipPlaybackError,
    refetch: refetchClipPlayback,
  } = useFollowedClipPlayback(selectedClip);

  const revealMoreVideos = useCallback(() => {
    setVisibleVideoCount((count) => Math.min(count + CONTENT_PAGE_SIZE, followedVideos.length));
  }, [followedVideos.length]);

  const revealMoreClips = useCallback(() => {
    setVisibleClipCount((count) => Math.min(count + CONTENT_PAGE_SIZE, followedClips.length));
  }, [followedClips.length]);

  const refreshFollowingData = useCallback(async () => {
    if (manualRefreshPending) return;

    setManualRefreshPending(true);
    setManualRefreshFailed(false);
    try {
      let syncFailed = false;
      try {
        const syncResult = await syncConnectedFollows();
        syncFailed = syncResult.failed.length > 0;
      } catch {
        syncFailed = true;
      }

      const refreshes: Array<Promise<unknown>> = [refetchFollowedStreams()];
      if (twitchConnected && filter !== "kick") refreshes.push(refetchTwitchFollows());
      if (kickConnected && filter !== "twitch") refreshes.push(refetchKickFollows());
      if (activeTab === "categories") {
        refreshes.push(refetchTopCategories());
      }
      if (activeTab === "videos") refreshes.push(refetchFollowedVideos());
      if (activeTab === "clips") refreshes.push(refetchFollowedClips());

      const results = await measureCacheInvalidationDispatch("manual-refresh:following", () =>
        Promise.allSettled(refreshes)
      );
      setManualRefreshFailed(syncFailed || results.some(manualRefreshResultFailed));
    } finally {
      setManualRefreshPending(false);
    }
  }, [
    activeTab,
    filter,
    kickConnected,
    manualRefreshPending,
    refetchFollowedClips,
    refetchFollowedStreams,
    refetchFollowedVideos,
    refetchKickFollows,
    refetchTopCategories,
    refetchTwitchFollows,
    syncConnectedFollows,
    twitchConnected,
  ]);
  const manualSyncPending = manualRefreshPending || followSyncInProgress;

  useEffect(() => {
    if (
      activeTab !== "videos" ||
      !visibleVideos.hasMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const target = videoLoadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          revealMoreVideos();
        }
      },
      { root: contentScrollRef.current, rootMargin: "600px 0px" }
    );
    observer.observe(target);

    return () => observer.disconnect();
  }, [activeTab, revealMoreVideos, visibleVideos.hasMore]);

  useEffect(() => {
    if (
      activeTab !== "clips" ||
      !visibleClips.hasMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const target = clipLoadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          revealMoreClips();
        }
      },
      { root: contentScrollRef.current, rootMargin: "600px 0px" }
    );
    observer.observe(target);

    return () => observer.disconnect();
  }, [activeTab, revealMoreClips, visibleClips.hasMore]);

  const followedCategories = useMemo(() => {
    if (!canRenderContent) return [];

    const categoryLookup = new Map<string, UnifiedCategory>();

    topCategories?.forEach((category) => {
      categoryLookup.set(`${category.platform}:id:${category.id}`, category);
      categoryLookup.set(
        `${category.platform}:name:${normalizeCategoryName(category.name)}`,
        category
      );
      categoryLookup.set(`all:name:${normalizeCategoryName(category.name)}`, category);
    });

    const categoryMap = new Map<string, UnifiedCategory>();

    liveChannels.forEach((stream) => {
      if (!stream.categoryName) return;

      const categoryNameKey = normalizeCategoryName(stream.categoryName);
      const matchedCategory =
        (stream.categoryId && categoryLookup.get(`${stream.platform}:id:${stream.categoryId}`)) ||
        categoryLookup.get(`${stream.platform}:name:${categoryNameKey}`) ||
        categoryLookup.get(`all:name:${categoryNameKey}`);
      const key = matchedCategory
        ? `${matchedCategory.platform}-${matchedCategory.id}`
        : `${stream.platform}-${stream.categoryId ?? categoryNameKey}`;
      const existing = categoryMap.get(key);
      if (existing) {
        existing.viewerCount = (existing.viewerCount ?? 0) + stream.viewerCount;
        return;
      }

      categoryMap.set(key, {
        ...(matchedCategory ?? {
          id: stream.categoryId ?? categoryNameKey,
          platform: stream.platform,
          name: stream.categoryName,
          boxArtUrl: "",
        }),
        viewerCount: stream.viewerCount,
      });
    });

    return Array.from(categoryMap.values()).sort(
      (a, b) => (b.viewerCount ?? 0) - (a.viewerCount ?? 0)
    );
  }, [canRenderContent, liveChannels, topCategories]);

  useEffect(() => {
    followedCategories.slice(0, CATEGORY_THUMBNAIL_PRELOAD_LIMIT).forEach((category) => {
      const thumbnailUrl = getCategoryThumbnailUrl(category);
      if (thumbnailUrl) preloadCategoryThumbnail(thumbnailUrl);
    });
  }, [followedCategories]);

  const getContentChannel = useCallback(
    (item: FollowedContentItem) => {
      const platform = item.platform ?? "twitch";
      const channelSlug = item.channelSlug?.toLowerCase();
      const channelName = item.channelName?.toLowerCase();

      return (
        (channelSlug && channelLookup.get(`${platform}:name:${channelSlug}`)) ||
        (channelName && channelLookup.get(`${platform}:display:${channelName}`)) ||
        null
      );
    },
    [channelLookup]
  );

  const getContentChannelName = useCallback(
    (item: FollowedContentItem) =>
      item.channelSlug || getContentChannel(item)?.username || item.channelName || "",
    [getContentChannel]
  );

  const renderContentFilters = () => {
    if (activeTab !== "videos" && activeTab !== "clips") return null;

    return (
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {activeTab === "clips" && (
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
            <span className="shrink-0 font-bold text-[var(--color-foreground)]">Filter by:</span>
            <Select
              value={clipTimeRange}
              onValueChange={(value) => {
                setClipTimeRange(value as FollowedClipTimeRange);
                setVisibleClipCount(CONTENT_PAGE_SIZE);
              }}
            >
              <SelectTrigger
                aria-label="Filter clips by time range"
                className="h-9 min-w-[120px] bg-[var(--color-background-secondary)]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="day">Last Day</SelectItem>
                <SelectItem value="week">Last Week</SelectItem>
                <SelectItem value="month">Last Month</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
          <span className="shrink-0 font-bold text-[var(--color-foreground)]">Sort by:</span>
          <Select
            value={activeTab === "videos" ? videoSort : clipSort}
            onValueChange={(value) => {
              if (activeTab === "videos") {
                setVideoSort(value as FollowedContentSort);
                setVisibleVideoCount(CONTENT_PAGE_SIZE);
                return;
              }
              setClipSort(value as FollowedContentSort);
              setVisibleClipCount(CONTENT_PAGE_SIZE);
            }}
          >
            <SelectTrigger
              aria-label={activeTab === "videos" ? "Sort videos" : "Sort clips"}
              className="h-9 min-w-[120px] bg-[var(--color-background-secondary)]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="recent">Most Recent</SelectItem>
              <SelectItem value="views">Views</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  const renderContentSkeletons = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-video rounded-xl" />
          <div className="flex gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderInfiniteScrollSentinel = (
    content: ReturnType<typeof getVisibleContent<FollowedContentItem>>,
    sentinelRef: RefObject<HTMLDivElement | null>,
    label: string
  ) => {
    if (content.total <= CONTENT_PAGE_SIZE) return null;

    return (
      <div
        ref={sentinelRef}
        className="flex min-h-10 items-center justify-center border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-foreground-secondary)]"
        data-testid={`${label}-infinite-sentinel`}
      >
        <span className="whitespace-nowrap">
          Showing {content.endIndex} of {content.total} {label}
        </span>
      </div>
    );
  };

  const renderEmptyState = (title: string, message: string, showBrowseButton = false) => (
    <div className="text-center py-24 flex flex-col items-center gap-4 text-[var(--color-foreground-muted)] animate-in fade-in zoom-in duration-300">
      <div className="w-16 h-16 rounded-full bg-[var(--color-background-secondary)] flex items-center justify-center mb-2">
        <LuHeart className="w-8 h-8 text-[var(--color-foreground-muted)]" />
      </div>
      <h3 className="text-xl font-semibold text-[var(--color-foreground)]">{title}</h3>
      <p>{message}</p>
      {showBrowseButton && (
        <Link to="/" className="mt-4">
          <Button variant="default">Browse Channels</Button>
        </Link>
      )}
    </div>
  );

  const renderChannelCard = ({ channel, isLive }: FollowedChannelCard) => (
    <div key={`${channel.platform}-${channel.id}`} className="relative group">
      <Link
        to="/stream/$platform/$channel"
        params={{ platform: channel.platform, channel: channel.username }}
        search={{ tab: "home" }}
        className="flex flex-col items-center text-center p-3 rounded-xl hover:bg-[var(--color-background-secondary)] transition-all"
      >
        <div className="relative mb-2">
          <PlatformAvatar
            src={channel.avatarUrl}
            alt={channel.displayName}
            platform={channel.platform}
            size="w-20 h-20"
            className="ring-2 ring-transparent group-hover:ring-[var(--color-primary)] transition-all"
          />
          <div
            className={cn(
              "absolute bottom-0 right-0 p-1 rounded-full bg-[var(--color-background)] border-2 border-[var(--color-background)]",
              channel.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]"
            )}
          >
            {channel.platform === "twitch" ? <TwitchIcon size={12} /> : <KickIcon size={12} />}
          </div>
        </div>
        <div className="flex w-full min-w-0 items-center justify-center gap-1.5">
          <h3 className="min-w-0 truncate font-medium text-sm group-hover:text-[var(--color-primary)] transition-colors">
            {channel.displayName}
          </h3>
          {(channel.isPartner || channel.isVerified) && (
            <StreamVerifiedBadge platform={channel.platform} />
          )}
        </div>
        {isLive && (
          <span className="mt-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-bold uppercase tracking-wider border border-red-500/20">
            Live
          </span>
        )}
      </Link>
    </div>
  );

  const hasNoFollowedChannels = !hasVisibleFollowedChannels;
  const hasInitialLiveError =
    activeTab === "live" &&
    liveChannels.length === 0 &&
    Boolean(twitchFollowsError || kickFollowsError || liveStreamsError);
  const noMatchMessage = searchQuery
    ? `No matches for "${searchQuery}"`
    : "Follow channels to see them here!";

  const renderLiveErrorState = () => (
    <div
      role="alert"
      className="text-center py-24 flex flex-col items-center gap-4 text-[var(--color-foreground-muted)]"
    >
      <div className="w-16 h-16 rounded-full bg-[var(--color-background-secondary)] flex items-center justify-center mb-2">
        <LuRefreshCw className="w-8 h-8 text-[var(--color-foreground-muted)]" aria-hidden="true" />
      </div>
      <h3 className="text-xl font-semibold text-[var(--color-foreground)]">
        Couldn't load followed channels
      </h3>
      <p>Check your connection and try again.</p>
      <Button
        variant="secondary"
        onClick={() => void refreshFollowingData()}
        disabled={manualSyncPending}
        aria-label="Retry loading followed content"
      >
        Retry
      </Button>
    </div>
  );

  return (
    <div className="px-6 pt-6 h-full flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <LuHeart className="fill-red-500 text-red-500" />
          Following
        </h1>
        <p className="text-[var(--color-foreground-secondary)]">
          Channels you follow across Twitch and Kick
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 bg-[var(--color-background-secondary)] p-4 rounded-xl border border-[var(--color-border)]">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setFilter("all");
                setVisibleVideoCount(CONTENT_PAGE_SIZE);
                setVisibleClipCount(CONTENT_PAGE_SIZE);
              }}
              className={filter === "all" ? "bg-white text-black hover:bg-white/90" : ""}
              size="sm"
            >
              All
            </Button>
            <Button
              variant={filter === "twitch" ? "default" : "secondary"}
              onClick={() => {
                setFilter("twitch");
                setVisibleVideoCount(CONTENT_PAGE_SIZE);
                setVisibleClipCount(CONTENT_PAGE_SIZE);
              }}
              className={filter === "twitch" ? "bg-[#9146FF] hover:bg-[#9146FF]/90 text-white" : ""}
              size="sm"
            >
              <TwitchIcon className="mr-2 h-4 w-4" />
              Twitch
            </Button>
            <Button
              variant={filter === "kick" ? "default" : "secondary"}
              onClick={() => {
                setFilter("kick");
                setVisibleVideoCount(CONTENT_PAGE_SIZE);
                setVisibleClipCount(CONTENT_PAGE_SIZE);
              }}
              className={filter === "kick" ? "bg-[#53FC18] hover:bg-[#53FC18]/90 text-black" : ""}
              size="sm"
            >
              <KickIcon className="mr-2 h-4 w-4" />
              Kick
            </Button>
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-64">
              <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-foreground-muted)]" />
              <input
                type="text"
                placeholder="Search followed channels..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setVisibleVideoCount(CONTENT_PAGE_SIZE);
                  setVisibleClipCount(CONTENT_PAGE_SIZE);
                }}
                className="w-full h-9 pl-9 pr-4 rounded-md bg-[var(--color-background-tertiary)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-white transition-all placeholder:text-[var(--color-foreground-muted)]"
              />
            </div>
            <Button
              variant="secondary"
              size="icon"
              className={cn(
                "h-9 w-9 shrink-0",
                manualRefreshFailed && "border-red-500/40 text-red-200 hover:text-red-100"
              )}
              onClick={() => void refreshFollowingData()}
              disabled={manualSyncPending}
              aria-label={
                manualRefreshFailed ? "Retry refreshing following data" : "Refresh following data"
              }
              title={
                manualRefreshFailed
                  ? "Some following data failed to refresh. Try again."
                  : "Refresh following data"
              }
            >
              <LuRefreshCw
                className={cn("h-4 w-4", manualSyncPending && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-6 overflow-x-auto no-scrollbar border-t border-[var(--color-border)] pt-3">
          <div className="flex shrink-0 items-center gap-3 text-xs font-medium text-[var(--color-foreground-muted)]">
            {twitchConnected && followSyncLastSyncedAt.twitch && (
              <span>Twitch synced {formatFollowSyncFreshness(followSyncLastSyncedAt.twitch)}</span>
            )}
            {kickConnected && followSyncLastSyncedAt.kick && (
              <span>Kick synced {formatFollowSyncFreshness(followSyncLastSyncedAt.kick)}</span>
            )}
          </div>
          {FOLLOWING_TABS.map((tab) => {
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative inline-flex items-center gap-2 pb-2 text-sm font-medium transition-colors whitespace-nowrap",
                  activeTab === tab.id
                    ? "text-white after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-white"
                    : "text-[var(--color-foreground-secondary)] hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={contentScrollRef} className="space-y-8 flex-1 overflow-y-auto pr-2 pb-10">
        {activeTab === "live" && isLoading ? (
          <div
            role="status"
            aria-label="Loading followed content"
            aria-busy="true"
            className="space-y-8"
          >
            <div className="space-y-4">
              <Skeleton className="h-7 w-32" />
              <StreamGrid isLoading skeletons={12} />
            </div>

            <div className="space-y-4">
              <Skeleton className="h-7 w-24" />
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2">
                    <Skeleton className="w-16 h-16 rounded-full" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : hasInitialLiveError ? (
          renderLiveErrorState()
        ) : (
          <>
            {activeTab === "live" &&
              (liveChannels.length > 0 ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    Live Now
                    <span className="text-sm font-normal text-[var(--color-foreground-muted)] ml-2">
                      ({liveChannels.length})
                    </span>
                  </h2>
                  {canRenderContent && (
                    <StreamGrid streams={liveChannels} activeStream={currentStream} />
                  )}
                </div>
              ) : (
                renderEmptyState(
                  hasNoFollowedChannels
                    ? "No followed channels found"
                    : "No live followed channels found",
                  noMatchMessage,
                  !searchQuery && hasNoFollowedChannels
                )
              ))}

            {activeTab === "channels" &&
              (followedChannels.length > 0 ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-semibold text-white">
                    Channels
                    <span className="text-sm font-normal text-[var(--color-foreground-muted)] ml-2">
                      ({followedChannels.length})
                    </span>
                  </h2>
                  <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4 pt-2">
                    {followedChannels.map(renderChannelCard)}
                  </div>
                </div>
              ) : (
                renderEmptyState("No followed channels found", noMatchMessage, !searchQuery)
              ))}

            {activeTab === "categories" &&
              (followedCategories.length > 0 ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h2 className="text-xl font-semibold text-white">
                    Categories
                    <span className="text-sm font-normal text-[var(--color-foreground-muted)] ml-2">
                      ({followedCategories.length})
                    </span>
                  </h2>
                  <CategoryGrid
                    categories={followedCategories}
                    isLoading={isLoadingTopCategories && followedCategories.length === 0}
                    emptyMessage="No followed categories found"
                    imageLoading="eager"
                  />
                </div>
              ) : (
                renderEmptyState(
                  "No followed categories found",
                  searchQuery
                    ? `No matches for "${searchQuery}"`
                    : "Live followed channels will group by category here."
                )
              ))}

            {activeTab === "videos" && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <h2 className="text-xl font-semibold text-white">
                    Videos
                    <span className="text-sm font-normal text-[var(--color-foreground-muted)] ml-2">
                      ({followedVideos.length})
                    </span>
                  </h2>
                  {renderContentFilters()}
                </div>

                {isLoadingVideos ? (
                  renderContentSkeletons()
                ) : followedVideos.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {visibleVideos.items.map((video) => {
                        const platform = video.platform ?? "twitch";
                        const channelData = getContentChannel(video);

                        return (
                          <VideoCard
                            key={`${platform}-${video.id}`}
                            video={video}
                            platform={platform}
                            channelName={getContentChannelName(video)}
                            channelData={channelData}
                          />
                        );
                      })}
                    </div>
                    {renderInfiniteScrollSentinel(visibleVideos, videoLoadMoreRef, "videos")}
                  </>
                ) : (
                  renderEmptyState(
                    followedChannelList.length > 0
                      ? "No followed videos found"
                      : "No followed channels found",
                    followedChannelList.length > 0
                      ? "Recent videos from followed channels will show here."
                      : noMatchMessage,
                    !searchQuery && followedChannelList.length === 0
                  )
                )}
              </div>
            )}

            {activeTab === "clips" && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <h2 className="text-xl font-semibold text-white">
                    Clips
                    <span className="text-sm font-normal text-[var(--color-foreground-muted)] ml-2">
                      ({followedClips.length})
                    </span>
                  </h2>
                  {renderContentFilters()}
                </div>

                {isLoadingClips ? (
                  renderContentSkeletons()
                ) : followedClips.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {visibleClips.items.map((clip) => {
                        const platform = clip.platform ?? "twitch";
                        const channelData = getContentChannel(clip);

                        return (
                          <ClipCard
                            key={`${platform}-${clip.id}`}
                            clip={clip}
                            onClick={() => setSelectedClip(clip)}
                            platform={platform}
                            channelName={getContentChannelName(clip)}
                            channelData={channelData}
                          />
                        );
                      })}
                    </div>
                    {renderInfiniteScrollSentinel(visibleClips, clipLoadMoreRef, "clips")}
                  </>
                ) : (
                  renderEmptyState(
                    followedChannelList.length > 0
                      ? "No followed clips found"
                      : "No followed channels found",
                    followedChannelList.length > 0
                      ? "Recent clips from followed channels will show here."
                      : noMatchMessage,
                    !searchQuery && followedChannelList.length === 0
                  )
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ClipDialog
        selectedClip={selectedClip}
        onClose={() => setSelectedClip(null)}
        clipLoading={isClipPlaybackLoading}
        clipError={clipPlaybackError instanceof Error ? clipPlaybackError.message : null}
        clipPlaybackUrl={clipPlayback?.url ?? null}
        clipQualities={clipPlayback?.qualities}
        platform={selectedClip?.platform ?? "twitch"}
        channelName={selectedClip ? getContentChannelName(selectedClip) : ""}
        channelData={selectedClip ? getContentChannel(selectedClip) : null}
        onPlaybackError={() => {
          void refetchClipPlayback();
        }}
      />
    </div>
  );
}
