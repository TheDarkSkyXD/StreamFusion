/**
 * U20 — Twitch AutoMod hold queue store.
 *
 * Holds the messages that Twitch's AutoMod placed on hold for the current
 * session, keyed by `(channelId, messageId)`. Entries are added when an
 * `automod.message.hold` EventSub notification fires and removed when the
 * moderator approves / denies via the AutoMod tab.
 *
 * Out of scope: backfilling past holds via Helix. Once the renderer process
 * starts, only newly-held messages enter the queue.
 */

import { create } from "zustand";

export interface TwitchAutoModHeldMessage {
  messageId: string;
  channelId: string;
  /** Login name of the sender whose message got held. */
  username: string;
  userId: string;
  rawText: string;
  /** Twitch-defined category string (e.g. "harassment"). Forward-compat. */
  category: string;
  /** Numeric severity Twitch assigns (typically 1–4). */
  level: number;
  fragments?: Array<{ type: string; text: string }>;
  /** ms epoch when we received the hold. */
  heldAt: number;
}

interface AutoModQueueState {
  byKey: Map<string, TwitchAutoModHeldMessage>;
  add: (m: TwitchAutoModHeldMessage) => void;
  remove: (channelId: string, messageId: string) => void;
  clearForChannel: (channelId: string) => void;
  countForChannel: (channelId: string) => number;
  listForChannel: (channelId: string) => TwitchAutoModHeldMessage[];
}

function keyFor(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

export const useAutoModQueueStore = create<AutoModQueueState>((set, get) => ({
  byKey: new Map(),

  add: (m) => {
    const key = keyFor(m.channelId, m.messageId);
    const current = get().byKey;
    // De-dup: if the same hold notification arrives twice (e.g. a session
    // reconnect re-delivers), skip silently.
    if (current.has(key)) return;
    const next = new Map(current);
    next.set(key, m);
    set({ byKey: next });
  },

  remove: (channelId, messageId) => {
    const key = keyFor(channelId, messageId);
    const current = get().byKey;
    if (!current.has(key)) return;
    const next = new Map(current);
    next.delete(key);
    set({ byKey: next });
  },

  clearForChannel: (channelId) => {
    const current = get().byKey;
    const next = new Map<string, TwitchAutoModHeldMessage>();
    for (const [k, v] of current.entries()) {
      if (v.channelId !== channelId) next.set(k, v);
    }
    set({ byKey: next });
  },

  countForChannel: (channelId) => {
    let n = 0;
    for (const v of get().byKey.values()) {
      if (v.channelId === channelId) n++;
    }
    return n;
  },

  listForChannel: (channelId) => {
    const out: TwitchAutoModHeldMessage[] = [];
    for (const v of get().byKey.values()) {
      if (v.channelId === channelId) out.push(v);
    }
    // Oldest first so reviewers see the queue in arrival order.
    out.sort((a, b) => a.heldAt - b.heldAt);
    return out;
  },
}));
