import { useQuery } from "@tanstack/react-query";

import type { UnifiedChannel } from "@shared/platform-types";
import { formatDuration } from "@/lib/utils";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";

const FOLLOWED_CONTENT_CHANNEL_LIMIT = 30;
const FOLLOWED_CONTENT_PER_CHANNEL = 4;

type RawContentItem = Record<string, unknown>;
export type FollowedContentSort = "recent" | "views";
export type FollowedClipTimeRange = "day" | "week" | "month" | "all";

export interface FollowedContentItem {
  id: string;
  title: string;
  duration: string;
  views: string;
  date: string;
  created_at?: string;
  thumbnailUrl: string;
  embedUrl?: string;
  url?: string;
  source?: string;
  gameName?: string;
  isLive?: boolean;
  isSubOnly?: boolean;
  channelSlug?: string;
  channelName?: string;
  channelAvatar?: string | null;
  category?: string;
  tags?: string[];
  language?: string;
  isMature?: boolean;
  vodId?: string;
  platform?: Platform;
}

interface FollowedContentOptions {
  enabled?: boolean;
  limitPerChannel?: number;
  sort?: FollowedContentSort;
  timeRange?: FollowedClipTimeRange;
}

export const FOLLOWED_CONTENT_KEYS = {
  all: ["followed-content"] as const,
  videos: (channels: UnifiedChannel[], limitPerChannel: number, sort: FollowedContentSort) =>
    [
      ...FOLLOWED_CONTENT_KEYS.all,
      "videos",
      limitPerChannel,
      sort,
      channels.map((channel) => `${channel.platform}:${channel.id}:${channel.username}`).sort(),
    ] as const,
  clips: (
    channels: UnifiedChannel[],
    limitPerChannel: number,
    sort: FollowedContentSort,
    timeRange: FollowedClipTimeRange
  ) =>
    [
      ...FOLLOWED_CONTENT_KEYS.all,
      "clips",
      limitPerChannel,
      sort,
      timeRange,
      channels.map((channel) => `${channel.platform}:${channel.id}:${channel.username}`).sort(),
    ] as const,
  clipPlayback: (clip: FollowedContentItem | null) =>
    [
      ...FOLLOWED_CONTENT_KEYS.all,
      "clip-playback",
      clip?.platform,
      clip?.id,
      clip?.url,
      clip?.embedUrl,
    ] as const,
};

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return fallback;
}

function getContentDate(item: RawContentItem): string {
  return asString(item.created_at || item.createdAt || item.publishedAt || item.date);
}

function getContentTime(item: FollowedContentItem): number {
  const parsed = Date.parse(item.created_at || item.date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getContentViews(item: FollowedContentItem): number {
  const parsed = Number.parseInt(item.views.replace(/,/g, ""), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeContentItem(
  item: RawContentItem,
  channel: UnifiedChannel,
  kind: "video" | "clip"
): FollowedContentItem | null {
  const id = asString(item.id);
  const title = asString(item.title);
  if (!id || !title) return null;

  const date = getContentDate(item);
  const duration =
    typeof item.duration === "number"
      ? formatDuration(item.duration)
      : asString(item.duration, kind === "video" ? "00:00" : "0:00");
  const category = asString(item.category || item.gameName || channel.categoryName);

  return {
    id,
    title,
    duration,
    views: asString(item.views || item.viewCount, "0"),
    date,
    created_at: asString(item.created_at || item.createdAt || item.publishedAt) || undefined,
    thumbnailUrl: asString(item.thumbnailUrl),
    embedUrl: asString(item.embedUrl) || undefined,
    url: asString(item.url || item.clipUrl) || undefined,
    source: asString(item.source) || undefined,
    gameName: asString(item.gameName || category) || undefined,
    isLive: typeof item.isLive === "boolean" ? item.isLive : undefined,
    isSubOnly: typeof item.isSubOnly === "boolean" ? item.isSubOnly : undefined,
    channelSlug: asString(item.channelSlug || channel.username),
    channelName: asString(item.channelName || item.channelDisplayName || channel.displayName),
    channelAvatar: asString(item.channelAvatar || channel.avatarUrl) || null,
    category: category || undefined,
    tags: Array.isArray(item.tags) ? (item.tags as string[]) : undefined,
    language: asString(item.language) || undefined,
    isMature: typeof item.isMature === "boolean" ? item.isMature : undefined,
    vodId: asString(item.vodId) || undefined,
    platform: channel.platform,
  };
}

function isPastVideo(item: FollowedContentItem): boolean {
  if (item.isLive) return false;

  const thumbnailUrl = item.thumbnailUrl.trim();
  if (!thumbnailUrl) return false;
  if (
    item.platform === "twitch" &&
    (thumbnailUrl.includes("/_404/") || thumbnailUrl.includes("404_processing"))
  ) {
    return false;
  }

  const duration = item.duration.trim();
  if (duration === "0:00" || duration === "00:00" || duration === "00:00:00") {
    return false;
  }

  return Boolean(item.created_at || item.date);
}

function dedupeAndSort(
  items: FollowedContentItem[],
  sort: FollowedContentSort
): FollowedContentItem[] {
  const byKey = new Map<string, FollowedContentItem>();

  for (const item of items) {
    byKey.set(`${item.platform}:${item.id}`, item);
  }

  return Array.from(byKey.values()).sort((a, b) =>
    sort === "views"
      ? getContentViews(b) - getContentViews(a)
      : getContentTime(b) - getContentTime(a)
  );
}

async function fetchFollowedContent(
  channels: UnifiedChannel[],
  kind: "video" | "clip",
  limitPerChannel: number,
  sort: FollowedContentSort,
  timeRange: FollowedClipTimeRange = "all"
): Promise<FollowedContentItem[]> {
  const channelsToFetch = channels.slice(0, FOLLOWED_CONTENT_CHANNEL_LIMIT);

  const contentByChannel = await Promise.all(
    channelsToFetch.map(async (channel) => {
      try {
        const response =
          kind === "video"
            ? await window.electronAPI.videos.getByChannel({
                platform: channel.platform,
                channelName: channel.username,
                channelId: channel.id,
                limit: limitPerChannel,
                sort: sort === "views" ? "views" : "date",
              })
            : await window.electronAPI.clips.getByChannel({
                platform: channel.platform,
                channelName: channel.username,
                channelId: channel.id,
                limit: limitPerChannel,
                sort: sort === "views" ? "views" : "date",
                timeRange,
              });

        if (!response.success) {
          logger.warn("Hook:Queries:FollowedContent", "failed to fetch followed content", {
            platform: channel.platform,
            channelName: channel.username,
            kind,
            error: response.error,
          });
          return [];
        }

        const normalized = ((response.data as RawContentItem[] | undefined) ?? [])
          .map((item) => normalizeContentItem(item, channel, kind))
          .filter((item): item is FollowedContentItem => item !== null);

        return kind === "video" ? normalized.filter(isPastVideo) : normalized;
      } catch (error) {
        logger.warn("Hook:Queries:FollowedContent", "followed content request threw", {
          platform: channel.platform,
          channelName: channel.username,
          kind,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    })
  );

  return dedupeAndSort(contentByChannel.flat(), sort);
}

export function useFollowedVideos(
  channels: UnifiedChannel[],
  options: FollowedContentOptions = {}
) {
  const limitPerChannel = options.limitPerChannel ?? FOLLOWED_CONTENT_PER_CHANNEL;
  const sort = options.sort ?? "recent";
  const queryKey = FOLLOWED_CONTENT_KEYS.videos(channels, limitPerChannel, sort);
  const enabled = (options.enabled ?? true) && channels.length > 0;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchFollowedContent(channels, "video", limitPerChannel, sort),
    enabled,
    ...getQueryCacheOptions("followedContent"),
  });
  useQueryCachePerformance({
    data: query.data,
    enabled,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "following",
  });
  return query;
}

export function useFollowedClips(channels: UnifiedChannel[], options: FollowedContentOptions = {}) {
  const limitPerChannel = options.limitPerChannel ?? FOLLOWED_CONTENT_PER_CHANNEL;
  const sort = options.sort ?? "recent";
  const timeRange = options.timeRange ?? "all";
  const queryKey = FOLLOWED_CONTENT_KEYS.clips(channels, limitPerChannel, sort, timeRange);
  const enabled = (options.enabled ?? true) && channels.length > 0;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchFollowedContent(channels, "clip", limitPerChannel, sort, timeRange),
    enabled,
    ...getQueryCacheOptions("followedContent"),
  });
  useQueryCachePerformance({
    data: query.data,
    enabled,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "following",
  });
  return query;
}

export function useFollowedClipPlayback(clip: FollowedContentItem | null) {
  const queryKey = FOLLOWED_CONTENT_KEYS.clipPlayback(clip);
  const enabled = !!clip?.id && !!clip.platform;
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<{
      url: string | null;
      qualities?: { quality: string; url: string }[];
      error?: string;
    }> => {
      if (!clip?.id || !clip.platform) return { url: null };

      const response = (await window.electronAPI.clips.getPlaybackUrl({
        platform: clip.platform,
        clipId: clip.id,
        clipUrl: clip.embedUrl || clip.url,
      })) as {
        success: boolean;
        data?: { url?: string; qualities?: { quality: string; url: string }[] };
        error?: string;
      };

      if (response.success && response.data) {
        return {
          url: response.data.url ?? null,
          qualities: response.data.qualities,
        };
      }

      if (clip.platform === "twitch") {
        return { url: null };
      }

      throw new Error(response.error || "Failed to load clip");
    },
    enabled,
    retry: false,
    ...getQueryCacheOptions("searchResults"),
  });
  useQueryCachePerformance({
    data: query.data,
    enabled,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "following",
  });
  return query;
}
