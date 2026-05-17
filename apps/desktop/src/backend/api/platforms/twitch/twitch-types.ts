/**
 * Twitch API Types
 *
 * Type definitions for Twitch Helix API responses.
 * These are the raw types from the API before transformation to unified types.
 */

// ========== Twitch User ==========

export interface TwitchApiUser {
  id: string;
  login: string;
  display_name: string;
  type: "" | "admin" | "global_mod" | "staff";
  broadcaster_type: "" | "affiliate" | "partner";
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  email?: string;
  created_at: string;
}

// ========== Twitch Stream ==========

export interface TwitchApiStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: "live" | "";
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  tag_ids: string[];
  tags: string[];
  is_mature: boolean;
}

// ========== Twitch Channel ==========

export interface TwitchApiChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  broadcaster_language: string;
  game_id: string;
  game_name: string;
  title: string;
  delay: number;
  tags: string[];
  content_classification_labels: string[];
  is_branded_content: boolean;
}

// ========== Twitch Game/Category ==========

export interface TwitchApiGame {
  id: string;
  name: string;
  box_art_url: string;
  igdb_id?: string;
}

// ========== Twitch Follow ==========

export interface TwitchApiFollow {
  user_id: string;
  user_login: string;
  user_name: string;
  followed_at: string;
}

export interface TwitchApiFollowedChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  followed_at: string;
}

// ========== Twitch Video ==========

export interface TwitchApiVideo {
  id: string;
  stream_id: string | null;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  description: string;
  created_at: string;
  published_at: string;
  url: string;
  thumbnail_url: string;
  viewable: "public" | "private";
  view_count: number;
  language: string;
  type: "archive" | "highlight" | "upload";
  duration: string; // e.g., "3h8m32s"
  muted_segments: { duration: number; offset: number }[] | null;
  game_id?: string;
  game_name?: string;
}

// ========== Twitch Clip ==========

export interface TwitchApiClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  language: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
  vod_offset: number | null;
  is_featured: boolean;
}

// ========== Twitch Search Results ==========

export interface TwitchApiSearchChannel {
  broadcaster_language: string;
  broadcaster_login: string;
  display_name: string;
  game_id: string;
  game_name: string;
  id: string;
  is_live: boolean;
  tags: string[];
  thumbnail_url: string;
  title: string;
  started_at: string;
}

// ========== Twitch API Response Wrapper ==========

export interface TwitchApiResponse<T> {
  data: T[];
  pagination?: {
    cursor?: string;
  };
  total?: number;
}

// ========== Twitch OAuth Token ==========

export interface TwitchTokenValidation {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  expires_in: number;
}

// ========== API Endpoints ==========

export const TWITCH_API_BASE = "https://api.twitch.tv/helix";
export const TWITCH_AUTH_BASE = "https://id.twitch.tv/oauth2";

// ========== Client Types ==========

export interface PaginationOptions {
  first?: number; // Number of results (max 100)
  after?: string; // Cursor for next page
  before?: string; // Cursor for previous page
  started_at?: string; // ISO timestamp
  ended_at?: string; // ISO timestamp
}

/**
 * Why pagination ended for this page. Populated only when `cursor` is
 * undefined. Callers can distinguish a clean exhaustion from a
 * defensive end-of-list (integrity rejection, cursor-no-advance,
 * empty-page) for telemetry, dev logging, or optional UI hints.
 *
 * - `exhausted`: server returned no cursor — natural end of results.
 * - `cursor-no-advance`: server returned the same cursor we sent — schema
 *   doesn't honor pagination on this connection, or rate-limited us.
 * - `integrity-rejected`: GQL response contained an integrity-check error
 *   (Twitch's anonymous-paginated-query rejection mode).
 * - `empty-page`: server returned `data: []` — end of meaningful results.
 */
export type PaginationEndReason =
  | "exhausted"
  | "cursor-no-advance"
  | "integrity-rejected"
  | "empty-page";

export interface PaginatedResult<T> {
  data: T[];
  cursor?: string;
  total?: number;
  endReason?: PaginationEndReason;
}

export interface TwitchClientError {
  status: number;
  message: string;
  retryAfter?: number;
}

// ========== Twitch GQL & Playback ==========

export interface TwitchGqlResponse<T> {
  data: T;
  extensions?: {
    durationMilliseconds: number;
    operationName: string;
    requestID: string;
  };
  errors?: any[];
}

export interface TwitchPlaybackAccessTokenData {
  streamPlaybackAccessToken?: {
    value: string;
    signature: string;
  } | null;
  videoPlaybackAccessToken?: {
    value: string;
    signature: string;
  } | null;
}

export interface StreamPlaybackAccessToken {
  value: string;
  signature: string;
}

export interface StreamPlayback {
  url: string;
  format: "hls" | "dash" | "mp4";
  qualities?: {
    quality: string;
    url: string;
    frameRate?: number;
  }[];
}
