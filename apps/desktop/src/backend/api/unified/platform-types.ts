/**
 * Unified Platform Types
 *
 * Common type definitions that abstract over platform-specific implementations.
 * Both Twitch and Kick API clients should return data conforming to these types.
 */

import type { Platform } from "../../../shared/auth-types";

// ========== Stream Types ==========

export interface UnifiedStream {
  id: string;
  platform: Platform;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  channelAvatar: string;
  title: string;
  viewerCount: number;
  thumbnailUrl: string;
  isLive: boolean;
  startedAt: string | null; // ISO date string, or null if unknown
  language: string;
  tags: string[];
  isMature?: boolean;
  categoryId?: string;
  categoryName?: string;
}

// ========== Channel Types ==========

export interface UnifiedChannel {
  id: string;
  platform: Platform;
  username: string; // login/slug
  displayName: string;
  avatarUrl: string;
  bannerUrl?: string;
  bio?: string;
  isLive: boolean;
  isVerified: boolean;
  isPartner: boolean;
  followerCount?: number;
  subscriberCount?: number;
  viewCount?: number;
  createdAt?: string;
  socialLinks?: SocialLink[];
  // Category info - represents the last set category for the channel
  categoryId?: string;
  categoryName?: string;
  // Stream title - represents the last set stream title
  lastStreamTitle?: string;
  // Kick-specific: chatroom ID for Pusher WebSocket subscription
  chatroomId?: number;
  // Kick-specific: subscriber badges
  subscriberBadges?: any[];
}

export interface SocialLink {
  platform: string;
  url: string;
}

// ========== Category/Game Types ==========

export interface UnifiedCategory {
  id: string;
  platform: Platform;
  name: string;
  boxArtUrl: string;
  igdbId?: string;
  viewerCount?: number; // Total viewers for the category (if available)
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
}

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

// ========== Chat Types ==========

export interface UnifiedChatMessage {
  id: string;
  platform: Platform;
  channelId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  message: string;
  parsedMessage: ParsedMessagePart[];
  badges: ChatBadge[];
  color?: string;
  timestamp: Date;
  isAction: boolean;
  isFirstMessage: boolean;
  isSubscriber: boolean;
  isModerator: boolean;
  isBroadcaster: boolean;
  isVip: boolean;
}

export type ParsedMessagePart =
  | { type: "text"; content: string }
  | { type: "emote"; id: string; name: string; url: string }
  | { type: "mention"; username: string }
  | { type: "link"; url: string };

export interface ChatBadge {
  id: string;
  name: string;
  imageUrl: string;
}

// ========== Video/VOD Types ==========

export interface UnifiedVideo {
  id: string;
  platform: Platform;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  channelAvatar: string;
  title: string;
  description?: string;
  thumbnailUrl: string;
  duration: number; // seconds
  viewCount: number;
  publishedAt: string;
  url: string;
  type: "archive" | "highlight" | "upload";
}

// ========== Clip Types ==========

export interface UnifiedClip {
  id: string;
  platform: Platform;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  channelAvatar: string;
  title: string;
  thumbnailUrl: string;
  clipUrl: string;
  embedUrl: string;
  duration: number; // seconds
  viewCount: number;
  createdAt: string;
  creatorName: string;
  gameId?: string;
  gameName?: string;
}

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
