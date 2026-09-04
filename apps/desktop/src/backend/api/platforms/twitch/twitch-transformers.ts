/**
 * Twitch Data Transformers
 *
 * Functions to transform Twitch API responses into unified types.
 */

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedFollow,
  UnifiedStream,
  UnifiedUser,
  UnifiedVideo,
} from "../../../../shared/platform-types";

import type {
  TwitchApiChannel,
  TwitchApiClip,
  TwitchApiFollowedChannel,
  TwitchApiGame,
  TwitchApiSearchChannel,
  TwitchApiStream,
  TwitchApiUser,
  TwitchApiVideo,
} from "./twitch-types";

function normalizedTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) ? value : timestamp.toISOString();
}

/**
 * Transform Twitch user to unified user
 */
function transformTwitchUser(user: TwitchApiUser): UnifiedUser {
  return {
    id: user.id,
    platform: "twitch",
    username: user.login,
    displayName: user.display_name,
    avatarUrl: user.profile_image_url,
    email: user.email,
    isVerified: user.broadcaster_type === "partner",
    createdAt: user.created_at,
  };
}

/**
 * Transform Twitch stream to unified stream
 */
export function transformTwitchStream(stream: TwitchApiStream): UnifiedStream {
  // Replace {width}x{height} in thumbnail URL
  const thumbnailUrl = stream.thumbnail_url.replace("{width}", "440").replace("{height}", "248");

  return {
    id: stream.id,
    platform: "twitch",
    channelId: stream.user_id,
    channelName: stream.user_login,
    channelDisplayName: stream.user_name,
    channelAvatar: "", // Need to fetch separately
    title: stream.title,
    viewerCount: stream.viewer_count,
    thumbnailUrl,
    isLive: stream.type === "live",
    startedAt: stream.started_at,
    language: stream.language,
    tags: stream.tags || [],
    isMature: stream.is_mature,
    categoryId: stream.game_id,
    categoryName: stream.game_name,
  };
}

/**
 * Transform Twitch game to unified category
 */
export function transformTwitchCategory(game: TwitchApiGame): UnifiedCategory {
  // Replace {width}x{height} in box art URL
  const boxArtUrl = game.box_art_url.replace("{width}", "285").replace("{height}", "380");

  return {
    id: game.id,
    platform: "twitch",
    name: game.name,
    boxArtUrl,
    igdbId: game.igdb_id,
  };
}

/**
 * Transform Twitch channel info to unified channel
 * Optionally accepts user data for additional fields like avatar and offline banner
 */
export function transformTwitchChannel(
  channel: TwitchApiChannel,
  user?: {
    id: string;
    login: string;
    display_name: string;
    profile_image_url: string;
    broadcaster_type: string;
    offline_image_url?: string;
    description?: string;
  }
): UnifiedChannel {
  return {
    id: channel.broadcaster_id,
    platform: "twitch",
    username: channel.broadcaster_login,
    displayName: channel.broadcaster_name,
    avatarUrl: user?.profile_image_url || "",
    bannerUrl: user?.offline_image_url || undefined,
    bio: user?.description || undefined,
    isLive: false, // Need to check streams endpoint for live status
    isVerified: user?.broadcaster_type === "partner",
    isPartner: user?.broadcaster_type === "partner",
    // Include category info from channel data - this is the last set category
    categoryId: channel.game_id || undefined,
    categoryName: channel.game_name || undefined,
    // Include stream title from channel data - this is the last set title
    lastStreamTitle: channel.title || undefined,
  };
}

/**
 * Transform Twitch user to unified channel
 */
function transformTwitchUserToChannel(
  user: TwitchApiUser,
  isLive: boolean = false
): UnifiedChannel {
  return {
    id: user.id,
    platform: "twitch",
    username: user.login,
    displayName: user.display_name,
    avatarUrl: user.profile_image_url,
    bannerUrl: user.offline_image_url || undefined,
    bio: user.description || undefined,
    isLive,
    isVerified: user.broadcaster_type === "partner",
    isPartner: user.broadcaster_type === "partner",
    createdAt: user.created_at,
  };
}

/**
 * Transform Twitch search channel to unified channel
 */
export function transformTwitchSearchChannel(channel: TwitchApiSearchChannel): UnifiedChannel {
  return {
    id: channel.id,
    platform: "twitch",
    username: channel.broadcaster_login,
    displayName: channel.display_name,
    avatarUrl: channel.thumbnail_url,
    isLive: channel.is_live,
    isVerified: false, // Not available in search results
    isPartner: false, // Not available in search results
  };
}

/**
 * Transform Twitch followed channel to unified follow
 */
function transformTwitchFollow(
  follow: TwitchApiFollowedChannel,
  channelData?: TwitchApiUser
): UnifiedFollow {
  const channel: UnifiedChannel = channelData
    ? transformTwitchUserToChannel(channelData)
    : {
        id: follow.broadcaster_id,
        platform: "twitch",
        username: follow.broadcaster_login,
        displayName: follow.broadcaster_name,
        avatarUrl: "",
        isLive: false,
        isVerified: false,
        isPartner: false,
      };

  return {
    id: `twitch-${follow.broadcaster_id}`,
    platform: "twitch",
    channel,
    followedAt: follow.followed_at,
    notifications: false, // Default, can be updated
  };
}

/**
 * Transform Twitch video to unified video
 */
export function transformTwitchVideo(video: TwitchApiVideo): UnifiedVideo {
  // Parse duration string (e.g., "3h8m32s") to seconds
  const durationSeconds = parseTwitchDuration(video.duration);

  // Replace {width}x{height} in thumbnail URL
  const thumbnailUrl = video.thumbnail_url
    .replace("%{width}", "320")
    .replace("%{height}", "180")
    .replace("{width}", "320")
    .replace("{height}", "180");

  return {
    id: video.id,
    platform: "twitch",
    channelId: video.user_id,
    channelName: video.user_login, // Use login for channel URL
    channelDisplayName: video.user_name,
    channelAvatar: "", // Not available in video object
    title: video.title,
    description: video.description || undefined,
    thumbnailUrl,
    duration: durationSeconds,
    viewCount: video.view_count,
    publishedAt: normalizedTimestamp(video.published_at),
    url: video.url,
    shareUrl: video.url,
    type: video.type,
  };
}

/**
 * Transform Twitch clip to unified clip
 */
export function transformTwitchClip(clip: TwitchApiClip): UnifiedClip {
  return {
    id: clip.id,
    platform: "twitch",
    channelId: clip.broadcaster_id,
    channelName: clip.broadcaster_name, // Fallback as login is not available in clip object
    channelDisplayName: clip.broadcaster_name,
    channelAvatar: "", // Not available in clip object
    title: clip.title,
    thumbnailUrl: clip.thumbnail_url,
    clipUrl: clip.url,
    shareUrl: clip.url,
    embedUrl: clip.embed_url,
    duration: clip.duration,
    viewCount: clip.view_count,
    createdAt: normalizedTimestamp(clip.created_at),
    creatorName: clip.creator_name,
    gameId: clip.game_id,
    categoryId: clip.game_id,
    language: clip.language,
    vodId: clip.video_id,
  };
}

/**
 * Parse Twitch duration string to seconds
 * e.g., "3h8m32s" -> 11312
 */
function parseTwitchDuration(duration: string): number {
  const regex = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/;
  const match = duration.match(regex);

  if (!match) return 0;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}
