import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { dedupeStreamsByChannelIdentity } from "@/lib/id-utils";

import type { Platform } from "../../../../../shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";
import { STREAM_KEYS } from "./useStreams";

const TOP_STREAMS_PAGE_SIZE = 12;
const TOP_STREAM_PLATFORMS = ["twitch", "kick"] as const satisfies readonly Platform[];

function useInfiniteTopStreamsByPlatform(platform: Platform) {
  const queryKey = STREAM_KEYS.topInfinite(platform, TOP_STREAMS_PAGE_SIZE);
  return useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const response = await window.electronAPI.streams.getTop({
        platform,
        limit: TOP_STREAMS_PAGE_SIZE,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      });
      signal.throwIfAborted();
      if (!response.success) throw new Error(response.error);

      return {
        data: response.data,
        nextCursor: response.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...getQueryCacheOptions("streamList"),
  });
}

export function useInfiniteTopStreams() {
  const twitch = useInfiniteTopStreamsByPlatform("twitch");
  const kick = useInfiniteTopStreamsByPlatform("kick");
  const loadMoreInFlight = useRef<Promise<void> | null>(null);
  const twitchPages = twitch.data?.pages;
  const kickPages = kick.data?.pages;

  const data = useMemo(() => {
    const streams = [...(twitchPages ?? []), ...(kickPages ?? [])].flatMap((page) => page.data);
    return dedupeStreamsByChannelIdentity(streams).sort(
      (left, right) => right.viewerCount - left.viewerCount
    );
  }, [kickPages, twitchPages]);

  const unavailablePlatforms = TOP_STREAM_PLATFORMS.filter((platform) =>
    platform === "twitch" ? twitch.isError : kick.isError
  );
  const hasNextPage = Boolean(twitch.hasNextPage || kick.hasNextPage);
  const isFetchingNextPage = twitch.isFetchingNextPage || kick.isFetchingNextPage;
  const fetchNextTwitchPage = twitch.fetchNextPage;
  const fetchNextKickPage = kick.fetchNextPage;
  const refetchTwitch = twitch.refetch;
  const refetchKick = kick.refetch;

  const fetchNextPage = useCallback((): Promise<void> => {
    if (loadMoreInFlight.current) return loadMoreInFlight.current;

    const pending = Promise.all([
      twitch.hasNextPage && !twitch.isFetchingNextPage
        ? fetchNextTwitchPage({ cancelRefetch: false })
        : Promise.resolve(),
      kick.hasNextPage && !kick.isFetchingNextPage
        ? fetchNextKickPage({ cancelRefetch: false })
        : Promise.resolve(),
    ]).then(() => undefined);
    loadMoreInFlight.current = pending;
    const clearPending = () => {
      if (loadMoreInFlight.current === pending) loadMoreInFlight.current = null;
    };
    void pending.then(clearPending, clearPending);
    return pending;
  }, [
    fetchNextKickPage,
    fetchNextTwitchPage,
    kick.hasNextPage,
    kick.isFetchingNextPage,
    twitch.hasNextPage,
    twitch.isFetchingNextPage,
  ]);

  const refetch = useCallback(async (): Promise<void> => {
    await Promise.all([refetchTwitch(), refetchKick()]);
  }, [refetchKick, refetchTwitch]);

  const allProvidersFailed = twitch.isError && kick.isError;
  return {
    data,
    isLoading: data.length === 0 && (twitch.isLoading || kick.isLoading),
    error:
      data.length === 0 && allProvidersFailed
        ? new Error("Couldn't load live channels from Twitch or Kick")
        : null,
    hasNextPage,
    isFetchingNextPage,
    loadMoreError: twitch.isFetchNextPageError || kick.isFetchNextPageError,
    unavailablePlatforms,
    fetchNextPage,
    refetch,
  };
}

export function useInfiniteStreamsByCategory(
  categoryId: string,
  platform?: Platform,
  limit: number = 20,
  categoryName?: string,
  language?: string,
  datasetKey?: string
) {
  const queryKey = [
    ...STREAM_KEYS.byCategory(categoryId, platform),
    "infinite",
    categoryName,
    language,
    ...(datasetKey === undefined ? [] : [datasetKey]),
  ] as const;
  const enabled = !!categoryId || !!categoryName;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await window.electronAPI.streams.getByCategory({
        categoryId,
        platform,
        limit,
        cursor: pageParam,
        categoryName,
        language,
      });

      if (!response.success) throw new Error(response.error);

      return {
        data: response.data,
        nextCursor: response.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    ...getQueryCacheOptions("streamList"),
  });
  useQueryCachePerformance({
    data: query.data,
    enabled,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "category-detail",
  });
  return query;
}
