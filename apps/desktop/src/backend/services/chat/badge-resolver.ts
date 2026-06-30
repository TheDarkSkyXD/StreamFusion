/**
 * Twitch Badge Resolver
 *
 * Resolves badge identifiers to full badge data including images.
 * Fetches and caches global and channel badges from Twitch API.
 */

// Cross-logger: badge-resolver is reached from the renderer via twitch-chat
// → TwitchChat.tsx. Importing the backend logger here would drag electron-log
// into the renderer bundle.
import { logger } from "@/lib/cross-logger";
import type { BadgeSet, BadgeVersion, ChatBadge } from "../../../shared/chat-types";

// ========== Types ==========

interface TwitchBadgeVersion {
  id: string;
  image_url_1x: string;
  image_url_2x: string;
  image_url_4x: string;
  title: string;
  description: string;
  click_action: string | null;
  click_url: string | null;
}

interface TwitchBadgeSet {
  set_id: string;
  versions: TwitchBadgeVersion[];
}

interface TwitchBadgesResponse {
  data: TwitchBadgeSet[];
}

interface TwitchGqlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface TwitchGqlBroadcastBadgesData {
  user?: {
    broadcastBadges?: Array<TwitchGqlBroadcastBadge | null>;
  } | null;
}

interface TwitchGqlBroadcastBadge {
  setID?: string | null;
  version?: string | null;
  imageURL?: string | null;
  title?: string | null;
}

interface TwitchGqlChatBadgesData {
  badges?: Array<TwitchGqlChatBadge | null>;
}

interface TwitchGqlChatBadge {
  setID?: string | null;
  version?: string | null;
  image1x?: string | null;
  image2x?: string | null;
  image4x?: string | null;
  title?: string | null;
}

interface LoadChannelBadgesOptions {
  forceRefresh?: boolean;
}

// ========== Constants ==========

const TWITCH_API_BASE = "https://api.twitch.tv/helix";
const TWITCH_GQL_ENDPOINT = "https://gql.twitch.tv/gql";
// Same anonymous Android-app Client-Id used by Xtra and this repo's public GQL
// client. Twitch web Client-Id commonly requires paired integrity headers.
const TWITCH_GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const GQL_REQUEST_TIMEOUT_MS = 10_000;
const BADGE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
// Cap on per-channel badge entries kept in memory. Without this, broadcasters
// watched and abandoned during a long session stay cached forever; eviction is
// insertion-order (oldest-first) since JS Map preserves insertion order.
const MAX_CHANNEL_BADGES = 20;
// Cap on resolveBadges cache entries. Each entry is a tuple of (cache-key-string,
// resolved badges array). Soft cap with `clear()` overflow keeps the worst-case
// memory bounded without paying per-entry LRU bookkeeping.
const RESOLVE_CACHE_MAX_SIZE = 5000;

// ========== BadgeResolver Class ==========

export class BadgeResolver {
  /** Global badges (available in all channels) */
  private globalBadges: Map<string, BadgeSet> = new Map();

  /** Channel-specific badges (keyed by broadcaster ID) */
  private channelBadges: Map<string, Map<string, BadgeSet>> = new Map();

  /** Timestamps for cache invalidation */
  private globalBadgesLoadedAt: number = 0;
  private channelBadgesLoadedAt: Map<string, number> = new Map();

  /**
   * Per-resolve result cache. Most chat messages have small, repeating badge
   * sets (e.g. moderator + subscriber:6), so a key→resolved-array map collapses
   * thousands of allocations per minute on busy channels into Map.get() lookups.
   * Returning the same array reference also helps `ChatMessage` memoization
   * stability across renders for repeat posters.
   */
  private resolveCache: Map<string, ChatBadge[]> = new Map();

  // ========== Loading Methods ==========

  /**
   * Load global Twitch badges
   */
  async loadGlobalBadges(token: string, clientId: string): Promise<void> {
    // Check cache validity
    if (this.globalBadges.size > 0 && Date.now() - this.globalBadgesLoadedAt < BADGE_CACHE_TTL) {
      return;
    }

    try {
      const badges = await this.fetchBadges("/chat/badges/global", token, clientId);
      this.globalBadges = this.transformBadges(badges);
      this.globalBadgesLoadedAt = Date.now();
      // New badge data invalidates any previously-cached resolutions.
      this.resolveCache.clear();
      logger.debug("Chat:Badges", "Loaded global badge sets", {
        count: this.globalBadges.size,
      });
    } catch (error) {
      logger.error("Chat:Badges", "Failed to load global badges", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  /**
   * Load channel-specific badges
   */
  async loadChannelBadges(
    broadcasterId: string,
    token: string,
    clientId: string,
    channelLogin?: string,
    options: LoadChannelBadgesOptions = {}
  ): Promise<void> {
    // Check cache validity
    const loadedAt = this.channelBadgesLoadedAt.get(broadcasterId);
    if (
      !options.forceRefresh &&
      this.channelBadges.has(broadcasterId) &&
      loadedAt &&
      Date.now() - loadedAt < BADGE_CACHE_TTL
    ) {
      return;
    }

    try {
      const badges = await this.fetchChannelBadgeSets(broadcasterId, token, clientId, channelLogin);
      this.channelBadges.set(broadcasterId, this.transformBadges(badges));
      this.channelBadgesLoadedAt.set(broadcasterId, Date.now());
      while (this.channelBadges.size > MAX_CHANNEL_BADGES) {
        const oldestKey = this.channelBadges.keys().next().value;
        if (!oldestKey) break;
        this.channelBadges.delete(oldestKey);
        this.channelBadgesLoadedAt.delete(oldestKey);
      }
      // New badge data invalidates any previously-cached resolutions.
      this.resolveCache.clear();
      logger.debug("Chat:Badges", "Loaded channel badge sets", {
        broadcasterId,
        count: this.channelBadges.get(broadcasterId)?.size ?? 0,
      });
    } catch (error) {
      logger.error("Chat:Badges", "Failed to load channel badges", {
        broadcasterId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }

  // ========== Resolution Methods ==========

  /**
   * Resolve a list of badge identifiers to full badge data.
   *
   * Hits a per-key result cache so repeated badge sets (the common case in
   * busy chats — moderators, regular subs, broadcasters) reuse the same
   * resolved array instead of allocating a fresh one per inbound message.
   */
  resolveBadges(badges: ChatBadge[], broadcasterId?: string): ChatBadge[] {
    if (badges.length === 0) return badges;

    const key = this.makeResolveCacheKey(badges, broadcasterId);
    const cached = this.resolveCache.get(key);
    if (cached) return cached;

    const resolved = badges.map((badge) => this.resolveBadge(badge, broadcasterId));

    if (this.resolveCache.size >= RESOLVE_CACHE_MAX_SIZE) {
      this.resolveCache.clear();
    }
    this.resolveCache.set(key, resolved);
    return resolved;
  }

  private makeResolveCacheKey(badges: ChatBadge[], broadcasterId?: string): string {
    const broadcaster = broadcasterId ?? "global";
    let parts = "";
    for (let i = 0; i < badges.length; i++) {
      if (i > 0) parts += "|";
      parts += `${badges[i].setId}:${badges[i].version}`;
    }
    return `${broadcaster}|${parts}`;
  }

  /**
   * Resolve a single badge identifier to full badge data
   */
  resolveBadge(badge: ChatBadge, broadcasterId?: string): ChatBadge {
    // Try channel badges first (they override global)
    if (broadcasterId) {
      const channelSet = this.channelBadges.get(broadcasterId)?.get(badge.setId);
      if (channelSet) {
        const version = channelSet.versions.get(badge.version);
        if (version) {
          return {
            setId: badge.setId,
            version: badge.version,
            imageUrl: version.imageUrl4x,
            title: version.title,
          };
        }
      }
    }

    // Fall back to global badges
    const globalSet = this.globalBadges.get(badge.setId);
    if (globalSet) {
      const version = globalSet.versions.get(badge.version);
      if (version) {
        return {
          setId: badge.setId,
          version: badge.version,
          imageUrl: version.imageUrl4x,
          title: version.title,
        };
      }
    }

    // Return original if not found (with empty URL)
    return badge;
  }

  /**
   * Check if a user has a specific badge
   */
  hasBadge(badges: ChatBadge[], setId: string): boolean {
    return badges.some((badge) => badge.setId === setId);
  }

  /**
   * Check if a user is a moderator based on badges
   */
  isModerator(badges: ChatBadge[]): boolean {
    return this.hasBadge(badges, "moderator") || this.hasBadge(badges, "broadcaster");
  }

  /**
   * Check if a user is a VIP based on badges
   */
  isVIP(badges: ChatBadge[]): boolean {
    return this.hasBadge(badges, "vip");
  }

  /**
   * Check if a user is a subscriber based on badges
   */
  isSubscriber(badges: ChatBadge[]): boolean {
    return this.hasBadge(badges, "subscriber") || this.hasBadge(badges, "founder");
  }

  // ========== Private Methods ==========

  /**
   * Fetch badges from Twitch API
   */
  private async fetchChannelBadgeSets(
    broadcasterId: string,
    token: string,
    clientId: string,
    channelLogin?: string
  ): Promise<TwitchBadgeSet[]> {
    try {
      const badges = await this.fetchBroadcastBadgesFromGql(broadcasterId, channelLogin);
      if (badges.length > 0) return badges;
    } catch (error) {
      logger.debug("Chat:Badges", "Twitch broadcastBadges GQL lookup failed; falling back", {
        broadcasterId,
        channelLogin,
        error:
          error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
    }

    if (channelLogin) {
      try {
        const badges = await this.fetchChatListBadgesFromGql(channelLogin);
        if (badges.length > 0) return badges;
      } catch (error) {
        logger.debug("Chat:Badges", "Twitch ChatList_Badges GQL lookup failed; falling back", {
          broadcasterId,
          channelLogin,
          error:
            error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
      }
    }

    return this.fetchBadges(`/chat/badges?broadcaster_id=${broadcasterId}`, token, clientId);
  }

  /**
   * Xtra uses `user.broadcastBadges` as the primary source for channel badge
   * images. That source reflects the custom subscriber badges Twitch web chat
   * renders for the broadcaster.
   */
  private async fetchBroadcastBadgesFromGql(
    broadcasterId: string,
    channelLogin?: string
  ): Promise<TwitchBadgeSet[]> {
    const variables: { id?: string; login?: string; quality: "QUADRUPLE" } = {
      quality: "QUADRUPLE",
    };
    if (broadcasterId) {
      variables.id = broadcasterId;
    } else if (channelLogin) {
      variables.login = channelLogin;
    }

    const response = await this.fetchGql<TwitchGqlBroadcastBadgesData>({
      operationName: "UserBadges",
      variables,
      query: `query UserBadges($id: ID, $login: String, $quality: BadgeImageSize) {
        user(id: $id, login: $login, lookupType: ALL) {
          broadcastBadges {
            imageURL(size: $quality)
            setID
            title
            version
          }
        }
      }`,
    });

    return this.transformFlatBadges(
      response.data?.user?.broadcastBadges?.map((badge) =>
        badge
          ? {
              setId: badge.setID,
              version: badge.version,
              imageUrl1x: badge.imageURL,
              imageUrl2x: badge.imageURL,
              imageUrl4x: badge.imageURL,
              title: badge.title,
            }
          : null
      ) ?? []
    );
  }

  /**
   * Persisted-query fallback mirrored from Xtra's `ChatList_Badges` path.
   */
  private async fetchChatListBadgesFromGql(channelLogin: string): Promise<TwitchBadgeSet[]> {
    const response = await this.fetchGql<TwitchGqlChatBadgesData>({
      operationName: "ChatList_Badges",
      variables: { channelLogin },
      extensions: {
        persistedQuery: {
          sha256Hash: "dd0997370fb7ca288bc52a96a9a7e3222c75c4a9a9b03df17d779666f07f7529",
          version: 1,
        },
      },
    });

    return this.transformFlatBadges(
      response.data?.badges?.map((badge) =>
        badge
          ? {
              setId: badge.setID,
              version: badge.version,
              imageUrl1x: badge.image1x,
              imageUrl2x: badge.image2x,
              imageUrl4x: badge.image4x,
              title: badge.title,
            }
          : null
      ) ?? []
    );
  }

  private async fetchGql<T>(body: Record<string, unknown>): Promise<TwitchGqlResponse<T>> {
    const response = await fetch(TWITCH_GQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Client-Id": TWITCH_GQL_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GQL_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Badge GQL error: ${response.status}`);
    }

    const data = (await response.json()) as TwitchGqlResponse<T>;
    if (data.errors && data.errors.length > 0) {
      throw new Error(data.errors.map((error) => error.message ?? "unknown").join("; "));
    }
    return data;
  }

  private async fetchBadges(
    endpoint: string,
    token: string,
    clientId: string
  ): Promise<TwitchBadgeSet[]> {
    if (!token) {
      throw new Error("No Twitch token available for badge fetch");
    }

    const response = await fetch(`${TWITCH_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": clientId,
      },
    });

    if (!response.ok) {
      throw new Error(`Badge API error: ${response.status}`);
    }

    const data = (await response.json()) as TwitchBadgesResponse;
    return data.data;
  }

  private transformFlatBadges(
    apiBadges: Array<{
      setId?: string | null;
      version?: string | null;
      imageUrl1x?: string | null;
      imageUrl2x?: string | null;
      imageUrl4x?: string | null;
      title?: string | null;
    } | null>
  ): TwitchBadgeSet[] {
    const badgeSets = new Map<string, TwitchBadgeVersion[]>();

    for (const badge of apiBadges) {
      if (!badge?.setId || !badge.version || !badge.imageUrl4x) continue;
      const versions = badgeSets.get(badge.setId) ?? [];
      versions.push({
        id: badge.version,
        image_url_1x: badge.imageUrl1x ?? badge.imageUrl4x,
        image_url_2x: badge.imageUrl2x ?? badge.imageUrl4x,
        image_url_4x: badge.imageUrl4x,
        title: badge.title ?? badge.setId,
        description: badge.title ?? badge.setId,
        click_action: null,
        click_url: null,
      });
      badgeSets.set(badge.setId, versions);
    }

    return Array.from(badgeSets, ([set_id, versions]) => ({ set_id, versions }));
  }

  /**
   * Transform API response to our BadgeSet format
   */
  private transformBadges(apiBadges: TwitchBadgeSet[]): Map<string, BadgeSet> {
    const result = new Map<string, BadgeSet>();

    for (const apiSet of apiBadges) {
      const versions = new Map<string, BadgeVersion>();

      for (const apiVersion of apiSet.versions) {
        versions.set(apiVersion.id, {
          id: apiVersion.id,
          imageUrl1x: apiVersion.image_url_1x,
          imageUrl2x: apiVersion.image_url_2x,
          imageUrl4x: apiVersion.image_url_4x,
          title: apiVersion.title,
          description: apiVersion.description,
        });
      }

      result.set(apiSet.set_id, {
        setId: apiSet.set_id,
        versions,
      });
    }

    return result;
  }

  /**
   * Clear all cached badges
   */
  clearCache(): void {
    this.globalBadges.clear();
    this.channelBadges.clear();
    this.globalBadgesLoadedAt = 0;
    this.channelBadgesLoadedAt.clear();
    this.resolveCache.clear();
  }
}

// ========== Export Singleton ==========

export const badgeResolver = new BadgeResolver();
