import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { UnifiedClip, UnifiedVideo } from "@shared/platform-types";
import { formatDuration } from "@/lib/utils";
import { i18n } from "@/i18n";
import type { CategoryPlatformScope } from "@/features/discovery/routes/category-detail-search";
import type { Platform } from "@shared/auth-types";
import type { CategoryMediaItem as IpcCategoryMediaItem } from "@shared/category-media-types";

import { getQueryCacheOptions } from "./cache-policy";

export type CategoryMediaKind = "clips" | "videos";
export type CategoryMediaSort = "recent" | "views";
export type CategoryMediaDirection = "asc" | "desc";
export type CategoryClipTimeRange = "day" | "week" | "month" | "all";
type RawCategoryMediaItem = IpcCategoryMediaItem | UnifiedClip | UnifiedVideo;

export interface CategoryMediaItem {
  id: string;
  platform: Platform;
  title: string;
  duration: string;
  views: string;
  viewCount: number;
  publishedAt: string;
  thumbnailUrl: string;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  channelAvatar: string;
  creatorName?: string;
  gameId?: string;
  gameName?: string;
  embedUrl?: string;
  url?: string;
  shareUrl?: string;
  source?: string;
  isLive?: boolean;
  isSubOnly?: boolean;
}

interface CategoryMediaSource {
  platform: Platform;
  categoryId: string;
  categorySlug?: string;
  categoryName?: string;
}

interface UseCategoryMediaOptions {
  kind: CategoryMediaKind;
  platformScope: CategoryPlatformScope;
  twitch: CategoryMediaSource;
  kick: CategoryMediaSource;
  sort: CategoryMediaSort;
  language?: string;
  tag?: string;
  direction?: CategoryMediaDirection;
  timeRange?: CategoryClipTimeRange;
  limit?: number;
}

function includesPlatform(scope: CategoryPlatformScope, platform: Platform): boolean {
  return scope === "all" || scope === platform;
}

function hasUsableCategoryIdentity(source: CategoryMediaSource): boolean {
  return Boolean(
    source.categoryId.trim() || source.categorySlug?.trim() || source.categoryName?.trim()
  );
}

function numericViews(value: string): number {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMediaItem(item: RawCategoryMediaItem): CategoryMediaItem {
  const publishedAt =
    "createdAt" in item
      ? item.createdAt
      : "publishedAt" in item
        ? item.publishedAt
        : item.created_at || item.date;
  const viewCount = "viewCount" in item ? item.viewCount : numericViews(item.views);
  const channelDisplayName =
    "channelDisplayName" in item ? item.channelDisplayName : item.channelName;

  return {
    id: item.id,
    platform: item.platform,
    title: item.title,
    duration: typeof item.duration === "number" ? formatDuration(item.duration) : item.duration,
    views: "views" in item ? item.views : String(item.viewCount),
    viewCount,
    publishedAt,
    thumbnailUrl: item.thumbnailUrl,
    channelId: item.channelId,
    channelName: item.channelName,
    channelDisplayName,
    channelAvatar: item.channelAvatar,
    creatorName: "creatorName" in item ? item.creatorName : undefined,
    gameId: "gameId" in item ? item.gameId : undefined,
    gameName: "gameName" in item ? item.gameName : undefined,
    embedUrl: "embedUrl" in item ? item.embedUrl : undefined,
    url: "clipUrl" in item ? item.clipUrl : item.url,
    shareUrl: item.shareUrl,
    source: "source" in item ? item.source : undefined,
    isLive: "isLive" in item ? item.isLive : undefined,
    isSubOnly: "isSubOnly" in item ? item.isSubOnly : undefined,
  };
}

function compareMediaItems(
  left: CategoryMediaItem,
  right: CategoryMediaItem,
  sort: CategoryMediaSort,
  direction: CategoryMediaDirection
): number {
  const primaryDifference =
    sort === "views"
      ? left.viewCount - right.viewCount
      : Date.parse(left.publishedAt) - Date.parse(right.publishedAt);
  const primary = direction === "asc" ? primaryDifference : -primaryDifference;
  if (primary !== 0) return primary;

  const secondary =
    sort === "views"
      ? Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
      : right.viewCount - left.viewCount;
  if (secondary !== 0) return secondary;

  return `${left.platform}:${left.id}`.localeCompare(`${right.platform}:${right.id}`);
}

function usePlatformCategoryMedia(
  kind: CategoryMediaKind,
  source: CategoryMediaSource,
  enabled: boolean,
  sort: CategoryMediaSort,
  language: string | undefined,
  tag: string | undefined,
  direction: CategoryMediaDirection,
  timeRange: CategoryClipTimeRange,
  limit: number
) {
  return useInfiniteQuery({
    queryKey: [
      "category-media",
      kind,
      source.platform,
      source.categoryId,
      source.categorySlug,
      source.categoryName,
      sort,
      language,
      tag,
      direction,
      kind === "clips" ? timeRange : null,
      limit,
    ],
    queryFn: async ({ pageParam }): Promise<{ items: CategoryMediaItem[]; cursor?: string }> => {
      if (!hasUsableCategoryIdentity(source)) {
        throw new Error(
          i18n.t("discovery.category.missingIdentity", { platform: source.platform })
        );
      }
      // Let both Platform observers enter their loading state before either IPC
      // request resolves so the first combined paint cannot expose a half-feed.
      await Promise.resolve();
      const apiSort = sort === "recent" ? "date" : "views";
      const response =
        kind === "clips"
          ? await window.electronAPI.clips.getByCategory({
              platform: source.platform,
              categoryId: source.categoryId,
              categorySlug: source.categorySlug,
              categoryName: source.categoryName,
              limit,
              sort: apiSort,
              language,
              tag,
              direction,
              timeRange,
              cursor: pageParam || undefined,
            })
          : await window.electronAPI.videos.getByCategory({
              platform: source.platform,
              categoryId: source.categoryId,
              categorySlug: source.categorySlug,
              categoryName: source.categoryName,
              limit,
              sort: apiSort,
              language,
              tag,
              direction,
              cursor: pageParam || undefined,
            });

      if (
        !response.success ||
        (response.availability !== undefined && response.availability !== "available")
      ) {
        throw new Error(
          response.error ||
            i18n.t("discovery.category.mediaLoadFailed", {
              platform: source.platform,
              kind,
            })
        );
      }

      return {
        items: ((response.data ?? []) as RawCategoryMediaItem[]).map(normalizeMediaItem),
        cursor: response.cursor,
      };
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled,
    retry: false,
    networkMode: "always",
    ...getQueryCacheOptions("searchResults"),
  });
}

export function useCategoryMedia({
  kind,
  platformScope,
  twitch,
  kick,
  sort,
  language,
  tag,
  direction = "desc",
  timeRange = "all",
  limit,
}: UseCategoryMediaOptions) {
  const resolvedLimit = limit ?? (kind === "videos" ? 60 : 20);
  const twitchQuery = usePlatformCategoryMedia(
    kind,
    twitch,
    includesPlatform(platformScope, "twitch") && hasUsableCategoryIdentity(twitch),
    sort,
    language,
    tag,
    direction,
    timeRange,
    resolvedLimit
  );
  const kickQuery = usePlatformCategoryMedia(
    kind,
    kick,
    includesPlatform(platformScope, "kick") && hasUsableCategoryIdentity(kick),
    sort,
    language,
    tag,
    direction,
    timeRange,
    resolvedLimit
  );

  const items = useMemo(() => {
    const deduped = new Map<string, CategoryMediaItem>();
    const selectedItems = [
      ...(includesPlatform(platformScope, "twitch")
        ? (twitchQuery.data?.pages.flatMap((page) => page.items) ?? [])
        : []),
      ...(includesPlatform(platformScope, "kick")
        ? (kickQuery.data?.pages.flatMap((page) => page.items) ?? [])
        : []),
    ];
    for (const item of selectedItems) {
      const key = `${item.platform}:${item.id}`;
      if (!deduped.has(key)) deduped.set(key, item);
    }
    return [...deduped.values()].sort((left, right) =>
      compareMediaItems(left, right, sort, direction)
    );
  }, [direction, kickQuery.data, platformScope, sort, twitchQuery.data]);

  const selectedQueries = [
    ...(includesPlatform(platformScope, "twitch")
      ? [{ platform: "twitch" as const, query: twitchQuery }]
      : []),
    ...(includesPlatform(platformScope, "kick")
      ? [{ platform: "kick" as const, query: kickQuery }]
      : []),
  ];

  return {
    items,
    isLoading: items.length === 0 && selectedQueries.some(({ query }) => query.isLoading),
    failures: selectedQueries
      .filter(({ query }) => query.error)
      .map(({ platform, query }) => ({ platform, error: query.error, retry: query.refetch })),
    hasNextPage: selectedQueries.some(({ query }) => query.hasNextPage),
    isFetchingNextPage: selectedQueries.some(({ query }) => query.isFetchingNextPage),
    fetchNextPage: async () => {
      await Promise.all(
        selectedQueries
          .filter(({ query }) => query.hasNextPage && !query.isFetchingNextPage)
          .map(({ query }) => query.fetchNextPage())
      );
    },
  };
}
