import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";

export const SEARCH_KEYS = {
  all: ["search"] as const,
  channels: (query: string, platform?: Platform, limit?: number) =>
    [...SEARCH_KEYS.all, "channels", query, platform, limit] as const,
  categories: (query: string, platform?: Platform, limit?: number) =>
    [...SEARCH_KEYS.all, "categories", query, platform, limit] as const,
  everything: (query: string, platform?: Platform, limit?: number) =>
    [...SEARCH_KEYS.all, "everything", query, platform, limit] as const,
};

const MIN_REMOTE_SEARCH_LENGTH = 1;

// Electron IPC has no native AbortSignal propagation — the backend will still
// finish the work, but the renderer ignores stale results so a fast typer
// ("t"→"ti"→"tim") doesn't see older queries overwrite the latest one.
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export function useSearchChannels(query: string, platform?: Platform, limit: number = 50) {
  const normalizedQuery = query.trim();
  const queryKey = SEARCH_KEYS.channels(normalizedQuery, platform, limit);

  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await window.electronAPI.search.channels({
        query: normalizedQuery,
        platform,
        limit,
        after: pageParam,
      });
      throwIfAborted(signal);
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return { data: (response.data ?? []) as UnifiedChannel[], cursor: response.cursor };
    },
    // Twitch GQL keeps returning a cursor even when a page is empty after the
    // verify/dedupe filter, which makes hasNextPage stuck-true and produces a
    // skeleton-flicker loop in the dropdown's onScroll near-bottom handler.
    // Treat an empty page as end-of-list regardless of cursor.
    getNextPageParam: (lastPage) =>
      lastPage.data.length === 0 ? undefined : (lastPage.cursor ?? undefined),
    enabled: normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    ...getQueryCacheOptions("searchResults"),
  });
  useQueryCachePerformance({
    data: result.data,
    enabled: normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    fetchStatus: result.fetchStatus,
    queryKey,
    surface: "search",
  });
  return result;
}

export function useSearchCategories(query: string, platform?: Platform, limit: number = 20) {
  const normalizedQuery = query.trim();
  const queryKey = SEARCH_KEYS.categories(normalizedQuery, platform, limit);

  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await window.electronAPI.categories.search({
        query: normalizedQuery,
        platform,
        limit,
        after: pageParam,
      });
      throwIfAborted(signal);
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return { data: (response.data ?? []) as UnifiedCategory[], cursor: response.cursor };
    },
    // Mirrors the empty-page guard in useSearchChannels above. Backend
    // gqlSearchCategories already nulls the cursor on an empty page, but
    // this hook-level guard also covers post-fetch dedupe paths (cross-
    // platform category collapsing in the dropdown) where the backend
    // can't see the post-filter emptiness.
    getNextPageParam: (lastPage) =>
      lastPage.data.length === 0 ? undefined : (lastPage.cursor ?? undefined),
    enabled: normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    ...getQueryCacheOptions("searchResults"),
  });
  useQueryCachePerformance({
    data: result.data,
    enabled: normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    fetchStatus: result.fetchStatus,
    queryKey,
    surface: "search",
  });
  return result;
}

export interface SearchAllResponse {
  channels: UnifiedChannel[];
  categories: UnifiedCategory[];
  streams: UnifiedStream[];
  videos: UnifiedVideo[];
  clips: UnifiedClip[];
}

export function useSearchAll(query: string, platform?: Platform, limit: number = 5) {
  const normalizedQuery = query.trim();
  const queryKey = SEARCH_KEYS.everything(normalizedQuery, platform, limit);

  const result = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.search.all({
        query: normalizedQuery,
        platform,
        limit,
      });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as SearchAllResponse;
    },
    enabled: normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    ...getQueryCacheOptions("searchResults"),
  });
  useQueryCachePerformance({
    data: result.data,
    enabled: normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    fetchStatus: result.fetchStatus,
    queryKey,
    surface: "search",
  });
  return result;
}
