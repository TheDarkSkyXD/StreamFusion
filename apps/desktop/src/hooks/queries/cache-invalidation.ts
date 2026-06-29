import type { QueryClient } from "@tanstack/react-query";

import type { Platform } from "@/shared/auth-types";

import { measureCacheInvalidationDispatch } from "./cache-performance";
import { CHANNEL_KEYS } from "./useChannels";
import { FOLLOWED_CONTENT_KEYS } from "./useFollowedContent";
import { STREAM_KEYS } from "./useStreams";

type CacheInvalidationClient = Pick<QueryClient, "invalidateQueries" | "removeQueries">;

function invalidateFollowedStreams(client: CacheInvalidationClient, platform: Platform): void {
  client.invalidateQueries({ queryKey: STREAM_KEYS.followed(platform) });
  client.invalidateQueries({ queryKey: STREAM_KEYS.followed() });
}

function removeFollowedStreams(client: CacheInvalidationClient, platform: Platform): void {
  client.removeQueries({ queryKey: STREAM_KEYS.followed(platform) });
  client.removeQueries({ queryKey: STREAM_KEYS.followed() });
}

export function invalidateFollowCachesAfterMutation(
  client: CacheInvalidationClient,
  platform: Platform
): void {
  measureCacheInvalidationDispatch(`follow-mutation:${platform}`, () => {
    client.invalidateQueries({ queryKey: CHANNEL_KEYS.followed(platform) });
    invalidateFollowedStreams(client, platform);
    client.invalidateQueries({ queryKey: FOLLOWED_CONTENT_KEYS.all });
  });
}

export function removePlatformAccountCaches(
  client: CacheInvalidationClient,
  platform: Platform
): void {
  measureCacheInvalidationDispatch(`account-cache-remove:${platform}`, () => {
    client.removeQueries({ queryKey: CHANNEL_KEYS.followed(platform) });
    removeFollowedStreams(client, platform);
    client.removeQueries({ queryKey: FOLLOWED_CONTENT_KEYS.all });
  });
}

export function invalidatePlatformRecoveryCaches(
  client: CacheInvalidationClient,
  platform: Platform
): void {
  measureCacheInvalidationDispatch(`platform-recovery:${platform}`, () => {
    client.invalidateQueries({
      queryKey: STREAM_KEYS.all,
      predicate: (query) => {
        const key = query.queryKey;
        if (key[0] !== STREAM_KEYS.all[0]) return false;
        return key.includes(platform) || key.includes(undefined);
      },
    });
  });
}
