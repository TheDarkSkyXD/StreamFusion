import { type InfiniteData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";
import type {
  SearchPlatformError,
  SearchPlatformStatus,
  SearchStreamsRequest,
  SearchVideosRequest,
} from "../../shared/search-types";
import { sleep } from "../../lib/sleep";
import { normalizeSearchQuery } from "../../search/search-normalization";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";
import {
  savePersistedSearchPage,
  type PersistedSearchItem,
  type PersistedSearchKind,
  usePersistedSearchPage,
} from "./persisted-search-lru";

export const SEARCH_KEYS = {
  all: ["search"] as const,
  channels: (query: string, platform?: Platform, limit?: number, liveOnly: boolean = false) =>
    [...SEARCH_KEYS.all, "channels", query, platform, limit, liveOnly] as const,
  categories: (query: string, platform?: Platform, limit?: number) =>
    [...SEARCH_KEYS.all, "categories", query, platform, limit] as const,
  everything: (query: string, platform?: Platform, limit?: number) =>
    [...SEARCH_KEYS.all, "everything", query, platform, limit] as const,
  streams: (query: string, platform?: Platform, limit?: number, liveOnly: boolean = false) =>
    [...SEARCH_KEYS.all, "streams", query, platform, limit, liveOnly] as const,
  videos: (query: string, platform?: Platform, limit?: number) =>
    [...SEARCH_KEYS.all, "videos", query, platform, limit] as const,
  clips: (query: string, platform?: Platform, limit?: number) =>
    [...SEARCH_KEYS.all, "clips", query, platform, limit] as const,
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

type ProgressiveSearchKind = "streams" | "videos" | "clips";
type ProgressiveSearchItem = UnifiedStream | UnifiedVideo | UnifiedClip;

interface ProgressiveSearchRequest {
  sessionId: string;
  query: string;
  platform: Platform;
  limit: number;
  cursor?: string;
  liveOnly?: boolean;
}

interface ProgressiveSearchResponse<T extends ProgressiveSearchItem> {
  success: boolean;
  sessionId: string;
  platform: Platform;
  data: T[];
  cursor?: string;
  endReason?:
    "exhausted" | "repeated-cursor" | "empty-page" | "safety-limit" | "rate-limited" | "cancelled";
  retryAfterMs?: number;
  retryable: boolean;
  error: SearchPlatformError | null;
}

interface ProgressiveSearchBoundary {
  streams?: (request: SearchStreamsRequest) => Promise<ProgressiveSearchResponse<UnifiedStream>>;
  videos?: (request: SearchVideosRequest) => Promise<ProgressiveSearchResponse<UnifiedVideo>>;
  clips?: (request: SearchVideosRequest) => Promise<ProgressiveSearchResponse<UnifiedClip>>;
  cancel?: (request: { sessionId: string }) => Promise<unknown>;
}

interface ProgressivePlatformState<T extends ProgressiveSearchItem> {
  status: SearchPlatformStatus;
  retryable: boolean;
  retryAfterMs?: number;
  error: SearchPlatformError | null;
  data: T[];
}

interface ProgressivePage<T extends ProgressiveSearchItem> {
  sessionId: string;
  responses: Partial<Record<Platform, ProgressiveSearchResponse<T>>>;
}

interface ProgressivePageParam {
  sessionId: string;
  cursors: Partial<Record<Platform, string>>;
}

interface ProgressiveSearchOptions<T extends ProgressiveSearchItem> {
  kind: ProgressiveSearchKind;
  query: string;
  platform?: Platform;
  limit: number;
  enabled: boolean;
  liveOnly?: boolean;
  persistedData?: T[];
  persistKind?: PersistedSearchKind;
}

let nextSearchSessionId = 0;

function createSearchSessionId(): string {
  nextSearchSessionId += 1;
  return `renderer-search-${Date.now()}-${nextSearchSessionId}`;
}

function getProgressiveSearchBoundary(): ProgressiveSearchBoundary {
  return window.electronAPI.search as typeof window.electronAPI.search & ProgressiveSearchBoundary;
}

function getProgressiveSearchMethod<T extends ProgressiveSearchItem>(
  kind: ProgressiveSearchKind
): (request: ProgressiveSearchRequest) => Promise<ProgressiveSearchResponse<T>> {
  const search = getProgressiveSearchBoundary();
  const method = search[kind];
  if (typeof method !== "function") {
    throw new Error(`Search API method "${kind}" is unavailable on window.electronAPI.search`);
  }
  return method as (request: ProgressiveSearchRequest) => Promise<ProgressiveSearchResponse<T>>;
}

function platformsFor(platform: Platform | undefined): Platform[] {
  return platform ? [platform] : ["twitch", "kick"];
}

function statusForResponse<T extends ProgressiveSearchItem>(
  response: ProgressiveSearchResponse<T>
): SearchPlatformStatus {
  if (response.endReason === "cancelled") return "cancelled";
  if (!response.success) return "failed";
  if (response.endReason === "safety-limit") return "limited";
  if (response.cursor) return "loading";
  return "exhausted";
}

function deduplicateProgressiveItems<T extends ProgressiveSearchItem>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = `${item.platform}:${item.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function useProgressiveSearch<T extends ProgressiveSearchItem>({
  kind,
  query,
  platform,
  limit,
  enabled,
  liveOnly = false,
  persistedData,
  persistKind,
}: ProgressiveSearchOptions<T>) {
  const normalizedQuery = normalizeSearchQuery(query);
  const active = enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH;
  const intent = JSON.stringify([kind, normalizedQuery, platform ?? "all", limit, liveOnly]);
  const expectedPlatforms = platformsFor(platform);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const activationIdRef = useRef(0);
  const renderLifecycleRef = useRef({ active, intent });
  const previousRender = renderLifecycleRef.current;
  if (
    active &&
    (!sessionIdRef.current || !previousRender.active || previousRender.intent !== intent)
  ) {
    sessionIdRef.current = createSearchSessionId();
    activationIdRef.current += 1;
  }
  renderLifecycleRef.current = { active, intent };

  const publicQueryKey =
    kind === "streams"
      ? SEARCH_KEYS.streams(normalizedQuery, platform, limit, liveOnly)
      : kind === "videos"
        ? SEARCH_KEYS.videos(normalizedQuery, platform, limit)
        : SEARCH_KEYS.clips(normalizedQuery, platform, limit);
  const queryKey = [...publicQueryKey, activationIdRef.current] as const;

  const initialData:
    InfiniteData<ProgressivePage<T>, ProgressivePageParam | undefined> | undefined =
    persistedData?.length
      ? {
          pages: [
            {
              sessionId: "persisted",
              responses: {},
            } satisfies ProgressivePage<T>,
          ],
          pageParams: [undefined],
        }
      : undefined;

  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as ProgressivePageParam | undefined,
    initialData,
    initialDataUpdatedAt: initialData ? 0 : undefined,
    queryFn: async ({ pageParam, signal }): Promise<ProgressivePage<T>> => {
      const sessionId = pageParam?.sessionId ?? sessionIdRef.current ?? createSearchSessionId();
      const cursors = pageParam?.cursors;
      const requestedPlatforms = cursors
        ? expectedPlatforms.filter((candidate) => cursors[candidate] !== undefined)
        : expectedPlatforms;
      const search = getProgressiveSearchMethod<T>(kind);
      const responses = await Promise.all(
        requestedPlatforms.map(async (candidate) => {
          const response = await search({
            sessionId,
            query: normalizedQuery,
            platform: candidate,
            limit,
            cursor: cursors?.[candidate],
            ...(kind === "streams" ? { liveOnly } : {}),
          });
          return [candidate, response] as const;
        })
      );
      throwIfAborted(signal);
      if (sessionIdRef.current !== sessionId) {
        throw new DOMException("Superseded search session", "AbortError");
      }
      return { sessionId, responses: Object.fromEntries(responses) };
    },
    getNextPageParam: (lastPage): ProgressivePageParam | undefined => {
      const cursors: Partial<Record<Platform, string>> = {};
      for (const candidate of expectedPlatforms) {
        const cursor = lastPage.responses[candidate]?.cursor;
        if (cursor) cursors[candidate] = cursor;
      }
      return Object.keys(cursors).length > 0
        ? { sessionId: lastPage.sessionId, cursors }
        : undefined;
    },
    enabled: active,
    staleTime: 0,
    gcTime: getQueryCacheOptions("searchResults").gcTime,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!active || !sessionIdRef.current) return;
    const sessionId = sessionIdRef.current;
    return () => {
      const cancel = getProgressiveSearchBoundary().cancel;
      if (typeof cancel === "function") void cancel({ sessionId }).catch(() => undefined);
    };
  }, [active, intent]);

  const [retryState, setRetryState] = useState<{
    intent: string;
    responses: Partial<Record<Platform, ProgressiveSearchResponse<T>>>;
    retrying: Partial<Record<Platform, boolean>>;
  }>({ intent, responses: {}, retrying: {} });
  const retryResponses = retryState.intent === intent ? retryState.responses : {};
  const retryingPlatforms = retryState.intent === intent ? retryState.retrying : {};

  const pages = result.data?.pages ?? [];
  const latestResponses: Partial<Record<Platform, ProgressiveSearchResponse<T>>> = {};
  const pageResponses: Partial<Record<Platform, ProgressiveSearchResponse<T>[]>> = {};
  for (const page of pages) {
    for (const candidate of expectedPlatforms) {
      const response = page.responses[candidate];
      if (!response) continue;
      latestResponses[candidate] = response;
      const responses = pageResponses[candidate] ?? [];
      responses.push(response);
      pageResponses[candidate] = responses;
    }
  }
  for (const candidate of expectedPlatforms) {
    const retryResponse = retryResponses[candidate];
    if (!retryResponse) continue;
    latestResponses[candidate] = retryResponse;
  }

  const reconciledDataRef = useRef<{
    intent: string;
    byPlatform: Partial<Record<Platform, T[]>>;
  }>({
    intent,
    byPlatform: Object.fromEntries(
      expectedPlatforms.map((candidate) => [
        candidate,
        (persistedData ?? []).filter((item) => item.platform === candidate),
      ])
    ),
  });
  if (reconciledDataRef.current.intent !== intent) {
    reconciledDataRef.current = {
      intent,
      byPlatform: Object.fromEntries(
        expectedPlatforms.map((candidate) => [
          candidate,
          (persistedData ?? []).filter((item) => item.platform === candidate),
        ])
      ),
    };
  }
  for (const candidate of expectedPlatforms) {
    const successfulPages = (pageResponses[candidate] ?? []).filter((response) => response.success);
    if (successfulPages.length > 0) {
      reconciledDataRef.current.byPlatform[candidate] = deduplicateProgressiveItems(
        successfulPages.flatMap((response) => response.data)
      );
    }
    const retryResponse = retryResponses[candidate];
    if (retryResponse?.success) {
      reconciledDataRef.current.byPlatform[candidate] = deduplicateProgressiveItems(
        retryResponse.data
      );
    }
  }
  const data = deduplicateProgressiveItems(
    expectedPlatforms.flatMap((candidate) => reconciledDataRef.current.byPlatform[candidate] ?? [])
  );
  const hasEveryPlatformResponse = expectedPlatforms.every(
    (candidate) => latestResponses[candidate] !== undefined
  );
  const hasAuthoritativeResponse =
    expectedPlatforms.some((candidate) =>
      (pageResponses[candidate] ?? []).some((response) => response.success)
    ) || expectedPlatforms.some((candidate) => retryResponses[candidate]?.success);

  const platformStates: Partial<Record<Platform, ProgressivePlatformState<T>>> = {};
  for (const candidate of expectedPlatforms) {
    const response = latestResponses[candidate];
    if (!response) {
      if (active) {
        platformStates[candidate] = {
          status: "loading",
          retryable: false,
          error: null,
          data: [],
        };
      }
      continue;
    }
    platformStates[candidate] = {
      status: retryingPlatforms[candidate] ? "retrying" : statusForResponse(response),
      retryable: response.retryable,
      retryAfterMs: response.retryAfterMs,
      error: response.error,
      data: reconciledDataRef.current.byPlatform[candidate] ?? [],
    };
  }

  const retryPlatform = async (candidate: Platform): Promise<void> => {
    const previous = latestResponses[candidate];
    if (!active || !previous?.retryable || !sessionIdRef.current) return;
    const retryIntent = intent;
    const sessionId = sessionIdRef.current;
    setRetryState((current) => ({
      intent: retryIntent,
      responses: {
        ...(current.intent === retryIntent ? current.responses : {}),
      },
      retrying: {
        ...(current.intent === retryIntent ? current.retrying : {}),
        [candidate]: true,
      },
    }));
    try {
      if (previous.retryAfterMs) {
        await sleep(previous.retryAfterMs);
      }
      const response = await getProgressiveSearchMethod<T>(kind)({
        sessionId,
        query: normalizedQuery,
        platform: candidate,
        limit,
        ...(kind === "streams" ? { liveOnly } : {}),
      });
      if (renderLifecycleRef.current.intent === retryIntent && sessionIdRef.current === sessionId) {
        setRetryState((current) =>
          current.intent === retryIntent
            ? {
                ...current,
                responses: { ...current.responses, [candidate]: response },
              }
            : current
        );
      }
    } finally {
      if (renderLifecycleRef.current.intent === retryIntent) {
        setRetryState((current) =>
          current.intent === retryIntent
            ? {
                ...current,
                retrying: { ...current.retrying, [candidate]: false },
              }
            : current
        );
      }
    }
  };

  const persistenceSignatureRef = useRef<{ intent: string; signature: string }>({
    intent,
    signature: JSON.stringify(persistedData ?? []),
  });
  if (persistenceSignatureRef.current.intent !== intent) {
    persistenceSignatureRef.current = {
      intent,
      signature: JSON.stringify(persistedData ?? []),
    };
  }
  useEffect(() => {
    if (!persistKind || !hasAuthoritativeResponse) return;
    const signature = JSON.stringify(data);
    if (persistenceSignatureRef.current.signature === signature) return;
    persistenceSignatureRef.current.signature = signature;
    void savePersistedSearchPage(persistKind, normalizedQuery, platform, limit, {
      pages: [{ data: data as PersistedSearchItem[], cursor: null }],
      pageParams: [undefined],
    });
  }, [data, hasAuthoritativeResponse, limit, normalizedQuery, persistKind, platform]);

  useQueryCachePerformance({
    data: persistedData,
    enabled: Boolean(persistKind && persistedData),
    fetchStatus: result.fetchStatus,
    queryKey,
    surface: persistKind ? `search-${persistKind}-persisted` : "search-streams",
  });

  const terminalStatuses: SearchPlatformStatus[] = ["exhausted", "limited", "failed"];
  const isFinalEmpty =
    data.length === 0 &&
    hasEveryPlatformResponse &&
    expectedPlatforms.every((candidate) => {
      const status = platformStates[candidate]?.status;
      return status !== undefined && terminalStatuses.includes(status);
    });

  return {
    ...result,
    data,
    platformStates,
    retryPlatform,
    isRetrying: expectedPlatforms.some((candidate) => retryingPlatforms[candidate]),
    limitReached: expectedPlatforms.some(
      (candidate) => platformStates[candidate]?.status === "limited"
    ),
    isFinalEmpty,
    isLoading: active && data.length === 0 && result.isPending,
  };
}

export function useSearchStreams(
  query: string,
  platform?: Platform,
  limit: number = 20,
  enabled: boolean = true,
  liveOnly: boolean = false
) {
  return useProgressiveSearch<UnifiedStream>({
    kind: "streams",
    query,
    platform,
    limit,
    enabled,
    liveOnly,
  });
}

function usePersistedMediaSearch<T extends UnifiedVideo | UnifiedClip>(
  kind: "videos" | "clips",
  query: string,
  platform: Platform | undefined,
  limit: number,
  enabled: boolean
) {
  const persisted = usePersistedSearchPage<T>(kind, query, platform, limit, true);
  const persistedData = persisted?.pages.flatMap((page) => page.data);
  return useProgressiveSearch<T>({
    kind,
    query,
    platform,
    limit,
    enabled,
    persistedData,
    persistKind: kind,
  });
}

export function useSearchVideos(
  query: string,
  platform?: Platform,
  limit: number = 12,
  enabled: boolean = true
) {
  return usePersistedMediaSearch<UnifiedVideo>("videos", query, platform, limit, enabled);
}

export function useSearchClips(
  query: string,
  platform?: Platform,
  limit: number = 12,
  enabled: boolean = true
) {
  return usePersistedMediaSearch<UnifiedClip>("clips", query, platform, limit, enabled);
}

export function useSearchChannels(
  query: string,
  platform?: Platform,
  limit: number = 50,
  liveOnly: boolean = false,
  enabled: boolean = true
) {
  const normalizedQuery = query.trim();
  const queryKey = SEARCH_KEYS.channels(normalizedQuery, platform, limit, liveOnly);

  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await window.electronAPI.search.channels({
        query: normalizedQuery,
        platform,
        limit,
        after: pageParam,
        ...(liveOnly ? { liveOnly: true } : {}),
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
    enabled: enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    ...getQueryCacheOptions("searchResults"),
    // Typeahead must never show the previous term's rows while the next term
    // is pending. The general search cache intentionally keeps prior data for
    // browsing surfaces, so opt out at this user-input boundary.
    placeholderData: undefined,
  });
  useQueryCachePerformance({
    data: result.data,
    enabled: enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    fetchStatus: result.fetchStatus,
    queryKey,
    surface: "search",
  });
  return result;
}

export function useSearchCategories(
  query: string,
  platform?: Platform,
  limit: number = 20,
  enabled: boolean = true
) {
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
    enabled: enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    ...getQueryCacheOptions("searchResults"),
    placeholderData: undefined,
  });
  useQueryCachePerformance({
    data: result.data,
    enabled: enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
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

export function useSearchAll(
  query: string,
  platform?: Platform,
  limit: number = 5,
  enabled: boolean = true
) {
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
    enabled: enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    ...getQueryCacheOptions("searchResults"),
    placeholderData: undefined,
  });
  useQueryCachePerformance({
    data: result.data,
    enabled: enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    fetchStatus: result.fetchStatus,
    queryKey,
    surface: "search",
  });
  return result;
}
