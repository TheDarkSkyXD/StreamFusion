import { Platform } from "@streamfusion/core/platform";

export interface VideoOrClip {
  id: string;
  title: string;
  duration: string;
  views: string;
  viewCount?: string | number;
  view_count?: string | number;
  date: string;
  created_at?: string; // ISO timestamp for more accurate time-ago calculation
  creatorName?: string;
  thumbnailUrl: string;
  embedUrl?: string; // For clips
  url?: string; // For clips
  /** Verified public Platform content URL. Never a playback/media URL. */
  shareUrl?: string;
  source?: string; // HLS m3u8 URL for VODs (especially Kick)
  gameName?: string;
  gameId?: string;
  isLive?: boolean;
  isSubOnly?: boolean; // Whether the VOD is subscriber-only content
  // Additional metadata for passing to video page
  channelSlug?: string;
  channelName?: string;
  channelAvatar?: string | null;
  channelFollowerCount?: number;
  category?: string;
  // Stream tags
  tags?: string[];
  language?: string;
  isMature?: boolean;
  // VOD availability for clips - empty/null means VOD is no longer available
  vodId?: string;
  platform?: Platform;
}

/** Validate media rows once as they cross the untyped IPC boundary. */
export function isVideoOrClip(value: unknown): value is VideoOrClip {
  if (typeof value !== "object" || value === null) return false;

  const requiredStrings = ["id", "title", "duration", "views", "date", "thumbnailUrl"];
  if (
    !requiredStrings.every((key) => key in value && typeof Reflect.get(value, key) === "string")
  ) {
    return false;
  }

  const optionalStrings = [
    "created_at",
    "creatorName",
    "embedUrl",
    "url",
    "shareUrl",
    "source",
    "gameName",
    "gameId",
    "channelSlug",
    "channelName",
    "category",
    "language",
    "vodId",
  ];
  if (
    !optionalStrings.every((key) => {
      const field = Reflect.get(value, key);
      return field === undefined || typeof field === "string";
    })
  ) {
    return false;
  }

  const optionalBooleans = ["isLive", "isSubOnly", "isMature"];
  if (
    !optionalBooleans.every((key) => {
      const field = Reflect.get(value, key);
      return field === undefined || typeof field === "boolean";
    })
  ) {
    return false;
  }

  const viewCount = Reflect.get(value, "viewCount");
  const legacyViewCount = Reflect.get(value, "view_count");
  const avatar = Reflect.get(value, "channelAvatar");
  const followerCount = Reflect.get(value, "channelFollowerCount");
  const tags = Reflect.get(value, "tags");
  const platform = Reflect.get(value, "platform");
  return (
    (viewCount === undefined || typeof viewCount === "string" || typeof viewCount === "number") &&
    (legacyViewCount === undefined ||
      typeof legacyViewCount === "string" ||
      typeof legacyViewCount === "number") &&
    (avatar === undefined || avatar === null || typeof avatar === "string") &&
    (followerCount === undefined || typeof followerCount === "number") &&
    (tags === undefined || (Array.isArray(tags) && tags.every((tag) => typeof tag === "string"))) &&
    (platform === undefined || platform === "twitch" || platform === "kick")
  );
}

export function parseVideoOrClips(value: unknown): VideoOrClip[] {
  return Array.isArray(value) ? value.filter(isVideoOrClip) : [];
}

export interface PlaybackQuality {
  quality: string;
  url: string;
}

export function parsePlaybackQualities(value: unknown): PlaybackQuality[] | undefined {
  if (typeof value !== "object" || value === null || !("qualities" in value)) return undefined;
  const qualities = Reflect.get(value, "qualities");
  if (!Array.isArray(qualities)) return undefined;

  return qualities.filter((quality): quality is PlaybackQuality => {
    if (typeof quality !== "object" || quality === null) return false;
    return (
      "quality" in quality &&
      typeof Reflect.get(quality, "quality") === "string" &&
      "url" in quality &&
      typeof Reflect.get(quality, "url") === "string"
    );
  });
}

export interface ClipPlayerProps {
  src: string;
  autoPlay?: boolean;
  onError?: () => void;
}

export interface RelatedContentProps {
  platform: Platform;
  channelName: string;
  channelData: import("@shared/platform-types").UnifiedChannel | null | undefined;
  /** Truthy while the stream is live; flips to undefined/null when it ends. */
  streamStartedAt?: string | null;
  onClipSelectionChange?: (isOpen: boolean) => void;
}
