/**
 * Unified Platform Types
 *
 * Common type definitions that abstract over platform-specific implementations.
 * Both Twitch and Kick API clients should return data conforming to these types.
 */

import type {
  Category as CoreCategory,
  Channel as CoreChannel,
  Clip as CoreClip,
  SocialLink as CoreSocialLink,
  Stream as CoreStream,
  Video as CoreVideo,
} from "@streamfusion/core/content";
import { Platform } from "@streamfusion/core/platform";
import type { ChannelAccountStatus } from "./channel-account-status-types";
import type { SubscriberBadge } from "./chat-types";

type Mutable<T> = { -readonly [TKey in keyof T]: T[TKey] };

export type UnifiedStream = Omit<Mutable<CoreStream>, "startedAt" | "tags"> & {
  startedAt: string | null;
  tags: string[];
};

export type UnifiedChannel = Omit<
  Mutable<CoreChannel>,
  "createdAt" | "lastLiveAt" | "socialLinks"
> & {
  createdAt?: string;
  lastLiveAt?: string;
  socialLinks?: SocialLink[];
  /**
   * Account availability, independent from isLive. Required on authoritative
   * Kick channel responses; omitted on providers that do not classify it.
   */
  accountStatus?: ChannelAccountStatus;
  // Kick-specific: chatroom ID for Pusher WebSocket subscription
  chatroomId?: number;
  // Kick-specific: legacy channel/db ID used by web-only channel endpoints.
  // This differs from the official API's broadcaster identity in `id`.
  kickChannelId?: string;
  // Kick-specific: broadcaster `user_id`. 7TV's KICK connection is keyed by
  // this user_id, so it is kept explicit even when it matches `id`.
  kickUserId?: string;
  // Kick-specific: subscriber badges
  subscriberBadges?: SubscriberBadge[];
  // Kick-specific: chatroom mode settings (followers/subs/slow/emote-only/account-age).
  // Sourced from data.chatroom on the v2 channel-resolve payload; used to seed
  // useRoomStateStore on channel mount. Absent for Twitch channels.
  chatroomSettings?: KickChatroomSettings;
};

/**
 * Kick chatroom mode settings — initial-fetch shape, normalized.
 *
 * The raw v2 payload uses flat fields (`followers_mode: bool, slow_mode: bool,
 * message_interval, following_min_duration`); this normalized shape mirrors what
 * the chatroom-update Pusher event emits, so the merge seam in
 * useChatSettingsSync sees one shape regardless of source.
 *
 * Units: followersMode.minDuration is **minutes**; slowMode.interval is
 * **seconds**; accountAge.minDuration is **minutes**.
 */
export interface KickChatroomSettings {
  slowMode: { enabled: boolean; interval: number | null };
  followersMode: { enabled: boolean; minDuration: number | null };
  subscribersMode: { enabled: boolean };
  emoteOnlyMode: { enabled: boolean };
  /** Account-age restriction. Absent on initial v2 fetch — only delivered via WS. */
  accountAge?: { enabled: boolean; minDuration: number | null };
}

export type SocialLink = Mutable<CoreSocialLink>;

// ========== Category/Game Types ==========

export type UnifiedCategory = Omit<Mutable<CoreCategory>, "tags"> & {
  igdbId?: string;
  // Curated tags ("FPS", "Casual", "IRL", …). Kick surfaces these in
  // /private/v1/categories; Twitch doesn't include any on /games/top, so for
  // Twitch-only entries this is empty until the per-card lazy fetch fills it.
  tags?: string[];
  // Twitch-only: URL slug (e.g. "just-chatting"). Required by the
  // DirectoryPage_Game persisted query, which keys off slug not numeric id.
  slug?: string;
  // Set by the frontend merge in useTopCategories when the same category exists
  // on both platforms — lets CategoryDetail skip a brittle runtime name-search.
  crossPlatformId?: string;
  crossPlatformName?: string;
};

// ========== User Types ==========

export interface UnifiedUser {
  id: string;
  platform: Platform;
  username: string;
  displayName: string;
  avatarUrl: string;
  email?: string;
  isVerified: boolean;
  createdAt: string;
}

// ========== Follow Types ==========

export interface UnifiedFollow {
  id: string;
  platform: Platform;
  channel: UnifiedChannel;
  followedAt: string;
  notifications: boolean;
}

export type UnifiedVideo = Omit<Mutable<CoreVideo>, "publishedAt"> & {
  publishedAt: string;
  source?: string;
  isLive?: boolean;
  isSubOnly?: boolean;
  language?: string;
};

export type UnifiedClip = Omit<Mutable<CoreClip>, "createdAt"> & {
  embedUrl: string;
  createdAt: string;
  gameId?: string;
  gameName?: string;
  language?: string;
  vodId?: string;
};

// ========== Search Results ==========

export interface SearchResults<T> {
  items: T[];
  cursor?: string;
  hasMore: boolean;
}

// ========== Pagination ==========

export interface PaginationParams {
  limit?: number;
  cursor?: string;
}

// ========== API Response Types ==========

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  status?: number;
}
