/**
 * Twitch API Client
 *
 * Hybrid client combining:
 * - GQL API (no API key) for public data: streams, categories, search, channels, videos, clips
 * - Helix API (via Cloudflare Worker) for auth-only: followed streams, followed channels, user info
 */

import { logger } from "@backend/logging/logger";
import { clipSchema, videoSchema } from "@streamfusion/core/content";
import type {
  AccountFollowReader,
  AccountFollowReadResult,
  FollowedChannelReader,
  FollowedStreamReader,
} from "@streamfusion/core/follows";
import type {
  ChannelRef,
  ChannelReader,
  ChannelSearchOptions,
  CategoryReader,
  CategoryStreamReader,
  CategoryStreamsOptions,
  CategoryClipOptions,
  CategoryContentOptions,
  CategoryContentResult,
  CategoryRef,
  ChannelContentOptions,
  ClipReader,
  DiscoverySearchReader,
  DiscoverySearchOptions,
  DiscoverySearchResult,
  IPlatformReader,
  PageOptions,
  PageResult,
  TopStreamsOptions,
  VideoReader,
} from "@streamfusion/core/discovery";
import type { Platform, TwitchUser } from "../../../../shared/auth-types";
import { twitchAuthService } from "../../../auth/twitch-auth";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../../../shared/platform-types";
import * as StreamEndpoints from "./endpoints/stream-endpoints";
import * as UserEndpoints from "./endpoints/user-endpoints";
import * as GqlClient from "./twitch-gql-client";
import { transformTwitchClip, transformTwitchVideo } from "./twitch-transformers";
import { TwitchRequestor } from "./twitch-requestor";
import type {
  PaginatedResult,
  PaginationEndReason,
  PaginationOptions,
  TwitchClientError,
} from "./twitch-types";

// Re-export types for backward compatibility
export type { PaginationOptions, PaginatedResult, PaginationEndReason, TwitchClientError };

export type TwitchFollowedStreamAccess =
  { kind: "guest" } | { kind: "ready" } | { kind: "unavailable" };

const TWITCH_STREAM_LANGUAGES: ReadonlySet<string> = new Set([
  "ar",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "fi",
  "fr",
  "he",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pl",
  "pt",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
]);

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

function mergeCategoryViewerCounts(
  result: PaginatedResult<UnifiedCategory>,
  countsById: Record<string, number>
): PaginatedResult<UnifiedCategory> {
  return {
    ...result,
    data: result.data.map((category) => {
      const viewerCount = countsById[category.id];
      return viewerCount === undefined ? category : { ...category, viewerCount };
    }),
  };
}

function toTwitchPageOptions(options: PageOptions | PaginationOptions): PaginationOptions {
  const first = "limit" in options ? options.limit : "first" in options ? options.first : undefined;
  const after =
    "cursor" in options ? options.cursor : "after" in options ? options.after : undefined;
  return {
    ...(first === undefined ? {} : { first }),
    ...(after === undefined ? {} : { after }),
  };
}

function toTwitchChannelSearchOptions(
  options: ChannelSearchOptions | (PaginationOptions & { liveOnly?: boolean })
): PaginationOptions & { liveOnly?: boolean } {
  const page = toTwitchPageOptions(options);
  return {
    ...page,
    ...(options.liveOnly === undefined ? {} : { liveOnly: options.liveOnly }),
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

// ========== Twitch API Client Class ==========

class TwitchClient
  extends TwitchRequestor
  implements
    IPlatformReader<UnifiedStream>,
    ChannelReader<Platform, UnifiedChannel, ChannelRef>,
    CategoryReader<Platform, UnifiedCategory>,
    CategoryStreamReader<Platform, UnifiedStream>,
    DiscoverySearchReader<Platform, UnifiedStream, UnifiedChannel, UnifiedCategory, AbortSignal>,
    VideoReader<Platform, UnifiedVideo, UnifiedChannel, AbortSignal>,
    ClipReader<Platform, UnifiedClip, UnifiedChannel, AbortSignal>,
    AccountFollowReader<"twitch", UnifiedChannel>,
    FollowedChannelReader<"twitch", UnifiedChannel>,
    FollowedStreamReader<"twitch", UnifiedStream, PaginationOptions>
{
  readonly platform = "twitch" as const;

  isAuthenticated(): boolean {
    return twitchAuthService.isAuthenticated();
  }

  async getFollowedStreamAccess(): Promise<TwitchFollowedStreamAccess> {
    if (!this.isAuthenticated()) return { kind: "guest" };

    const accessToken = await twitchAuthService.getValidAccessToken();
    return accessToken ? { kind: "ready" } : { kind: "unavailable" };
  }

  // ==========================================
  // AUTH-ONLY ENDPOINTS (Helix API via Worker)
  // These require user authentication
  // ==========================================

  /**
   * Get the currently authenticated user
   * Requires: User OAuth token
   */
  async getUser(): Promise<TwitchUser | null> {
    return UserEndpoints.getUser(this);
  }

  /**
   * Get users by their IDs
   * Requires: User OAuth token
   */
  async getUsersById(ids: string[]): Promise<TwitchUser[]> {
    return UserEndpoints.getUsersById(this, ids);
  }

  /**
   * Get users by their login names
   * Requires: User OAuth token
   */
  async getUsersByLogin(logins: string[]): Promise<TwitchUser[]> {
    return UserEndpoints.getUsersByLogin(this, logins);
  }

  async getFollowerCounts(userIds: string[]): Promise<Map<string, number>> {
    return UserEndpoints.getFollowerCounts(this, userIds);
  }

  // ========== Followed Channels ==========

  /**
   * Get channels followed by the authenticated user
   * Requires: User OAuth token
   */
  async getFollowedChannels(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    return UserEndpoints.getFollowedChannels(this, options);
  }

  /**
   * Get all followed channels (handles pagination automatically)
   * Requires: User OAuth token
   */
  async getAllFollowedChannels(): Promise<UnifiedChannel[]> {
    return UserEndpoints.getAllFollowedChannels(this);
  }

  async readAccountFollows(): Promise<AccountFollowReadResult<UnifiedChannel>> {
    try {
      return {
        kind: "available",
        follows: await this.getAllFollowedChannels(),
        authoritative: true,
      };
    } catch (error) {
      return {
        kind: "unavailable",
        reason: error instanceof Error ? error.message : "twitch-follow-fetch-failed",
      };
    }
  }

  /**
   * Get live streams for followed channels
   * Requires: User OAuth token
   */
  async getFollowedStreams(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    return StreamEndpoints.getFollowedStreams(this, options);
  }

  // ==========================================
  // PUBLIC ENDPOINTS (GQL API - No API Key)
  // These work without any authentication
  // ==========================================

  /**
   * Get live streams by user logins (GQL - no auth needed)
   * Used for local follows / guest mode
   */
  async getStreamsByLogins(logins: string[]): Promise<PaginatedResult<UnifiedStream>> {
    try {
      const streams = await GqlClient.gqlGetStreamsByLogins(logins);
      return { data: streams };
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getStreamsByLogins failed", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw error;
    }
  }

  /**
   * Get live streams for specific user IDs
   * Tries GQL first (if logins are available), falls back to Helix
   */
  async getStreamsByUserIds(
    userIds: string[],
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    // Try Helix first if authenticated (most reliable for ID-based lookups)
    if (this.isAuthenticated()) {
      try {
        return await StreamEndpoints.getStreamsByUserIds(this, userIds, options);
      } catch (error) {
        logger.warn("Twitch:Client", "Helix getStreamsByUserIds failed, trying GQL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
    }

    // Fallback: Use GQL with user IDs converted to logins
    // We can look up logins via GQL's GetUserID (but that only goes login→ID)
    // So instead, we use ChannelShell which accepts login but not ID.
    // For guest mode, the local follows already have channelName (login),
    // so the caller should prefer getStreamsByLogins() instead.
    // Return empty for now if Helix is unavailable.
    return { data: [] };
  }

  /**
   * Get top live streams
   * Uses GQL - no API key needed
   *
   * Accepts either the legacy `{first, after, gameId, language}` shape or the
   * seam-standard `TopStreamsOptions` (`{limit, cursor, categoryId, language}`).
   */
  async getTopStreams(
    options: (PaginationOptions & { gameId?: string; language?: string }) | TopStreamsOptions = {}
  ): Promise<PageResult<UnifiedStream>> {
    const requestedLanguage = options.language?.trim().toLowerCase();
    if (requestedLanguage && !TWITCH_STREAM_LANGUAGES.has(requestedLanguage)) {
      return { data: [] };
    }
    const normalized: PaginationOptions & { gameId?: string; language?: string } = {
      first: "first" in options ? options.first : (options as TopStreamsOptions).limit,
      after: "after" in options ? options.after : (options as TopStreamsOptions).cursor,
      gameId: "gameId" in options ? options.gameId : (options as TopStreamsOptions).categoryId,
      language: requestedLanguage,
    };
    try {
      return await GqlClient.gqlGetTopStreams(normalized);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getTopStreams failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return StreamEndpoints.getTopStreams(this, normalized);
    }
  }

  async getStreamsByCategory(
    categoryId: string,
    options: CategoryStreamsOptions = {}
  ): Promise<PageResult<UnifiedStream>> {
    return this.getTopStreams({
      categoryId,
      limit: options.limit,
      cursor: options.cursor,
      language: options.language,
    });
  }

  /**
   * Get a specific stream by user login
   * Uses GQL - no API key needed
   */
  async getStreamByLogin(login: string): Promise<UnifiedStream | null> {
    try {
      return await GqlClient.gqlGetStreamByLogin(login);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getStreamByLogin failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return StreamEndpoints.getStreamByLogin(this, login);
    }
  }

  // ========== Channels (GQL) ==========

  /**
   * Get channel information by login
   * Uses GQL - no API key needed
   */
  async getChannelByLogin(login: string): Promise<UnifiedChannel | null> {
    return GqlClient.gqlGetChannelByLogin(login);
  }

  /**
   * Get channel information by broadcaster IDs
   * Note: For backward compatibility, this falls back to Helix
   * since GQL channels are looked up by login, not ID.
   */
  async getChannelsById(ids: string[]): Promise<UnifiedChannel[]> {
    // GQL doesn't support lookup by ID directly for channels;
    // This is only used in the getFollowedChannels flow which is auth-gated.
    const ChannelEndpoints = await import("./endpoints/channel-endpoints");
    return ChannelEndpoints.getChannelsById(this, ids);
  }

  async resolveChannel(ref: ChannelRef): Promise<UnifiedChannel | null> {
    if (ref.kind === "slug") return this.getChannelByLogin(ref.value);
    return (await this.getChannelsById([ref.value]))[0] ?? null;
  }

  /**
   * Search for channels
   * Authenticated searches prefer Helix because it supports real cursor
   * pagination. Logged-out searches use public GQL. Each transport is attempted
   * at most once so a dual failure cannot loop back into a duplicate Helix call.
   */
  async searchChannels(
    query: string,
    options: ChannelSearchOptions | (PaginationOptions & { liveOnly?: boolean }) = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    const normalized = toTwitchChannelSearchOptions(options);
    if (this.isAuthenticated()) {
      try {
        const SearchEndpoints = await import("./endpoints/search-endpoints");
        return await SearchEndpoints.searchChannels(this, query, normalized);
      } catch (error) {
        logger.warn("Twitch:Client", "Helix searchChannels failed, falling back to GQL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
    }

    return GqlClient.gqlSearchChannels(query, normalized);
  }

  // ========== Categories/Games (GQL) ==========

  /**
   * Get top categories/games
   * Uses GQL - no API key needed
   */
  async getTopCategories(
    options: PageOptions | PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    const normalized = toTwitchPageOptions(options);
    try {
      return await GqlClient.gqlGetTopCategories(normalized);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getTopCategories failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      const CategoryEndpoints = await import("./endpoints/category-endpoints");
      return CategoryEndpoints.getTopCategories(this, normalized);
    }
  }

  /**
   * Get ALL top categories with automatic pagination (for browse page)
   * Uses GQL - no API key needed
   */
  async getAllTopCategories(): Promise<UnifiedCategory[]> {
    try {
      return await GqlClient.gqlGetAllTopCategories();
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getAllTopCategories failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      const CategoryEndpoints = await import("./endpoints/category-endpoints");
      return CategoryEndpoints.getAllTopCategories(this);
    }
  }

  async getAllCategories(): Promise<UnifiedCategory[]> {
    return this.getAllTopCategories();
  }

  /**
   * Search for categories/games. Prefer the documented Helix endpoint when a
   * token exists; logged-out callers use public GQL. Do not retry a failed
   * transport twice.
   */
  async searchCategories(
    query: string,
    options: PageOptions | PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    const normalized = toTwitchPageOptions(options);
    if (this.isAuthenticated()) {
      const SearchEndpoints = await import("./endpoints/search-endpoints");
      let helixResult: PaginatedResult<UnifiedCategory>;
      try {
        helixResult = await SearchEndpoints.searchCategories(this, query, normalized);
      } catch (error) {
        logger.warn("Twitch:Client", "Helix searchCategories failed, falling back to GQL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return GqlClient.gqlSearchCategories(query, normalized);
      }

      try {
        const countsById = await GqlClient.gqlGetCategoryViewerCountsByIds(
          helixResult.data.map((category) => category.id)
        );
        return mergeCategoryViewerCounts(helixResult, countsById);
      } catch (error) {
        logger.warn("Twitch:Client", "GQL category viewer count hydration failed", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return helixResult;
      }
    }

    return GqlClient.gqlSearchCategories(query, normalized);
  }

  /**
   * Get category/game by ID. Prefers GQL (works without auth); falls back to Helix
   * if GQL fails for any reason and we happen to have an app token.
   */
  async getCategoryById(id: string): Promise<UnifiedCategory | null> {
    try {
      return await GqlClient.gqlGetCategoryById(id);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getCategoryById failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      const CategoryEndpoints = await import("./endpoints/category-endpoints");
      return CategoryEndpoints.getCategoryById(this, id);
    }
  }

  async searchDiscovery(
    query: string,
    options: DiscoverySearchOptions<UnifiedChannel, AbortSignal> = {}
  ): Promise<DiscoverySearchResult<UnifiedStream, UnifiedChannel, UnifiedCategory>> {
    const channels = options.channelSeeds
      ? { data: options.channelSeeds }
      : await this.searchChannels(query, { limit: options.limit, liveOnly: false });
    const categories =
      options.includeCategories === false
        ? { data: [] }
        : await this.searchCategories(query, { limit: options.limit });
    return {
      channels: channels.data,
      categories: categories.data,
      streams: [],
    };
  }

  /**
   * Get categories/games by multiple IDs
   */
  async getCategoriesByIds(ids: string[]): Promise<UnifiedCategory[]> {
    const CategoryEndpoints = await import("./endpoints/category-endpoints");
    return CategoryEndpoints.getCategoriesByIds(this, ids);
  }

  // ========== Videos (GQL) ==========

  /**
   * Get videos by channel login
   * Uses GQL - no API key needed
   */
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
    const channelCursor = options.cursor?.startsWith("channels:")
      ? options.cursor.slice("channels:".length)
      : undefined;
    const nativePage = channelCursor
      ? { data: [], cursor: undefined }
      : await this.getVideosByGame(category.id, {
          first: options.limit,
          after: options.cursor,
          sort: options.sort === "popular" ? "views" : "time",
        });

    if (nativePage.data.length > 0) {
      const users = await this.getUsersById([
        ...new Set(nativePage.data.map((video) => video.user_id)),
      ]);
      const usersById = new Map(users.map((user) => [user.id, user]));
      return {
        kind: "available",
        data: nativePage.data
          .flatMap((video) => {
            const normalized = normalizeVideoForCore({
              ...transformTwitchVideo(video),
              channelAvatar: usersById.get(video.user_id)?.profileImageUrl || "",
              categoryId: video.game_id || category.id,
              categoryName: video.game_name || category.name,
              language: video.language,
            });
            return normalized ? [normalized] : [];
          })
          .filter((video) => video.isLive !== true),
        cursor: nativePage.cursor,
      };
    }

    const limit = options.limit ?? 20;
    const streams = await this.getStreamsByCategory(category.id, {
      limit: Math.min(limit, 24),
      cursor: channelCursor,
      categoryName: category.name,
      language: options.language,
    });
    const channels = [
      ...new Map(streams.data.map((stream) => [stream.channelId, stream])).values(),
    ];
    const perChannelLimit = Math.min(
      Math.max(Math.ceil(limit / Math.max(channels.length, 1)), 1),
      5
    );
    const pages: PageResult<UnifiedVideo>[] = [];
    for (let index = 0; index < channels.length; index += 4) {
      pages.push(
        ...(await Promise.all(
          channels
            .slice(index, index + 4)
            .map((channel) =>
              this.getVideosByChannel(channel.channelName, { first: perChannelLimit })
            )
        ))
      );
    }
    const pageVideos = pages.flatMap((page) => page.data);
    const gamesByVideoId =
      pageVideos.length > 0
        ? await this.getVideosGameData(pageVideos.map((video) => video.id))
        : {};
    const videos = pages.flatMap((page, index) => {
      const channel = channels[index];
      return page.data.flatMap((video) => {
        const game = gamesByVideoId[video.id];
        const normalized = normalizeVideoForCore({
          ...video,
          channelId: channel.channelId,
          channelName: channel.channelName,
          channelDisplayName: channel.channelDisplayName,
          channelAvatar: channel.channelAvatar,
          categoryId: game?.id || video.categoryId,
          categoryName: game?.name || video.categoryName,
          language: channel.language,
        });
        return normalized ? [normalized] : [];
      });
    });
    const requestedName = category.name?.trim().toLowerCase();
    const matchingVideos = videos.filter(
      (video) =>
        video.isLive !== true &&
        (video.categoryId === category.id ||
          (Boolean(requestedName) && video.categoryName?.trim().toLowerCase() === requestedName))
    );

    return {
      kind: "available",
      data: orderCategoryVideos(matchingVideos, options),
      cursor:
        streams.cursor && streams.cursor !== channelCursor
          ? `channels:${streams.cursor}`
          : undefined,
    };
  }

  /** Get videos by native Twitch game/category ID through Helix. */
  async getVideosByGame(
    gameId: string,
    options: PaginationOptions & { sort?: "time" | "views" } = {}
  ): Promise<PaginatedResult<import("./twitch-types").TwitchApiVideo>> {
    const VideoEndpoints = await import("./endpoints/video-endpoints");
    return VideoEndpoints.getVideosByGame(this, gameId, options);
  }

  /**
   * Get videos by user ID (legacy Helix - kept for backward compat)
   */
  async getVideosByUser(
    userId: string,
    options: PaginationOptions & { type?: "archive" | "highlight" | "upload" } = {}
  ): Promise<PaginatedResult<import("./twitch-types").TwitchApiVideo>> {
    const VideoEndpoints = await import("./endpoints/video-endpoints");
    return VideoEndpoints.getVideosByUser(this, userId, options);
  }

  /**
   * Get a single video by ID
   * Uses GQL - no API key needed
   */
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
      const VideoEndpoints = await import("./endpoints/video-endpoints");
      const video = await VideoEndpoints.getVideoById(this, videoId);
      return video ? transformTwitchVideo(video) : null;
    }
  }

  /**
   * Get game/category data for videos via GQL
   */
  async getVideosGameData(
    videoIds: string[]
  ): Promise<Record<string, { id: string; name: string }>> {
    return GqlClient.gqlFetchGamesForVideos(videoIds);
  }

  // ========== Clips (GQL) ==========

  /**
   * Get clips by channel login
   * Uses GQL - no API key needed
   */
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
        reason: "Twitch Helix Category Clips does not support Most Recent ordering",
      };
    }
    const result = await this.getClipsByGame(category.id, {
      first: options.limit,
      after: options.cursor,
    });
    const users = await this.getUsersById([
      ...new Set(result.data.map((clip) => clip.broadcaster_id)),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    return {
      kind: "available",
      data: result.data.flatMap((clip) => {
        const normalized = normalizeClipForCore({
          ...transformTwitchClip(clip),
          channelName: usersById.get(clip.broadcaster_id)?.login || clip.broadcaster_name,
          channelAvatar: usersById.get(clip.broadcaster_id)?.profileImageUrl || "",
          categoryId: clip.game_id || category.id,
          categoryName: category.name,
        });
        return normalized ? [normalized] : [];
      }),
      cursor: result.cursor,
    };
  }

  /** Get clips by native Twitch game/category ID through Helix. */
  async getClipsByGame(
    gameId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<import("./twitch-types").TwitchApiClip>> {
    const ClipEndpoints = await import("./endpoints/clip-endpoints");
    return ClipEndpoints.getClipsByGame(this, gameId, options);
  }

  /**
   * Get clips by broadcaster ID (legacy Helix - kept for backward compat)
   */
  async getClipsByBroadcaster(
    broadcasterId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<import("./twitch-types").TwitchApiClip>> {
    const ClipEndpoints = await import("./endpoints/clip-endpoints");
    return ClipEndpoints.getClipsByBroadcaster(this, broadcasterId, options);
  }

  // ========== Utility ==========

  /**
   * Check if a channel is live (lightweight GQL check)
   */
  async isChannelLive(login: string): Promise<boolean> {
    return GqlClient.gqlIsChannelLive(login);
  }

  /**
   * Get follower count via GQL (no auth needed)
   */
  async getFollowerCount(login: string): Promise<number | null> {
    return GqlClient.gqlGetFollowerCount(login);
  }
}

// ========== Export Singleton ==========

export const twitchClient = new TwitchClient();
