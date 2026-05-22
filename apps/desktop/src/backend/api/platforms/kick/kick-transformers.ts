/**
 * Kick Data Transformers
 *
 * Functions to transform official Kick API responses into unified types.
 * API Documentation: https://docs.kick.com/
 */

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedFollow,
  UnifiedStream,
  UnifiedUser,
} from "../../unified/platform-types";

import type {
  KickApiCategory,
  KickApiChannel,
  KickApiLivestream,
  KickApiUser,
  KickLegacyApiClip,
  KickLegacyApiFollowedChannel,
} from "./kick-types";

/**
 * Transform official Kick API user to unified user
 * Endpoint: GET /public/v1/users
 */
export function transformKickUser(user: KickApiUser): UnifiedUser {
  return {
    id: user.user_id.toString(),
    platform: "kick",
    username: user.name,
    displayName: user.name,
    avatarUrl: user.profile_picture || "",
    isVerified: false, // Not available in API
    createdAt: "", // Not available in API
  };
}

/**
 * Transform official Kick API channel to unified channel
 * Endpoint: GET /public/v1/channels
 */
export function transformKickChannel(channel: KickApiChannel): UnifiedChannel {
  return {
    id: channel.broadcaster_user_id.toString(),
    platform: "kick",
    username: channel.slug,
    displayName: channel.slug,
    avatarUrl: "", // Not provided in official API
    bannerUrl:
      (channel as any).offline_banner_image?.src ||
      (channel as any).offline_banner_image?.url ||
      (typeof (channel as any).offline_banner_image === "string"
        ? (channel as any).offline_banner_image
        : undefined),
    bio: channel.channel_description || undefined,
    isLive: channel.stream?.is_live || false,
    isVerified: false, // Not provided in official API
    isPartner: false, // Not provided in official API
  };
}

/**
 * Helper to ensure Kick date strings are properly formatted as UTC ISO strings
 * Kick API sometimes returns "YYYY-MM-DD HH:MM:SS" (local/UTC ambiguous) or ISO without Z
 * @returns Normalized ISO string with 'Z' suffix, or null if dateStr is missing/falsy
 */
export function normalizeKickDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  // Handle "YYYY-MM-DD HH:MM:SS" format (replace space with T, append Z)
  if (dateStr.includes(" ") && !dateStr.includes("T")) {
    return `${dateStr.replace(" ", "T")}Z`;
  }

  // Handle ISO-like dates missing Timezone info (append Z)
  if (dateStr.includes("T") && !dateStr.endsWith("Z") && !dateStr.includes("+")) {
    return `${dateStr}Z`;
  }

  return dateStr;
}

/**
 * Transform official Kick API livestream to unified stream
 * Endpoint: GET /public/v1/livestreams
 */
export function transformKickLivestream(livestream: KickApiLivestream): UnifiedStream {
  return {
    id: livestream.channel_id.toString(),
    platform: "kick",
    channelId: livestream.broadcaster_user_id.toString(),
    channelName: livestream.slug,
    channelDisplayName: livestream.broadcaster_display_name || livestream.slug,
    channelAvatar: livestream.profile_picture || "", // Use official API profile_picture
    title: livestream.stream_title,
    viewerCount: livestream.viewer_count,
    thumbnailUrl: livestream.thumbnail || "",
    isLive: true,
    startedAt: normalizeKickDate(livestream.started_at),
    language: livestream.language,
    tags:
      livestream.custom_tags && livestream.custom_tags.length > 0
        ? livestream.custom_tags
        : livestream.tags || [],
    isMature: livestream.has_mature_content,
    categoryId: livestream.category.id.toString(),
    categoryName: livestream.category.name,
  };
}

/**
 * Transform official Kick API category to unified category
 * Endpoint: GET /public/v1/categories
 */
export function transformKickCategory(category: KickApiCategory): UnifiedCategory {
  const tags = Array.isArray(category.tags)
    ? category.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  return {
    id: category.id.toString(),
    platform: "kick",
    name: category.name,
    boxArtUrl: category.thumbnail || "",
    tags: tags.length > 0 ? tags : undefined,
    viewerCount: typeof category.viewer_count === "number" ? category.viewer_count : undefined,
  };
}

/**
 * Transform Kick channel to unified follow
 */
export function transformKickFollow(channel: KickApiChannel, followedAt?: string): UnifiedFollow {
  return {
    id: `kick-${channel.broadcaster_user_id}`,
    platform: "kick",
    channel: transformKickChannel(channel),
    followedAt: followedAt || new Date().toISOString(),
    notifications: false, // Default, can be updated
  };
}

/**
 * Transform a v2 legacy followed-channel item into a UnifiedChannel.
 *
 * Source: GET kick.com/api/v2/channels/followed (undocumented). The endpoint
 * may return either a nested `user.*` block (mirroring the clip endpoint shape)
 * or flat top-level fields. This reads defensively from both.
 *
 * Returns null if neither an id nor a slug is present — without either, the
 * row is unusable downstream because identity matching in channelsMatch
 * requires at least one of platform+id or platform+slug.
 */
export function transformKickFollowedChannelLegacy(
  item: KickLegacyApiFollowedChannel
): UnifiedChannel | null {
  const channelId = item.id;
  const slug = item.slug;
  if (channelId == null && !slug) return null;

  const displayName =
    item.user?.username ?? item.username ?? slug ?? (channelId != null ? String(channelId) : "");
  const avatarUrl = item.user?.profile_pic ?? item.profile_pic ?? "";
  const isLive = item.livestream?.is_live ?? item.is_live ?? false;

  return {
    id: channelId != null ? String(channelId) : "",
    platform: "kick",
    username: slug ?? "",
    displayName,
    avatarUrl,
    bannerUrl: undefined,
    bio: undefined,
    isLive,
    isVerified: false,
    isPartner: false,
  };
}

/**
 * Transform legacy Kick clip to unified clip
 * Note: Clips are NOT in the official API, this uses legacy undocumented API format
 */
export function transformKickClip(clip: KickLegacyApiClip): UnifiedClip {
  return {
    id: clip.id,
    platform: "kick",
    channelId: clip.channel_id.toString(),
    channelName: clip.channel.slug,
    channelDisplayName: clip.channel.username,
    channelAvatar: clip.channel.profile_pic || "",
    title: clip.title,
    thumbnailUrl: clip.thumbnail_url,
    clipUrl: clip.clip_url,
    embedUrl: clip.video_url,
    duration: clip.duration,
    viewCount: clip.view_count,
    createdAt: clip.created_at,
    creatorName: clip.creator.username,
    gameId: clip.category_id,
    gameName: clip.category.name,
  };
}
