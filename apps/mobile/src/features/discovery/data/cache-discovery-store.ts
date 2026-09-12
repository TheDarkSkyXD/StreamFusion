import type { Stream } from "@streamfusion/core/content";
import {
  categorySchema,
  channelSchema,
  clipSchema,
  streamSchema,
  videoSchema,
} from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";

import type {
  CacheProjection,
  SearchCatalogPage,
} from "../capabilities/platform-reads";

const TOP_STREAMS_FRESHNESS_MS = 5 * 60 * 1_000;
const SEARCH_FRESHNESS_MS = 5 * 60 * 1_000;

export function topStreamsCacheKey(
  platform: Platform,
  language?: string,
): string {
  return `discovery:top-streams:${platform}:${language ?? "all"}`;
}

export function searchCacheKey(platform: Platform, query: string): string {
  return `discovery:search:${platform}:${query}`;
}

export function createDiscoveryCacheStore(cache: DisposableCache) {
  return {
    async readTopStreams(
      platform: Platform,
      language?: string,
    ): Promise<
      | { readonly kind: "miss" }
      | {
          readonly kind: "hit";
          readonly cache: CacheProjection;
          readonly items: readonly Stream[];
          readonly cursor?: string;
        }
    > {
      const stored = await cache.get(topStreamsCacheKey(platform, language));
      if (stored.kind === "miss") return { kind: "miss" };
      const parsed = parseTopStreamsPayload(stored.payload);
      if (parsed === null) return { kind: "miss" };
      return {
        cache: {
          ageMilliseconds: stored.ageMilliseconds,
          kind: "hit",
          stale: stored.stale,
        },
        items: parsed.items,
        kind: "hit",
        ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
      };
    },
    async readSearch(
      platform: Platform,
      query: string,
    ): Promise<
      | { readonly kind: "miss" }
      | {
          readonly kind: "hit";
          readonly cache: CacheProjection;
          readonly catalog: SearchCatalogPage;
        }
    > {
      const stored = await cache.get(searchCacheKey(platform, query));
      if (stored.kind === "miss") return { kind: "miss" };
      const catalog = parseSearchPayload(stored.payload);
      if (catalog === null) return { kind: "miss" };
      return {
        cache: {
          ageMilliseconds: stored.ageMilliseconds,
          kind: "hit",
          stale: stored.stale,
        },
        catalog,
        kind: "hit",
      };
    },
    async writeSearch(input: {
      readonly catalog: SearchCatalogPage;
      readonly platform: Platform;
      readonly query: string;
    }): Promise<void> {
      await cache.put({
        freshnessMilliseconds: SEARCH_FRESHNESS_MS,
        key: searchCacheKey(input.platform, input.query),
        payload: JSON.stringify(input.catalog),
      });
    },
    async writeTopStreams(input: {
      readonly cursor?: string;
      readonly items: readonly Stream[];
      readonly language?: string;
      readonly platform: Platform;
    }): Promise<void> {
      await cache.put({
        freshnessMilliseconds: TOP_STREAMS_FRESHNESS_MS,
        key: topStreamsCacheKey(input.platform, input.language),
        payload: JSON.stringify({
          cursor: input.cursor ?? null,
          items: input.items,
        }),
      });
    },
  };
}

function parseTopStreamsPayload(payload: string): {
  readonly cursor?: string;
  readonly items: readonly Stream[];
} | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.items)) return null;
    const items = record.items.filter(streamSchema.is);
    const cursor =
      typeof record.cursor === "string" && record.cursor.length > 0
        ? record.cursor
        : undefined;
    return cursor === undefined ? { items } : { cursor, items };
  } catch {
    return null;
  }
}

function parseSearchPayload(payload: string): SearchCatalogPage | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    return {
      categories: Array.isArray(record.categories)
        ? record.categories.filter(categorySchema.is)
        : [],
      channels: Array.isArray(record.channels)
        ? record.channels.filter(channelSchema.is)
        : [],
      clips: Array.isArray(record.clips)
        ? record.clips.filter(clipSchema.is)
        : [],
      streams: Array.isArray(record.streams)
        ? record.streams.filter(streamSchema.is)
        : [],
      videos: Array.isArray(record.videos)
        ? record.videos.filter(videoSchema.is)
        : [],
    };
  } catch {
    return null;
  }
}
