import { useEffect, useState } from "react";

import { logger } from "@/renderer/logging/logger";

const STORAGE_KEY = "streamfusion_search_history";
const MAX_HISTORY_ITEMS = 10;

export const SEARCH_HISTORY_SCOPES = ["channels", "categories", "streams"] as const;

export type SearchHistoryScope = (typeof SEARCH_HISTORY_SCOPES)[number];

export type SearchHistoryEntry = {
  readonly label: string;
  readonly avatarUrl?: string;
  readonly channelId?: string;
  readonly platform?: "twitch" | "kick";
  readonly username?: string;
};

type SearchHistoryByScope = Record<SearchHistoryScope, SearchHistoryEntry[]>;

const EMPTY_HISTORY: SearchHistoryByScope = {
  channels: [],
  categories: [],
  streams: [],
};

function createEmptyHistory(): SearchHistoryByScope {
  return {
    channels: [],
    categories: [],
    streams: [],
  };
}

function normalizeEntry(value: unknown): SearchHistoryEntry | null {
  if (typeof value === "string") {
    const label = value.trim();
    return label.length === 0 ? null : { label };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const label =
    typeof record.label === "string"
      ? record.label.trim()
      : typeof record.query === "string"
        ? record.query.trim()
        : "";
  if (!label) return null;
  const avatarUrl = typeof record.avatarUrl === "string" ? record.avatarUrl.trim() : "";
  const channelId = typeof record.channelId === "string" ? record.channelId.trim() : "";
  const username =
    typeof record.username === "string" ? record.username.trim().toLowerCase() : "";
  const platform =
    record.platform === "twitch" || record.platform === "kick" ? record.platform : undefined;
  return {
    label,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(channelId ? { channelId } : {}),
    ...(username ? { username } : {}),
    ...(platform ? { platform } : {}),
  };
}

function sameEntry(left: SearchHistoryEntry, right: SearchHistoryEntry): boolean {
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

/** Prefer incoming fields, but keep prior avatar/identity when a plain-string re-add would wipe them. */
export function mergeSearchHistoryEntry(
  incoming: SearchHistoryEntry,
  existing: SearchHistoryEntry | undefined
): SearchHistoryEntry {
  if (!existing) return incoming;
  const avatarUrl = incoming.avatarUrl?.trim() || existing.avatarUrl?.trim() || "";
  const channelId = incoming.channelId?.trim() || existing.channelId?.trim() || "";
  const username =
    incoming.username?.trim().toLowerCase() || existing.username?.trim().toLowerCase() || "";
  const platform = incoming.platform ?? existing.platform;
  return {
    label: incoming.label || existing.label,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(channelId ? { channelId } : {}),
    ...(username ? { username } : {}),
    ...(platform ? { platform } : {}),
  };
}

function normalizeStoredHistory(value: unknown): SearchHistoryByScope {
  if (Array.isArray(value)) {
    return {
      channels: value
        .map((item) => normalizeEntry(item))
        .filter((item): item is SearchHistoryEntry => item !== null),
      categories: [],
      streams: [],
    };
  }

  if (!value || typeof value !== "object") {
    return createEmptyHistory();
  }

  const stored = value as Partial<Record<SearchHistoryScope, unknown>>;
  return SEARCH_HISTORY_SCOPES.reduce<SearchHistoryByScope>((acc, scope) => {
    const scopedHistory = stored[scope];
    acc[scope] = Array.isArray(scopedHistory)
      ? scopedHistory
          .map((item) => normalizeEntry(item))
          .filter((item): item is SearchHistoryEntry => item !== null)
      : [];
    return acc;
  }, createEmptyHistory());
}

export function useSearchHistory(scope: SearchHistoryScope = "channels") {
  const [historyByScope, setHistoryByScope] = useState<SearchHistoryByScope>(EMPTY_HISTORY);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHistoryByScope(normalizeStoredHistory(JSON.parse(stored)));
      }
    } catch (error) {
      logger.error("Hook:SearchHistory", "failed to load search history", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
    }
  }, []);

  const saveHistory = (newHistory: SearchHistoryByScope) => {
    setHistoryByScope(newHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
  };

  const addSearch = (
    term: string | SearchHistoryEntry,
    targetScope: SearchHistoryScope = scope
  ) => {
    const entry = normalizeEntry(term);
    if (!entry) return;

    const scopedHistory = historyByScope[targetScope];
    const existing = scopedHistory.find((item) => sameEntry(item, entry));
    const merged = mergeSearchHistoryEntry(entry, existing);
    const newScopedHistory = [
      merged,
      ...scopedHistory.filter((item) => !sameEntry(item, entry)),
    ].slice(0, MAX_HISTORY_ITEMS);

    saveHistory({ ...historyByScope, [targetScope]: newScopedHistory });
  };

  const removeSearch = (
    term: string | SearchHistoryEntry,
    targetScope: SearchHistoryScope = scope
  ) => {
    const entry = normalizeEntry(term);
    if (!entry) return;
    const newScopedHistory = historyByScope[targetScope].filter(
      (item) => !sameEntry(item, entry)
    );
    saveHistory({ ...historyByScope, [targetScope]: newScopedHistory });
  };

  const clearHistory = (targetScope: SearchHistoryScope = scope) => {
    saveHistory({ ...historyByScope, [targetScope]: [] });
  };

  return {
    history: historyByScope[scope],
    historyByScope,
    addSearch,
    removeSearch,
    clearHistory,
  };
}
