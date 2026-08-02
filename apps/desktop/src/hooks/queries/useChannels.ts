import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { dedupeChannelsByIdentity } from "@/lib/id-utils";
import { logger } from "@/renderer/logging/logger";
import { useFollowStore } from "@/store/follow-store";

import type { UnifiedChannel } from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";

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
        return [];
      }
      return dedupeChannelsByIdentity(response.data as UnifiedChannel[]);
    },
    retry: 1,
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

export function useChannelByUsername(username: string, platform: Platform) {
  const repairFollowMetadataFromChannel = useFollowStore(
    (state) => state.repairFollowMetadataFromChannel
  );
  const queryKey = CHANNEL_KEYS.byUsername(username, platform);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.channels.getByUsername({ username, platform });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data as UnifiedChannel;
    },
    enabled: !!username && !!platform,
    ...getQueryCacheOptions("followedChannelList"),
  });
  useQueryCachePerformance({
    data: query.data,
    enabled: !!username && !!platform,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "stream-detail",
  });
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    void repairFollowMetadataFromChannel(query.data);
  }, [query.data, query.isPlaceholderData, repairFollowMetadataFromChannel]);
  return query;
}
