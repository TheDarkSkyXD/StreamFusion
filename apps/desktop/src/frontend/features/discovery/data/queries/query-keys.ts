import type { Platform } from "@streamfusion/core/platform";

/** Query-cache identities shared by data-layer mutation and recovery workflows. */
export const DISCOVERY_CACHE_KEYS = {
  channels: {
    followed: (platform?: Platform) => ["channels", "followed", platform] as const,
  },
  streams: {
    all: ["streams"] as const,
    followed: (platform?: Platform) => ["streams", "followed", platform] as const,
  },
  followedContent: ["followed-content"] as const,
};
