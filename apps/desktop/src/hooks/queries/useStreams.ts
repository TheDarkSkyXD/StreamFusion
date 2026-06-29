import { useQuery } from "@tanstack/react-query";

import { logger } from "@/renderer/logging/logger";

import type { UnifiedStream } from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";

export const STREAM_KEYS = {
  all: ["streams"] as const,
  top: (platform?: Platform, limit?: number) =>
    [...STREAM_KEYS.all, "top", platform, limit] as const,
  byCategory: (categoryId: string, platform?: Platform) =>
    [...STREAM_KEYS.all, "category", categoryId, platform] as const,
  followed: (platform?: Platform) => [...STREAM_KEYS.all, "followed", platform] as const,
  byChannel: (username: string, platform: Platform) =>
    [...STREAM_KEYS.all, "channel", platform, username] as const,
};

export function useTopStreams(platform?: Platform, limit: number = 20) {
  const queryKey = STREAM_KEYS.top(platform, limit);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.streams.getTop({ platform, limit });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedStream[];
    },
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

function useStreamsByCategory(categoryId: string, platform?: Platform, limit: number = 20) {
  const queryKey = STREAM_KEYS.byCategory(categoryId, platform);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.streams.getByCategory({
        categoryId,
        platform,
        limit,
      });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedStream[];
    },
    enabled: !!categoryId,
    ...getQueryCacheOptions("streamList"),
  });
  useQueryCachePerformance({
    data: query.data,
    enabled: !!categoryId,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "category-detail",
  });
  return query;
}

export function useFollowedStreams(
  platform?: Platform,
  limit: number = 20,
  options: { enabled?: boolean } = {}
) {
  const queryKey = STREAM_KEYS.followed(platform);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.streams.getFollowed({ platform, limit });
      if (response.error) {
        // If it fails (e.g. auth error, network), we just return empty list so UI doesn't break
        // But logging it is good
        logger.warn("Hook:Queries:Streams", "failed to fetch followed streams", {
          error: response.error,
        });
        return [];
      }
      return response.data as UnifiedStream[];
    },
    enabled: options.enabled,
    ...getQueryCacheOptions("followedStreamStatus"),
  });
  useQueryCachePerformance({
    data: query.data,
    enabled: options.enabled,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "following",
  });
  return query;
}

export function useStreamByChannel(username: string, platform: Platform) {
  const queryKey = STREAM_KEYS.byChannel(username, platform);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.streams.getByChannel({ username, platform });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedStream;
    },
    enabled: !!username && !!platform,
    ...getQueryCacheOptions("streamChannelDetail"),
    retry: false, // Don't retry - stream might simply be offline
  });
  useQueryCachePerformance({
    data: query.data,
    enabled: !!username && !!platform,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "stream-detail",
  });
  return query;
}
