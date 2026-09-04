import type { InfiniteData } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedVideo,
} from "@shared/platform-types";
import { logger } from "@/renderer/logging/logger";
import { normalizeSearchQuery } from "@streamfusion/core/discovery";
import {
  normalizeUnifiedCategory,
  normalizeUnifiedChannel,
  normalizeUnifiedClip,
  normalizeUnifiedVideo,
} from "@/features/discovery/utils/search/search-result-validation";
import { Platform } from "@streamfusion/core/platform";

export type PersistedSearchKind = "categories" | "channels" | "clips" | "videos";
export type PersistedSearchItem = UnifiedCategory | UnifiedChannel | UnifiedClip | UnifiedVideo;
export interface PersistedSearchPage<T extends PersistedSearchItem = PersistedSearchItem> {
  data: T[];
  cursor?: string | null;
}
export type PersistedInfiniteSearchData<T extends PersistedSearchItem = PersistedSearchItem> =
  InfiniteData<PersistedSearchPage<T>, string | undefined>;

export interface PersistedSearchEntry {
  kind: PersistedSearchKind;
  query: string;
  platform?: Platform;
  liveOnly?: boolean;
  limit: number;
  savedAt: number;
  data: PersistedInfiniteSearchData;
}

interface PersistedSearchLru {
  version: 1;
  entries: PersistedSearchEntry[];
}

const STORE_KEY = "search-query-lru:v1";
const MAX_ENTRIES = 40;
const MAX_BYTES = 1_500_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let entries = new Map<string, PersistedSearchEntry>();
let hydrationPromise: Promise<void> | undefined;
let hydrated = false;
let persistQueue = Promise.resolve();
const listeners = new Set<() => void>();

function persistedKindLabel(kind: PersistedSearchKind): string {
  if (kind === "channels") return "Channel";
  if (kind === "categories") return "Category";
  if (kind === "clips") return "Clip";
  return "Video";
}

export function normalizePersistedSearchQuery(query: string): string {
  return normalizeSearchQuery(query);
}

function entryKey(
  kind: PersistedSearchKind,
  query: string,
  platform: Platform | undefined,
  limit: number,
  liveOnly: boolean = false
): string {
  return JSON.stringify([
    kind,
    normalizePersistedSearchQuery(query),
    platform ?? "all",
    kind === "channels" ? liveOnly : false,
    limit,
  ]);
}

function isValidEntry(value: unknown, now: number): value is PersistedSearchEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PersistedSearchEntry>;
  const firstPage = entry.data?.pages?.[0];
  return (
    (entry.kind === "channels" ||
      entry.kind === "categories" ||
      entry.kind === "clips" ||
      entry.kind === "videos") &&
    typeof entry.query === "string" &&
    entry.query.length > 0 &&
    (entry.platform === undefined || entry.platform === "twitch" || entry.platform === "kick") &&
    (entry.liveOnly === undefined || typeof entry.liveOnly === "boolean") &&
    typeof entry.limit === "number" &&
    Number.isInteger(entry.limit) &&
    entry.limit > 0 &&
    typeof entry.savedAt === "number" &&
    now - entry.savedAt <= MAX_AGE_MS &&
    now >= entry.savedAt &&
    Array.isArray(entry.data?.pages) &&
    entry.data.pages.length === 1 &&
    Array.isArray(entry.data.pageParams) &&
    entry.data.pageParams.length === 1 &&
    Array.isArray(firstPage?.data) &&
    firstPage.data.length > 0
  );
}

function boundedEntries(values: PersistedSearchEntry[]): PersistedSearchEntry[] {
  const bounded: PersistedSearchEntry[] = [];
  for (const entry of values.toSorted((a, b) => b.savedAt - a.savedAt)) {
    if (bounded.length >= MAX_ENTRIES) break;
    const candidate = [...bounded, entry];
    if (JSON.stringify({ version: 1, entries: candidate }).length > MAX_BYTES) break;
    bounded.push(entry);
  }
  return bounded;
}

function sanitizeSearchEntry(
  entry: PersistedSearchEntry,
  message: string
): PersistedSearchEntry | null {
  const raw = entry.data.pages[0]?.data ?? [];
  const items = raw.flatMap((item) => {
    const normalized =
      entry.kind === "channels"
        ? normalizeUnifiedChannel(item)
        : entry.kind === "categories"
          ? normalizeUnifiedCategory(item)
          : entry.kind === "clips"
            ? normalizeUnifiedClip(item)
            : normalizeUnifiedVideo(item);
    return normalized ? [normalized] : [];
  });
  const rejectedCount = raw.length - items.length;
  if (rejectedCount > 0) {
    logger.warn("Hook:Queries:Search", message, { rejectedCount });
  }
  if (items.length === 0) return null;
  return {
    ...entry,
    data: {
      pages: [{ ...entry.data.pages[0], data: items }],
      pageParams: [undefined],
    },
  };
}

function publish(nextEntries: PersistedSearchEntry[]): void {
  entries = new Map(
    nextEntries.map((entry) => [
      entryKey(entry.kind, entry.query, entry.platform, entry.limit, entry.liveOnly),
      entry,
    ])
  );
  for (const listener of listeners) listener();
}

export function hydratePersistedSearchLru(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = window.electronAPI.store
    .get(STORE_KEY)
    .then((stored) => {
      const now = Date.now();
      const valid =
        stored !== null &&
        typeof stored === "object" &&
        "version" in stored &&
        stored.version === 1 &&
        "entries" in stored &&
        Array.isArray(stored.entries)
          ? boundedEntries(
              stored.entries
                .filter((entry) => isValidEntry(entry, now))
                .flatMap((entry) => {
                  const sanitized = sanitizeSearchEntry(
                    entry,
                    `Rejected malformed persisted ${persistedKindLabel(entry.kind)} items`
                  );
                  return sanitized ? [sanitized] : [];
                })
            )
          : [];
      publish(valid);
    })
    .catch(() => publish([]))
    .finally(() => {
      hydrated = true;
    });
  return hydrationPromise;
}

export function getPersistedSearchEntries(): PersistedSearchEntry[] {
  return [...entries.values()];
}

export function getPersistedSearchPage<T extends PersistedSearchItem>(
  kind: PersistedSearchKind,
  query: string,
  platform: Platform | undefined,
  limit: number,
  liveOnly: boolean = false
): PersistedInfiniteSearchData<T> | undefined {
  const entry = entries.get(entryKey(kind, query, platform, limit, liveOnly));
  return entry?.data as PersistedInfiniteSearchData<T> | undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePersistedSearchPage<T extends PersistedSearchItem>(
  kind: PersistedSearchKind,
  query: string,
  platform: Platform | undefined,
  limit: number,
  enabled: boolean,
  liveOnly: boolean = false
): PersistedInfiniteSearchData<T> | undefined {
  const normalizedQuery = normalizePersistedSearchQuery(query);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => getPersistedSearchPage<T>(kind, normalizedQuery, platform, limit, liveOnly),
    () => undefined
  );

  useEffect(() => {
    if (enabled && normalizedQuery.length > 0) void hydratePersistedSearchLru();
  }, [enabled, normalizedQuery]);

  return snapshot;
}

export function savePersistedSearchPage<T extends PersistedSearchItem>(
  kind: PersistedSearchKind,
  query: string,
  platform: Platform | undefined,
  limit: number,
  data: PersistedInfiniteSearchData<T>,
  liveOnly: boolean = false
): Promise<void> {
  const normalizedQuery = normalizePersistedSearchQuery(query);
  const firstPage = data.pages[0];
  if (!normalizedQuery || !firstPage) return Promise.resolve();

  persistQueue = persistQueue
    .catch(() => undefined)
    .then(async () => {
      await hydratePersistedSearchLru();
      const key = entryKey(kind, normalizedQuery, platform, limit, liveOnly);
      if (firstPage.data.length === 0) {
        const bounded = boundedEntries(
          [...entries.values()].filter(
            (entry) =>
              entryKey(entry.kind, entry.query, entry.platform, entry.limit, entry.liveOnly) !== key
          )
        );
        publish(bounded);
        await window.electronAPI.store.set(STORE_KEY, { version: 1, entries: bounded });
        return;
      }
      const nextEntry: PersistedSearchEntry = {
        kind,
        query: normalizedQuery,
        platform,
        liveOnly: kind === "channels" ? liveOnly : undefined,
        limit,
        savedAt: Date.now(),
        data: {
          pages: [{ data: firstPage.data, cursor: firstPage.cursor }],
          pageParams: [undefined],
        },
      };
      const sanitizedEntry = sanitizeSearchEntry(
        nextEntry,
        `Rejected malformed ${persistedKindLabel(kind)} items before persistence`
      );
      if (!sanitizedEntry) return;
      const next = [
        sanitizedEntry,
        ...[...entries.values()].filter(
          (entry) =>
            entryKey(entry.kind, entry.query, entry.platform, entry.limit, entry.liveOnly) !== key
        ),
      ];
      const bounded = boundedEntries(next);
      publish(bounded);
      await window.electronAPI.store.set(STORE_KEY, { version: 1, entries: bounded });
    });
  return persistQueue;
}

export function resetPersistedSearchLruForTests(): void {
  entries = new Map();
  hydrationPromise = undefined;
  hydrated = false;
  persistQueue = Promise.resolve();
  listeners.clear();
}
