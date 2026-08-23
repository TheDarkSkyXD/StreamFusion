import { useEffect, useSyncExternalStore } from "react";

import type {
  UnifiedCategory,
  UnifiedChannel,
  UnifiedClip,
  UnifiedStream,
  UnifiedVideo,
} from "@/backend/api/unified/platform-types";
import { normalizeSearchQuery } from "@/search/search-normalization";
import {
  isValidUnifiedCategory,
  isValidUnifiedChannel,
  isValidUnifiedClip,
  isValidUnifiedStream,
  isValidUnifiedVideo,
  type SearchResultCollection,
} from "@/search/search-result-validation";
import type { Platform } from "@/shared/auth-types";

export interface PersistedSearchResultEntry {
  query: string;
  platform?: Platform;
  limit: number;
  savedAt: number;
  data: SearchResultCollection;
}

interface PersistedSearchResultsLru {
  version: 1;
  entries: PersistedSearchResultEntry[];
}

const STORE_KEY = "search-results-lru:v1";
const MAX_ENTRIES = 40;
const MAX_BYTES = 2_000_000;

let entries = new Map<string, PersistedSearchResultEntry>();
let hydrationPromise: Promise<void> | undefined;
let hydrated = false;
let persistQueue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function keyFor(query: string, platform: Platform | undefined, limit: number): string {
  return JSON.stringify([normalizeSearchQuery(query), platform ?? "all", limit]);
}

function publicChannel(item: UnifiedChannel): UnifiedChannel {
  return {
    id: item.id,
    platform: item.platform,
    username: item.username,
    displayName: item.displayName,
    avatarUrl: item.avatarUrl,
    isLive: item.isLive,
    isVerified: item.isVerified,
    isPartner: item.isPartner,
    ...(typeof item.bannerUrl === "string" ? { bannerUrl: item.bannerUrl } : {}),
    ...(typeof item.bio === "string" ? { bio: item.bio } : {}),
    ...(typeof item.accountStatus === "string" ? { accountStatus: item.accountStatus } : {}),
    ...(typeof item.followerCount === "number" ? { followerCount: item.followerCount } : {}),
    ...(typeof item.categoryId === "string" ? { categoryId: item.categoryId } : {}),
    ...(typeof item.categoryName === "string" ? { categoryName: item.categoryName } : {}),
    ...(typeof item.lastStreamTitle === "string" ? { lastStreamTitle: item.lastStreamTitle } : {}),
  };
}

function publicCategory(item: UnifiedCategory): UnifiedCategory {
  return {
    id: item.id,
    platform: item.platform,
    name: item.name,
    boxArtUrl: item.boxArtUrl,
    ...(typeof item.viewerCount === "number" ? { viewerCount: item.viewerCount } : {}),
    ...(item.tags ? { tags: item.tags } : {}),
    ...(typeof item.slug === "string" ? { slug: item.slug } : {}),
    ...(typeof item.crossPlatformId === "string" ? { crossPlatformId: item.crossPlatformId } : {}),
    ...(typeof item.crossPlatformName === "string"
      ? { crossPlatformName: item.crossPlatformName }
      : {}),
  };
}

function publicStream(item: UnifiedStream): UnifiedStream {
  return {
    id: item.id,
    platform: item.platform,
    channelId: item.channelId,
    channelName: item.channelName,
    channelDisplayName: item.channelDisplayName,
    channelAvatar: item.channelAvatar,
    title: item.title,
    viewerCount: item.viewerCount,
    thumbnailUrl: item.thumbnailUrl,
    isLive: item.isLive,
    startedAt: item.startedAt,
    language: item.language,
    tags: item.tags,
    ...(typeof item.categoryId === "string" ? { categoryId: item.categoryId } : {}),
    ...(typeof item.categoryName === "string" ? { categoryName: item.categoryName } : {}),
    ...(typeof item.isMature === "boolean" ? { isMature: item.isMature } : {}),
    ...(typeof item.channelIsVerified === "boolean"
      ? { channelIsVerified: item.channelIsVerified }
      : {}),
  };
}

function publicVideo(item: UnifiedVideo): UnifiedVideo {
  return {
    id: item.id,
    platform: item.platform,
    channelId: item.channelId,
    channelName: item.channelName,
    channelDisplayName: item.channelDisplayName,
    channelAvatar: item.channelAvatar,
    title: item.title,
    ...(typeof item.description === "string" ? { description: item.description } : {}),
    thumbnailUrl: item.thumbnailUrl,
    duration: item.duration,
    viewCount: item.viewCount,
    publishedAt: item.publishedAt,
    url: item.url,
    ...(typeof item.shareUrl === "string" ? { shareUrl: item.shareUrl } : {}),
    type: item.type,
  };
}

function publicClip(item: UnifiedClip): UnifiedClip {
  return {
    id: item.id,
    platform: item.platform,
    channelId: item.channelId,
    channelName: item.channelName,
    channelDisplayName: item.channelDisplayName,
    channelAvatar: item.channelAvatar,
    title: item.title,
    thumbnailUrl: item.thumbnailUrl,
    clipUrl: item.clipUrl,
    embedUrl: item.embedUrl,
    duration: item.duration,
    viewCount: item.viewCount,
    createdAt: item.createdAt,
    creatorName: item.creatorName,
    ...(typeof item.shareUrl === "string" ? { shareUrl: item.shareUrl } : {}),
    ...(typeof item.gameId === "string" ? { gameId: item.gameId } : {}),
    ...(typeof item.gameName === "string" ? { gameName: item.gameName } : {}),
  };
}

function collection<T>(
  value: unknown,
  isValid: (item: unknown) => item is T,
  project: (item: T) => T
): T[] | null {
  if (!Array.isArray(value) || !value.every(isValid)) return null;
  return value.map(project);
}

export function sanitizePersistedSearchResult(
  value: unknown
): SearchResultCollection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Partial<Record<keyof SearchResultCollection, unknown>>;
  const channels = collection(data.channels, isValidUnifiedChannel, publicChannel);
  const categories = collection(data.categories, isValidUnifiedCategory, publicCategory);
  const streams = collection(data.streams, isValidUnifiedStream, publicStream);
  const videos = collection(data.videos, isValidUnifiedVideo, publicVideo);
  const clips = collection(data.clips, isValidUnifiedClip, publicClip);
  if (!channels || !categories || !streams || !videos || !clips) return undefined;
  if (channels.length + categories.length + streams.length + videos.length + clips.length === 0)
    return undefined;
  return { channels, categories, streams, videos, clips };
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function bounded(values: PersistedSearchResultEntry[]): PersistedSearchResultEntry[] {
  const result: PersistedSearchResultEntry[] = [];
  const seen = new Set<string>();
  for (const entry of values.toSorted((a, b) => b.savedAt - a.savedAt)) {
    const key = keyFor(entry.query, entry.platform, entry.limit);
    if (seen.has(key) || result.length >= MAX_ENTRIES) continue;
    const candidate = [...result, entry];
    if (bytes({ version: 1, entries: candidate }) > MAX_BYTES) break;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function validEntry(value: unknown, now: number): PersistedSearchResultEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<PersistedSearchResultEntry>;
  const query = typeof entry.query === "string" ? normalizeSearchQuery(entry.query) : "";
  const data = sanitizePersistedSearchResult(entry.data);
  if (
    !query ||
    (entry.platform !== undefined && entry.platform !== "twitch" && entry.platform !== "kick") ||
    !Number.isInteger(entry.limit) ||
    (entry.limit ?? 0) <= 0 ||
    typeof entry.savedAt !== "number" ||
    entry.savedAt > now ||
    !data
  )
    return null;
  return { query, platform: entry.platform, limit: entry.limit!, savedAt: entry.savedAt, data };
}

function publish(values: PersistedSearchResultEntry[]): void {
  entries = new Map(
    values.map((entry) => [keyFor(entry.query, entry.platform, entry.limit), entry])
  );
  for (const listener of listeners) listener();
}

export function hydratePersistedSearchResultsLru(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = window.electronAPI.store
    .get(STORE_KEY)
    .then((stored) => {
      const now = Date.now();
      publish(
        stored !== null &&
          typeof stored === "object" &&
          "version" in stored &&
          stored.version === 1 &&
          "entries" in stored &&
          Array.isArray(stored.entries)
          ? bounded(
              stored.entries.flatMap((entry) => {
                const valid = validEntry(entry, now);
                return valid ? [valid] : [];
              })
            )
          : []
      );
    })
    .catch(() => publish([]))
    .finally(() => {
      hydrated = true;
    });
  return hydrationPromise;
}

export function getPersistedSearchResultEntries(): PersistedSearchResultEntry[] {
  return [...entries.values()];
}

export function getPersistedSearchResult(
  query: string,
  platform: Platform | undefined,
  limit: number
): SearchResultCollection | undefined {
  return entries.get(keyFor(query, platform, limit))?.data;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePersistedSearchResult(
  query: string,
  platform: Platform | undefined,
  limit: number,
  enabled: boolean
): SearchResultCollection | undefined {
  const normalized = normalizeSearchQuery(query);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => getPersistedSearchResult(normalized, platform, limit),
    () => undefined
  );
  useEffect(() => {
    if (enabled && normalized) void hydratePersistedSearchResultsLru();
  }, [enabled, normalized]);
  return snapshot;
}

export function savePersistedSearchResult(
  query: string,
  platform: Platform | undefined,
  limit: number,
  value: SearchResultCollection,
  shouldPersist: () => boolean = () => true
): Promise<boolean> {
  const normalized = normalizeSearchQuery(query);
  const data = sanitizePersistedSearchResult(value);
  if (!normalized || !data) return Promise.resolve(false);
  const save = persistQueue
    .catch(() => undefined)
    .then(async (): Promise<boolean> => {
      await hydratePersistedSearchResultsLru();
      if (!shouldPersist()) return false;
      const next = bounded([
        { query: normalized, platform, limit, savedAt: Date.now(), data },
        ...entries.values(),
      ]);
      await window.electronAPI.store.set(STORE_KEY, { version: 1, entries: next });
      publish(next);
      return true;
    });
  persistQueue = save;
  return save;
}

export function resetPersistedSearchResultsLruForTests(): void {
  entries = new Map();
  hydrationPromise = undefined;
  hydrated = false;
  persistQueue = Promise.resolve();
  listeners.clear();
}
