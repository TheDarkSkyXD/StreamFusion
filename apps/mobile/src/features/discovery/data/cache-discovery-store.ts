import type { Category, Stream } from "@streamfusion/core/content";
import { categorySchema, streamSchema } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type { DisposableCache } from "@mobile/features/storage/capabilities/persistence";

import type { CacheProjection } from "../capabilities/platform-reads";

const TOP_STREAMS_FRESHNESS_MS = 5 * 60 * 1_000;

export function topStreamsCacheKey(
  platform: Platform,
  language?: string,
): string {
  return `discovery:top-streams:${platform}:${language ?? "all"}`;
}

export function categoriesCacheKey(platform: Platform): string {
  return `discovery:categories:${platform}`;
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
    async readCategories(platform: Platform): Promise<
      | { readonly kind: "miss" }
      | {
          readonly kind: "hit";
          readonly cache: CacheProjection;
          readonly items: readonly Category[];
          readonly cursor?: string;
        }
    > {
      const stored = await cache.get(categoriesCacheKey(platform));
      if (stored.kind === "miss") return { kind: "miss" };
      const parsed = parseCategoryPayload(stored.payload);
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
    async writeCategories(input: {
      readonly cursor?: string;
      readonly items: readonly Category[];
      readonly platform: Platform;
    }): Promise<void> {
      await cache.put({
        freshnessMilliseconds: TOP_STREAMS_FRESHNESS_MS,
        key: categoriesCacheKey(input.platform),
        payload: JSON.stringify({
          cursor: input.cursor ?? null,
          items: input.items,
        }),
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

function parseCategoryPayload(payload: string): {
  readonly cursor?: string;
  readonly items: readonly Category[];
} | null {
  return parseCachedItems(payload, categorySchema.is);
}

function parseTopStreamsPayload(payload: string): {
  readonly cursor?: string;
  readonly items: readonly Stream[];
} | null {
  return parseCachedItems(payload, streamSchema.is);
}

function parseCachedItems<T>(
  payload: string,
  isItem: (value: unknown) => value is T,
): {
  readonly cursor?: string;
  readonly items: readonly T[];
} | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.items)) return null;
    const items = record.items.filter(isItem);
    const cursor =
      typeof record.cursor === "string" && record.cursor.length > 0
        ? record.cursor
        : undefined;
    return cursor === undefined ? { items } : { cursor, items };
  } catch {
    return null;
  }
}
