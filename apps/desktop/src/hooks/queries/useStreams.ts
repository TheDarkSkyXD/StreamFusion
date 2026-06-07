import { useQuery } from "@tanstack/react-query";

import type { UnifiedStream } from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";

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
  return useQuery({
    queryKey: STREAM_KEYS.top(platform, limit),
    queryFn: async () => {
      const response = await window.electronAPI.streams.getTop({ platform, limit });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedStream[];
    },
  });
}

function useStreamsByCategory(categoryId: string, platform?: Platform, limit: number = 20) {
  return useQuery({
    queryKey: STREAM_KEYS.byCategory(categoryId, platform),
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
  });
}

export function useFollowedStreams(
  platform?: Platform,
  limit: number = 20,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: STREAM_KEYS.followed(platform),
    queryFn: async () => {
      const response = await window.electronAPI.streams.getFollowed({ platform, limit });
      if (response.error) {
        // If it fails (e.g. auth error, network), we just return empty list so UI doesn't break
        // But logging it is good
        console.warn(`Failed to fetch followed streams:`, response.error);
        return [];
      }
      return response.data as UnifiedStream[];
    },
    enabled: options.enabled,
    // Auto-refresh every 60 seconds to detect new live streams
    refetchInterval: 60000,
    // Keep refetching in background so data stays fresh
    refetchIntervalInBackground: false,
    // Consider data stale after 30 seconds (triggers refetch on window focus)
    staleTime: 30000,
    // Keep cached data while refetching (prevents loading spinner on refresh)
    placeholderData: (previousData) => previousData,
  });
}

export function useStreamByChannel(username: string, platform: Platform) {
  return useQuery({
    queryKey: STREAM_KEYS.byChannel(username, platform),
    queryFn: async () => {
      const response = await window.electronAPI.streams.getByChannel({ username, platform });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedStream;
    },
    enabled: !!username && !!platform,
    refetchInterval: 30000, // Refetch every 30 seconds for real-time viewer count updates
    refetchIntervalInBackground: false, // Don't refetch when tab is not active
    retry: false, // Don't retry - stream might simply be offline
  });
}
