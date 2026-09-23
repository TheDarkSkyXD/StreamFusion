import type { Platform } from "@streamfusion/core/platform";

import type {
  SearchHistoryByScope,
  SearchHistoryEntry,
  SearchHistoryScope,
} from "../capabilities/platform-reads";

export const SEARCH_HISTORY_SCOPES = [
  "channels",
  "streams",
  "categories",
] as const satisfies readonly SearchHistoryScope[];

export const SEARCH_HISTORY_LIMIT = 10;

export function emptySearchHistory(): SearchHistoryByScope {
  return {
    categories: [],
    channels: [],
    streams: [],
  };
}

export function parseSearchHistory(value: unknown): SearchHistoryByScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptySearchHistory();
  }
  const record = value as Partial<Record<SearchHistoryScope, unknown>>;
  return {
    categories: scopedEntries(record.categories),
    channels: scopedEntries(record.channels),
    streams: scopedEntries(record.streams),
  };
}

export function addSearchHistory(
  history: SearchHistoryByScope,
  scope: SearchHistoryScope,
  input: string | SearchHistoryEntry,
): SearchHistoryByScope {
  const entry = normalizeEntry(input);
  if (entry === null) return history;
  const next = [
    entry,
    ...history[scope].filter((item) => !sameHistoryEntry(item, entry)),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  return { ...history, [scope]: next };
}

export function removeSearchHistory(
  history: SearchHistoryByScope,
  scope: SearchHistoryScope,
  input: string | SearchHistoryEntry,
): SearchHistoryByScope {
  const entry = normalizeEntry(input);
  if (entry === null) return history;
  return {
    ...history,
    [scope]: history[scope].filter((item) => !sameHistoryEntry(item, entry)),
  };
}

export function clearSearchHistory(
  history: SearchHistoryByScope,
  scope: SearchHistoryScope,
): SearchHistoryByScope {
  return { ...history, [scope]: [] };
}

export function historyScopeForTab(resultType: string): SearchHistoryScope {
  if (resultType === "streams" || resultType === "categories") {
    return resultType;
  }
  return "channels";
}

export function historyEntryLabel(entry: SearchHistoryEntry): string {
  return entry.label;
}

export function historyEntryAvatarUrl(entry: SearchHistoryEntry): string | null {
  const url = entry.avatarUrl?.trim();
  return url && url.length > 0 ? url : null;
}

export function channelIdentityFromHistory(
  entry: SearchHistoryEntry,
  fallbackPlatform: Platform = "twitch",
): { id: string; platform: Platform; username: string } | null {
  const username = (entry.username ?? entry.label).trim().toLowerCase();
  if (username.length === 0) return null;
  const platform = entry.platform ?? fallbackPlatform;
  return {
    id: entry.channelId?.trim() || username,
    platform,
    username,
  };
}

function scopedEntries(value: unknown): readonly SearchHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeEntry(item))
    .filter((item): item is SearchHistoryEntry => item !== null)
    .slice(0, SEARCH_HISTORY_LIMIT);
}

function normalizeEntry(value: unknown): SearchHistoryEntry | null {
  if (typeof value === "string") {
    const label = value.trim();
    return label.length === 0 ? null : { label };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const label =
    typeof record.label === "string"
      ? record.label.trim()
      : typeof record.query === "string"
        ? record.query.trim()
        : "";
  if (label.length === 0) return null;
  const entry: SearchHistoryEntry = { label };
  const avatarUrl =
    typeof record.avatarUrl === "string" ? record.avatarUrl.trim() : "";
  const channelId =
    typeof record.channelId === "string" ? record.channelId.trim() : "";
  const username =
    typeof record.username === "string"
      ? record.username.trim().toLowerCase()
      : "";
  const platform =
    record.platform === "twitch" || record.platform === "kick"
      ? record.platform
      : undefined;
  return {
    ...entry,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(channelId ? { channelId } : {}),
    ...(username ? { username } : {}),
    ...(platform ? { platform } : {}),
  };
}

function sameHistoryEntry(
  left: SearchHistoryEntry,
  right: SearchHistoryEntry,
): boolean {
  if (
    left.platform &&
    right.platform &&
    left.channelId &&
    right.channelId &&
    left.platform === right.platform &&
    left.channelId === right.channelId
  ) {
    return true;
  }
  const leftUser = (left.username ?? left.label).toLowerCase();
  const rightUser = (right.username ?? right.label).toLowerCase();
  if (
    left.platform &&
    right.platform &&
    left.platform === right.platform &&
    leftUser === rightUser
  ) {
    return true;
  }
  return left.label.toLowerCase() === right.label.toLowerCase();
}
