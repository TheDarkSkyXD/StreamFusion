import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type FetchNextPageOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import type { UnifiedCategory } from "../../../../../shared/platform-types";
import {
  getEquivalentCategoryName,
  normalizeCategoryName,
  pickWinner,
} from "../../../../lib/utils";
import { logger } from "../../../../renderer/logging/logger";
import type { Platform } from "../../../../../shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";
import { savePersistedCategoryCatalog } from "./persisted-category-catalog";

// Minimal interface for stream data needed for category aggregation
interface StreamSummary {
  categoryId?: string;
  viewerCount?: number;
}

const CATEGORY_PREVIEW_LIMIT = 12;
const CATEGORY_SCROLL_PAGE_LIMIT = 20;
let categoryRequestSequence = 0;

function elapsedMs(startedAt: number): number {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return Math.round((now - startedAt) * 10) / 10;
}

function firstUsefulBatch(requests: Promise<UnifiedCategory[]>[]): Promise<UnifiedCategory[]> {
  return new Promise((resolve) => {
    let remaining = requests.length;
    for (const request of requests) {
      void request.then((categories) => {
        if (categories.length > 0) {
          resolve(categories);
          return;
        }
        remaining -= 1;
        if (remaining === 0) resolve([]);
      });
    }
  });
}

function mergeCategories(
  categories: UnifiedCategory[],
  streams: StreamSummary[] = []
): UnifiedCategory[] {
  const viewerCounts = new Map<string, number>();
  for (const stream of streams) {
    if (!stream.categoryId) continue;
    viewerCounts.set(
      stream.categoryId,
      (viewerCounts.get(stream.categoryId) || 0) + (stream.viewerCount || 0)
    );
  }

  const twitchByKey = new Map<string, UnifiedCategory>();
  const kickByKey = new Map<string, UnifiedCategory>();
  for (const category of categories) {
    const enriched = {
      ...category,
      viewerCount: Math.max(viewerCounts.get(category.id) || 0, category.viewerCount || 0),
    };
    const key = normalizeCategoryName(category.name);
    if (category.platform === "twitch") twitchByKey.set(key, enriched);
    if (category.platform === "kick") kickByKey.set(key, enriched);
  }

  const categoryMap = new Map<string, UnifiedCategory>();
  for (const [key, twitchCategory] of twitchByKey) {
    if (key === "slots" && kickByKey.has(key)) continue;
    const kickMatch = kickByKey.get(key);
    categoryMap.set(key, {
      ...twitchCategory,
      viewerCount: (twitchCategory.viewerCount ?? 0) + (kickMatch?.viewerCount ?? 0),
      crossPlatformId: kickMatch?.id,
      crossPlatformName: kickMatch?.name,
      tags: twitchCategory.tags?.length ? twitchCategory.tags : kickMatch?.tags,
    });
  }

  for (const [key, kickCategory] of kickByKey) {
    if (key !== "slots" && categoryMap.has(key)) continue;
    const twitchMatch = twitchByKey.get(key);
    categoryMap.set(key, {
      ...kickCategory,
      viewerCount: (kickCategory.viewerCount ?? 0) + (twitchMatch?.viewerCount ?? 0),
      crossPlatformId: twitchMatch?.id,
      crossPlatformName: twitchMatch?.name,
      tags: kickCategory.tags?.length ? kickCategory.tags : twitchMatch?.tags,
    });
  }

  return Array.from(categoryMap.values()).sort(
    (a, b) => (b.viewerCount || 0) - (a.viewerCount || 0)
  );
}

export const CATEGORY_KEYS = {
  all: ["categories"] as const,
  top: (platform?: Platform) => [...CATEGORY_KEYS.all, "top", platform] as const,
  infinite: (platform: Platform) =>
    [...CATEGORY_KEYS.top(undefined), "infinite", platform] as const,
  byId: (categoryId: string, platform: Platform) =>
    [...CATEGORY_KEYS.all, "id", platform, categoryId] as const,
  metadata: (categoryId: string, platform: Platform) =>
    [...CATEGORY_KEYS.all, "metadata", platform, categoryId] as const,
};

async function loadProgressiveCategoryData(
  platform: Platform | undefined,
  signal: AbortSignal,
  queryClient: QueryClient,
  queryKey: ReturnType<typeof CATEGORY_KEYS.top>
) {
  const requestId = ++categoryRequestSequence;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const previewPlatforms: Platform[] = platform ? [platform] : ["twitch", "kick"];
  const existingCatalog = queryClient.getQueryData<UnifiedCategory[]>(queryKey);
  const hasExistingCatalog = Boolean(existingCatalog?.length);
  logger.info("Hook:Queries:Categories", "category discovery request started", {
    requestId,
    platform: platform ?? "all",
    stage: "request-start",
  });
  if (hasExistingCatalog) {
    logger.info("Hook:Queries:Categories", "cached category catalog published", {
      requestId,
      platform: platform ?? "all",
      stage: "cache-publication",
      count: existingCatalog?.length ?? 0,
      elapsedMs: elapsedMs(startedAt),
    });
  }

  const streamsRequest = window.electronAPI.streams
    .getTop({ platform, limit: 100 })
    .catch((error) => {
      logger.warn("Hook:Queries:Categories", "category viewer aggregation failed", {
        requestId,
        platform: platform ?? "all",
        stage: "stream-error",
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, data: [] };
    });
  if (!hasExistingCatalog) {
    const previewRequests = previewPlatforms.map(async (previewPlatform) => {
      try {
        const response = await window.electronAPI.categories.getTop({
          platform: previewPlatform,
          limit: CATEGORY_PREVIEW_LIMIT,
        });
        if (response.success !== false) return response.data ?? [];
        logger.warn("Hook:Queries:Categories", "bounded category preview failed", {
          requestId,
          platform: previewPlatform,
          stage: "preview-error",
          error: String(response.error),
        });
      } catch (error) {
        logger.warn("Hook:Queries:Categories", "bounded category preview failed", {
          requestId,
          platform: previewPlatform,
          stage: "preview-error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return [];
    });

    const firstBatch = mergeCategories(await firstUsefulBatch(previewRequests));
    if (signal.aborted) throw new DOMException("Category request cancelled", "AbortError");
    if (firstBatch.length > 0) {
      queryClient.setQueryData(queryKey, firstBatch);
      logger.info("Hook:Queries:Categories", "first useful category batch ready", {
        requestId,
        platform: platform ?? "all",
        stage: "first-useful",
        count: firstBatch.length,
        elapsedMs: elapsedMs(startedAt),
      });
    }

    const preview = mergeCategories((await Promise.all(previewRequests)).flat());
    if (signal.aborted) throw new DOMException("Category request cancelled", "AbortError");
    if (preview.length > firstBatch.length) {
      queryClient.setQueryData(queryKey, preview);
    }
  }

  const categoriesResponse = await window.electronAPI.categories.getTop({ platform });
  if (signal.aborted) throw new DOMException("Category request cancelled", "AbortError");
  const streamsResponse = await streamsRequest;
  if (signal.aborted) throw new DOMException("Category request cancelled", "AbortError");
  const rawCategories = categoriesResponse.success !== false ? categoriesResponse.data : [];
  const completion = categoriesResponse.providers;
  const refreshComplete = platform
    ? completion?.[platform] === "complete"
    : completion?.twitch === "complete" && completion.kick === "complete";
  const fullCatalog = mergeCategories(
    rawCategories,
    streamsResponse.success ? (streamsResponse.data as StreamSummary[]) : []
  );
  const accepted =
    categoriesResponse.success !== false && refreshComplete && fullCatalog.length > 0;
  if (accepted) {
    queryClient.setQueryData(queryKey, fullCatalog);
    let persisted = false;
    try {
      persisted = await savePersistedCategoryCatalog(platform, fullCatalog, () => !signal.aborted);
    } catch (error) {
      logger.warn("Hook:Queries:Categories", "failed to persist category catalog", {
        requestId,
        platform: platform ?? "all",
        stage: "persist-error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (signal.aborted) throw new DOMException("Category request cancelled", "AbortError");
    if (persisted) {
      logger.info("Hook:Queries:Categories", "full category catalog ready", {
        requestId,
        platform: platform ?? "all",
        stage: "full-hydration",
        count: fullCatalog.length,
        elapsedMs: elapsedMs(startedAt),
      });
    }
  }

  return [categoriesResponse, streamsResponse, accepted, fullCatalog, refreshComplete] as const;
}

interface ProgressiveCategoryRequest {
  abortTimer: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
  leases: Set<symbol>;
  promise: ReturnType<typeof loadProgressiveCategoryData>;
}

const CATEGORY_REQUEST_RELEASE_GRACE_MS = 50;
const progressiveCategoryRequests = new WeakMap<
  QueryClient,
  Map<string, ProgressiveCategoryRequest>
>();

function acquireProgressiveCategoryData(
  platform: Platform | undefined,
  signal: AbortSignal,
  queryClient: QueryClient,
  queryKey: ReturnType<typeof CATEGORY_KEYS.top>
) {
  const requestKey = platform ?? "all";
  let clientRequests = progressiveCategoryRequests.get(queryClient);
  if (!clientRequests) {
    clientRequests = new Map();
    progressiveCategoryRequests.set(queryClient, clientRequests);
  }
  let request = clientRequests.get(requestKey);

  if (!request) {
    const controller = new AbortController();
    request = {
      abortTimer: null,
      controller,
      leases: new Set(),
      promise: loadProgressiveCategoryData(platform, controller.signal, queryClient, queryKey),
    };
    clientRequests.set(requestKey, request);

    const settledRequest = request;
    const clearSettledRequest = () => {
      if (settledRequest.abortTimer) clearTimeout(settledRequest.abortTimer);
      if (clientRequests.get(requestKey) === settledRequest) {
        clientRequests.delete(requestKey);
      }
    };
    void request.promise.then(clearSettledRequest, clearSettledRequest);
  }

  if (request.abortTimer) {
    clearTimeout(request.abortTimer);
    request.abortTimer = null;
  }

  const lease = Symbol(requestKey);
  request.leases.add(lease);
  const leasedRequest = request;
  const release = () => {
    leasedRequest.leases.delete(lease);
    if (leasedRequest.leases.size > 0 || leasedRequest.abortTimer) return;

    // timer-allowlist: shared query lease needs a cancelable remount grace period
    leasedRequest.abortTimer = setTimeout(() => {
      leasedRequest.abortTimer = null;
      if (leasedRequest.leases.size > 0) return;
      if (clientRequests.get(requestKey) === leasedRequest) {
        clientRequests.delete(requestKey);
      }
      leasedRequest.controller.abort();
    }, CATEGORY_REQUEST_RELEASE_GRACE_MS);
  };

  if (signal.aborted) release();
  else signal.addEventListener("abort", release, { once: true });

  const removeAbortListener = () => signal.removeEventListener("abort", release);
  void request.promise.then(removeAbortListener, removeAbortListener);
  return request.promise;
}

export interface CategoryMetadata {
  tags?: string[];
}

/**
 * Lazy-fetch per-category content tags for Twitch categories.
 *
 * Twitch's Helix /games/top response doesn't include tags, so the only way
 * to surface them is a per-card raw GQL query. The virtualized grid only
 * mounts visible cards, so this fans out to at most ~36 requests on first
 * page open, cached for 5 minutes via React Query.
 *
 * Kick categories already carry their tags through from the bulk
 * /private/v1/categories fetch, so this hook short-circuits for them.
 */
export function useCategoryMetadata(category: UnifiedCategory) {
  const queryKey = CATEGORY_KEYS.metadata(category.id, category.platform);
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<CategoryMetadata> => {
      const response = await window.electronAPI.categories.getMetadata({
        platform: category.platform,
        categoryId: category.id,
        slug: category.slug,
      });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return (response.data as CategoryMetadata) ?? { tags: undefined };
    },
    enabled: category.platform === "twitch",
    ...getQueryCacheOptions("categoryReference"),
    refetchOnWindowFocus: false,
  });
  useQueryCachePerformance({
    data: query.data,
    enabled: category.platform === "twitch",
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "category-detail",
  });
  return query;
}

export function useTopCategories(platform?: Platform, options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const queryKey = CATEGORY_KEYS.top(platform);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const [categoriesResponse, _streamsResponse, accepted, fullCatalog, refreshComplete] =
        await acquireProgressiveCategoryData(platform, signal, queryClient, queryKey);

      if (categoriesResponse.success === false) {
        throw new Error(categoriesResponse.error);
      }
      if (accepted || refreshComplete) return fullCatalog;

      const cached = queryClient.getQueryData<UnifiedCategory[]>(queryKey);
      if (cached?.length) return cached;
      if (fullCatalog.length > 0) return fullCatalog;
      throw new Error("Couldn’t load categories from Twitch or Kick");
    },
    ...getQueryCacheOptions("categories"),
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    enabled: options.enabled,
  });
  useQueryCachePerformance({
    data: query.data,
    enabled: options.enabled,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "categories",
  });
  return query;
}

interface CategoryProviderScrollPage {
  categories: UnifiedCategory[];
  cursor: string | null;
}

interface CategoryProviderScrollPageParam {
  cursor?: string;
  knownCategoryKeys: string[];
}

const FIRST_CATEGORY_PROVIDER_PAGE: CategoryProviderScrollPageParam = {
  knownCategoryKeys: [],
};

function useInfiniteProviderCategories(platform: Platform) {
  return useInfiniteQuery({
    queryKey: CATEGORY_KEYS.infinite(platform),
    initialPageParam: FIRST_CATEGORY_PROVIDER_PAGE,
    queryFn: async ({ pageParam, signal }): Promise<CategoryProviderScrollPage> => {
      const knownCategoryKeys = new Set(pageParam.knownCategoryKeys);
      const categories: UnifiedCategory[] = [];
      let cursor: string | null | undefined = pageParam.cursor;

      while (cursor !== null) {
        try {
          const response = await window.electronAPI.categories.getTop({
            platform,
            limit: CATEGORY_SCROLL_PAGE_LIMIT,
            ...(cursor ? { cursor } : {}),
          });
          if (signal.aborted) throw new DOMException("Category request cancelled", "AbortError");
          if (response.success === false) throw new Error(response.error);

          const batch = response.data ?? [];
          categories.push(...batch);
          const nextCursor = response.cursor ?? null;
          const cursorAdvanced: boolean = nextCursor !== (cursor ?? null);
          cursor = cursorAdvanced ? nextCursor : null;
          const addedCount = mergeCategories(categories).reduce(
            (count, category) =>
              count + (knownCategoryKeys.has(normalizeCategoryName(category.name)) ? 0 : 1),
            0
          );
          if (addedCount >= CATEGORY_SCROLL_PAGE_LIMIT || (batch.length === 0 && !cursorAdvanced)) {
            break;
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          logger.warn("Hook:Queries:Categories", "category provider request rejected", {
            platform,
            stage: "provider-rejection",
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      return { categories, cursor: cursor ?? null };
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.cursor === null) return undefined;
      const knownCategoryKeys = Array.from(
        new Set(
          mergeCategories(allPages.flatMap((page) => page.categories)).map((category) =>
            normalizeCategoryName(category.name)
          )
        )
      );
      return { cursor: lastPage.cursor, knownCategoryKeys };
    },
    ...getQueryCacheOptions("categories"),
    refetchOnWindowFocus: false,
  });
}

/** Cursor-driven category catalog used by the Categories page. */
export function useInfiniteTopCategories() {
  const twitchQuery = useInfiniteProviderCategories("twitch");
  const kickQuery = useInfiniteProviderCategories("kick");
  const providerQueries = [twitchQuery, kickQuery] as const;
  const providerCategories: UnifiedCategory[] = [];
  for (const query of providerQueries) {
    for (const page of query.data?.pages ?? []) providerCategories.push(...page.categories);
  }
  const data = mergeCategories(providerCategories);
  const hasData = data.length > 0;
  const isLoading = !hasData && providerQueries.some((query) => query.isLoading);
  const isError = !hasData && !isLoading && providerQueries.every((query) => query.isError);
  const isSuccess = hasData || (!isLoading && providerQueries.some((query) => query.isSuccess));
  const {
    fetchNextPage: fetchNextTwitchPage,
    hasNextPage: twitchHasNextPage,
    isFetchingNextPage: isFetchingNextTwitchPage,
    refetch: refetchTwitch,
  } = twitchQuery;
  const {
    fetchNextPage: fetchNextKickPage,
    hasNextPage: kickHasNextPage,
    isFetchingNextPage: isFetchingNextKickPage,
    refetch: refetchKick,
  } = kickQuery;

  const loadMoreInFlight = useRef<Promise<unknown> | null>(null);
  const fetchNextPage = useCallback(
    (options?: FetchNextPageOptions) => {
      if (loadMoreInFlight.current) return loadMoreInFlight.current;
      const requests: Promise<unknown>[] = [];
      if (twitchHasNextPage && !isFetchingNextTwitchPage) {
        requests.push(fetchNextTwitchPage({ ...options, cancelRefetch: false }));
      }
      if (kickHasNextPage && !isFetchingNextKickPage) {
        requests.push(fetchNextKickPage({ ...options, cancelRefetch: false }));
      }
      const request = Promise.all(requests);
      loadMoreInFlight.current = request;
      const clear = () => {
        if (loadMoreInFlight.current === request) loadMoreInFlight.current = null;
      };
      void request.then(clear, clear);
      return request;
    },
    [
      fetchNextKickPage,
      fetchNextTwitchPage,
      isFetchingNextKickPage,
      isFetchingNextTwitchPage,
      kickHasNextPage,
      twitchHasNextPage,
    ]
  );

  const refetch = useCallback(
    () => Promise.all([refetchTwitch(), refetchKick()]),
    [refetchKick, refetchTwitch]
  );

  return {
    data,
    error: isError ? new Error("Couldn’t load categories from Twitch or Kick") : null,
    fetchNextPage,
    fetchStatus: providerQueries.some((query) => query.fetchStatus === "fetching")
      ? ("fetching" as const)
      : providerQueries.some((query) => query.fetchStatus === "paused")
        ? ("paused" as const)
        : ("idle" as const),
    hasNextPage: providerQueries.some((query) => query.hasNextPage),
    isError,
    isFetching: providerQueries.some((query) => query.isFetching),
    isFetchingNextPage: providerQueries.some((query) => query.isFetchingNextPage),
    isLoading,
    isSuccess,
    refetch,
  };
}

/**
 * Resolve a category reference (source platform + id + name) to the canonical
 * cross-platform link destination used by the Categories page — so a click on
 * a stream-page category badge lands on the same merged page as a click on the
 * Categories grid.
 *
 * Two-tier lookup: first the cached top-categories merge (free), then a
 * targeted `categories.search` against the other platform (one IPC). Falls
 * back to the source unchanged for platform-exclusive categories. Matches by
 * normalized name — Kick ids vary across auth states, name is the actual
 * cross-platform key.
 *
 * Shares its query key (`["category-match", key, otherPlatform]`) with
 * CategoryDetailPage's fallback search so a visit in either direction primes
 * the other.
 */
export function useUnifiedCategoryLink(
  platform: Platform,
  categoryId: string,
  categoryName: string
): { linkPlatform: Platform; linkCategoryId: string; otherId?: string } {
  const queryClient = useQueryClient();
  const otherPlatform: Platform = platform === "twitch" ? "kick" : "twitch";
  const key = categoryName ? normalizeCategoryName(categoryName) : null;

  // Warm path: the Categories grid has already merged Twitch+Kick into a single
  // entry per normalized name, with the cross-platform id stashed on the winner.
  const cachedEntry =
    key !== null
      ? queryClient
          .getQueryData<UnifiedCategory[]>(CATEGORY_KEYS.top(undefined))
          ?.find((c) => normalizeCategoryName(c.name) === key)
      : undefined;

  // Cold path: search the other platform for a name match. Disabled when the
  // warm path already resolved or when we have nothing to look up.
  const queryKey = ["category-match", key, otherPlatform] as const;
  const { data: searched, fetchStatus } = useQuery({
    queryKey,
    queryFn: async () => {
      const searchQuery = (key && getEquivalentCategoryName(key, otherPlatform)) ?? categoryName;
      const response = await window.electronAPI.categories.search({
        query: searchQuery,
        platform: otherPlatform,
        limit: 10,
      });
      if (response.success === false) throw new Error(response.error);
      const candidates = (response.data as UnifiedCategory[]) || [];
      return candidates.find((c) => normalizeCategoryName(c.name) === key) || null;
    },
    enabled: !!key && !!categoryId && !cachedEntry,
    ...getQueryCacheOptions("categoryReference"),
  });
  useQueryCachePerformance({
    data: searched,
    enabled: !!key && !!categoryId && !cachedEntry,
    fetchStatus,
    queryKey,
    surface: "category-detail",
  });

  if (!categoryId || key === null) {
    return { linkPlatform: platform, linkCategoryId: categoryId };
  }

  if (cachedEntry) {
    return {
      linkPlatform: cachedEntry.platform,
      linkCategoryId: cachedEntry.id,
      otherId: cachedEntry.crossPlatformId,
    };
  }

  if (searched) {
    const winner = pickWinner(key);
    if (winner === platform) {
      return { linkPlatform: platform, linkCategoryId: categoryId, otherId: searched.id };
    }
    return { linkPlatform: otherPlatform, linkCategoryId: searched.id, otherId: categoryId };
  }

  return { linkPlatform: platform, linkCategoryId: categoryId };
}

interface CachedCategoryReference {
  category: UnifiedCategory;
  updatedAt: number;
}

function getCachedCategoryReference(
  queryClient: QueryClient,
  categoryId: string,
  platform: Platform
): CachedCategoryReference | undefined {
  const candidates: CachedCategoryReference[] = [];
  const addCandidate = (categories: UnifiedCategory[] | undefined, updatedAt: number) => {
    const category = categories?.find(
      (candidate) => candidate.id === categoryId && candidate.platform === platform
    );
    if (category) candidates.push({ category, updatedAt });
  };

  for (const key of [CATEGORY_KEYS.top(platform), CATEGORY_KEYS.top(undefined)]) {
    const state = queryClient.getQueryState<UnifiedCategory[]>(key);
    addCandidate(state?.data, state?.dataUpdatedAt ?? 0);
  }

  for (const candidatePlatform of ["twitch", "kick"] as const) {
    const infiniteState = queryClient.getQueryState<{
      pages: CategoryProviderScrollPage[];
    }>(CATEGORY_KEYS.infinite(candidatePlatform));
    addCandidate(
      infiniteState?.data
        ? mergeCategories(infiniteState.data.pages.flatMap((page) => page.categories))
        : undefined,
      infiniteState?.dataUpdatedAt ?? 0
    );
  }

  return candidates.reduce<CachedCategoryReference | undefined>(
    (freshest, candidate) =>
      !freshest || candidate.updatedAt > freshest.updatedAt ? candidate : freshest,
    undefined
  );
}

export function useCategoryById(categoryId: string, platform: Platform) {
  const queryClient = useQueryClient();
  const queryKey = CATEGORY_KEYS.byId(categoryId, platform);
  const cachedReference = getCachedCategoryReference(queryClient, categoryId, platform);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.categories.getById({ categoryId, platform });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedCategory;
    },
    enabled: !!categoryId && !!platform,
    initialData: cachedReference?.category,
    initialDataUpdatedAt: cachedReference?.updatedAt,
    ...getQueryCacheOptions("categoryReference"),
  });
  useQueryCachePerformance({
    data: query.data,
    enabled: !!categoryId && !!platform,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "category-detail",
  });
  return query;
}
