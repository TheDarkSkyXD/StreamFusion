/**
 * Twitch API Client
 *
 * Hybrid client combining:
 * - GQL API (no API key) for public data: streams, categories, search, channels, videos, clips
 * - Helix API (via Cloudflare Worker) for auth-only: followed streams, followed channels, user info
 */

import type { TwitchUser } from "../../../../shared/auth-types";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../unified/platform-types";
import * as StreamEndpoints from "./endpoints/stream-endpoints";
import * as UserEndpoints from "./endpoints/user-endpoints";
import * as GqlClient from "./twitch-gql-client";
import { TwitchRequestor } from "./twitch-requestor";
import type { PaginatedResult, PaginationOptions, TwitchClientError } from "./twitch-types";

// Re-export types for backward compatibility
export type { PaginationOptions, PaginatedResult, TwitchClientError };

// ========== Twitch API Client Class ==========

class TwitchClient extends TwitchRequestor {
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
      console.warn("GQL getStreamsByLogins failed:", error);
      return { data: [] };
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
        console.warn("Helix getStreamsByUserIds failed, trying GQL:", error);
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
   */
  async getTopStreams(
    options: PaginationOptions & { gameId?: string; language?: string } = {}
  ): Promise<PaginatedResult<UnifiedStream>> {
    try {
      return await GqlClient.gqlGetTopStreams(options);
    } catch (error) {
      console.warn("GQL getTopStreams failed, falling back to Helix:", error);
      return StreamEndpoints.getTopStreams(this, options);
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
      console.warn("GQL getStreamByLogin failed, falling back to Helix:", error);
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
   * Uses GQL - no API key needed
   */
  async searchChannels(
    query: string,
    options: PaginationOptions & { liveOnly?: boolean } = {}
  ): Promise<PaginatedResult<UnifiedChannel>> {
    try {
      return await GqlClient.gqlSearchChannels(query, options);
    } catch (error) {
      console.warn("GQL searchChannels failed, falling back to Helix:", error);
      const SearchEndpoints = await import("./endpoints/search-endpoints");
      return SearchEndpoints.searchChannels(this, query, options);
    }
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
      console.warn("GQL getTopCategories failed, falling back to Helix:", error);
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
      console.warn("GQL getAllTopCategories failed, falling back to Helix:", error);
      const CategoryEndpoints = await import("./endpoints/category-endpoints");
      return CategoryEndpoints.getAllTopCategories(this);
    }
  }

  /**
   * Search for categories/games
   * Uses GQL - no API key needed
   */
  async searchCategories(
    query: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<UnifiedCategory>> {
    try {
      return await GqlClient.gqlSearchCategories(query, options);
    } catch (error) {
      console.warn("GQL searchCategories failed, falling back to Helix:", error);
      const SearchEndpoints = await import("./endpoints/search-endpoints");
      return SearchEndpoints.searchCategories(this, query, options);
    }
  }

  /**
   * Get category/game by ID
   * Uses GQL search as a fallback strategy
   */
  async getCategoryById(id: string): Promise<UnifiedCategory | null> {
    // GQL doesn't have a direct getById — fall back to Helix for this
    const CategoryEndpoints = await import("./endpoints/category-endpoints");
    return CategoryEndpoints.getCategoryById(this, id);
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

  /**
   * Get videos by user ID (legacy Helix - kept for backward compat)
   */
  async getVideosByUser(
    userId: string,
    options: PaginationOptions & { type?: "archive" | "highlight" | "upload" } = {}
  ): Promise<PaginatedResult<any>> {
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
      console.warn("GQL getVideoById failed, falling back to Helix:", error);
      const VideoEndpoints = await import("./endpoints/video-endpoints");
      return VideoEndpoints.getVideoById(this, videoId) as any;
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

  /**
   * Get clips by broadcaster ID (legacy Helix - kept for backward compat)
   */
  async getClipsByBroadcaster(
    broadcasterId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<any>> {
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
