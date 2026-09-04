import { Platform } from "@streamfusion/core/platform";

export interface VideoSearch {
  src?: string;
  title?: string;
  channelName?: string;
  channelDisplayName?: string;
  channelAvatar?: string;
  thumbnail?: string;
  views?: string;
  date?: string;
  category?: string;
  categoryId?: string;
  duration?: string;
  isSubOnly?: boolean;
  tags?: string[];
  language?: string;
  isMature?: boolean;
  shareUrl?: string;
}

export function parsePlatform(value: unknown): Platform | null {
  return value === "twitch" || value === "kick" ? value : null;
}

export function requirePlatform(value: unknown): Platform {
  const platform = parsePlatform(value);
  if (platform === null) throw new Error(`Unsupported platform route: ${String(value)}`);
  return platform;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalBoolean(value: unknown): true | undefined {
  return value === true || value === "true" ? true : undefined;
}

export function validateVideoSearch(search: Record<string, unknown>): VideoSearch {
  const tags =
    Array.isArray(search.tags) && search.tags.every((tag) => typeof tag === "string")
      ? search.tags
      : undefined;

  return Object.fromEntries(
    Object.entries({
      src: optionalString(search.src),
      title: optionalString(search.title),
      channelName: optionalString(search.channelName),
      channelDisplayName: optionalString(search.channelDisplayName),
      channelAvatar: optionalString(search.channelAvatar),
      thumbnail: optionalString(search.thumbnail),
      views: optionalString(search.views),
      date: optionalString(search.date),
      category: optionalString(search.category),
      categoryId: optionalString(search.categoryId),
      duration: optionalString(search.duration),
      isSubOnly: optionalBoolean(search.isSubOnly),
      tags,
      language: optionalString(search.language),
      isMature: optionalBoolean(search.isMature),
      shareUrl: optionalString(search.shareUrl),
    }).filter((entry) => entry[1] !== undefined)
  );
}

export function validateStreamSearch(search: Record<string, unknown>): {
  tab?: "home" | "videos" | "clips";
} {
  const tab = search.tab;
  return tab === "home" || tab === "videos" || tab === "clips" ? { tab } : {};
}
