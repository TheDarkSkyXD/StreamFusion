import { useCallback, useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  SearchIntent,
  SearchResultType,
} from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";
import type { PlatformReadOutcome } from "../capabilities/platform-reads";

import type {
  MobileSearchKind,
  SearchHistoryEntry,
  SearchHistoryRepository,
  SearchHistoryScope,
  SearchMediaOutcome,
  SearchPageOutcome,
  SearchReadOutcome,
  SearchSession,
} from "../capabilities/platform-reads";
import { dedupeByIdentity, emptySearchCatalog } from "../domain/search-catalog";
import {
  addSearchHistory,
  clearSearchHistory,
  emptySearchHistory,
  historyScopeForTab,
  removeSearchHistory,
} from "../domain/search-history";
import { composeUnifiedSearch } from "../domain/unified-search";

import type { SearchPlatformFilter } from "./search-filters";

export function searchPageQueryKey(
  platform: Platform,
  kind: MobileSearchKind,
  query: string,
  liveOnly: boolean,
) {
  return [
    "discovery",
    "search-page",
    platform,
    kind,
    query.trim().toLowerCase(),
    liveOnly,
  ] as const;
}

class SearchPageError extends Error {
  constructor(readonly outcome: SearchPageOutcome) {
    super(outcome.error?.code ?? "search-failed");
  }
}

class SearchMediaError extends Error {
  constructor(readonly outcome: SearchMediaOutcome) {
    super(outcome.error?.code ?? "search-media-failed");
  }
}

export function nextSearchCursor<K extends MobileSearchKind>(
  lastPage: SearchPageOutcome<K>,
  pages: readonly SearchPageOutcome<K>[],
): string | undefined {
  const cursor = lastPage.cursor;
  if (!cursor || lastPage.status === "stale") return undefined;
  if (pages.slice(0, -1).some((page) => page.cursor === cursor))
    return undefined;
  const earlierIds = new Set(
    pages.slice(0, -1).flatMap((page) => page.items.map((item) => item.id)),
  );
  if (
    lastPage.items.length > 0 &&
    lastPage.items.every((item) => earlierIds.has(item.id))
  ) {
    return undefined;
  }
  return cursor;
}

export function useUnifiedSearch(input: {
  readonly enabled?: boolean;
  readonly history: SearchHistoryRepository;
  readonly historyScope?: SearchHistoryScope;
  readonly liveOnly: boolean;
  readonly platform: SearchPlatformFilter;
  readonly query: string;
  readonly resultType: SearchResultType;
  readonly session: SearchSession;
}) {
  const queryClient = useQueryClient();
  const history = useSearchHistoryController(input);
  const query = input.query.trim();
  const shouldFetch = input.enabled !== false && query.length > 0;
  const selectedKind =
    input.resultType === "videos" || input.resultType === "clips"
      ? "all"
      : input.resultType;
  const twitchQueries = useProviderSearch(
    "twitch",
    input,
    query,
    shouldFetch,
    selectedKind,
  );
  const kickQueries = useProviderSearch(
    "kick",
    input,
    query,
    shouldFetch,
    selectedKind,
  );

  const active = [...twitchQueries.active, ...kickQueries.active];
  const activeMedia = [twitchQueries.media, kickQueries.media].filter(
    (result) => result !== undefined,
  );
  const canLoadMore = {
    channels:
      twitchQueries.canLoadMore.channels || kickQueries.canLoadMore.channels,
    streams:
      twitchQueries.canLoadMore.streams || kickQueries.canLoadMore.streams,
    categories:
      twitchQueries.canLoadMore.categories ||
      kickQueries.canLoadMore.categories,
  };
  const loadingMore = {
    channels:
      twitchQueries.loadingMore.channels || kickQueries.loadingMore.channels,
    streams:
      twitchQueries.loadingMore.streams || kickQueries.loadingMore.streams,
    categories:
      twitchQueries.loadingMore.categories ||
      kickQueries.loadingMore.categories,
  };
  return {
    ...history.actions,
    refresh() {
      return queryClient.invalidateQueries({ queryKey: ["discovery"] });
    },
    refreshing:
      active.some(
        (result) => result.isFetching && !result.isFetchingNextPage,
      ) || activeMedia.some((result) => result.isFetching),
    retry(platform: Platform) {
      void queryClient.invalidateQueries({
        queryKey: ["discovery", "search-page", platform],
      });
      void queryClient.invalidateQueries({
        queryKey: ["discovery", "search-media", platform],
      });
    },
    loadMore(kind: MobileSearchKind) {
      twitchQueries.loadMore(kind);
      kickQueries.loadMore(kind);
    },
    view: {
      ...composeUnifiedSearch({
        history: history.value,
        historyConfirmClear: history.confirmClear,
        intent: shouldFetch ? searchIntent(input, query) : null,
        loading:
          active.some((result) => result.isPending) ||
          activeMedia.some((result) => result.isPending),
        ...(kickQueries.outcome === undefined
          ? {}
          : { kick: kickQueries.outcome }),
        ...(twitchQueries.outcome === undefined
          ? {}
          : { twitch: twitchQueries.outcome }),
      }),
      canLoadMore,
      loadingMore,
    },
  };
}

function useSearchHistoryController(input: {
  readonly history: SearchHistoryRepository;
  readonly historyScope?: SearchHistoryScope;
  readonly resultType: SearchResultType;
}) {
  const [value, setValue] = useState(emptySearchHistory);
  const [confirmClear, setConfirmClear] = useState(false);
  const scope = input.historyScope ?? historyScopeForTab(input.resultType);
  useEffect(() => setConfirmClear(false), [scope]);
  useEffect(() => {
    let cancelled = false;
    void input.history.read().then((history) => {
      if (!cancelled) setValue(history);
    });
    return () => {
      cancelled = true;
    };
  }, [input.history]);
  const persist = useCallback(
    async (next: typeof value) => {
      setValue(next);
      await input.history.write(next, Date.now());
    },
    [input.history],
  );
  return {
    value,
    confirmClear,
    actions: {
      cancelClear() {
        setConfirmClear(false);
      },
      async confirmClear() {
        const next = clearSearchHistory(value, scope);
        setConfirmClear(false);
        await persist(next);
      },
      record(entry: string | SearchHistoryEntry) {
        void persist(addSearchHistory(value, scope, entry));
      },
      remove(entry: string | SearchHistoryEntry) {
        void persist(removeSearchHistory(value, scope, entry));
      },
      requestClear() {
        setConfirmClear(true);
      },
    },
  };
}

function useProviderSearch(
  platform: Platform,
  input: {
    readonly liveOnly: boolean;
    readonly platform: SearchPlatformFilter;
    readonly session: SearchSession;
  },
  query: string,
  shouldFetch: boolean,
  selectedKind: "all" | MobileSearchKind,
) {
  const enabled = enabledSearchKinds(
    platform,
    input.platform,
    shouldFetch,
    selectedKind,
  );
  const channels = usePage(
    platform,
    "channels",
    enabled.channels,
    input,
    query,
  );
  const streams = usePage(platform, "streams", enabled.streams, input, query);
  const categories = usePage(
    platform,
    "categories",
    enabled.categories,
    input,
    query,
  );
  const media = useMedia(platform, enabled.media, input, query);
  return providerSearchState(
    platform,
    enabled,
    { channels, streams, categories },
    media,
  );
}

function enabledSearchKinds(
  platform: Platform,
  filter: SearchPlatformFilter,
  shouldFetch: boolean,
  selectedKind: "all" | MobileSearchKind,
) {
  const selected = shouldFetch && (filter === "all" || filter === platform);
  return {
    channels:
      selected && (selectedKind === "all" || selectedKind === "channels"),
    streams: selected && (selectedKind === "all" || selectedKind === "streams"),
    categories:
      selected && (selectedKind === "all" || selectedKind === "categories"),
    media: selected && selectedKind === "all",
  };
}

function providerSearchState(
  platform: Platform,
  enabled: ReturnType<typeof enabledSearchKinds>,
  pages: {
    readonly channels: ReturnType<typeof usePage<"channels">>;
    readonly streams: ReturnType<typeof usePage<"streams">>;
    readonly categories: ReturnType<typeof usePage<"categories">>;
  },
  media: ReturnType<typeof useMedia>,
) {
  const { channels, streams, categories } = pages;
  const active = [
    ...(enabled.channels ? [channels] : []),
    ...(enabled.streams ? [streams] : []),
    ...(enabled.categories ? [categories] : []),
  ];
  return {
    active,
    media: enabled.media ? media : undefined,
    canLoadMore: {
      channels: enabled.channels && channels.hasNextPage,
      streams: enabled.streams && streams.hasNextPage,
      categories: enabled.categories && categories.hasNextPage,
    },
    loadingMore: {
      channels: enabled.channels && channels.isFetchingNextPage,
      streams: enabled.streams && streams.isFetchingNextPage,
      categories: enabled.categories && categories.isFetchingNextPage,
    },
    outcome: providerOutcome(platform, {
      channels: enabled.channels ? pageOutcome(channels) : undefined,
      streams: enabled.streams ? pageOutcome(streams) : undefined,
      categories: enabled.categories ? pageOutcome(categories) : undefined,
      media: enabled.media ? mediaOutcome(media) : undefined,
    }),
    loadMore(kind: MobileSearchKind) {
      const page = pages[kind];
      if (enabled[kind] && page.hasNextPage && !page.isFetchingNextPage)
        void page.fetchNextPage();
    },
  };
}

function useMedia(
  platform: Platform,
  enabled: boolean,
  input: { readonly session: SearchSession },
  query: string,
) {
  return useQuery({
    enabled,
    queryKey: ["discovery", "search-media", platform, query.toLowerCase()],
    queryFn: async ({ signal }) => {
      const outcome = await input.session.searchMedia({
        platform,
        query,
        signal,
      });
      if (outcome.status === "failed") throw new SearchMediaError(outcome);
      return outcome;
    },
    retry: false,
  });
}

function mediaOutcome(query: {
  readonly data: SearchMediaOutcome | undefined;
  readonly error: Error | null;
}): SearchMediaOutcome | undefined {
  return (
    query.data ??
    (query.error instanceof SearchMediaError ? query.error.outcome : undefined)
  );
}

function usePage<K extends MobileSearchKind>(
  platform: Platform,
  kind: K,
  enabled: boolean,
  input: { readonly liveOnly: boolean; readonly session: SearchSession },
  query: string,
) {
  return useInfiniteQuery({
    enabled,
    initialPageParam: undefined as string | undefined,
    queryKey: searchPageQueryKey(platform, kind, query, input.liveOnly),
    queryFn: async ({ pageParam, signal }) => {
      const outcome = await input.session.searchPage({
        platform,
        kind,
        query,
        liveOnly: input.liveOnly,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (outcome.status === "failed") throw new SearchPageError(outcome);
      return outcome;
    },
    getNextPageParam: nextSearchCursor,
    retry: false,
  });
}

function pageOutcome<
  TItem extends { readonly id: string; readonly platform: Platform },
  K extends MobileSearchKind,
>(query: {
  readonly data:
    | {
        readonly pages: readonly (PlatformReadOutcome<TItem> & {
          readonly resultKind: K;
        })[];
      }
    | undefined;
  readonly error: Error | null;
}): (PlatformReadOutcome<TItem> & { readonly resultKind: K }) | undefined {
  const pages = query.data?.pages;
  const error =
    query.error instanceof SearchPageError ? query.error.outcome : undefined;
  if (!pages || pages.length === 0)
    return error as
      (PlatformReadOutcome<TItem> & { readonly resultKind: K }) | undefined;
  const items = dedupeByIdentity(pages.flatMap((page) => page.items));
  const latest = pages.at(-1);
  if (!latest) return undefined;
  return {
    ...latest,
    items,
    ...(error === undefined
      ? {}
      : { error: error.error, status: "partial" as const }),
  };
}

function providerOutcome(
  platform: Platform,
  pages: {
    readonly channels: SearchPageOutcome<"channels"> | undefined;
    readonly streams: SearchPageOutcome<"streams"> | undefined;
    readonly categories: SearchPageOutcome<"categories"> | undefined;
    readonly media: SearchMediaOutcome | undefined;
  },
): SearchReadOutcome | undefined {
  const present = [
    pages.channels,
    pages.streams,
    pages.categories,
    pages.media,
  ].filter((page) => page !== undefined);
  if (present.length === 0) return undefined;
  const first = present[0];
  if (!first) return undefined;
  const failure = present.find(
    (page) => page.status === "failed" || page.status === "partial",
  );
  const cache =
    present.find((page) => page.cache.kind === "hit")?.cache ?? first.cache;
  return {
    cache,
    catalog: {
      ...emptySearchCatalog(),
      channels: pages.channels?.items ?? [],
      streams: pages.streams?.items ?? [],
      categories: pages.categories?.items ?? [],
      videos: pages.media?.videos ?? [],
      clips: pages.media?.clips ?? [],
    },
    path: failure?.path ?? first.path,
    platform,
    status: failure
      ? present.some((page) => page.status !== "failed")
        ? "partial"
        : "failed"
      : present.some((page) => page.status === "stale")
        ? "stale"
        : "complete",
    ...(failure?.error === undefined ? {} : { error: failure.error }),
  };
}

function searchIntent(
  input: {
    readonly liveOnly: boolean;
    readonly platform: SearchPlatformFilter;
    readonly resultType: SearchResultType;
  },
  query: string,
): SearchIntent {
  return {
    liveOnly: input.liveOnly,
    limits: { resultLimit: 20 },
    query,
    resultType: input.resultType,
    ...(input.platform === "all" ? {} : { platform: input.platform }),
  };
}
