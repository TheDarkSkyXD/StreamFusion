import { useInfiniteQuery } from "@tanstack/react-query";

import type { Platform } from "../../../../../shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";
import { STREAM_KEYS } from "./useStreams";

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
