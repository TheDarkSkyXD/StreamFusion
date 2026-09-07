import {
  normalizeSearchTokens,
  rankAndDeduplicateCategories,
  rankAndDeduplicateClips,
  rankAndDeduplicateStreams,
  rankAndDeduplicateVideos,
  rankSearchChannels,
} from "@streamfusion/core/discovery";
import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../../../shared/platform-types";
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function platform(value: unknown): value is "twitch" | "kick" {
  return value === "twitch" || value === "kick";
}
export function isValidUnifiedChannel(value: unknown): value is UnifiedChannel {
  return record(value) && text(value.id) && platform(value.platform) && text(value.username) &&
    text(value.displayName) && typeof value.avatarUrl === "string" && typeof value.isLive === "boolean" &&
    typeof value.isVerified === "boolean" && typeof value.isPartner === "boolean";
}
export function isValidUnifiedStream(value: unknown): value is UnifiedStream {
  return record(value) && text(value.id) && platform(value.platform) && text(value.channelId) &&
    text(value.channelName) && text(value.channelDisplayName) && typeof value.channelAvatar === "string" &&
    text(value.title) && typeof value.viewerCount === "number" && Number.isFinite(value.viewerCount) &&
    value.viewerCount >= 0 && typeof value.thumbnailUrl === "string" && typeof value.isLive === "boolean" &&
    (value.startedAt === null || typeof value.startedAt === "string") && typeof value.language === "string" &&
    Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string");
}
export function isValidUnifiedCategory(value: unknown): value is UnifiedCategory {
  return record(value) && text(value.id) && platform(value.platform) && text(value.name) &&
    typeof value.boxArtUrl === "string" && (value.viewerCount === undefined ||
      (typeof value.viewerCount === "number" && Number.isFinite(value.viewerCount) && value.viewerCount >= 0)) &&
    (value.tags === undefined ||
      (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string")));
}
export function isValidUnifiedVideo(value: unknown): value is UnifiedVideo {
  return record(value) && text(value.id) && platform(value.platform) && text(value.channelId) &&
    text(value.channelName) && text(value.channelDisplayName) && typeof value.channelAvatar === "string" &&
    text(value.title) && typeof value.thumbnailUrl === "string" && typeof value.duration === "number" &&
    Number.isFinite(value.duration) && value.duration >= 0 && typeof value.viewCount === "number" &&
    Number.isFinite(value.viewCount) && value.viewCount >= 0 && text(value.publishedAt) &&
    Number.isFinite(Date.parse(value.publishedAt)) && text(value.url) &&
    (value.type === "archive" || value.type === "highlight" || value.type === "upload");
}
export function isValidUnifiedClip(value: unknown): value is UnifiedClip {
  return record(value) && text(value.id) && platform(value.platform) && text(value.channelId) &&
    text(value.channelName) && text(value.channelDisplayName) && typeof value.channelAvatar === "string" &&
    text(value.title) && typeof value.thumbnailUrl === "string" && text(value.clipUrl) && text(value.embedUrl) &&
    typeof value.duration === "number" && Number.isFinite(value.duration) && value.duration >= 0 &&
    typeof value.viewCount === "number" && Number.isFinite(value.viewCount) && value.viewCount >= 0 &&
    text(value.createdAt) && Number.isFinite(Date.parse(value.createdAt)) && typeof value.creatorName === "string";
}
export function normalizeUnifiedChannel(value: unknown): UnifiedChannel | null {
  if (!record(value)) return null;
  const normalized = {
    ...value,
    avatarUrl: typeof value.avatarUrl === "string" ? value.avatarUrl : "",
  };
  return isValidUnifiedChannel(normalized) ? normalized : null;
}
export function normalizeUnifiedStream(value: unknown): UnifiedStream | null {
  if (!record(value)) return null;
  const normalized = {
    ...value,
    channelAvatar: typeof value.channelAvatar === "string" ? value.channelAvatar : "",
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : "",
  };
  return isValidUnifiedStream(normalized) ? normalized : null;
}
export function normalizeUnifiedCategory(value: unknown): UnifiedCategory | null {
  if (!record(value)) return null;
  const normalized = {
    ...value,
    boxArtUrl: typeof value.boxArtUrl === "string" ? value.boxArtUrl : "",
  };
  return isValidUnifiedCategory(normalized) ? normalized : null;
}
export function normalizeUnifiedVideo(value: unknown): UnifiedVideo | null {
  return record(value) && isValidUnifiedVideo({ ...value, channelAvatar: typeof value.channelAvatar === "string" ? value.channelAvatar : "", thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : "" }) ? value as UnifiedVideo : null;
}
export function normalizeUnifiedClip(value: unknown): UnifiedClip | null {
  return record(value) && isValidUnifiedClip({ ...value, channelAvatar: typeof value.channelAvatar === "string" ? value.channelAvatar : "", thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : "", creatorName: typeof value.creatorName === "string" ? value.creatorName : "" }) ? value as UnifiedClip : null;
}
export function filterRankAndDeduplicateCategories(values: readonly unknown[], query: string): UnifiedCategory[] {
  const byIdentity = new Map<string, UnifiedCategory>();
  for (const value of values) { const category = normalizeUnifiedCategory(value); if (category) byIdentity.set(`${category.platform}:${category.id}`, category); }
  return rankAndDeduplicateCategories([...byIdentity.values()], query);
}
export function mergeExactCrossPlatformCategories(ranked: readonly UnifiedCategory[]): UnifiedCategory[] {
  const merged: UnifiedCategory[] = []; const unmatched = new Map<string, number>();
  for (const category of ranked) { const name = normalizeSearchTokens(category.name).join(" "); const index = unmatched.get(name); if (index === undefined) { unmatched.set(name, merged.length); merged.push(category); continue; } const existing = merged[index]; if (existing.platform === category.platform || existing.crossPlatformId) { unmatched.set(name, merged.length); merged.push(category); continue; } const preferred = (category.viewerCount ?? 0) > (existing.viewerCount ?? 0) ? category : existing; const alternate = preferred === category ? existing : category; merged[index] = { ...preferred, crossPlatformId: alternate.id, crossPlatformName: alternate.name }; unmatched.delete(name); }
  return merged;
}

function normalizeValues<TItem>(
  values: readonly unknown[],
  normalize: (value: unknown) => TItem | null
): TItem[] {
  return values.flatMap((value) => {
    const item = normalize(value);
    return item ? [item] : [];
  });
}

export function filterRankAndDeduplicateChannels(
  channels: readonly unknown[],
  query: string
): UnifiedChannel[] {
  return rankSearchChannels(normalizeValues(channels, normalizeUnifiedChannel), query);
}

export function filterRankAndDeduplicateStreams(
  streams: readonly unknown[],
  query: string
): UnifiedStream[] {
  return rankAndDeduplicateStreams(normalizeValues(streams, normalizeUnifiedStream), query);
}

export function filterRankAndDeduplicateVideos(
  videos: readonly unknown[],
  query: string
): UnifiedVideo[] {
  return rankAndDeduplicateVideos(normalizeValues(videos, normalizeUnifiedVideo), query);
}

export function filterRankAndDeduplicateClips(
  clips: readonly unknown[],
  query: string
): UnifiedClip[] {
  return rankAndDeduplicateClips(normalizeValues(clips, normalizeUnifiedClip), query);
}
