import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { dedupeStreamsByChannelIdentity } from "@/lib/id-utils";
import { logger } from "@/renderer/logging/logger";

import type { UnifiedChannel, UnifiedStream } from "../../../../../shared/platform-types";
import type { Platform } from "../../../../../shared/auth-types";

import { useQueryCachePerformance } from "./cache-performance";
import { getQueryCacheOptions } from "./cache-policy";
import { deletePersistedSnapshot, savePersistedSnapshot } from "./persisted-snapshot";

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

const KICK_FOLLOWED_STATUS_REFETCH_INTERVAL_MS = 60_000;
const KICK_CHANNEL_STATUS_REFETCH_INTERVAL_MS = 10_000;

class StreamStatusRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("Stream status refresh paused for platform rate limit");
    this.name = "StreamStatusRateLimitError";
  }
}

export function removeFollowedStreamFromCache(
  client: QueryClient,
  platform: Platform,
  channelName: string
): void {
  const normalizedChannelName = channelName.trim().toLowerCase();
  for (const queryKey of [STREAM_KEYS.followed(platform), STREAM_KEYS.followed()]) {
    client.setQueryData<UnifiedStream[] | undefined>(queryKey, (streams) =>
      streams?.filter(
        (stream) =>
          stream.platform !== platform ||
          stream.channelName.trim().toLowerCase() !== normalizedChannelName
      )
    );
  }
}

export interface FollowedStreamSnapshotIdentity {
  platform: Platform | "all";
  twitchUserId: string;
  kickUserId: string;
  follows: readonly string[];
}

export function createFollowedStreamSnapshotIdentity(
  platform: Platform | undefined,
  twitchUserId: string,
  kickUserId: string,
  follows: ReadonlyArray<Pick<UnifiedChannel, "platform" | "id">>
): FollowedStreamSnapshotIdentity {
  return {
    platform: platform ?? "all",
    twitchUserId,
    kickUserId,
    follows: follows.map((follow) => `${follow.platform}:${follow.id}`).sort(),
  };
}

export function useTopStreams(platform?: Platform, limit: number = 20) {
  const queryKey = STREAM_KEYS.top(platform, limit);
  const snapshotSlot = `top-streams:${platform ?? "all"}`;
  const snapshotIdentity = { platform: platform ?? "all", limit } as const;
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.streams.getTop({ platform, limit });
      if (!response.success) throw new Error(response.error);
      const persistence =
        response.data.length > 0
          ? savePersistedSnapshot(snapshotSlot, snapshotIdentity, response.data)
          : deletePersistedSnapshot(snapshotSlot);
      void persistence.catch((error: unknown) => {
        logger.warn("Hook:Queries:Streams", "failed to persist top streams", {
          error: error instanceof Error ? error.message : String(error),
          platform: platform ?? "all",
        });
      });
      return response.data;
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
      if (!response.success) throw new Error(response.error);
      return response.data;
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
  options: { enabled?: boolean; snapshotIdentity?: FollowedStreamSnapshotIdentity } = {}
) {
  const queryKey = STREAM_KEYS.followed(platform);
  const isEnabled = options.enabled !== false;
  const snapshotIdentityKey = options.snapshotIdentity
    ? JSON.stringify(options.snapshotIdentity)
    : undefined;
  const successfulResultRef = useRef<
    | {
        data: UnifiedStream[];
        sourceIdentityKey?: string;
        persistedIdentityKey?: string;
      }
    | undefined
  >(undefined);
  const cacheOptions = getQueryCacheOptions("followedStreamStatus");
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const sourceIdentityKey = snapshotIdentityKey;
      const response = await window.electronAPI.streams.getFollowed({ platform, limit });
      signal.throwIfAborted();
      if (response.error) {
        logger.warn("Hook:Queries:Streams", "failed to fetch followed streams", {
          error: response.error,
        });
        throw new Error(response.error);
      }
      const streams = dedupeStreamsByChannelIdentity(response.data as UnifiedStream[]);
      successfulResultRef.current = {
        data: streams,
        sourceIdentityKey,
      };
      return streams;
    },
    enabled: isEnabled,
    ...cacheOptions,
    refetchInterval:
      platform === "kick" ? KICK_FOLLOWED_STATUS_REFETCH_INTERVAL_MS : cacheOptions.refetchInterval,
  });
  const { refetch } = query;

  useEffect(() => {
    const successfulResult = successfulResultRef.current;
    const snapshotIdentity = options.snapshotIdentity;
    if (!query.dataUpdatedAt || !snapshotIdentity || !snapshotIdentityKey || !successfulResult)
      return;
    if (
      successfulResult.sourceIdentityKey !== undefined &&
      successfulResult.sourceIdentityKey !== snapshotIdentityKey
    )
      return;
    if (successfulResult.persistedIdentityKey === snapshotIdentityKey) return;

    successfulResult.persistedIdentityKey = snapshotIdentityKey;
    const slot = `followed-streams:${platform ?? "all"}`;
    const persistence =
      successfulResult.data.length > 0
        ? savePersistedSnapshot(slot, snapshotIdentity, successfulResult.data)
        : deletePersistedSnapshot(slot);
    void persistence.catch((error) => {
      logger.warn("Hook:Queries:Streams", "failed to persist followed streams", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [options.snapshotIdentity, platform, query.dataUpdatedAt, snapshotIdentityKey]);

  const lastSettledIdentityKeyRef = useRef<string | undefined>(undefined);
  const pendingIdentityRefreshRef = useRef(false);
  useEffect(() => {
    if (!snapshotIdentityKey) return;
    const previousIdentityKey = lastSettledIdentityKeyRef.current;
    lastSettledIdentityKeyRef.current = snapshotIdentityKey;
    const identityChanged =
      previousIdentityKey !== undefined && previousIdentityKey !== snapshotIdentityKey;
    if (!isEnabled) {
      pendingIdentityRefreshRef.current ||= identityChanged;
      return;
    }
    if (!identityChanged && !pendingIdentityRefreshRef.current) return;

    pendingIdentityRefreshRef.current = false;
    void refetch();
  }, [isEnabled, refetch, snapshotIdentityKey]);

  useQueryCachePerformance({
    data: query.data,
    enabled: isEnabled,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "following",
  });
  return query;
}

export function getStreamByChannelQueryOptions(username: string, platform: Platform) {
  const queryKey = STREAM_KEYS.byChannel(username, platform);
  const cacheOptions = getQueryCacheOptions("streamChannelDetail");
  return queryOptions({
    queryKey,
    queryFn: async () => {
      const response = await window.electronAPI.streams.getByChannel({ username, platform });
      if (!response.success) {
        if (response.retryAfterMs !== undefined) {
          throw new StreamStatusRateLimitError(response.retryAfterMs);
        }
        throw new Error(response.error);
      }
      return response.data;
    },
    enabled: !!username && !!platform,
    ...cacheOptions,
    refetchInterval:
      platform === "kick"
        ? (query) =>
            query.state.error instanceof StreamStatusRateLimitError
              ? Math.max(KICK_CHANNEL_STATUS_REFETCH_INTERVAL_MS, query.state.error.retryAfterMs)
              : KICK_CHANNEL_STATUS_REFETCH_INTERVAL_MS
        : cacheOptions.refetchInterval,
    retry: false, // Don't retry - stream might simply be offline
  });
}

export function useStreamByChannel(username: string, platform: Platform) {
  const queryKey = STREAM_KEYS.byChannel(username, platform);
  const query = useQuery(getStreamByChannelQueryOptions(username, platform));
  useQueryCachePerformance({
    data: query.data,
    enabled: !!username && !!platform,
    fetchStatus: query.fetchStatus,
    queryKey,
    surface: "stream-detail",
  });
  return query;
}
