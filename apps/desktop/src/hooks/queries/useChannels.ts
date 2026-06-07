import { useQuery } from "@tanstack/react-query";

import { logger } from "@/renderer/logging/logger";

import type { UnifiedChannel } from "../../backend/api/unified/platform-types";
import type { Platform } from "../../shared/auth-types";

export const CHANNEL_KEYS = {
  all: ["channels"] as const,
  byId: (id: string, platform: Platform) => [...CHANNEL_KEYS.all, "id", platform, id] as const,
  byUsername: (username: string, platform: Platform) =>
    [...CHANNEL_KEYS.all, "username", platform, username] as const,
  followed: (platform?: Platform) => [...CHANNEL_KEYS.all, "followed", platform] as const,
};

export function useFollowedChannels(platform: Platform, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: CHANNEL_KEYS.followed(platform),
    queryFn: async () => {
      const response = await window.electronAPI.channels.getFollowed({ platform });
      if (response.error) {
        logger.warn("Hook:Queries:Channels", "failed to fetch followed channels", {
          platform,
          error: response.error,
        });
        return [];
      }
      return response.data as UnifiedChannel[];
    },
    retry: 1,
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: options.enabled,
  });
}

export function useChannelByUsername(username: string, platform: Platform) {
  return useQuery({
    queryKey: CHANNEL_KEYS.byUsername(username, platform),
    queryFn: async () => {
      const response = await window.electronAPI.channels.getByUsername({ username, platform });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data as UnifiedChannel;
    },
    enabled: !!username && !!platform,
    staleTime: 1000 * 60 * 5,
  });
}
