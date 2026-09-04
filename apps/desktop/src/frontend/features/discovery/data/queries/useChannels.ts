import { queryOptions, useQuery } from "@tanstack/react-query";

import { dedupeChannelsByIdentity } from "@/lib/id-utils";
import { logger } from "@/renderer/logging/logger";

import type { UnifiedChannel } from "../../../../../shared/platform-types";
import { Platform } from "@streamfusion/core/platform";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";
import { savePersistedChannelMetadata } from "./persisted-channel-lru";

export const CHANNEL_KEYS = {
  all: ["channels"] as const,
  byId: (id: string, platform: Platform) => [...CHANNEL_KEYS.all, "id", platform, id] as const,
  byUsername: (username: string, platform: Platform) =>
    [...CHANNEL_KEYS.all, "username", platform, username.trim().toLowerCase()] as const,
  followed: (platform?: Platform) => [...CHANNEL_KEYS.all, "followed", platform] as const,
};

export function useFollowedChannels(platform: Platform, options: { enabled?: boolean } = {}) {
  const queryKey = CHANNEL_KEYS.followed(platform);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.channels.getFollowed({ platform });
      if (response.error) {
        logger.warn("Hook:Queries:Channels", "failed to fetch followed channels", {
          platform,
          error: response.error,
        });
        throw new Error(response.error);
      }
      return dedupeChannelsByIdentity(response.data as UnifiedChannel[]);
    },
    retry: false,
    enabled: options.enabled,
    ...getQueryCacheOptions("followedChannelList"),
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

export function channelByUsernameQueryOptions(username: string, platform: Platform) {
  return queryOptions({
    queryKey: CHANNEL_KEYS.byUsername(username, platform),
    queryFn: async () => {
      const response = await window.electronAPI.channels.getByUsername({ username, platform });
      if (response.error) {
        throw new Error(response.error);
      }
      const channel = response.data as UnifiedChannel;
      void savePersistedChannelMetadata(channel).catch((error: unknown) => {
        logger.warn("Hook:Queries:Channels", "failed to persist channel metadata", {
          error: error instanceof Error ? error.message : String(error),
          platform,
          username,
        });
      });
      return channel;
    },
    enabled: !!username && !!platform,
    ...getQueryCacheOptions("followedChannelList"),
  });
}

export function useChannelByUsername(username: string, platform: Platform) {
  const queryKey = CHANNEL_KEYS.byUsername(username, platform);
  const query = useQuery(channelByUsernameQueryOptions(username, platform));
  useQueryCachePerformance({
    data: query.data,
    enabled: !!username && !!platform,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "stream-detail",
  });
  return query;
}
