import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../backend/api/unified/platform-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlatform(value: unknown): value is UnifiedChannel["platform"] {
  return value === "twitch" || value === "kick";
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidUnifiedChannel(value: unknown): value is UnifiedChannel {
  if (!isRecord(value)) return false;
  return (
    isNonemptyString(value.id) &&
    isPlatform(value.platform) &&
    isNonemptyString(value.username) &&
    isNonemptyString(value.displayName) &&
    typeof value.avatarUrl === "string" &&
    typeof value.isLive === "boolean" &&
    typeof value.isVerified === "boolean" &&
    typeof value.isPartner === "boolean"
  );
}

export function isValidUnifiedStream(value: unknown): value is UnifiedStream {
  if (!isRecord(value)) return false;
  return (
    isNonemptyString(value.id) &&
    isPlatform(value.platform) &&
    isNonemptyString(value.channelId) &&
    isNonemptyString(value.channelName) &&
    isNonemptyString(value.channelDisplayName) &&
    typeof value.channelAvatar === "string" &&
    isNonemptyString(value.title) &&
    typeof value.viewerCount === "number" &&
    Number.isFinite(value.viewerCount) &&
    value.viewerCount >= 0 &&
    typeof value.thumbnailUrl === "string" &&
    typeof value.isLive === "boolean" &&
    (value.startedAt === null || typeof value.startedAt === "string") &&
    typeof value.language === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string")
  );
}

export function isValidUnifiedCategory(value: unknown): value is UnifiedCategory {
  if (!isRecord(value)) return false;
  return (
    isNonemptyString(value.id) &&
    isPlatform(value.platform) &&
    isNonemptyString(value.name) &&
    typeof value.boxArtUrl === "string" &&
    (value.viewerCount === undefined ||
      (typeof value.viewerCount === "number" &&
        Number.isFinite(value.viewerCount) &&
        value.viewerCount >= 0)) &&
    (value.tags === undefined ||
      (Array.isArray(value.tags) && value.tags.every((tag) => isNonemptyString(tag)))) &&
    (value.crossPlatformId === undefined || isNonemptyString(value.crossPlatformId))
  );
}

export function isValidUnifiedVideo(value: unknown): value is UnifiedVideo {
  if (!isRecord(value)) return false;
  return (
    isNonemptyString(value.id) &&
    isPlatform(value.platform) &&
    isNonemptyString(value.channelId) &&
    isNonemptyString(value.channelName) &&
    isNonemptyString(value.channelDisplayName) &&
    typeof value.channelAvatar === "string" &&
    isNonemptyString(value.title) &&
    typeof value.thumbnailUrl === "string" &&
    typeof value.duration === "number" &&
    Number.isFinite(value.duration) &&
    value.duration >= 0 &&
    typeof value.viewCount === "number" &&
    Number.isFinite(value.viewCount) &&
    value.viewCount >= 0 &&
    isNonemptyString(value.publishedAt) &&
    Number.isFinite(Date.parse(value.publishedAt)) &&
    isNonemptyString(value.url) &&
    (value.type === "archive" || value.type === "highlight" || value.type === "upload")
  );
}

export function isValidUnifiedClip(value: unknown): value is UnifiedClip {
  if (!isRecord(value)) return false;
  return (
    isNonemptyString(value.id) &&
    isPlatform(value.platform) &&
    isNonemptyString(value.channelId) &&
    isNonemptyString(value.channelName) &&
    isNonemptyString(value.channelDisplayName) &&
    typeof value.channelAvatar === "string" &&
    isNonemptyString(value.title) &&
    typeof value.thumbnailUrl === "string" &&
    isNonemptyString(value.clipUrl) &&
    isNonemptyString(value.embedUrl) &&
    typeof value.duration === "number" &&
    Number.isFinite(value.duration) &&
    value.duration >= 0 &&
    typeof value.viewCount === "number" &&
    Number.isFinite(value.viewCount) &&
    value.viewCount >= 0 &&
    isNonemptyString(value.createdAt) &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.creatorName === "string"
  );
}

export function normalizeUnifiedChannel(value: unknown): UnifiedChannel | null {
  if (!isRecord(value)) return null;
  const normalized = {
    ...value,
    avatarUrl: typeof value.avatarUrl === "string" ? value.avatarUrl : "",
  };
  return isValidUnifiedChannel(normalized) ? normalized : null;
}

export function normalizeUnifiedStream(value: unknown): UnifiedStream | null {
  if (!isRecord(value)) return null;
  const normalized = {
    ...value,
    channelAvatar: typeof value.channelAvatar === "string" ? value.channelAvatar : "",
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : "",
  };
  return isValidUnifiedStream(normalized) ? normalized : null;
}

export function normalizeUnifiedCategory(value: unknown): UnifiedCategory | null {
  if (!isRecord(value)) return null;
  const normalized = {
    ...value,
    boxArtUrl: typeof value.boxArtUrl === "string" ? value.boxArtUrl : "",
  };
  return isValidUnifiedCategory(normalized) ? normalized : null;
}

export function normalizeUnifiedVideo(value: unknown): UnifiedVideo | null {
  if (!isRecord(value)) return null;
  const normalized = {
    ...value,
    channelAvatar: typeof value.channelAvatar === "string" ? value.channelAvatar : "",
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : "",
  };
  return isValidUnifiedVideo(normalized) ? normalized : null;
}

export function normalizeUnifiedClip(value: unknown): UnifiedClip | null {
  if (!isRecord(value)) return null;
  const normalized = {
    ...value,
    channelAvatar: typeof value.channelAvatar === "string" ? value.channelAvatar : "",
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : "",
    creatorName: typeof value.creatorName === "string" ? value.creatorName : "",
  };
  return isValidUnifiedClip(normalized) ? normalized : null;
}

export interface SearchResultCollection {
  channels: UnifiedChannel[];
  categories: UnifiedCategory[];
  streams: UnifiedStream[];
  videos: UnifiedVideo[];
  clips: UnifiedClip[];
}

export function sanitizeSearchResultCollection(value: unknown): {
  data: SearchResultCollection;
  rejectedCategories: number;
  rejectedChannels: number;
  rejectedStreams: number;
  rejectedVideos: number;
  rejectedClips: number;
} {
  const record = isRecord(value) ? value : {};
  const rawChannels = Array.isArray(record.channels) ? record.channels : [];
  const rawCategories = Array.isArray(record.categories) ? record.categories : [];
  const rawStreams = Array.isArray(record.streams) ? record.streams : [];
  const rawVideos = Array.isArray(record.videos) ? record.videos : [];
  const rawClips = Array.isArray(record.clips) ? record.clips : [];
  const channels = rawChannels.flatMap((item) => {
    const channel = normalizeUnifiedChannel(item);
    return channel ? [channel] : [];
  });
  const streams = rawStreams.flatMap((item) => {
    const stream = normalizeUnifiedStream(item);
    return stream ? [stream] : [];
  });
  const categories = rawCategories.flatMap((item) => {
    const category = normalizeUnifiedCategory(item);
    return category ? [category] : [];
  });
  const videos = rawVideos.flatMap((item) => {
    const video = normalizeUnifiedVideo(item);
    return video ? [video] : [];
  });
  const clips = rawClips.flatMap((item) => {
    const clip = normalizeUnifiedClip(item);
    return clip ? [clip] : [];
  });

  return {
    data: {
      channels,
      categories,
      streams,
      videos,
      clips,
    },
    rejectedCategories: rawCategories.length - categories.length,
    rejectedChannels: rawChannels.length - channels.length,
    rejectedStreams: rawStreams.length - streams.length,
    rejectedVideos: rawVideos.length - videos.length,
    rejectedClips: rawClips.length - clips.length,
  };
}
