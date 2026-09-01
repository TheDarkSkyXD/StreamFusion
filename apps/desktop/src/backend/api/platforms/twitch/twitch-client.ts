/**
 * Twitch API Client
 *
 * Hybrid client combining:
 * - GQL API (no API key) for public data: streams, categories, search, channels, videos, clips
 * - Helix API (via Cloudflare Worker) for auth-only: followed streams, followed channels, user info
 */

import { logger } from "@backend/logging/logger";
import type { Platform, TwitchUser } from "../../../../shared/auth-types";
import { twitchAuthService } from "../../../auth/twitch-auth";
import type { IPlatformReader, PageResult, TopStreamsOptions } from "../../unified/platform-reader";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../../../shared/platform-types";
import { clients } from "../../unified/registry";
import * as StreamEndpoints from "./endpoints/stream-endpoints";
import * as UserEndpoints from "./endpoints/user-endpoints";
import * as GqlClient from "./twitch-gql-client";
import { transformTwitchVideo } from "./twitch-transformers";
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

// ========== Twitch API Client Class ==========

class TwitchClient extends TwitchRequestor implements IPlatformReader {
  readonly platform: Platform = "twitch";

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
    const normalized: PaginationOptions & { gameId?: string; language?: string } = {
      first: "first" in options ? options.first : (options as TopStreamsOptions).limit,
      after: "after" in options ? options.after : (options as TopStreamsOptions).cursor,
      gameId: "gameId" in options ? options.gameId : (options as TopStreamsOptions).categoryId,
      language: options.language,
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

  /**
   * Search for channels
   * Authenticated searches prefer Helix because it supports real cursor
   * pagination. Logged-out searches use public GQL. Each transport is attempted
   * at most once so a dual failure cannot loop back into a duplicate Helix call.
   */
  async searchChannels(
    query: string,
    options: PaginationOptions & { liveOnly?: boolean } = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    if (this.isAuthenticated()) {
      try {
        const SearchEndpoints = await import("./endpoints/search-endpoints");
        return await SearchEndpoints.searchChannels(this, query, options);
      } catch (error) {
        logger.warn("Twitch:Client", "Helix searchChannels failed, falling back to GQL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
    }

    return GqlClient.gqlSearchChannels(query, options);
  }

  // ========== Categories/Games (GQL) ==========

  /**
   * Get top categories/games
   * Uses GQL - no API key needed
   */
  async getTopCategories(
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    try {
      return await GqlClient.gqlGetTopCategories(options);
    } catch (error) {
      logger.warn("Twitch:Client", "GQL getTopCategories failed, falling back to Helix", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      const CategoryEndpoints = await import("./endpoints/category-endpoints");
      return CategoryEndpoints.getTopCategories(this, options);
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

  /**
   * Search for categories/games. Prefer the documented Helix endpoint when a
   * token exists; logged-out callers use public GQL. Do not retry a failed
   * transport twice.
   */
  async searchCategories(
    query: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    if (this.isAuthenticated()) {
      const SearchEndpoints = await import("./endpoints/search-endpoints");
      let helixResult: PaginatedResult<UnifiedCategory>;
      try {
        helixResult = await SearchEndpoints.searchCategories(this, query, options);
      } catch (error) {
        logger.warn("Twitch:Client", "Helix searchCategories failed, falling back to GQL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return GqlClient.gqlSearchCategories(query, options);
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

    return GqlClient.gqlSearchCategories(query, options);
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

clients.register(twitchClient);
