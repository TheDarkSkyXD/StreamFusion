import type { QueryClient } from "@tanstack/react-query";

import type { UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import { channelsMatch } from "@/lib/id-utils";
import type { Platform } from "@shared/auth-types";

import { measureCacheInvalidationDispatch } from "./cache-performance";
import { CHANNEL_KEYS } from "./useChannels";
import { FOLLOWED_CONTENT_KEYS } from "./useFollowedContent";
import { STREAM_KEYS } from "./useStreams";

type CacheInvalidationClient = Pick<QueryClient, "invalidateQueries" | "removeQueries">;
type AuthoritativeFollowCacheClient = Pick<
  QueryClient,
  "invalidateQueries" | "removeQueries" | "setQueryData" | "setQueriesData"
>;

function isStreamStillFollowed(
  stream: UnifiedStream,
  platform: Platform,
  authoritativeChannels: readonly UnifiedChannel[]
): boolean {
  if (stream.platform !== platform) return true;
  return authoritativeChannels.some((channel) =>
    channelsMatch(channel, {
      id: stream.channelId,
      platform: stream.platform,
      username: stream.channelName,
    })
  );
}

function filterFollowedStreamCache(
  cached: unknown,
  platform: Platform,
  authoritativeChannels: readonly UnifiedChannel[]
): unknown {
  if (Array.isArray(cached)) {
    return (cached as UnifiedStream[]).filter((stream) =>
      isStreamStillFollowed(stream, platform, authoritativeChannels)
    );
  }

  if (!cached || typeof cached !== "object" || !("pages" in cached)) return cached;
  const pages = (cached as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return cached;

  return {
    ...cached,
    pages: pages.map((page) => {
      if (!page || typeof page !== "object" || !("data" in page)) return page;
      const data = (page as { data?: unknown }).data;
      if (!Array.isArray(data)) return page;
      return {
        ...page,
        data: filterFollowedStreamCache(data, platform, authoritativeChannels),
      };
    }),
  };
}

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

export function applyAuthoritativeFollowCaches(
  client: AuthoritativeFollowCacheClient,
  platform: Platform,
  authoritativeChannels: readonly UnifiedChannel[]
): void {
  client.setQueryData(CHANNEL_KEYS.followed(platform), authoritativeChannels);
  client.setQueriesData(
    { queryKey: [...STREAM_KEYS.all, "followed"] },
    (cached) => filterFollowedStreamCache(cached, platform, authoritativeChannels)
  );
  invalidateFollowCachesAfterMutation(client, platform);
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
