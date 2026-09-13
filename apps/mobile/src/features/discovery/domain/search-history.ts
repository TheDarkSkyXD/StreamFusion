import type {
  SearchHistoryByScope,
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
    categories: scopedQueries(record.categories),
    channels: scopedQueries(record.channels),
    streams: scopedQueries(record.streams),
  };
}

export function addSearchHistory(
  history: SearchHistoryByScope,
  scope: SearchHistoryScope,
  query: string,
): SearchHistoryByScope {
  const trimmed = query.trim();
  if (trimmed === "") return history;
  const next = [
    trimmed,
    ...history[scope].filter(
      (item) => item.toLowerCase() !== trimmed.toLowerCase(),
    ),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  return { ...history, [scope]: next };
}

export function removeSearchHistory(
  history: SearchHistoryByScope,
  scope: SearchHistoryScope,
  query: string,
): SearchHistoryByScope {
  return {
    ...history,
    [scope]: history[scope].filter((item) => item !== query),
  };
}

export function clearSearchHistory(
  history: SearchHistoryByScope,
  scope: SearchHistoryScope,
): SearchHistoryByScope {
  return { ...history, [scope]: [] };
}

export function historyScopeForTab(
  resultType: string,
): SearchHistoryScope {
  if (resultType === "streams" || resultType === "categories") {
    return resultType;
  }
  return "channels";
}

function scopedQueries(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, SEARCH_HISTORY_LIMIT);
}
