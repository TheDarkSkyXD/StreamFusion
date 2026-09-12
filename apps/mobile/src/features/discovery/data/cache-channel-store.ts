import type { Channel, Clip, Stream, Video } from "@streamfusion/core/content";
import {
  channelSchema,
  clipSchema,
  streamSchema,
  videoSchema,
} from "@streamfusion/core/content";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";

import type { CacheProjection } from "../capabilities/platform-reads";

const FRESHNESS_MS = 5 * 60 * 1_000;

export function channelCacheKey(channel: ChannelIdentity): string {
  return `discovery:channel:${channel.platform}:${channel.id}:${channel.username}`;
}

export function channelVideosCacheKey(channel: ChannelIdentity): string {
  return `discovery:videos:${channel.platform}:${channel.id}:${channel.username}`;
}

export function channelClipsCacheKey(channel: ChannelIdentity): string {
  return `discovery:clips:${channel.platform}:${channel.id}:${channel.username}`;
}

export function createChannelCacheStore(cache: DisposableCache) {
  return {
    readChannel: (channel: ChannelIdentity) =>
      readRecord(cache, channelCacheKey(channel), parseChannelPayload),
    writeChannel: (input: {
      readonly channel: ChannelIdentity;
      readonly item: Channel;
      readonly live: Stream | null;
    }) =>
      putJson(cache, channelCacheKey(input.channel), {
        item: input.item,
        live: input.live,
      }),
    readVideos: (channel: ChannelIdentity) =>
      readItems(cache, channelVideosCacheKey(channel), videoSchema.is),
    writeVideos: (input: {
      readonly channel: ChannelIdentity;
      readonly items: readonly Video[];
    }) => putJson(cache, channelVideosCacheKey(input.channel), { items: input.items }),
    readClips: (channel: ChannelIdentity) =>
      readItems(cache, channelClipsCacheKey(channel), clipSchema.is),
    writeClips: (input: {
      readonly channel: ChannelIdentity;
      readonly items: readonly Clip[];
    }) => putJson(cache, channelClipsCacheKey(input.channel), { items: input.items }),
  };
}

async function readRecord<T>(
  cache: DisposableCache,
  key: string,
  parse: (payload: string) => T | null,
): Promise<
  | { readonly kind: "miss" }
  | { readonly kind: "hit"; readonly cache: CacheProjection; readonly value: T }
> {
  const stored = await cache.get(key);
  if (stored.kind === "miss") return { kind: "miss" };
  const value = parse(stored.payload);
  if (value === null) return { kind: "miss" };
  return {
    cache: {
      ageMilliseconds: stored.ageMilliseconds,
      kind: "hit",
      stale: stored.stale,
    },
    kind: "hit",
    value,
  };
}

async function readItems<T>(
  cache: DisposableCache,
  key: string,
  isItem: (value: unknown) => value is T,
): Promise<
  | { readonly kind: "miss" }
  | {
      readonly kind: "hit";
      readonly cache: CacheProjection;
      readonly items: readonly T[];
    }
> {
  const stored = await readRecord(cache, key, (payload) =>
    parseItemsPayload(payload, isItem),
  );
  if (stored.kind === "miss") return stored;
  return {
    cache: stored.cache,
    items: stored.value.items,
    kind: "hit",
  };
}

async function putJson(
  cache: DisposableCache,
  key: string,
  payload: unknown,
): Promise<void> {
  await cache.put({
    freshnessMilliseconds: FRESHNESS_MS,
    key,
    payload: JSON.stringify(payload),
  });
}

function parseChannelPayload(payload: string): {
  readonly item: Channel;
  readonly live: Stream | null;
} | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (!channelSchema.is(record.item)) return null;
    if (record.live !== null && !streamSchema.is(record.live)) return null;
    return { item: record.item, live: record.live };
  } catch {
    return null;
  }
}

function parseItemsPayload<T>(
  payload: string,
  isItem: (value: unknown) => value is T,
): { readonly items: readonly T[] } | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.items)) return null;
    return { items: record.items.filter(isItem) };
  } catch {
    return null;
  }
}

export type { Platform };
