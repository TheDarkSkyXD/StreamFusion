import type { Stream } from "@streamfusion/core/content";
import { streamSchema } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";

import type { FollowedReadOutcome } from "../capabilities/following-session";

const LIVE_FRESHNESS_MS = 5 * 60 * 1_000;

export function followedLiveCacheKey(platform: Platform): string {
  return `follows:live:${platform}`;
}

export function createFollowedLiveCache(cache: DisposableCache) {
  return {
    async read(platform: Platform): Promise<FollowedReadOutcome<Stream> | null> {
      const stored = await cache.get(followedLiveCacheKey(platform));
      if (stored.kind === "miss") return null;
      const items = parseStreams(stored.payload);
      if (items === null) return null;
      return {
        items,
        missing: [],
        offline: false,
        platform,
        retryable: true,
        stale: stored.stale,
        status: "stale",
      };
    },
    async write(
      platform: Platform,
      items: readonly Stream[],
    ): Promise<void> {
      if (items.length === 0) return;
      await cache.put({
        freshnessMilliseconds: LIVE_FRESHNESS_MS,
        key: followedLiveCacheKey(platform),
        payload: JSON.stringify(items),
      });
    },
  };
}

function parseStreams(payload: string): readonly Stream[] | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (!Array.isArray(value)) return null;
    const items = value.filter(streamSchema.is);
    return items.length === value.length ? items : null;
  } catch {
    return null;
  }
}
