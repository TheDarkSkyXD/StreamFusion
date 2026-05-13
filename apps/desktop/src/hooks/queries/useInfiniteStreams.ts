import { useInfiniteQuery } from "@tanstack/react-query";

import type { UnifiedStream } from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";

import { STREAM_KEYS } from "./useStreams";

export function useInfiniteTopStreams(platform?: Platform, limit: number = 20) {
  return useInfiniteQuery({
    queryKey: [...STREAM_KEYS.top(platform, limit), "infinite"],
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
  });
}

export function useInfiniteStreamsByCategory(
  categoryId: string,
  platform?: Platform,
  limit: number = 20,
  categoryName?: string,
  language?: string
) {
  return useInfiniteQuery({
    queryKey: [
      ...STREAM_KEYS.byCategory(categoryId, platform),
      "infinite",
      categoryName,
      language,
    ],
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
    enabled: !!categoryId || !!categoryName,
  });
}

export function useInfiniteFollowedStreams(platform?: Platform, limit: number = 20) {
  return useInfiniteQuery({
    queryKey: [...STREAM_KEYS.followed(platform), "infinite"],
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
  });
}
