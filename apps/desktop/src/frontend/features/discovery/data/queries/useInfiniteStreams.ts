import { useInfiniteQuery } from "@tanstack/react-query";

import type { UnifiedStream } from "../../../../../shared/platform-types";
import type { Platform } from "../../../../../shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";
import { STREAM_KEYS } from "./useStreams";

function useInfiniteTopStreams(platform?: Platform, limit: number = 20) {
  const queryKey = [...STREAM_KEYS.top(platform, limit), "infinite"] as const;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await window.electronAPI.streams.getTop({
        platform,
        limit,
        cursor: pageParam,
      });

      if (response.error) {
        throw new Error(response.error as unknown as string);
      }

      return {
        data: response.data as UnifiedStream[],
        nextCursor: response.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...getQueryCacheOptions("streamList"),
  });
  useQueryCachePerformance({
    data: query.data,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "stream-list",
  });
  return query;
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

      if (response.error) {
        throw new Error(response.error as unknown as string);
      }

      return {
        data: response.data as UnifiedStream[],
        nextCursor: response.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // categoryName lets the Kick path slug-guess when the numeric id is unknown,
    // so enable the query when either a real id OR a name is available.
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

function useInfiniteFollowedStreams(platform?: Platform, limit: number = 20) {
  const queryKey = [...STREAM_KEYS.followed(platform), "infinite"] as const;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await window.electronAPI.streams.getFollowed({
        platform,
        limit,
        cursor: pageParam,
      });

      if (response.error) {
        throw new Error(response.error as unknown as string);
      }

      return {
        data: response.data as UnifiedStream[],
        nextCursor: response.cursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...getQueryCacheOptions("followedStreamStatus"),
  });
  useQueryCachePerformance({
    data: query.data,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "following",
  });
  return query;
}
