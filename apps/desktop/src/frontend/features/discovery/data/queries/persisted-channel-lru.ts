import type { UnifiedChannel } from "@shared/platform-types";
import { Platform } from "@streamfusion/core/platform";

export interface PersistedChannelEntry {
  platform: Platform;
  username: string;
  savedAt: number;
  data: UnifiedChannel;
}

interface PersistedChannelLru {
  version: 1;
  entries: PersistedChannelEntry[];
}

const STORE_KEY = "channel-metadata-lru:v1";
const MAX_ENTRIES = 40;
const MAX_BYTES = 500_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const PERSISTED_CHANNEL_LRU_LIMITS = {
  maxEntries: MAX_ENTRIES,
  maxBytes: MAX_BYTES,
  maxAgeMs: MAX_AGE_MS,
} as const;

let entries = new Map<string, PersistedChannelEntry>();
let hydrationPromise: Promise<void> | undefined;
let hydrated = false;
let persistQueue = Promise.resolve();

export function normalizePersistedChannelUsername(username: string): string {
  return username.trim().toLowerCase();
}

function entryKey(platform: Platform, username: string): string {
  return `${platform}:${normalizePersistedChannelUsername(username)}`;
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isUsableChannel(
  value: unknown,
  platform: Platform,
  normalizedUsername: string
): value is UnifiedChannel {
  if (!value || typeof value !== "object") return false;
  const channel = value as Partial<UnifiedChannel>;
  if (
    channel.platform !== platform ||
    typeof channel.id !== "string" ||
    channel.id.length === 0 ||
    typeof channel.username !== "string" ||
    normalizePersistedChannelUsername(channel.username) !== normalizedUsername ||
    typeof channel.displayName !== "string" ||
    typeof channel.avatarUrl !== "string" ||
    typeof channel.isLive !== "boolean" ||
    typeof channel.isVerified !== "boolean" ||
    typeof channel.isPartner !== "boolean"
  ) {
    return false;
  }

  // A Kick snapshot without its Pusher room cannot make chat ready on click,
  // so do not let an incomplete response displace a previously usable entry.
  return (
    platform !== "kick" ||
    (typeof channel.chatroomId === "number" &&
      Number.isSafeInteger(channel.chatroomId) &&
      channel.chatroomId > 0)
  );
}

function isValidEntry(value: unknown, now: number): value is PersistedChannelEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PersistedChannelEntry>;
  if (
    (entry.platform !== "twitch" && entry.platform !== "kick") ||
    typeof entry.username !== "string" ||
    typeof entry.savedAt !== "number" ||
    !Number.isFinite(entry.savedAt) ||
    entry.savedAt > now ||
    now - entry.savedAt > MAX_AGE_MS
  ) {
    return false;
  }
  const normalizedUsername = normalizePersistedChannelUsername(entry.username);
  return (
    normalizedUsername.length > 0 && isUsableChannel(entry.data, entry.platform, normalizedUsername)
  );
}

function boundedEntries(values: PersistedChannelEntry[]): PersistedChannelEntry[] {
  const bounded: PersistedChannelEntry[] = [];
  const seen = new Set<string>();
  for (const entry of values.toSorted((left, right) => right.savedAt - left.savedAt)) {
    const key = entryKey(entry.platform, entry.username);
    if (seen.has(key)) continue;
    if (bounded.length >= MAX_ENTRIES) break;
    const candidate = [...bounded, entry];
    if (serializedBytes({ version: 1, entries: candidate }) > MAX_BYTES) break;
    seen.add(key);
    bounded.push(entry);
  }
  return bounded;
}

function publish(nextEntries: PersistedChannelEntry[]): void {
  entries = new Map(nextEntries.map((entry) => [entryKey(entry.platform, entry.username), entry]));
}

export function hydratePersistedChannelLru(): Promise<void> {
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
          ? boundedEntries(stored.entries.filter((entry) => isValidEntry(entry, now)))
          : [];
      publish(valid);
    })
    .catch(() => publish([]))
    .finally(() => {
      hydrated = true;
    });
  return hydrationPromise;
}

export function getPersistedChannelEntries(): PersistedChannelEntry[] {
  return [...entries.values()];
}

export function getPersistedChannelMetadata(
  username: string,
  platform: Platform
): UnifiedChannel | undefined {
  return entries.get(entryKey(platform, username))?.data;
}

export function savePersistedChannelMetadata(channel: UnifiedChannel): Promise<void> {
  const normalizedUsername = normalizePersistedChannelUsername(channel.username);
  if (!normalizedUsername || !isUsableChannel(channel, channel.platform, normalizedUsername)) {
    return Promise.resolve();
  }

  persistQueue = persistQueue
    .catch(() => undefined)
    .then(async () => {
      await hydratePersistedChannelLru();
      const nextEntry: PersistedChannelEntry = {
        platform: channel.platform,
        username: normalizedUsername,
        savedAt: Date.now(),
        data: channel,
      };
      const key = entryKey(channel.platform, normalizedUsername);
      const next = [
        nextEntry,
        ...[...entries.values()].filter(
          (entry) => entryKey(entry.platform, entry.username) !== key
        ),
      ];
      const bounded = boundedEntries(next);
      publish(bounded);
      await window.electronAPI.store.set(STORE_KEY, { version: 1, entries: bounded });
    });
  return persistQueue;
}

export function resetPersistedChannelLruForTests(): void {
  entries = new Map();
  hydrationPromise = undefined;
  hydrated = false;
  persistQueue = Promise.resolve();
}
