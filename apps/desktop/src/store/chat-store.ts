import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../shared/auth-types";
import type {
  ChatBadge,
  ChatConnectionStatus,
  ChatKnownUser,
  ChatKnownUserRole,
  ChatMessage,
  ChatPlatform,
  ChatUserPresentation,
} from "../shared/chat-types";
import { useAuthStore } from "./auth-store";

/**
 * Performance-optimized Chat Store
 *
 * Key optimizations (inspired by KickTalk-main):
 * 1. Dynamic message limits (200 normal, 600 when paused)
 * 2. Duplicate message prevention via ID check
 * 3. Efficient slice-based trimming from the front
 * 4. Message batching support for high-volume chats
 */

// Message limits - lower limits = less RAM usage.
// Reduced from 200/600 to fix 5GB RAM spikes; further reduced 150→100 and
// trim buffer 25→10 to drop the resident chat array on long sessions.
// Per-add still allocates a new array (Zustand requires immutable updates),
// but the smaller cap meaningfully reduces GC churn and resident size.
//
// The normal cap is now a user preference (chatDisplay.messageLimit, default
// 600) resolved via resolveMessageLimit() and clamped to [MESSAGE_LIMIT_MIN,
// MESSAGE_LIMIT_MAX]. Ceiling 1200 keeps the default 600 visually centered on
// the settings slider (midpoint of 10..1200 ≈ 605) while still giving headroom
// above KickTalk's 600-message paused cap. Floor stays at 10 so power users
// can dial way down for performance on tiny machines.
const MESSAGE_LIMIT_PAUSED = 1200;
const MESSAGE_LIMIT_MIN = 10;
const MESSAGE_LIMIT_MAX = 1200;

// Recent Chatters deliberately retains fewer identities than messages. This
// keeps opening the list fast on high-volume channels while still covering a
// useful slice of recent history. Recency pruning happens only when the cap is
// crossed, avoiding an O(n log n) sort on every incoming message.
const RECENT_CHATTER_LIMIT = 500;
const RECENT_CHATTER_WINDOW_MS = 30 * 60 * 1000;

// Force trim when this many messages over limit (avoids frequent small trims)
const TRIM_BUFFER = 10;

/**
 * The configured normal-buffer cap, clamped to a sane floor and the hard RAM
 * ceiling. Read lazily from the auth store on each trim so live preference
 * changes take effect without remounting chat. Falls back to the shipped
 * default (100) when prefs are absent or non-finite.
 */
function resolveMessageLimit(): number {
  const configured =
    useAuthStore.getState().preferences?.chatDisplay?.messageLimit ??
    DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit;
  if (!Number.isFinite(configured)) {
    return DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit;
  }
  return Math.min(MESSAGE_LIMIT_MAX, Math.max(MESSAGE_LIMIT_MIN, Math.floor(configured)));
}

/**
 * Canonical bucket identifier for the per-channel message store (Plan C,
 * slice 01). Composite `${platform}:${channel}` — the platform prefix
 * disambiguates the same channel slug across providers (Twitch and Kick can
 * each have a channel slugged "xqc"). Always construct keys via this helper;
 * never assemble inline so a typo can't silently fork a bucket.
 */
export function buildChannelKey(platform: ChatPlatform, channel: string): string {
  return `${platform}:${channel}`;
}

/**
 * Append a message to its channel's bucket, applying per-channel trim hysteresis
 * (trim when bucket >= maxMessages + TRIM_BUFFER, trim back to
 * maxMessages - TRIM_BUFFER). Returns a new `messagesByChannel` map with the
 * target bucket replaced; other buckets share references.
 */
function appendToBucketWithTrim(
  buckets: Record<string, ChatMessage[]>,
  channelKey: string,
  message: ChatMessage,
  maxMessages: number
): Record<string, ChatMessage[]> {
  const current = buckets[channelKey] ?? [];
  const next =
    current.length >= maxMessages + TRIM_BUFFER
      ? [...current.slice(-(maxMessages - TRIM_BUFFER)), message]
      : [...current, message];
  return { ...buckets, [channelKey]: next };
}

/**
 * Replace a message in its bucket by id (used by the emote-richer dedupe path).
 * If the bucket or the id isn't present, returns the map unchanged.
 */
function replaceMessageInBucket(
  buckets: Record<string, ChatMessage[]>,
  channelKey: string,
  message: ChatMessage
): Record<string, ChatMessage[]> {
  const current = buckets[channelKey];
  if (!current) return buckets;
  const idx = current.findIndex((m) => m.id === message.id);
  if (idx === -1) return buckets;
  const next = current.slice();
  next[idx] = message;
  return { ...buckets, [channelKey]: next };
}

const CHATTER_ROLE_PRIORITY: readonly ChatKnownUserRole[] = [
  "broadcaster",
  "moderator",
  "subscriber",
];
const USER_AUTHORED_CHAT_MESSAGE_TYPES = new Set<ChatMessage["type"]>([
  "message",
  "action",
  "bits",
]);

function inferKnownUserRole(badges: ChatBadge[]): ChatKnownUserRole {
  const badgeIds = new Set(badges.map((badge) => badge.setId.toLowerCase()));
  return CHATTER_ROLE_PRIORITY.find((role) => badgeIds.has(role)) ?? "viewer";
}

function messageToKnownUser(message: ChatMessage): ChatKnownUser | null {
  if (!USER_AUTHORED_CHAT_MESSAGE_TYPES.has(message.type)) return null;
  if (!message.username) return null;
  return {
    userId: message.userId,
    username: message.username,
    displayName: message.displayName || message.username,
    color: message.color,
    avatarUrl: message.avatarUrl,
    role: inferKnownUserRole(message.badges),
    badges: message.badges,
    lastSeen: message.timestamp,
  };
}

function mergeKnownUsers(
  usersByChannel: Record<string, Record<string, ChatKnownUser>>,
  channelKey: string,
  users: ChatKnownUser[]
): Record<string, Record<string, ChatKnownUser>> {
  if (users.length === 0) return usersByChannel;

  const current = usersByChannel[channelKey] ?? {};
  let next: Record<string, ChatKnownUser> | null = null;

  for (const user of users) {
    const key = user.username.toLowerCase();
    const existing = current[key];
    const shouldReplace =
      !existing ||
      user.lastSeen.getTime() >= existing.lastSeen.getTime() ||
      (!existing.avatarUrl && Boolean(user.avatarUrl)) ||
      (!existing.color && Boolean(user.color));

    if (!shouldReplace) continue;

    if (!next) next = { ...current };
    const incomingIsNewest =
      !existing || user.lastSeen.getTime() >= existing.lastSeen.getTime();
    next[key] = {
      ...existing,
      ...user,
      color: user.color || existing?.color,
      avatarUrl: user.avatarUrl || existing?.avatarUrl,
      role: incomingIsNewest ? user.role : (existing?.role ?? user.role),
      badges: incomingIsNewest ? user.badges : (existing?.badges ?? user.badges),
      lastSeen:
        existing && existing.lastSeen.getTime() > user.lastSeen.getTime()
          ? existing.lastSeen
          : user.lastSeen,
    };
  }

  if (!next) return usersByChannel;
  if (Object.keys(next).length > RECENT_CHATTER_LIMIT) {
    const newestFirst = Object.values(next).sort(
      (left, right) => right.lastSeen.getTime() - left.lastSeen.getTime()
    );
    const newestTimestamp = newestFirst[0]?.lastSeen.getTime() ?? 0;
    const cutoff = newestTimestamp - RECENT_CHATTER_WINDOW_MS;
    const retained = newestFirst
      .filter((user) => user.lastSeen.getTime() >= cutoff)
      .slice(0, RECENT_CHATTER_LIMIT);
    next = Object.fromEntries(retained.map((user) => [user.username.toLowerCase(), user]));
  }

  return { ...usersByChannel, [channelKey]: next };
}

function mergeKnownUsersFromMessages(
  usersByChannel: Record<string, Record<string, ChatKnownUser>>,
  channelKey: string,
  messages: ChatMessage[]
): Record<string, Record<string, ChatKnownUser>> {
  const users = messages
    .map(messageToKnownUser)
    .filter((user): user is ChatKnownUser => Boolean(user));
  return mergeKnownUsers(usersByChannel, channelKey, users);
}

/**
 * Apply a flushed batch to a single channel's bucket: dedupes against the
 * bucket using the emote-richer rule, appends fresh messages, then trims the
 * target bucket. All messages in the batch share `channelKey`.
 */
function applyBatchToBucket(
  buckets: Record<string, ChatMessage[]>,
  channelKey: string,
  batch: ChatMessage[],
  maxMessages: number
): Record<string, ChatMessage[]> {
  const current = buckets[channelKey] ?? [];
  const idIndex = new Map<string, number>();
  current.forEach((m, i) => idIndex.set(m.id, i));
  const fresh: ChatMessage[] = [];
  const replacements: { index: number; message: ChatMessage }[] = [];
  for (const m of batch) {
    const existingIdx = idIndex.get(m.id);
    if (existingIdx === undefined) {
      idIndex.set(m.id, current.length + fresh.length);
      fresh.push(m);
      continue;
    }
    const existing =
      existingIdx < current.length ? current[existingIdx] : fresh[existingIdx - current.length];
    const newHasEmotes = m.content.some((f) => f.type === "emote");
    const existingHasEmotes = existing.content.some((f) => f.type === "emote");
    if (newHasEmotes && !existingHasEmotes) {
      if (existingIdx < current.length) {
        replacements.push({ index: existingIdx, message: m });
      } else {
        fresh[existingIdx - current.length] = m;
      }
    }
  }
  if (fresh.length === 0 && replacements.length === 0) return buckets;

  let base = current;
  if (replacements.length > 0) {
    base = base.slice();
    for (const { index, message } of replacements) {
      base[index] = message;
    }
  }
  const merged = [...base, ...fresh];
  const trimmed =
    merged.length > maxMessages + TRIM_BUFFER ? merged.slice(-(maxMessages - TRIM_BUFFER)) : merged;
  return { ...buckets, [channelKey]: trimmed };
}

// Batching configuration
interface MessageBatch {
  queue: ChatMessage[];
  timer: ReturnType<typeof setTimeout> | null;
}

// Global batching state (outside React lifecycle for persistence)
const messageBatches: Record<string, MessageBatch> = {};
export const DEFAULT_BATCHING_INTERVAL_MS = 16;

interface ChatState {
  /** Per-channel message buckets, keyed by `buildChannelKey(platform, channel)`. */
  messagesByChannel: Record<string, ChatMessage[]>;
  /** Per-channel known chat users, learned from live + historical chat messages. */
  usersByChannel: Record<string, Record<string, ChatKnownUser>>;
  /** Monotonic session count; kept separately because the rendered roster is capped. */
  chatterCountByChannel: Record<string, number>;
  connectionStatus: Record<ChatPlatform, ChatConnectionStatus>;
  /** Per-channel pause state. */
  pausedChannels: Set<string>;

  // Batching settings
  batchingEnabled: boolean;
  batchingInterval: number; // ms

  // Actions
  addMessage: (message: ChatMessage) => void;
  /**
   * ChannelKey is per channel, not per platform, so each chat panel's batch
   * fires on its own cadence.
   */
  addMessageBatched: (message: ChatMessage, channelKey: string) => void;
  flushBatch: (channelKey: string) => void;
  /**
   * Insert a batch of messages at the front of the channel bucket, in the order given.
   * Used to seed historical chat after live messages have already started
   * arriving — appending would put history below the live feed, which is the
   * wrong chronological order.
   */
  prependMessages: (channelKey: string, messages: ChatMessage[]) => void;
  /**
   * Authoritatively replace one channel's bucket with persisted historical
   * messages. Unlike prependMessages, this intentionally discards any stale
   * bucket contents from a previous channel intent.
   */
  replaceHistoricalMessages: (channelKey: string, messages: ChatMessage[]) => void;
  clearMessages: (channelKey: string) => void;
  dropChannel: (channelKey: string) => void;
  deleteMessage: (channelKey: string, messageId: string, metadata?: DeletionMetadata) => void;
  deleteMessagesByUser: (channelKey: string, userId: string, metadata?: DeletionMetadata) => void;
  updateConnectionStatus: (status: ChatConnectionStatus) => void;
  rehydrateChannelBadges: (
    channelKey: string,
    resolve: (badges: ChatBadge[]) => ChatBadge[]
  ) => void;
  trimChannelToMessageLimit: (channelKey: string) => void;
  setPaused: (channelKey: string, paused: boolean) => void;
  setBatchingEnabled: (enabled: boolean) => void;
  setBatchingInterval: (interval: number) => void;
  cleanupBatching: () => void;
}

interface DeletionMetadata {
  deletedAt?: Date;
  deletedByUser?: ChatUserPresentation;
  deletedByUsername?: string;
}

// DEV-only counters for live perf inspection via PerfOverlay or electron-mcp
// eval probes. Tree-shaken in production via the import.meta.env.DEV gate
// inside the store factory below. Kept on a module-level object so every
// action body can increment without threading through closures.
const __debug = {
  setCalls: 0,
  addMessageBatched: 0,
  flushBatch: 0,
  addMessage: 0,
  setPaused: 0,
  deleteMessage: 0,
  deleteMessagesByUser: 0,
  updateConnectionStatus: 0,
};

export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => {
    // Expose __chatStore on window for live perf inspection (DEV only).
    // Probes can read counters to compute message rate, batching ratio, etc.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      const origSet = set;
      const wrappedSet: typeof set = ((updater: Parameters<typeof set>[0]) => {
        __debug.setCalls++;
        return origSet(updater);
      }) as typeof set;
      (window as unknown as { __chatStore: unknown }).__chatStore = {
        getState: () => get(),
        counters: __debug,
      };
      set = wrappedSet;
    }
    return {
      messagesByChannel: {},
      usersByChannel: {},
      chatterCountByChannel: {},
      pausedChannels: new Set<string>(),
      // Batching enabled by default. On busy streams (Kick xQc-tier or Twitch
      // raid bursts at 30+ msg/sec), grouping same-frame arrivals into a short
      // window reduces ChatMessageList commits without holding visible chat for
      // multiple frames. A 16ms window stays within one 60Hz frame budget.
      // Connection, system, and moderation events remain immediate.
      // System/ban/clear messages bypass batching via direct addMessage().
      batchingEnabled: true,
      batchingInterval: DEFAULT_BATCHING_INTERVAL_MS,
      connectionStatus: {
        twitch: {
          platform: "twitch",
          state: "disconnected",
          channels: [],
          isAuthenticated: false,
        },
        kick: {
          platform: "kick",
          state: "disconnected",
          channels: [],
          isAuthenticated: false,
        },
      },

      addMessage: (message) => {
        __debug.addMessage++;
        const messageChannelKey = buildChannelKey(message.platform, message.channel);
        // Direct-add path. Flush any pending batches first so system messages,
        // ban markers, and clear-chat events don't appear out of chronological
        // order with batched chat messages that arrived before them.
        for (const key of Object.keys(messageBatches)) {
          if (messageBatches[key].queue.length > 0) {
            get().flushBatch(key);
          }
        }
        set((state) => {
          const channelKey = messageChannelKey;

          // Duplicate prevention is now scoped to the channel's bucket (Plan C
          // slice 01). The same message id appearing in two different channels
          // is two distinct messages — would happen rarely in production (Twitch
          // and Kick IDs are namespaced) but the scoped dedupe is the correct
          // semantic and matches KickTalk's per-room dedupe.
          //
          // When a duplicate id arrives within a channel, prefer the version
          // with emote fragments. This handles the Kick optimistic-echo race:
          // the Pusher broadcast of the user's own message (~50-150ms) routinely
          // beats the HTTP send response that triggers the local echo (~300ms),
          // so the dropped duplicate is often the richer echo.
          const bucket = state.messagesByChannel[channelKey] ?? [];
          const dupIdx = bucket.findIndex((m) => m.id === message.id);
          if (dupIdx !== -1) {
            const existing = bucket[dupIdx];
            const newHasEmotes = message.content.some((f) => f.type === "emote");
            const existingHasEmotes = existing.content.some((f) => f.type === "emote");
            if (newHasEmotes && !existingHasEmotes) {
              return {
                messagesByChannel: replaceMessageInBucket(
                  state.messagesByChannel,
                  channelKey,
                  message
                ),
              };
            }
            return state;
          }

          const bucketMaxMessages = state.pausedChannels.has(channelKey)
            ? MESSAGE_LIMIT_PAUSED
            : resolveMessageLimit();

          const messagesByChannel = appendToBucketWithTrim(
            state.messagesByChannel,
            channelKey,
            message,
            bucketMaxMessages
          );
          const knownUser = messageToKnownUser(message);

          return {
            messagesByChannel,
            usersByChannel: knownUser
              ? mergeKnownUsers(state.usersByChannel, channelKey, [knownUser])
              : state.usersByChannel,
            chatterCountByChannel:
              knownUser && !state.usersByChannel[channelKey]?.[knownUser.username.toLowerCase()]
                ? {
                    ...state.chatterCountByChannel,
                    [channelKey]:
                      (state.chatterCountByChannel[channelKey] ??
                        Object.keys(state.usersByChannel[channelKey] ?? {}).length) + 1,
                  }
                : state.chatterCountByChannel,
          };
        });
      },

      // Batched message adding for high-volume chats
      addMessageBatched: (message, channelKey) => {
        __debug.addMessageBatched++;
        const state = get();

        // If batching disabled, add immediately
        if (!state.batchingEnabled || state.batchingInterval === 0) {
          state.addMessage(message);
          return;
        }

        // Initialize batch for channel if needed
        if (!messageBatches[channelKey]) {
          messageBatches[channelKey] = {
            queue: [],
            timer: null,
          };
        }

        const batch = messageBatches[channelKey];
        batch.queue.push(message);

        // Set up flush timer if not already running
        if (!batch.timer) {
          // timer-allowlist: Zustand-store message-batch coalescing timer (non-React; future backend ManagedTimeout primitive could replace)
          batch.timer = setTimeout(() => {
            get().flushBatch(channelKey);
          }, state.batchingInterval);
        }
      },

      flushBatch: (channelKey) => {
        __debug.flushBatch++;
        const batch = messageBatches[channelKey];
        if (!batch) return;

        // Clear the timer up front. Without this, calling flushBatch externally
        // (e.g. from addMessage's ordering-preservation flush, or cleanupBatching)
        // leaves a scheduled timer that fires later and runs flushBatch on an
        // empty queue — harmless but wasteful.
        if (batch.timer) {
          clearTimeout(batch.timer);
          batch.timer = null;
        }

        const queued = batch.queue;
        batch.queue = [];
        if (queued.length === 0) return;

        set((state) => {
          const bucketMaxMessages = state.pausedChannels.has(channelKey)
            ? MESSAGE_LIMIT_PAUSED
            : resolveMessageLimit();

          // Dedupe is scoped to the channel's bucket: same id in two different
          // channels is two distinct messages (matches the addMessage
          // per-channel dedupe and KickTalk's per-room dedupe). The
          // within-batch case still matters in multi-view: each chat panel
          // subscribes to its shared service, so the same inbound message is
          // enqueued once per mounted panel for THIS channel. Emote-richer
          // preference resolves the Kick optimistic-echo race.
          const bucket = state.messagesByChannel[channelKey] ?? [];
          const idIndex = new Map<string, number>();
          bucket.forEach((m, i) => idIndex.set(m.id, i));
          const fresh: ChatMessage[] = [];
          const bucketReplacements: { index: number; message: ChatMessage }[] = [];
          for (const m of queued) {
            const existingIdx = idIndex.get(m.id);
            if (existingIdx === undefined) {
              idIndex.set(m.id, bucket.length + fresh.length);
              fresh.push(m);
              continue;
            }
            const existing =
              existingIdx < bucket.length
                ? bucket[existingIdx]
                : fresh[existingIdx - bucket.length];
            const newHasEmotes = m.content.some((f) => f.type === "emote");
            const existingHasEmotes = existing.content.some((f) => f.type === "emote");
            if (newHasEmotes && !existingHasEmotes) {
              if (existingIdx < bucket.length) {
                bucketReplacements.push({ index: existingIdx, message: m });
              } else {
                fresh[existingIdx - bucket.length] = m;
              }
            }
          }
          if (fresh.length === 0 && bucketReplacements.length === 0) return state;

          const nextBuckets = applyBatchToBucket(
            state.messagesByChannel,
            channelKey,
            queued,
            bucketMaxMessages
          );

          return {
            messagesByChannel: nextBuckets,
            usersByChannel: mergeKnownUsersFromMessages(state.usersByChannel, channelKey, queued),
            chatterCountByChannel: (() => {
              const current = state.usersByChannel[channelKey] ?? {};
              const newNames = new Set(
                queued
                  .map(messageToKnownUser)
                  .filter((user): user is ChatKnownUser => Boolean(user))
                  .map((user) => user.username.toLowerCase())
                  .filter((username) => !current[username])
              );
              if (newNames.size === 0) return state.chatterCountByChannel;
              return {
                ...state.chatterCountByChannel,
                [channelKey]:
                  (state.chatterCountByChannel[channelKey] ?? Object.keys(current).length) +
                  newNames.size,
              };
            })(),
          };
        });
      },

      cleanupBatching: () => {
        // Cleanup all batches (call on unmount)
        Object.keys(messageBatches).forEach((channelKey) => {
          const batch = messageBatches[channelKey];
          if (batch.timer) {
            clearTimeout(batch.timer);
          }
          // Flush remaining messages
          if (batch.queue.length > 0) {
            get().flushBatch(channelKey);
          }
        });
        // Clear global batches
        Object.keys(messageBatches).forEach((key) => delete messageBatches[key]);
      },

      prependMessages: (channelKey, incoming) => {
        set((state) => {
          if (incoming.length === 0) return state;
          // Drop anything that's already in the store so we don't duplicate
          // messages that arrived live before the history fetch returned.
          const current = state.messagesByChannel[channelKey] ?? [];
          const existing = new Set(current.map((m) => m.id));
          const fresh = incoming.filter((m) => !existing.has(m.id));
          if (fresh.length === 0) return state;

          const bucketMerged = [...fresh, ...current];
          const bucketCap = state.pausedChannels.has(channelKey)
            ? MESSAGE_LIMIT_PAUSED
            : resolveMessageLimit();
          const bucketTrimmed =
            bucketMerged.length > bucketCap ? bucketMerged.slice(-bucketCap) : bucketMerged;

          return {
            messagesByChannel: { ...state.messagesByChannel, [channelKey]: bucketTrimmed },
            usersByChannel: mergeKnownUsersFromMessages(state.usersByChannel, channelKey, fresh),
            chatterCountByChannel: (() => {
              const current = state.usersByChannel[channelKey] ?? {};
              const newNames = new Set(
                fresh
                  .map(messageToKnownUser)
                  .filter((user): user is ChatKnownUser => Boolean(user))
                  .map((user) => user.username.toLowerCase())
                  .filter((username) => !current[username])
              );
              if (newNames.size === 0) return state.chatterCountByChannel;
              return {
                ...state.chatterCountByChannel,
                [channelKey]:
                  (state.chatterCountByChannel[channelKey] ?? Object.keys(current).length) +
                  newNames.size,
              };
            })(),
          };
        });
      },

      replaceHistoricalMessages: (channelKey, messages) => {
        set((state) => {
          const replacementUsers = mergeKnownUsersFromMessages({}, channelKey, messages)[channelKey];
          const usersByChannel = { ...state.usersByChannel };
          if (replacementUsers) {
            usersByChannel[channelKey] = replacementUsers;
          } else {
            delete usersByChannel[channelKey];
          }

          return {
            messagesByChannel: { ...state.messagesByChannel, [channelKey]: [...messages] },
            usersByChannel,
            chatterCountByChannel: {
              ...state.chatterCountByChannel,
              [channelKey]: new Set(
                messages
                  .map(messageToKnownUser)
                  .filter((user): user is ChatKnownUser => Boolean(user))
                  .map((user) => user.username.toLowerCase())
              ).size,
            },
          };
        });
      },

      clearMessages: (channelKey) => {
        set((state) => {
          const messagesByChannel = { ...state.messagesByChannel };
          delete messagesByChannel[channelKey];
          const usersByChannel = { ...state.usersByChannel };
          delete usersByChannel[channelKey];
          const chatterCountByChannel = { ...state.chatterCountByChannel };
          delete chatterCountByChannel[channelKey];
          return {
            messagesByChannel,
            usersByChannel,
            chatterCountByChannel,
          };
        });
      },

      dropChannel: (channelKey) =>
        set((state) => {
          if (!state.messagesByChannel[channelKey] && !state.pausedChannels.has(channelKey)) {
            return state;
          }

          const messagesByChannel = { ...state.messagesByChannel };
          delete messagesByChannel[channelKey];
          const usersByChannel = { ...state.usersByChannel };
          delete usersByChannel[channelKey];
          const chatterCountByChannel = { ...state.chatterCountByChannel };
          delete chatterCountByChannel[channelKey];

          const pausedChannels = new Set(state.pausedChannels);
          pausedChannels.delete(channelKey);

          return {
            messagesByChannel,
            usersByChannel,
            chatterCountByChannel,
            pausedChannels,
          };
        }),

      deleteMessage: (channelKey, messageId, metadata) => {
        __debug.deleteMessage++;
        set((state) => {
          const bucket = state.messagesByChannel[channelKey];
          const messagesByChannel = bucket
            ? {
                ...state.messagesByChannel,
                [channelKey]: bucket.map((m) =>
                  m.id === messageId ? { ...m, ...metadata, isDeleted: true } : m
                ),
              }
            : state.messagesByChannel;
          return {
            messagesByChannel,
          };
        });
      },

      deleteMessagesByUser: (channelKey, userId, metadata) => {
        __debug.deleteMessagesByUser++;
        set((state) => {
          const bucket = state.messagesByChannel[channelKey];
          const messagesByChannel = bucket
            ? {
                ...state.messagesByChannel,
                [channelKey]: bucket.map((m) =>
                  m.userId === userId ? { ...m, ...metadata, isDeleted: true } : m
                ),
              }
            : state.messagesByChannel;
          return {
            messagesByChannel,
          };
        });
      },

      updateConnectionStatus: (status) => {
        __debug.updateConnectionStatus++;
        set((state) => {
          const prev = state.connectionStatus[status.platform];
          // Field-by-field equality short-circuit. The chat services emit on every
          // IRC PING / Pusher heartbeat, so without this guard the entire chat
          // subtree re-renders multiple times per minute even when nothing
          // visible has changed. Returning the same state reference makes Zustand
          // skip the notify cycle entirely.
          if (
            prev &&
            prev.state === status.state &&
            prev.isAuthenticated === status.isAuthenticated &&
            prev.error === status.error &&
            prev.connectedAt === status.connectedAt &&
            prev.channels.length === status.channels.length &&
            prev.channels.every((c, i) => c === status.channels[i])
          ) {
            return state;
          }
          return {
            connectionStatus: {
              ...state.connectionStatus,
              [status.platform]: status,
            },
          };
        });
      },

      rehydrateChannelBadges: (channelKey, resolve) => {
        set((state) => {
          const bucket = state.messagesByChannel[channelKey];
          if (!bucket) return state;
          const channelUsers = state.usersByChannel[channelKey];
          const usersByChannel = channelUsers
            ? {
                ...state.usersByChannel,
                [channelKey]: Object.fromEntries(
                  Object.entries(channelUsers).map(([username, user]) => {
                    const badges = resolve(user.badges ?? []);
                    return [username, { ...user, badges, role: inferKnownUserRole(badges) }];
                  })
                ),
              }
            : state.usersByChannel;
          return {
            messagesByChannel: {
              ...state.messagesByChannel,
              [channelKey]: bucket.map((message) => ({
                ...message,
                badges: resolve(message.badges),
              })),
            },
            usersByChannel,
          };
        });
      },

      trimChannelToMessageLimit: (channelKey) => {
        set((state) => {
          const bucket = state.messagesByChannel[channelKey];
          const messageLimit = resolveMessageLimit();
          if (!bucket || bucket.length <= messageLimit) return state;

          return {
            messagesByChannel: {
              ...state.messagesByChannel,
              [channelKey]: bucket.slice(-messageLimit),
            },
          };
        });
      },

      setPaused: (channelKey, paused) => {
        __debug.setPaused++;
        set((state) => {
          const isPaused = state.pausedChannels.has(channelKey);
          if (isPaused === paused) {
            return state;
          }
          const pausedChannels = new Set(state.pausedChannels);
          if (paused) {
            pausedChannels.add(channelKey);
          } else {
            pausedChannels.delete(channelKey);
          }
          return {
            pausedChannels,
          };
        });
      },
      setBatchingEnabled: (enabled) => set({ batchingEnabled: enabled }),
      setBatchingInterval: (interval) => set({ batchingInterval: interval }),
    };
  })
);
