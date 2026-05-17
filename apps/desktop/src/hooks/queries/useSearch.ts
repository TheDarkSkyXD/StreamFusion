import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";

export const SEARCH_KEYS = {
  all: ["search"] as const,
  channels: (query: string, platform?: Platform) =>
    [...SEARCH_KEYS.all, "channels", query, platform] as const,
  categories: (query: string, platform?: Platform) =>
    [...SEARCH_KEYS.all, "categories", query, platform] as const,
  everything: (query: string, platform?: Platform) =>
    [...SEARCH_KEYS.all, "everything", query, platform] as const,
};

// Electron IPC has no native AbortSignal propagation — the backend will still
// finish the work, but the renderer ignores stale results so a fast typer
// ("t"→"ti"→"tim") doesn't see older queries overwrite the latest one.
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export function useSearchChannels(query: string, platform?: Platform, limit: number = 50) {
  return useInfiniteQuery({
    queryKey: SEARCH_KEYS.channels(query, platform),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await window.electronAPI.search.channels({
        query,
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
    enabled: !!query,
    staleTime: 60_000,
  });
}

export function useSearchCategories(query: string, platform?: Platform, limit: number = 20) {
  return useInfiniteQuery({
    queryKey: SEARCH_KEYS.categories(query, platform),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await window.electronAPI.categories.search({
        query,
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
    getNextPageParam: (lastPage) =>
      lastPage.data.length === 0 ? undefined : (lastPage.cursor ?? undefined),
    enabled: !!query,
    staleTime: 60_000,
  });
}

export interface SearchAllResponse {
  channels: UnifiedChannel[];
  categories: UnifiedCategory[];
  streams: UnifiedStream[];
  videos: UnifiedVideo[];
  clips: UnifiedClip[];
}

export function useSearchAll(query: string, platform?: Platform, limit: number = 5) {
  return useQuery({
    queryKey: SEARCH_KEYS.everything(query, platform),
    queryFn: async () => {
      const response = await window.electronAPI.search.all({ query, platform, limit });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as SearchAllResponse;
    },
    enabled: !!query,
  });
}
