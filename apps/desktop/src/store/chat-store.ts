import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../shared/auth-types";
import type { ChatConnectionStatus, ChatMessage, ChatPlatform } from "../shared/chat-types";
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
// 100) resolved via resolveMessageLimit() and clamped to [MESSAGE_LIMIT_MIN,
// MESSAGE_LIMIT_MAX]. The max stays 400 so a misconfigured value can't
// reintroduce the RAM spike (the array is shared across multiview panels).
const MESSAGE_LIMIT_PAUSED = 400;
const MESSAGE_LIMIT_MIN = 10;
const MESSAGE_LIMIT_MAX = 400;

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

// Batching configuration
interface MessageBatch {
  queue: ChatMessage[];
  timer: ReturnType<typeof setTimeout> | null;
}

// Global batching state (outside React lifecycle for persistence)
const messageBatches: Record<string, MessageBatch> = {};

interface ChatState {
  messages: ChatMessage[];
  connectionStatus: Record<ChatPlatform, ChatConnectionStatus>;
  isPaused: boolean;

  // Batching settings
  batchingEnabled: boolean;
  batchingInterval: number; // ms

  // Actions
  addMessage: (message: ChatMessage) => void;
  addMessageBatched: (message: ChatMessage, channelKey: string) => void;
  flushBatch: (channelKey: string) => void;
  /**
   * Insert a batch of messages at the front of the array, in the order given.
   * Used to seed historical chat after live messages have already started
   * arriving — appending would put history below the live feed, which is the
   * wrong chronological order.
   */
  prependMessages: (messages: ChatMessage[]) => void;
  clearMessages: (platform?: ChatPlatform) => void;
  deleteMessage: (messageId: string) => void;
  deleteMessagesByUser: (userId: string) => void;
  updateConnectionStatus: (status: ChatConnectionStatus) => void;
  setPaused: (paused: boolean) => void;
  setBatchingEnabled: (enabled: boolean) => void;
  setBatchingInterval: (interval: number) => void;
  cleanupBatching: () => void;
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
    messages: [],
    isPaused: false,
    // Batching enabled by default. On busy streams (Kick xQc-tier or Twitch
    // raid bursts at 30+ msg/sec), grouping store updates into 50ms windows
    // collapses 30 Zustand notifies → ~20 ChatMessageList commits, which is
    // the dominant per-message React work. Latency added is imperceptible.
    // System/ban/clear messages bypass batching via direct addMessage().
    batchingEnabled: true,
    batchingInterval: 50, // 50ms = 20Hz flush. Imperceptible.
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
      // Direct-add path. Flush any pending batches first so system messages,
      // ban markers, and clear-chat events don't appear out of chronological
      // order with batched chat messages that arrived before them.
      for (const key of Object.keys(messageBatches)) {
        if (messageBatches[key].queue.length > 0) {
          get().flushBatch(key);
        }
      }
      set((state) => {
        const currentMessages = state.messages;

        // Duplicate prevention - check last 50 messages only (optimization).
        // When a duplicate id arrives, prefer the version with emote fragments
        // over the one without. This handles the Kick optimistic-echo race:
        // the Pusher broadcast of the user's own message (~50-150ms) routinely
        // beats the HTTP send response that triggers the local echo (~300ms),
        // so the dropped duplicate is often the richer echo. Without this
        // preference, third-party / overlay emote info from the local emote
        // slots would be lost on every send.
        const recentMessages = currentMessages.slice(-50);
        const dupIdx = recentMessages.findIndex((m) => m.id === message.id);
        if (dupIdx !== -1) {
          const existing = recentMessages[dupIdx];
          const newHasEmotes = message.content.some((f) => f.type === "emote");
          const existingHasEmotes = existing.content.some((f) => f.type === "emote");
          if (newHasEmotes && !existingHasEmotes) {
            // Replace the leaner existing with the emote-richer incoming.
            const absoluteIdx = currentMessages.length - recentMessages.length + dupIdx;
            const replaced = currentMessages.slice();
            replaced[absoluteIdx] = message;
            return { messages: replaced };
          }
          return state;
        }

        // Dynamic limit based on pause state
        const maxMessages = state.isPaused ? MESSAGE_LIMIT_PAUSED : resolveMessageLimit();

        // Only trim when significantly over limit (reduces allocation frequency)
        const needsTrim = currentMessages.length >= maxMessages + TRIM_BUFFER;

        if (needsTrim) {
          // Trim more aggressively - remove TRIM_BUFFER + 1 messages at once
          const trimmedMessages = currentMessages.slice(-(maxMessages - TRIM_BUFFER));
          return { messages: [...trimmedMessages, message] };
        }

        // Normal append - mutate-in-place style for better performance
        return { messages: [...currentMessages, message] };
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
        const currentMessages = state.messages;
        const maxMessages = state.isPaused ? MESSAGE_LIMIT_PAUSED : resolveMessageLimit();

        // Dedup against existing store AND within this batch. The within-batch
        // case matters in multi-view: each KickChat/TwitchChat instance
        // subscribes to its shared service, so the same inbound message is
        // enqueued once per mounted chat panel.
        // When a duplicate id arrives, prefer the version with emote fragments
        // — same reasoning as the addMessage path above: the Kick optimistic
        // echo with emote fragments can lose the race to the Pusher text
        // broadcast, and we don't want to keep the leaner one.
        const idIndex = new Map<string, number>();
        currentMessages.forEach((m, i) => idIndex.set(m.id, i));
        const fresh: ChatMessage[] = [];
        const replacements: { index: number; message: ChatMessage }[] = [];
        for (const m of queued) {
          const existingIdx = idIndex.get(m.id);
          if (existingIdx === undefined) {
            idIndex.set(m.id, currentMessages.length + fresh.length);
            fresh.push(m);
            continue;
          }
          const existing =
            existingIdx < currentMessages.length
              ? currentMessages[existingIdx]
              : fresh[existingIdx - currentMessages.length];
          const newHasEmotes = m.content.some((f) => f.type === "emote");
          const existingHasEmotes = existing.content.some((f) => f.type === "emote");
          if (newHasEmotes && !existingHasEmotes) {
            if (existingIdx < currentMessages.length) {
              replacements.push({ index: existingIdx, message: m });
            } else {
              fresh[existingIdx - currentMessages.length] = m;
            }
          }
        }
        if (fresh.length === 0 && replacements.length === 0) return state;

        let base = currentMessages;
        if (replacements.length > 0) {
          base = base.slice();
          for (const { index, message } of replacements) {
            base[index] = message;
          }
        }
        const merged = [...base, ...fresh];
        // Hysteresis: only trim once we exceed maxMessages + TRIM_BUFFER, then
        // trim back to maxMessages - TRIM_BUFFER. Same pattern as addMessage's
        // single-message path so a flush of small batches doesn't trigger a
        // copy on every flush at the cap.
        if (merged.length > maxMessages + TRIM_BUFFER) {
          return { messages: merged.slice(-(maxMessages - TRIM_BUFFER)) };
        }
        return { messages: merged };
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

    prependMessages: (incoming) =>
      set((state) => {
        if (incoming.length === 0) return state;
        // Drop anything that's already in the store so we don't duplicate
        // messages that arrived live before the history fetch returned.
        const existing = new Set(state.messages.map((m) => m.id));
        const fresh = incoming.filter((m) => !existing.has(m.id));
        if (fresh.length === 0) return state;
        const merged = [...fresh, ...state.messages];
        const maxMessages = state.isPaused ? MESSAGE_LIMIT_PAUSED : resolveMessageLimit();
        if (merged.length > maxMessages) {
          // Keep the most recent `maxMessages` — same trim policy as addMessage.
          return { messages: merged.slice(-maxMessages) };
        }
        return { messages: merged };
      }),

    clearMessages: (platform) =>
      set((state) => {
        if (platform) {
          return { messages: state.messages.filter((m) => m.platform !== platform) };
        }
        return { messages: [] };
      }),

    deleteMessage: (messageId) => {
      __debug.deleteMessage++;
      set((state) => ({
        messages: state.messages.map((m) => (m.id === messageId ? { ...m, isDeleted: true } : m)),
      }));
    },

    deleteMessagesByUser: (userId) => {
      __debug.deleteMessagesByUser++;
      set((state) => ({
        messages: state.messages.map((m) => (m.userId === userId ? { ...m, isDeleted: true } : m)),
      }));
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

    setPaused: (paused) => {
      __debug.setPaused++;
      set({ isPaused: paused });
    },
    setBatchingEnabled: (enabled) => set({ batchingEnabled: enabled }),
    setBatchingInterval: (interval) => set({ batchingInterval: interval }),
    };
  })
);
