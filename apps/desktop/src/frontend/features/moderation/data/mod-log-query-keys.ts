import type { Platform } from "@shared/auth-types";

export const MOD_LOG_QUERY_KEYS = {
  all: ["modLog"] as const,
  channel: (platform: Platform, channelId: string) =>
    [...MOD_LOG_QUERY_KEYS.all, platform, channelId] as const,
};
