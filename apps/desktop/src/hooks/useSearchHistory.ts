import { useEffect, useState } from "react";

import { logger } from "@/renderer/logging/logger";

const STORAGE_KEY = "streamfusion_search_history";
const MAX_HISTORY_ITEMS = 10;

export const SEARCH_HISTORY_SCOPES = ["channels", "categories", "streams"] as const;

export type SearchHistoryScope = (typeof SEARCH_HISTORY_SCOPES)[number];
type SearchHistoryByScope = Record<SearchHistoryScope, string[]>;

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

function normalizeStoredHistory(value: unknown): SearchHistoryByScope {
  if (Array.isArray(value)) {
    const legacyHistory = value.filter((item): item is string => typeof item === "string");
    return {
      channels: legacyHistory,
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
      ? scopedHistory.filter((item): item is string => typeof item === "string")
      : [];
    return acc;
  }, createEmptyHistory());
}

export function useSearchHistory(scope: SearchHistoryScope = "channels") {
  const [historyByScope, setHistoryByScope] = useState<SearchHistoryByScope>(EMPTY_HISTORY);

  // Load history from local storage on mount
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

  const addSearch = (term: string, targetScope: SearchHistoryScope = scope) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    const scopedHistory = historyByScope[targetScope];
    // Remove duplicates and keep only recent unique items
    const newScopedHistory = [
      trimmed,
      ...scopedHistory.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, MAX_HISTORY_ITEMS);

    saveHistory({ ...historyByScope, [targetScope]: newScopedHistory });
  };

  const removeSearch = (term: string, targetScope: SearchHistoryScope = scope) => {
    const newScopedHistory = historyByScope[targetScope].filter((item) => item !== term);
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
