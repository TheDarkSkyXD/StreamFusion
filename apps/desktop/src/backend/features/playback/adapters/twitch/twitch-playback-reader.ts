import { gqlGetCategoryVideos, gqlGetCategoryClips } from "./twitch-gql-category-media";
import * as GqlClient from "@backend/features/playback/adapters/twitch/twitch-gql-playback";
import { transformTwitchVideo } from "@backend/api/platforms/twitch/twitch-transformers";
import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import type {
  PaginatedResult,
  PaginationOptions,
} from "@backend/api/platforms/twitch/twitch-types";
import { logger } from "@backend/logging/logger";
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

function normalizedTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) ? value : timestamp.toISOString();
}

function normalizeVideoForCore(video: UnifiedVideo): UnifiedVideo | null {
  const normalized = {
    ...video,
    publishedAt: normalizedTimestamp(video.publishedAt),
  };
  const portable = {
    id: normalized.id,
    platform: normalized.platform,
    channelId: normalized.channelId,
    channelName: normalized.channelName,
    channelDisplayName: normalized.channelDisplayName,
    channelAvatar: normalized.channelAvatar,
    title: normalized.title,
    description: normalized.description,
    thumbnailUrl: normalized.thumbnailUrl,
    duration: normalized.duration,
    viewCount: normalized.viewCount,
    publishedAt: normalized.publishedAt,
    url: normalized.url,
    shareUrl: normalized.shareUrl,
    type: normalized.type,
    categoryId: normalized.categoryId,
    categoryName: normalized.categoryName,
  };
  return videoSchema.is(portable) ? normalized : null;
}

function normalizeClipForCore(clip: UnifiedClip): UnifiedClip | null {
  const normalized = {
    ...clip,
    createdAt: normalizedTimestamp(clip.createdAt),
  };
  const portable = {
    id: normalized.id,
    platform: normalized.platform,
    channelId: normalized.channelId,
    channelName: normalized.channelName,
    channelDisplayName: normalized.channelDisplayName,
    channelAvatar: normalized.channelAvatar,
    title: normalized.title,
    thumbnailUrl: normalized.thumbnailUrl,
    clipUrl: normalized.clipUrl,
    shareUrl: normalized.shareUrl,
    duration: normalized.duration,
    viewCount: normalized.viewCount,
    createdAt: normalized.createdAt,
    creatorName: normalized.creatorName,
    categoryId: normalized.categoryId,
    categoryName: normalized.categoryName,
  };
  return clipSchema.is(portable) ? normalized : null;
}

export class TwitchPlayback
  implements
    VideoReader<Platform, UnifiedVideo, UnifiedChannel, AbortSignal>,
    ClipReader<Platform, UnifiedClip, UnifiedChannel, AbortSignal>
{
  readonly platform = "twitch" as const;
  constructor(private readonly requestor: TwitchHelixRequestPort) {}
  async getVideosByChannel(
    channelLogin: string,
    options: PaginationOptions & { type?: "archive" | "highlight" | "upload" } = {}
  ): Promise<PaginatedResult<UnifiedVideo>> {
    return GqlClient.gqlGetVideosByChannel(channelLogin, options);
  }

  async readChannelVideos(
    channel: UnifiedChannel,
    options: ChannelContentOptions<AbortSignal> = {}
  ): Promise<PageResult<UnifiedVideo>> {
    options.signal?.throwIfAborted();
    const result = await this.getVideosByChannel(channel.username, {
      first: options.limit,
      after: options.cursor,
    });
    options.signal?.throwIfAborted();
    return {
      data: result.data.flatMap((video) => {
        const normalized = normalizeVideoForCore(video);
        return normalized ? [normalized] : [];
      }),
      cursor: result.cursor,
    };
  }

  async readCategoryVideos(
    category: CategoryRef,
    options: CategoryContentOptions = {}
  ): Promise<CategoryContentResult<UnifiedVideo>> {
    const result = await gqlGetCategoryVideos(category.id, options);
    return { kind: "available", ...result };
  }

  async getVideosByGame(
    gameId: string,
    options: PaginationOptions & { sort?: "time" | "views" } = {}
  ): Promise<PaginatedResult<import("@backend/api/platforms/twitch/twitch-types").TwitchApiVideo>> {
    const VideoEndpoints =
      await import("@backend/features/playback/adapters/twitch/video-endpoints");
    return VideoEndpoints.getVideosByGame(this.requestor, gameId, options);
  }

  async getVideosByUser(
    userId: string,
    options: PaginationOptions & { type?: "archive" | "highlight" | "upload" } = {}
  ): Promise<PaginatedResult<import("@backend/api/platforms/twitch/twitch-types").TwitchApiVideo>> {
    const VideoEndpoints =
      await import("@backend/features/playback/adapters/twitch/video-endpoints");
    return VideoEndpoints.getVideosByUser(this.requestor, userId, options);
  }

  async getVideoById(videoId: string): Promise<UnifiedVideo | null> {
    try {
      return await GqlClient.gqlGetVideoMetadata(videoId);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getVideoById failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      const VideoEndpoints =
        await import("@backend/features/playback/adapters/twitch/video-endpoints");
      const video = await VideoEndpoints.getVideoById(this.requestor, videoId);
      return video ? transformTwitchVideo(video) : null;
    }
  }

  async getVideosGameData(
    videoIds: string[]
  ): Promise<Record<string, { id: string; name: string }>> {
    return GqlClient.gqlFetchGamesForVideos(videoIds);
  }

  async getClipsByChannel(
    channelLogin: string,
    options: PaginationOptions & { filter?: string } = {}
  ): Promise<PaginatedResult<UnifiedClip>> {
    return GqlClient.gqlGetClipsByChannel(channelLogin, options);
  }

  async readChannelClips(
    channel: UnifiedChannel,
    options: ChannelContentOptions<AbortSignal> = {}
  ): Promise<PageResult<UnifiedClip>> {
    options.signal?.throwIfAborted();
    const result = await this.getClipsByChannel(channel.username, {
      first: options.limit,
      after: options.cursor,
    });
    options.signal?.throwIfAborted();
    return {
      data: result.data.flatMap((clip) => {
        const normalized = normalizeClipForCore(clip);
        return normalized ? [normalized] : [];
      }),
      cursor: result.cursor,
    };
  }

  async readCategoryClips(
    category: CategoryRef,
    options: CategoryClipOptions = {}
  ): Promise<CategoryContentResult<UnifiedClip>> {
    if (options.sort === "recent") {
      return {
        kind: "unsupported",
        reason: "Twitch Category Clips does not support Most Recent ordering",
      };
    }
    const result = await gqlGetCategoryClips(category.id, options);
    return { kind: "available", ...result };
  }

  async getClipsByGame(
    gameId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<import("@backend/api/platforms/twitch/twitch-types").TwitchApiClip>> {
    const ClipEndpoints = await import("@backend/features/playback/adapters/twitch/clip-endpoints");
    return ClipEndpoints.getClipsByGame(this.requestor, gameId, options);
  }

  async getClipsByBroadcaster(
    broadcasterId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<import("@backend/api/platforms/twitch/twitch-types").TwitchApiClip>> {
    const ClipEndpoints = await import("@backend/features/playback/adapters/twitch/clip-endpoints");
    return ClipEndpoints.getClipsByBroadcaster(this.requestor, broadcasterId, options);
  }
}
