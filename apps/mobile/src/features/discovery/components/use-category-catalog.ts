import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Platform } from "@streamfusion/core/platform";

import type { DiscoveryPreferenceStore } from "../capabilities/discovery-preferences";
import type { DiscoverySession } from "../capabilities/platform-reads";
import {
  collapseCategoryPages,
  composeCategoryCatalog,
  nextCategoryCursor,
} from "../domain/category-catalog";
import type { LanguageFilter } from "../domain/broadcast-languages";
import { shouldAutoRetryHomeRead } from "../domain/home-live-discovery";

const REMOTE_SEARCH_MIN = 2;
const MAX_RETRY_DELAY_MS = 8_000;

export function categoriesQueryKey(
  platform: Platform,
): readonly ["discovery", "categories", "paged", Platform] {
  return ["discovery", "categories", "paged", platform];
}

export function categorySearchQueryKey(
  platform: Platform,
  query: string,
): readonly ["discovery", "category-search", Platform, string] {
  return ["discovery", "category-search", platform, query];
}

export function useCategoryCatalog(input: {
  readonly enabled?: boolean;
  readonly preferences: DiscoveryPreferenceStore;
  readonly query: string;
  readonly session: DiscoverySession;
}) {
  const queryClient = useQueryClient();
  const enabled = input.enabled !== false;
  const [language, setLanguage] = useState<LanguageFilter>("all");
  const trimmedQuery = input.query.trim();
  const remoteQuery =
    trimmedQuery.length >= REMOTE_SEARCH_MIN ? trimmedQuery : "";
  useEffect(() => {
    let cancelled = false;
    void input.preferences.readLanguage().then((value) => {
      if (!cancelled) setLanguage(value);
    });
    return () => {
      cancelled = true;
    };
  }, [input.preferences]);
  const twitch = useInfiniteQuery({
    enabled,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const outcome = await input.session.readCategories({
        platform: "twitch",
        ...(pageParam === "" ? {} : { cursor: pageParam }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (shouldAutoRetryHomeRead(outcome) && outcome.items.length === 0)
        throw new Error(outcome.error?.code);
      return outcome;
    },
    queryKey: categoriesQueryKey("twitch"),
    refetchInterval: ({ state }) =>
      state.data?.pages.some(shouldAutoRetryHomeRead) ? 5_000 : false,
    getNextPageParam: nextCategoryCursor,
    retry: true,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, MAX_RETRY_DELAY_MS),
  });
  const kick = useInfiniteQuery({
    enabled,
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const outcome = await input.session.readCategories({
        platform: "kick",
        ...(pageParam === "" ? {} : { cursor: pageParam }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (shouldAutoRetryHomeRead(outcome) && outcome.items.length === 0)
        throw new Error(outcome.error?.code);
      return outcome;
    },
    queryKey: categoriesQueryKey("kick"),
    refetchInterval: ({ state }) =>
      state.data?.pages.some(shouldAutoRetryHomeRead) ? 5_000 : false,
    getNextPageParam: nextCategoryCursor,
    retry: true,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, MAX_RETRY_DELAY_MS),
  });
  const remoteEnabled = enabled && remoteQuery.length >= REMOTE_SEARCH_MIN;
  const remoteTwitch = useQuery({
    enabled: remoteEnabled,
    queryFn: ({ signal }) =>
      input.session.searchCategories({
        platform: "twitch",
        query: remoteQuery,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: categorySearchQueryKey("twitch", remoteQuery),
    refetchInterval: ({ state }) =>
      shouldAutoRetryHomeRead(state.data) ? 5_000 : false,
    retry: false,
  });
  const remoteKick = useQuery({
    enabled: remoteEnabled,
    queryFn: ({ signal }) =>
      input.session.searchCategories({
        platform: "kick",
        query: remoteQuery,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: categorySearchQueryKey("kick", remoteQuery),
    refetchInterval: ({ state }) =>
      shouldAutoRetryHomeRead(state.data) ? 5_000 : false,
    retry: false,
  });
  const canLoadMore = {
    twitch: twitch.hasNextPage && !twitch.isFetching,
    kick: kick.hasNextPage && !kick.isFetching,
  };
  return {
    canLoadMore,
    loadMore(platform: "all" | Platform) {
      if (platform !== "kick" && canLoadMore.twitch)
        void twitch.fetchNextPage({ cancelRefetch: false });
      if (platform !== "twitch" && canLoadMore.kick)
        void kick.fetchNextPage({ cancelRefetch: false });
    },
    refresh() {
      return queryClient.invalidateQueries({ queryKey: ["discovery"] });
    },
    refreshing:
      twitch.isFetching ||
      kick.isFetching ||
      remoteTwitch.isFetching ||
      remoteKick.isFetching,
    async setLanguage(next: LanguageFilter) {
      setLanguage(next);
      await input.preferences.writeLanguage(next);
    },
    view: composeCategoryCatalog({
      language,
      loading: enabled && (twitch.isPending || kick.isPending),
      query: input.query,
      ...(kick.data === undefined
        ? {}
        : { kick: collapseCategoryPages(kick.data.pages) }),
      ...(twitch.data === undefined
        ? {}
        : { twitch: collapseCategoryPages(twitch.data.pages) }),
      ...(remoteKick.data === undefined ? {} : { remoteKick: remoteKick.data }),
      ...(remoteTwitch.data === undefined
        ? {}
        : { remoteTwitch: remoteTwitch.data }),
    }),
  };
}
