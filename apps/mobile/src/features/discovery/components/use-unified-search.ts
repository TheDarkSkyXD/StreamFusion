import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SearchIntent, SearchResultType } from "@streamfusion/core/discovery";
import type { Platform } from "@streamfusion/core/platform";

import type {
  SearchHistoryRepository,
  SearchSession,
} from "../capabilities/platform-reads";
import {
  addSearchHistory,
  clearSearchHistory,
  emptySearchHistory,
  historyScopeForTab,
  removeSearchHistory,
} from "../domain/search-history";
import { composeUnifiedSearch } from "../domain/unified-search";

import type { SearchPlatformFilter } from "./search-filters";

export function searchCatalogQueryKey(
  platform: Platform,
  query: string,
): readonly ["discovery", "search", Platform, string] {
  return ["discovery", "search", platform, query];
}

export function useUnifiedSearch(input: {
  readonly enabled?: boolean;
  readonly history: SearchHistoryRepository;
  readonly liveOnly: boolean;
  readonly platform: SearchPlatformFilter;
  readonly query: string;
  readonly resultType: SearchResultType;
  readonly session: SearchSession;
}) {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState(emptySearchHistory);
  const [historyConfirmClear, setHistoryConfirmClear] = useState(false);
  const enabled = input.enabled !== false;
  const query = input.query.trim();
  const shouldFetch = enabled && query.length > 0;
  const fetchTwitch = shouldFetch && input.platform !== "kick";
  const fetchKick = shouldFetch && input.platform !== "twitch";
  const twitch = useQuery({
    enabled: fetchTwitch,
    queryFn: ({ signal }) =>
      input.session.search({
        platform: "twitch",
        query,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: searchCatalogQueryKey("twitch", query),
    retry: false,
  });
  const kick = useQuery({
    enabled: fetchKick,
    queryFn: ({ signal }) =>
      input.session.search({
        platform: "kick",
        query,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: searchCatalogQueryKey("kick", query),
    retry: false,
  });

  useEffect(() => {
    let cancelled = false;
    void input.history.read().then((value) => {
      if (!cancelled) setHistory(value);
    });
    return () => {
      cancelled = true;
    };
  }, [input.history]);

  const persist = useCallback(
    async (next: typeof history) => {
      setHistory(next);
      await input.history.write(next, Date.now());
    },
    [input.history],
  );

  return {
    cancelClear() {
      setHistoryConfirmClear(false);
    },
    async confirmClear() {
      const next = clearSearchHistory(
        history,
        historyScopeForTab(input.resultType),
      );
      setHistoryConfirmClear(false);
      await persist(next);
    },
    record(queryValue: string) {
      const next = addSearchHistory(
        history,
        historyScopeForTab(input.resultType),
        queryValue,
      );
      void persist(next);
    },
    remove(queryValue: string) {
      void persist(
        removeSearchHistory(
          history,
          historyScopeForTab(input.resultType),
          queryValue,
        ),
      );
    },
    requestClear() {
      setHistoryConfirmClear(true);
    },
    retry(platform: Platform) {
      void queryClient.invalidateQueries({
        queryKey: ["discovery", "search", platform],
      });
    },
    view: composeUnifiedSearch({
      history,
      historyConfirmClear,
      intent: shouldFetch ? searchIntent(input, query) : null,
      loading:
        shouldFetch &&
        ((fetchTwitch && twitch.isPending) || (fetchKick && kick.isPending)),
      ...(kick.data === undefined ? {} : { kick: kick.data }),
      ...(twitch.data === undefined ? {} : { twitch: twitch.data }),
    }),
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
