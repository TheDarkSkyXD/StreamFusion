/**
 * Kick API Types
 *
 * Type definitions for the official Kick Public API v1.
 * API Documentation: https://docs.kick.com/
 *
 * These are the raw types from the API before transformation to unified types.
 */

// ========== Standard API Response Wrapper ==========

export interface KickApiResponse<T> {
  data: T;
  message?: string;
}

// ========== Official API: Users ==========
// Endpoint: GET /public/v1/users
// Scope: user:read

export interface KickApiUser {
  user_id: number;
  name: string;
  email?: string;
  profile_picture: string | null;
}

// ========== Official API: Token Introspect ==========
// Endpoint: POST /public/v1/token/introspect

export interface KickApiTokenIntrospect {
  active: boolean;
  client_id?: string;
  exp?: number;
  scope?: string;
  token_type?: "user" | "bot";
}

// ========== Official API: Channels ==========
// Endpoint: GET /public/v1/channels
// Scope: channel:read

export interface KickApiChannel {
  broadcaster_user_id: number;
  slug: string;
  channel_description: string;
  banner_picture: string | null;
  stream_title: string;
  category: KickApiChannelCategory | null;
  stream: KickApiChannelStream | null;
}

export interface KickApiChannelCategory {
  id: number;
  name: string;
  thumbnail: string;
}

export interface KickApiChannelStream {
  is_live: boolean;
  is_mature: boolean;
  key?: string;
  language: string;
  start_time: string;
  thumbnail: string | null;
  url?: string;
  viewer_count: number;
  custom_tags: string[];
}

// ========== Official API: Livestreams ==========
// Endpoint: GET /public/v1/livestreams
// Scope: channel:read

export interface KickApiLivestream {
  broadcaster_user_id: number;
  channel_id: number;
  slug: string;
  broadcaster_display_name?: string; // Properly capitalized username (e.g., "NickLee")
  stream_title: string;
  language: string;
  has_mature_content: boolean;
  viewer_count: number;
  thumbnail: string | null;
  profile_picture: string | null; // Channel avatar URL (kick.com/img/...)
  started_at: string;
  custom_tags: string[];
  tags?: string[];
  category: KickApiChannelCategory;
}

// Endpoint: GET /public/v1/livestreams/stats
export interface KickApiLivestreamStats {
  total_count: number;
}

// ========== Official API: Categories ==========
// Endpoint: GET /public/v1/categories?q=:query
// Endpoint: GET /public/v1/categories/:category_id
// Scope: channel:read

export interface KickApiCategory {
  id: number;
  name: string;
  thumbnail: string;
  tags?: string[];
  viewer_count?: number;
}

// ========== Official API: Channel Rewards ==========
// Endpoint: GET /public/v1/channels/rewards
// Scope: channel:rewards:read, channel:rewards:write

export interface KickApiChannelReward {
  id: string;
  broadcaster_user_id: number;
  title: string;
  description: string;
  cost: number;
  enabled: boolean;
  is_paused: boolean;
  requires_user_input: boolean;
  background_color_start: string;
  background_color_end: string;
}

// Endpoint: POST /public/v1/channels/rewards
export interface KickApiCreateRewardRequest {
  background_color_start: string;
  background_color_end: string;
  cost: number;
  description: string;
  enabled: boolean;
  is_paused: boolean;
  requires_user_input: boolean;
  title: string;
}

// ========== Official API: Chat ==========
// Endpoint: POST /public/v1/chat
// Scope: chat:write

export interface KickApiChatMessageRequest {
  broadcaster_user_id?: number;
  content: string;
  reply_to_message_id?: string;
  type: "user" | "bot";
}

export interface KickApiChatMessageResponse {
  is_sent: boolean;
  message_id: string;
}

// ========== Official API: Moderation ==========
// Endpoint: POST /public/v1/moderation/bans
// Endpoint: DELETE /public/v1/moderation/bans
// Scope: moderation:ban

export interface KickApiModerationBanRequest {
  broadcaster_user_id: number;
  user_id: number;
  duration?: number; // minutes, omit for permanent ban
  reason?: string;
}

// ========== Official API: KICKs Leaderboard ==========
// Endpoint: GET /public/v1/kicks/leaderboard
// Scope: kicks:read

export interface KickApiLeaderboardEntry {
  rank: number;
  user_id: number;
  username: string;
  gifted_amount: number;
}

export interface KickApiKicksLeaderboard {
  lifetime: KickApiLeaderboardEntry[];
  month: KickApiLeaderboardEntry[];
  week: KickApiLeaderboardEntry[];
}

// ========== Official API: Public Key ==========
// Endpoint: GET /public/v1/public-key -  For webhook signature verification

export interface KickApiPublicKey {
  public_key: string;
}

// ========== Official API Scopes ==========
// Reference: https://docs.kick.com/getting-started/scopes

export const KICK_API_SCOPES = {
  CHANNEL_READ: "channel:read",
  CHANNEL_WRITE: "channel:write",
  CHANNEL_REWARDS_READ: "channel:rewards:read",
  CHANNEL_REWARDS_WRITE: "channel:rewards:write",
  CHAT_WRITE: "chat:write",
  EVENTS_SUBSCRIBE: "events:subscribe",
  KICKS_READ: "kicks:read",
  MODERATION_BAN: "moderation:ban",
  MODERATION_CHAT_MESSAGE_MANAGE: "moderation:chat_message:manage",
  STREAMKEY_READ: "streamkey:read",
  USER_READ: "user:read",
} as const;

export type KickApiScope = (typeof KICK_API_SCOPES)[keyof typeof KICK_API_SCOPES];

// ========== API Base URL ==========
// Official Kick Dev API: https://docs.kick.com/

export const KICK_API_BASE = "https://api.kick.com/public/v1";

// ========== Official API Endpoints Reference ==========
/**
 * Categories:
 *   GET  /public/v1/categories?q=:query&page=:page     - Search categories
 *   GET  /public/v1/categories/:category_id           - Get category by ID
 *
 * Users:
 *   POST /public/v1/token/introspect                  - Token introspection
 *   GET  /public/v1/users?id[]=:user_id               - Get users by ID
 *
 * Channels:
 *   GET   /public/v1/channels?broadcaster_user_id[]=:id  - Get channels by broadcaster ID
 *   GET   /public/v1/channels?slug[]=:slug              - Get channels by slug
 *   PATCH /public/v1/channels                           - Update channel metadata
 *
 * Channel Rewards:
 *   GET    /public/v1/channels/rewards                - Get channel rewards
 *   POST   /public/v1/channels/rewards                - Create channel reward
 *   PATCH  /public/v1/channels/rewards/:id            - Update channel reward
 *   DELETE /public/v1/channels/rewards/:id            - Delete channel reward
 *
 * Chat:
 *   POST   /public/v1/chat                            - Send chat message
 *   DELETE /public/v1/chat/:message_id                - Delete chat message
 *
 * Moderation:
 *   POST   /public/v1/moderation/bans                 - Ban/timeout user
 *   DELETE /public/v1/moderation/bans                 - Unban user
 *
 * Livestreams:
 *   GET /public/v1/livestreams                        - Get livestreams
 *   GET /public/v1/livestreams/stats                  - Get livestream stats
 *
 * Public Key:
 *   GET /public/v1/public-key                         - Get public key for webhooks
 *
 * KICKs:
 *   GET /public/v1/kicks/leaderboard                  - Get KICKs leaderboard
 */

// ========== Legacy Types (for undocumented/unofficial APIs) ==========
// Note: These types are from the legacy undocumented API and may not work reliably

export interface KickLegacyApiVideo {
  id: number;
  live_stream_id: number;
  slug: string;
  thumb: string | null;
  s3: string | null;
  trading_platform_id: number | null;
  created_at: string;
  updated_at: string;
  uuid: string;
  views: number;
  deleted_at: string | null;
  video: {
    id: number;
    live_stream_id: number;
    slug: string | null;
    thumb: string | null;
    s3: string | null;
    trading_platform_id: number | null;
    created_at: string;
    updated_at: string;
    uuid: string;
    views: number;
    deleted_at: string | null;
  };
  session_title: string;
  source: string; // m3u8 url
  livestream: {
    id: number;
    channel_id: number;
    session_title: string;
    source: string | null;
    created_at: string;
    start_time: string;
    duration: number; // in milliseconds usually? or seconds? API varies.
    // ... other fields
  };
  start_time: string;
  duration: number; // Duration in milliseconds
}

/**
 * Followed-channel item shape returned by GET kick.com/api/v2/channels/followed.
 * Endpoint is undocumented (not in docs.kick.com as of 2026-05-21); shape is
 * inferred from sibling v2 endpoints (clip channel block, public-channel
 * response) and may need adjusting once observed live. Fields are all optional
 * so the transformer degrades to a partial UnifiedChannel rather than throwing
 * when the shape drifts.
 *
 * Important: prefer `id` (channel.id) over `user_id` for identity. See
 * docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md.
 */
export interface KickLegacyApiFollowedChannel {
  id?: number;
  user_id?: number;
  slug?: string;
  username?: string;
  profile_pic?: string | null;
  user?: {
    id?: number;
    username?: string;
    profile_pic?: string | null;
  };
  livestream?: { is_live?: boolean } | null;
  is_live?: boolean;
}

export interface KickLegacyApiClip {
  id: string;
  livestream_id: string;
  category_id: string;
  channel_id: number;
  user_id: number;
  title: string;
  clip_url: string;
  thumbnail_url: string;
  privacy: string;
  likes: number;
  liked: boolean;
  views: number;
  duration: number;
  started_at: string;
  created_at: string;
  is_mature: boolean;
  video_url: string;
  view_count: number;
  likes_count: number;
  channel: {
    id: number;
    username: string;
    slug: string;
    profile_pic: string | null;
  };
  category: {
    id: number;
    name: string;
    slug: string;
    responsive: string;
    banner: string;
    parent_category: {
      id: number;
      slug: string;
    };
  };
  creator: {
    id: number;
    username: string;
    slug: string;
    profile_pic: string | null;
  };
}

// Legacy API base URLs (undocumented, may not work)
export const KICK_LEGACY_API_V2_BASE = "https://kick.com/api/v2";
export const KICK_LEGACY_API_V1_BASE = "https://kick.com/api/v1";

// ========== Common Types ==========

export interface PaginationOptions {
  limit?: number;
  page?: number;
  cursor?: string;
  sort?: "date" | "views"; // Sort option: 'date' (most recent) or 'views'
  timeRange?: "day" | "week" | "month" | "all"; // Time range for views sort
}

export interface PaginatedResult<T> {
  data: T[];
  cursor?: string;
  nextPage?: number;
  total?: number;
}
