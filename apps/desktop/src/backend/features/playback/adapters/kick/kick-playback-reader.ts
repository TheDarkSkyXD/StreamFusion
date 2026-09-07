import { type PaginationOptions } from "@backend/api/platforms/kick/kick-types";
import type { KickDiscovery } from "@backend/features/discovery/adapters/kick/kick-discovery-reader";
import * as ClipEndpoints from "@backend/features/playback/adapters/kick/clip-endpoints";
import * as VideoEndpoints from "@backend/features/playback/adapters/kick/video-endpoints";
import type { UnifiedChannel, UnifiedClip, UnifiedVideo } from "@shared/platform-types";
import { clipSchema, videoSchema } from "@streamfusion/core/content";
import type {
  CategoryClipOptions,
  CategoryContentOptions,
  CategoryContentResult,
  CategoryRef,
  ChannelContentOptions,
  ClipReader,
  PageResult,
  VideoReader,
} from "@streamfusion/core/discovery";
import { Platform } from "@streamfusion/core/platform";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(textValue(value).replaceAll(",", ""), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function durationSeconds(value: unknown, sourceDurationMs?: unknown): number {
  if (typeof sourceDurationMs === "number" && Number.isFinite(sourceDurationMs)) {
    return Math.max(0, Math.round(sourceDurationMs / 1_000));
  }
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const parts = textValue(value).split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function normalizedTimestamp(value: unknown): string {
  const timestamp = new Date(textValue(value));
  return Number.isNaN(timestamp.valueOf()) ? "" : timestamp.toISOString();
}

function normalizeKickVideo(channel: UnifiedChannel, value: unknown): UnifiedVideo | null {
  if (!isRecord(value)) return null;
  const publishedAt = normalizedTimestamp(value.sourceCreatedAt || value.created_at || value.date);
  const url = textValue(value.shareUrl || value.url || value.source);
  const candidate = {
    id: textValue(value.id),
    platform: "kick",
    channelId: channel.id,
    channelName: channel.username,
    channelDisplayName: channel.displayName,
    channelAvatar: channel.avatarUrl,
    title: textValue(value.title),
    thumbnailUrl: textValue(value.thumbnailUrl),
    duration: durationSeconds(value.duration, value.sourceDurationMs),
    viewCount: numberValue(value.viewCount ?? value.views),
    publishedAt,
    url,
    shareUrl: textValue(value.shareUrl) || url,
    type: "archive",
    categoryId: textValue(value.gameId),
    categoryName: textValue(value.gameName || value.category),
  };
  if (!videoSchema.is(candidate)) return null;
  return {
    ...candidate,
    source: textValue(value.source) || undefined,
    isLive: typeof value.isLive === "boolean" ? value.isLive : undefined,
    isSubOnly: typeof value.isSubOnly === "boolean" ? value.isSubOnly : undefined,
    language: textValue(value.language) || undefined,
  };
}

function normalizeKickClip(channel: UnifiedChannel, value: unknown): UnifiedClip | null {
  if (!isRecord(value)) return null;
  const clipUrl = textValue(value.url || value.shareUrl || value.embedUrl);
  const candidate = {
    id: textValue(value.id),
    platform: "kick",
    channelId: channel.id,
    channelName: channel.username,
    channelDisplayName: channel.displayName,
    channelAvatar: channel.avatarUrl,
    title: textValue(value.title),
    thumbnailUrl: textValue(value.thumbnailUrl),
    clipUrl,
    shareUrl: textValue(value.shareUrl) || clipUrl,
    duration: durationSeconds(value.duration),
    viewCount: numberValue(value.viewCount ?? value.views),
    createdAt: normalizedTimestamp(value.createdAt || value.created_at || value.date),
    creatorName: textValue(value.creatorName),
    categoryId: textValue(value.gameId) || channel.categoryId,
    categoryName: textValue(value.gameName || value.category) || channel.categoryName,
  };
  if (!clipSchema.is(candidate)) return null;
  return {
    ...candidate,
    embedUrl: textValue(value.embedUrl || value.url),
    gameId: candidate.categoryId,
    gameName: candidate.categoryName,
    language: textValue(value.language) || undefined,
    vodId: textValue(value.vodId || value.videoId) || undefined,
  };
}

function categoryChannel(value: unknown): UnifiedChannel | null {
  if (!isRecord(value)) return null;
  const username = textValue(value.channelName || value.channelSlug);
  const id = textValue(value.channelId) || username;
  if (!username || !id) return null;
  return {
    id,
    platform: "kick",
    username,
    displayName: textValue(value.channelDisplayName) || username,
    avatarUrl: textValue(value.channelAvatar),
    isLive: false,
    isVerified: false,
    isPartner: false,
    categoryId: textValue(value.gameId) || undefined,
    categoryName: textValue(value.gameName || value.category) || undefined,
  };
}

function orderCategoryVideos(
  videos: readonly UnifiedVideo[],
  options: CategoryContentOptions
): UnifiedVideo[] {
  const unique = [...new Map(videos.map((video) => [video.id, video])).values()];
  const direction = options.direction === "ascending" ? 1 : -1;
  unique.sort((left, right) => {
    const difference =
      options.sort === "popular"
        ? left.viewCount - right.viewCount
        : Date.parse(left.publishedAt) - Date.parse(right.publishedAt);
    return difference * direction;
  });
  const representedChannels = new Set<string>();
  const firstByChannel: UnifiedVideo[] = [];
  const remaining: UnifiedVideo[] = [];
  for (const video of unique) {
    if (representedChannels.has(video.channelId)) remaining.push(video);
    else {
      representedChannels.add(video.channelId);
      firstByChannel.push(video);
    }
  }
  return [...firstByChannel, ...remaining];
}

export class KickPlayback
  implements
    VideoReader<Platform, UnifiedVideo, UnifiedChannel, AbortSignal>,
    ClipReader<Platform, UnifiedClip, UnifiedChannel, AbortSignal>
{
  readonly platform = "kick" as const;
  constructor(private readonly discovery: Pick<KickDiscovery, "getStreamsByCategory">) {}
  async getVideos(
    slug: string,
    options: PaginationOptions = {}
  ): Promise<Awaited<ReturnType<typeof VideoEndpoints.getVideosByChannelSlug>>> {
    return VideoEndpoints.getVideosByChannelSlug(slug, options);
  }

  async readChannelVideos(
    channel: UnifiedChannel,
    options: ChannelContentOptions<AbortSignal> = {}
  ): Promise<PageResult<UnifiedVideo>> {
    options.signal?.throwIfAborted();
    const result = await this.getVideos(channel.username, {
      limit: options.limit,
      cursor: options.cursor,
      sort: options.sort === "popular" ? "views" : "date",
    });
    options.signal?.throwIfAborted();
    return {
      data: result.data.flatMap((video) => {
        const normalized = normalizeKickVideo(channel, video);
        return normalized ? [normalized] : [];
      }),
      cursor: result.cursor,
    };
  }

  async readCategoryVideos(
    category: CategoryRef,
    options: CategoryContentOptions = {}
  ): Promise<CategoryContentResult<UnifiedVideo>> {
    const channelCursor = options.cursor?.startsWith("channels:")
      ? options.cursor.slice("channels:".length)
      : undefined;
    const streams = await this.discovery.getStreamsByCategory(category.id, {
      limit: 24,
      categoryName: category.name,
      cursor: channelCursor,
    });
    const channels = [
      ...new Map(streams.data.map((stream) => [stream.channelName, stream])).values(),
    ];
    const perChannelLimit = Math.min(options.limit ?? 20, 5);
    const videos: UnifiedVideo[] = [];

    for (let index = 0; index < channels.length; index += 4) {
      const batch = channels.slice(index, index + 4);
      const pages = await Promise.all(
        batch.map((channel) =>
          this.getVideos(channel.channelName, {
            limit: perChannelLimit,
            sort: options.sort === "popular" ? "views" : "date",
          })
        )
      );
      pages.forEach((page, pageIndex) => {
        const stream = batch[pageIndex];
        const channel: UnifiedChannel = {
          id: stream.channelId,
          platform: "kick",
          username: stream.channelName,
          displayName: stream.channelDisplayName,
          avatarUrl: stream.channelAvatar,
          isLive: stream.isLive,
          isVerified: false,
          isPartner: false,
          categoryId: category.id,
          categoryName: category.name,
        };
        for (const video of page.data) {
          const normalized = normalizeKickVideo(channel, video);
          if (normalized) videos.push(normalized);
        }
      });
    }

    const categoryId = category.id.trim();
    const categoryName = category.name?.trim().toLowerCase();
    const matchingVideos = videos.filter((video) => {
      if (video.isLive === true && video.duration === 0) return false;
      const recordedId = video.categoryId?.trim();
      if (recordedId && categoryId) return recordedId === categoryId;
      return Boolean(categoryName) && video.categoryName?.trim().toLowerCase() === categoryName;
    });
    return {
      kind: "available",
      data: orderCategoryVideos(matchingVideos, options),
      cursor:
        streams.cursor && streams.cursor !== channelCursor
          ? `channels:${streams.cursor}`
          : undefined,
    };
  }

  async getClips(
    slug: string,
    options: PaginationOptions = {}
  ): Promise<Awaited<ReturnType<typeof ClipEndpoints.getClipsByChannelSlug>>> {
    return ClipEndpoints.getClipsByChannelSlug(slug, options);
  }

  async readChannelClips(
    channel: UnifiedChannel,
    options: ChannelContentOptions<AbortSignal> = {}
  ): Promise<PageResult<UnifiedClip>> {
    options.signal?.throwIfAborted();
    const result = await this.getClips(channel.username, {
      limit: options.limit,
      cursor: options.cursor,
      sort: options.sort === "popular" ? "views" : "date",
    });
    options.signal?.throwIfAborted();
    return {
      data: result.data.flatMap((clip) => {
        const normalized = normalizeKickClip(channel, clip);
        return normalized ? [normalized] : [];
      }),
      cursor: result.cursor,
    };
  }

  async readCategoryClips(
    category: CategoryRef,
    options: CategoryClipOptions = {}
  ): Promise<CategoryContentResult<UnifiedClip>> {
    if (!category.slug) {
      return { kind: "invalid", reason: "Kick Category Clips require a category slug" };
    }
    const result = await this.getClipsByCategory(category.slug, {
      limit: options.limit,
      cursor: options.cursor,
      sort: options.sort === "popular" ? "views" : "date",
      timeRange: options.timeRange,
    });
    const canonicalId = category.id.trim();
    const canonicalName = category.name?.trim().toLowerCase();
    const clips = result.data.flatMap((clip) => {
      const channel = categoryChannel(clip);
      const normalized = channel ? normalizeKickClip(channel, clip) : null;
      if (!normalized) return [];
      const clipId = normalized.categoryId?.trim();
      const clipName = normalized.categoryName?.trim().toLowerCase();
      return (canonicalId && clipId === canonicalId) ||
        (canonicalName && clipName === canonicalName)
        ? [normalized]
        : [];
    });
    return { kind: "available", data: clips, cursor: result.cursor };
  }

  async getClipsByCategory(
    categorySlug: string,
    options: PaginationOptions = {}
  ): Promise<Awaited<ReturnType<typeof ClipEndpoints.getClipsByCategorySlug>>> {
    return ClipEndpoints.getClipsByCategorySlug(categorySlug, options);
  }
}
