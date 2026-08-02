import type { ChatMessage, ChatPlatform } from "../shared/chat-types";
import { buildChannelKey, useChatStore } from "./chat-store";

type SerializedChatMessage = Omit<ChatMessage, "timestamp"> & { timestamp: string };

interface PersistedChatHistoryEntry {
  platform: ChatPlatform;
  channel: string;
  channelId: string;
  savedAt: number;
  messages: SerializedChatMessage[];
}

interface PersistedChatHistoryLru {
  version: 1;
  entries: PersistedChatHistoryEntry[];
}

const STORE_KEY = "chat-history-lru:v1";
const CHAT_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES_PER_CHANNEL = 50;
const MAX_CHANNELS = 12;
const MAX_BYTES = 1_000_000;

export const PERSISTED_CHAT_HISTORY_LIMITS = {
  maxAgeMs: CHAT_HISTORY_RETENTION_MS,
  maxMessagesPerChannel: MAX_MESSAGES_PER_CHANNEL,
  maxChannels: MAX_CHANNELS,
  maxBytes: MAX_BYTES,
} as const;

type RestoredEntry = Omit<PersistedChatHistoryEntry, "messages"> & { messages: ChatMessage[] };

let entries = new Map<string, RestoredEntry>();
let hydrationPromise: Promise<void> | undefined;
let hydrated = false;
let persistQueue = Promise.resolve();
const intentPrimePromises = new Map<string, Promise<boolean>>();

function normalizeChannel(channel: string): string {
  return channel.trim().toLowerCase().replace(/^#+/, "");
}

function entryKey(platform: ChatPlatform, channel: string, channelId: string): string {
  return `${platform}:${normalizeChannel(channel)}:${channelId.trim()}`;
}

function restoreMessage(
  message: SerializedChatMessage,
  entry: Pick<PersistedChatHistoryEntry, "platform" | "channel">
): ChatMessage | null {
  const timestamp = new Date(message.timestamp);
  if (
    !message.id ||
    message.type !== "message" ||
    message.isDeleted ||
    message.platform !== entry.platform ||
    normalizeChannel(message.channel) !== normalizeChannel(entry.channel) ||
    !Array.isArray(message.content) ||
    !Array.isArray(message.badges) ||
    Number.isNaN(timestamp.getTime())
  ) {
    return null;
  }
  return { ...message, timestamp, isHistorical: true };
}

function serializeEntry(entry: RestoredEntry): PersistedChatHistoryEntry {
  return {
    ...entry,
    messages: entry.messages.map((message) => ({
      ...message,
      timestamp: message.timestamp.toISOString(),
    })),
  };
}

function serializedBytes(entriesToMeasure: RestoredEntry[]): number {
  return new TextEncoder().encode(
    JSON.stringify({ version: 1, entries: entriesToMeasure.map(serializeEntry) })
  ).byteLength;
}

function isFresh(savedAt: number, now = Date.now()): boolean {
  return Number.isFinite(savedAt) && savedAt <= now && now - savedAt <= CHAT_HISTORY_RETENTION_MS;
}

function boundedEntries(values: RestoredEntry[], now = Date.now()): RestoredEntry[] {
  const selected: RestoredEntry[] = [];
  const newestFirst = values
    .filter((entry) => isFresh(entry.savedAt, now))
    .toSorted((left, right) => right.savedAt - left.savedAt);
  for (const entry of newestFirst) {
    if (selected.length >= MAX_CHANNELS) break;
    const candidate = [entry, ...selected];
    if (serializedBytes(candidate) > MAX_BYTES) continue;
    selected.unshift(entry);
  }
  return selected;
}

export async function hydratePersistedChatHistory(): Promise<void> {
  if (hydrated) return;
  if (hydrationPromise) return hydrationPromise;

  const attempt = window.electronAPI.store
    .get<PersistedChatHistoryLru>(STORE_KEY)
    .then((stored) => {
      const now = Date.now();
      const restored = new Map<string, RestoredEntry>();
      if (stored?.version === 1 && Array.isArray(stored.entries)) {
        for (const entry of stored.entries) {
          if (
            (entry.platform !== "kick" && entry.platform !== "twitch") ||
            !entry.channel ||
            !entry.channelId ||
            !isFresh(entry.savedAt, now) ||
            !Array.isArray(entry.messages)
          ) {
            continue;
          }
          const messages = entry.messages
            .map((message) => restoreMessage(message, entry))
            .filter((message): message is ChatMessage => message !== null)
            .slice(-MAX_MESSAGES_PER_CHANNEL);
          if (messages.length === 0) continue;
          restored.set(entryKey(entry.platform, entry.channel, entry.channelId), {
            platform: entry.platform,
            channel: normalizeChannel(entry.channel),
            channelId: entry.channelId,
            savedAt: entry.savedAt,
            messages,
          });
        }
      }
      entries = new Map(
        boundedEntries([...restored.values()], now).map((entry) => [
          entryKey(entry.platform, entry.channel, entry.channelId),
          entry,
        ])
      );
      hydrated = true;
    })
    .catch(() => undefined)
    .finally(() => {
      if (hydrationPromise === attempt) hydrationPromise = undefined;
    });
  hydrationPromise = attempt;
  return attempt;
}

export function getPersistedChatHistory(
  platform: ChatPlatform,
  channel: string,
  channelId: string
): ChatMessage[] | undefined {
  const key = entryKey(platform, channel, channelId);
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (!isFresh(entry.savedAt)) {
    entries.delete(key);
    return undefined;
  }
  return entry.messages;
}

interface PersistedChatHistoryIntent {
  platform: ChatPlatform;
  normalizedChannel: string;
  channelId: string;
  limit: number;
}

/** Prime an exact channel synchronously once the persisted cache is hydrated. */
export function primePersistedChatHistoryIntent({
  platform,
  normalizedChannel,
  channelId,
  limit,
}: PersistedChatHistoryIntent): boolean {
  const channel = normalizeChannel(normalizedChannel);
  const exactChannelId = channelId.trim();
  if (!channel || !exactChannelId || !Number.isFinite(limit) || limit <= 0) return false;

  const cached = getPersistedChatHistory(platform, channel, exactChannelId);
  if (!cached?.length) return false;

  useChatStore
    .getState()
    .replaceHistoricalMessages(
      buildChannelKey(platform, channel),
      cached.slice(-Math.floor(limit))
    );
  return true;
}

/**
 * Best-effort cold-start fallback for hover intent. The synchronous helper
 * remains the first path; this waits for an in-flight cache read and retries
 * one transient startup IPC failure without duplicating work per channel.
 */
export function primePersistedChatHistoryIntentAsync(
  intent: PersistedChatHistoryIntent
): Promise<boolean> {
  if (primePersistedChatHistoryIntent(intent)) return Promise.resolve(true);

  const channel = normalizeChannel(intent.normalizedChannel);
  const channelId = intent.channelId.trim();
  if (!channel || !channelId || !Number.isFinite(intent.limit) || intent.limit <= 0) {
    return Promise.resolve(false);
  }
  const key = entryKey(intent.platform, channel, channelId);
  const pending = intentPrimePromises.get(key);
  if (pending) return pending;

  const attempt = (async () => {
    try {
      await hydratePersistedChatHistory();
      if (primePersistedChatHistoryIntent(intent)) return true;

      // A failed hydration remains retryable. After a successful read this is
      // a cheap no-op for a genuine cache miss or exact-id mismatch.
      await hydratePersistedChatHistory();
      return primePersistedChatHistoryIntent(intent);
    } catch {
      return false;
    }
  })().finally(() => {
    if (intentPrimePromises.get(key) === attempt) intentPrimePromises.delete(key);
  });
  intentPrimePromises.set(key, attempt);
  return attempt;
}

export function savePersistedChatHistory(
  platform: ChatPlatform,
  channel: string,
  channelId: string,
  messages: ChatMessage[]
): Promise<void> {
  const normalizedChannel = normalizeChannel(channel);
  const normalizedChannelId = channelId.trim();
  if (!normalizedChannel || !normalizedChannelId) return Promise.resolve();

  const historical = messages
    .filter((message) => message.type === "message" && !message.isDeleted)
    .slice(-MAX_MESSAGES_PER_CHANNEL)
    .map((message) => ({ ...message, isHistorical: true }));
  if (historical.length === 0) return Promise.resolve();

  persistQueue = persistQueue
    .catch(() => undefined)
    .then(async () => {
      await hydratePersistedChatHistory();
      const key = entryKey(platform, normalizedChannel, normalizedChannelId);
      entries.delete(key);
      const now = Date.now();
      entries.set(key, {
        platform,
        channel: normalizedChannel,
        channelId: normalizedChannelId,
        savedAt: now,
        messages: historical,
      });
      const bounded = boundedEntries([...entries.values()], now);
      entries = new Map(
        bounded.map((entry) => [entryKey(entry.platform, entry.channel, entry.channelId), entry])
      );
      const storedEntries = bounded.map(serializeEntry);
      await window.electronAPI.store.set(STORE_KEY, { version: 1, entries: storedEntries });
    });
  return persistQueue;
}

export function resetPersistedChatHistoryForTests(): void {
  entries = new Map();
  hydrationPromise = undefined;
  hydrated = false;
  persistQueue = Promise.resolve();
  intentPrimePromises.clear();
}
