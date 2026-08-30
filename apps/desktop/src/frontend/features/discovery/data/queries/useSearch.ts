import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "../../../../../shared/platform-types";
import type { Platform } from "../../../../../shared/auth-types";
import type { SearchPlatformError, SearchPlatformStatus } from "../../../../../shared/search-types";
import { sleep } from "@shared/utils/sleep";
import { normalizeSearchQuery } from "../../utils/search/search-normalization";
import { rankSearchChannels } from "../../utils/search/channel-search-contract";
import type { SearchResultCollection } from "../../utils/search/search-result-validation";
import { logger } from "../../../../renderer/logging/logger";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";
import {
  savePersistedSearchPage,
  type PersistedSearchItem,
  type PersistedSearchKind,
  usePersistedSearchPage,
} from "./persisted-search-lru";
import {
  savePersistedSearchResult,
  usePersistedSearchResult,
} from "./persisted-search-results-lru";

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

function createSearchSessionId(scope: string = ""): string {
  nextSearchSessionId += 1;
  return `renderer-search-${Date.now()}-${nextSearchSessionId}-${scope.length}`;
}

function getProgressiveSearchMethod<T extends ProgressiveSearchItem>(
  kind: ProgressiveSearchKind
): (request: ProgressiveSearchRequest) => Promise<ProgressiveSearchResponse<T>> {
  return window.electronAPI.search[kind] as unknown as (
    request: ProgressiveSearchRequest
  ) => Promise<ProgressiveSearchResponse<T>>;
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
  const queryClient = useQueryClient();
  const normalizedQuery = normalizeSearchQuery(query);
  const active = enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH;
  const intent = JSON.stringify([kind, normalizedQuery, platform ?? "all", limit, liveOnly]);
  const expectedPlatforms = platformsFor(platform);
  const sessionId = useMemo(
    () => (active ? createSearchSessionId(intent) : undefined),
    [active, intent]
  );
  const renderLifecycleRef = useRef({ active, intent, sessionId });
  useEffect(() => {
    renderLifecycleRef.current = { active, intent, sessionId };
  }, [active, intent, sessionId]);

  const publicQueryKey = useMemo(
    () =>
      kind === "streams"
        ? SEARCH_KEYS.streams(normalizedQuery, platform, limit, liveOnly)
        : kind === "videos"
          ? SEARCH_KEYS.videos(normalizedQuery, platform, limit)
          : SEARCH_KEYS.clips(normalizedQuery, platform, limit),
    [kind, limit, liveOnly, normalizedQuery, platform]
  );
  const warmSnapshot = useQuery<T[]>({
    queryKey: publicQueryKey,
    queryFn: async () => queryClient.getQueryData<T[]>(publicQueryKey) ?? [],
    enabled: false,
    gcTime: getQueryCacheOptions("searchResults").gcTime,
  });
  const sameQueryWarmData = warmSnapshot.data ?? persistedData ?? [];
  const queryKey = [...publicQueryKey, sessionId ?? "inactive"] as const;

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
      const pageSessionId = pageParam?.sessionId ?? sessionId ?? createSearchSessionId();
      const cursors = pageParam?.cursors;
      const requestedPlatforms = cursors
        ? expectedPlatforms.filter((candidate) => cursors[candidate] !== undefined)
        : expectedPlatforms;
      const search = getProgressiveSearchMethod<T>(kind);
      const responses = await Promise.all(
        requestedPlatforms.map(async (candidate) => {
          const response = await search({
            sessionId: pageSessionId,
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
      if (renderLifecycleRef.current.sessionId !== pageSessionId) {
        throw new DOMException("Superseded search session", "AbortError");
      }
      return { sessionId: pageSessionId, responses: Object.fromEntries(responses) };
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
    if (!active || !sessionId) return;
    return () => {
      void window.electronAPI.search.cancel({ requestId: sessionId }).catch(() => undefined);
    };
  }, [active, sessionId]);

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

  const reconciledByPlatform: Partial<Record<Platform, T[]>> = Object.fromEntries(
    expectedPlatforms.map((candidate) => [
      candidate,
      sameQueryWarmData.filter((item) => item.platform === candidate),
    ])
  );
  for (const candidate of expectedPlatforms) {
    const successfulPages = (pageResponses[candidate] ?? []).filter((response) => response.success);
    if (successfulPages.length > 0) {
      reconciledByPlatform[candidate] = deduplicateProgressiveItems(
        successfulPages.flatMap((response) => response.data)
      );
    }
    const retryResponse = retryResponses[candidate];
    if (retryResponse?.success) {
      reconciledByPlatform[candidate] = deduplicateProgressiveItems(retryResponse.data);
    }
  }
  const data = deduplicateProgressiveItems(
    expectedPlatforms.flatMap((candidate) => reconciledByPlatform[candidate] ?? [])
  );
  const hasEveryPlatformResponse = expectedPlatforms.every(
    (candidate) => latestResponses[candidate] !== undefined
  );
  const hasAuthoritativeResponse =
    expectedPlatforms.some((candidate) =>
      (pageResponses[candidate] ?? []).some((response) => response.success)
    ) || expectedPlatforms.some((candidate) => retryResponses[candidate]?.success);

  useEffect(() => {
    if (!hasAuthoritativeResponse) return;
    const cached = queryClient.getQueryData<T[]>(publicQueryKey);
    if (cached && JSON.stringify(cached) === JSON.stringify(data)) return;
    queryClient.setQueryData(publicQueryKey, data);
  }, [data, hasAuthoritativeResponse, publicQueryKey, queryClient]);

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
      data: reconciledByPlatform[candidate] ?? [],
    };
  }

  const retryPlatform = async (candidate: Platform): Promise<void> => {
    const previous = latestResponses[candidate];
    if (!active || !previous?.retryable || !sessionId) return;
    const retryIntent = intent;
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
      if (
        renderLifecycleRef.current.intent === retryIntent &&
        renderLifecycleRef.current.sessionId === sessionId
      ) {
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
    intent: "",
    signature: "",
  });
  useEffect(() => {
    if (!persistKind || !hasAuthoritativeResponse) return;
    if (persistenceSignatureRef.current.intent !== intent) {
      persistenceSignatureRef.current = {
        intent,
        signature: JSON.stringify(persistedData ?? []),
      };
    }
    const signature = JSON.stringify(data);
    if (persistenceSignatureRef.current.signature === signature) return;
    persistenceSignatureRef.current.signature = signature;
    void savePersistedSearchPage(persistKind, normalizedQuery, platform, limit, {
      pages: [{ data: data as PersistedSearchItem[], cursor: null }],
      pageParams: [undefined],
    });
  }, [
    data,
    hasAuthoritativeResponse,
    intent,
    limit,
    normalizedQuery,
    persistKind,
    persistedData,
    platform,
  ]);

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
      if (response.success === false) throw new Error(response.error);
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
      if (response.success === false) throw new Error(response.error);
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

export type SearchAllResponse = SearchResultCollection;

let broadSearchRequestSequence = 0;

interface SearchRequestTrace {
  key: string;
  requestId: number;
  startedAt: number;
  requestStartLogged: boolean;
  cachePublicationLogged: boolean;
  firstUsefulLogged: boolean;
  fullHydrationLogged: boolean;
  cancellationLogged: boolean;
}

function searchResultCount(data: SearchAllResponse | undefined): number {
  return data
    ? data.channels.length +
        data.categories.length +
        data.streams.length +
        data.videos.length +
        data.clips.length
    : 0;
}

function searchElapsedMs(startedAt: number): number {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return Math.round((now - startedAt) * 10) / 10;
}

export function useSearchAll(
  query: string,
  platform?: Platform,
  limit: number = 5,
  enabled: boolean = true
) {
  const normalizedQuery = normalizeSearchQuery(query);
  const queryClient = useQueryClient();
  const queryKey = SEARCH_KEYS.everything(normalizedQuery, platform, limit);
  const quickLimit = normalizedQuery.length === 1 ? 50 : 25;
  const active = enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH;
  const persistedData = usePersistedSearchResult(normalizedQuery, platform, limit, active);
  const traceKey = `${normalizedQuery}\u0000${platform ?? "all"}\u0000${limit}`;
  const requestTrace = useMemo<SearchRequestTrace | undefined>(
    () =>
      active
        ? {
            key: traceKey,
            requestId: ++broadSearchRequestSequence,
            startedAt: typeof performance !== "undefined" ? performance.now() : Date.now(),
            requestStartLogged: false,
            cachePublicationLogged: false,
            firstUsefulLogged: false,
            fullHydrationLogged: false,
            cancellationLogged: false,
          }
        : undefined,
    [active, traceKey]
  );
  const twitchChannels = useSearchChannels(
    platform === "kick" ? "" : normalizedQuery,
    "twitch",
    quickLimit,
    false,
    active && persistedData === undefined
  );
  const kickChannels = useSearchChannels(
    platform === "twitch" ? "" : normalizedQuery,
    "kick",
    quickLimit,
    false,
    active && persistedData === undefined
  );
  const selectedQuickQueries =
    platform === "twitch"
      ? [{ platform: "twitch" as const, result: twitchChannels }]
      : platform === "kick"
        ? [{ platform: "kick" as const, result: kickChannels }]
        : [
            { platform: "twitch" as const, result: twitchChannels },
            { platform: "kick" as const, result: kickChannels },
          ];
  const quickChannels = selectedQuickQueries.flatMap(
    ({ result: queryResult }) => queryResult.data?.pages.flatMap((page) => page.data) ?? []
  );
  const quickSearchSettled = selectedQuickQueries.every(({ result }) => !result.isPending);
  const successfulQuickPlatforms = selectedQuickQueries
    .filter(({ result }) => result.isSuccess)
    .map(({ platform: quickPlatform }) => quickPlatform);

  const result = useQuery({
    queryKey,
    initialData: persistedData,
    initialDataUpdatedAt: persistedData ? 0 : undefined,
    queryFn: async ({ signal }) => {
      const requestId = `search-${requestTrace?.requestId ?? ++broadSearchRequestSequence}`;
      const cancel = () => {
        if (requestTrace && !requestTrace.cancellationLogged) {
          requestTrace.cancellationLogged = true;
          logger.info("Hook:Queries:Search", "search request cancelled", {
            requestId: requestTrace.requestId,
            query: normalizedQuery,
            platform: platform ?? "all",
            stage: "cancelled",
            elapsedMs: searchElapsedMs(requestTrace.startedAt),
          });
        }
        void window.electronAPI.search.cancel({ requestId });
      };
      signal.addEventListener("abort", cancel, { once: true });

      try {
        // Persisted channels are for immediate publication, not evidence that
        // either provider has been searched during this request. A warm broad
        // refresh starts before quick search settles and must discover current
        // channels itself instead of accepting stale rows as provider seeds.
        const channelSeeds = quickSearchSettled ? quickChannels : [];
        const response = await window.electronAPI.search.all({
          query: normalizedQuery,
          platform,
          limit,
          channelSeeds,
          channelSeedPlatforms: quickSearchSettled ? successfulQuickPlatforms : [],
          requestId,
        });
        signal.throwIfAborted();
        if (response.success === false) {
          throw new Error(response.error ?? "Search failed");
        }
        const fresh = response.data;
        const completion = response.providers;
        const refreshComplete = platform
          ? completion?.[platform] === "complete"
          : completion?.twitch === "complete" && completion.kick === "complete";
        const usefulCount = searchResultCount(fresh);
        if (!refreshComplete || usefulCount === 0) {
          return queryClient.getQueryData<SearchAllResponse>(queryKey) ?? persistedData ?? fresh;
        }
        const persisted = await savePersistedSearchResult(
          normalizedQuery,
          platform,
          limit,
          fresh,
          () => !signal.aborted
        );
        signal.throwIfAborted();
        if (!persisted) return fresh;
        if (requestTrace && !requestTrace.fullHydrationLogged) {
          requestTrace.fullHydrationLogged = true;
          logger.info("Hook:Queries:Search", "full search hydration ready", {
            requestId: requestTrace.requestId,
            query: normalizedQuery,
            platform: platform ?? "all",
            stage: "full-hydration",
            count: usefulCount,
            elapsedMs: searchElapsedMs(requestTrace.startedAt),
          });
        }
        return fresh;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    enabled: active && (quickSearchSettled || persistedData !== undefined),
    ...getQueryCacheOptions("searchResults"),
    placeholderData: undefined,
    refetchOnMount: false,
  });
  const { isStale: isSearchStale, refetch: refetchSearch } = result;
  const warmRefreshStartedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!active || !persistedData || !isSearchStale || warmRefreshStartedRef.current === traceKey) {
      return;
    }
    // timer-allowlist: cancelable next-task scheduling collapses StrictMode effect replay into one warm refresh
    const timer = setTimeout(() => {
      warmRefreshStartedRef.current = traceKey;
      void refetchSearch();
    }, 0);
    return () => clearTimeout(timer);
  }, [active, isSearchStale, persistedData, refetchSearch, traceKey]);
  useQueryCachePerformance({
    data: result.data,
    enabled: enabled && normalizedQuery.length >= MIN_REMOTE_SEARCH_LENGTH,
    fetchStatus: result.fetchStatus,
    queryKey,
    surface: "search",
  });

  const progressiveChannels = persistedData ? [] : quickChannels;
  const mergedChannels = rankSearchChannels(
    [...progressiveChannels, ...(result.data?.channels ?? [])].filter(
      (channel, index, channels) =>
        channels.findIndex(
          (candidate) =>
            candidate.platform === channel.platform &&
            (candidate.id === channel.id || candidate.username === channel.username)
        ) === index
    ),
    normalizedQuery
  );
  const hasUsefulData = mergedChannels.length > 0 || result.data !== undefined;
  const data = hasUsefulData
    ? {
        channels: mergedChannels,
        categories: result.data?.categories ?? [],
        streams: result.data?.streams ?? [],
        videos: result.data?.videos ?? [],
        clips: result.data?.clips ?? [],
      }
    : undefined;
  const usefulResultCount = searchResultCount(data);

  useEffect(() => {
    const trace = requestTrace;
    if (!active || !trace || trace.key !== traceKey || trace.requestStartLogged) return;
    trace.requestStartLogged = true;
    logger.info("Hook:Queries:Search", "search request started", {
      requestId: trace.requestId,
      query: normalizedQuery,
      platform: platform ?? "all",
      stage: "request-start",
    });
  }, [active, normalizedQuery, platform, requestTrace, traceKey]);

  useEffect(() => {
    const trace = requestTrace;
    if (
      !trace ||
      trace.key !== traceKey ||
      trace.cachePublicationLogged ||
      !persistedData ||
      !hasUsefulData
    )
      return;
    trace.cachePublicationLogged = true;
    logger.info("Hook:Queries:Search", "cached search result published", {
      requestId: trace.requestId,
      query: normalizedQuery,
      platform: platform ?? "all",
      stage: "cache-publication",
      count: usefulResultCount,
      elapsedMs: searchElapsedMs(trace.startedAt),
    });
  }, [
    hasUsefulData,
    normalizedQuery,
    persistedData,
    platform,
    requestTrace,
    traceKey,
    usefulResultCount,
  ]);

  useEffect(() => {
    const trace = requestTrace;
    if (
      !trace ||
      trace.key !== traceKey ||
      trace.firstUsefulLogged ||
      persistedData ||
      !hasUsefulData
    )
      return;
    trace.firstUsefulLogged = true;
    logger.info("Hook:Queries:Search", "first useful search batch ready", {
      requestId: trace.requestId,
      query: normalizedQuery,
      platform: platform ?? "all",
      stage: "first-useful",
      count: usefulResultCount,
      elapsedMs: searchElapsedMs(trace.startedAt),
    });
  }, [
    hasUsefulData,
    normalizedQuery,
    persistedData,
    platform,
    requestTrace,
    traceKey,
    usefulResultCount,
  ]);

  return {
    ...result,
    data,
    isLoading:
      active &&
      !hasUsefulData &&
      (result.isLoading || twitchChannels.isLoading || kickChannels.isLoading),
    isHydrating:
      active &&
      result.data === undefined &&
      (!quickSearchSettled || result.fetchStatus === "fetching"),
  };
}
