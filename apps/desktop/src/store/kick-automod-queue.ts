/**
 * U21 — Kick custom AutoMod hold queue.
 *
 * The Kick interceptor (`kick-chat.ts setAutomodInterceptor`) drops held
 * messages here instead of letting them flow into `chat-store`. The Kick
 * AutoMod tab renders them and offers Approve / Deny / Allow+Allow-list /
 * Approve-and-timeout actions. Approve releases the original `ChatMessage`
 * back into `chat-store` so chat reflects the user's decision.
 *
 * Same shape as `automod-queue-store` (Twitch) but carries the parsed
 * `ChatMessage` so we can replay it without re-parsing Pusher events.
 */

import { create } from "zustand";

import type { ChatMessage } from "@/shared/chat-types";

import type { KickAutoModCategory } from "@/backend/api/platforms/kick/kick-automod-filter";

export interface KickHeldMessage {
  messageId: string;
  channelSlug: string;
  chatroomId: number;
  senderUserId: string;
  senderUsername: string;
  rawText: string;
  category: KickAutoModCategory;
  matchedKeyword: string;
  parsedMessage: ChatMessage;
  heldAt: number;
}

interface KickQueueState {
  byKey: Map<string, KickHeldMessage>;
  add: (m: KickHeldMessage) => void;
  remove: (channelSlug: string, messageId: string) => void;
  clearForChannel: (channelSlug: string) => void;
  countForChannel: (channelSlug: string) => number;
  listForChannel: (channelSlug: string) => KickHeldMessage[];
}

function keyFor(channelSlug: string, messageId: string): string {
  return `${channelSlug}:${messageId}`;
}

export const useKickAutoModQueueStore = create<KickQueueState>((set, get) => ({
  byKey: new Map(),

  add: (m) => {
    const key = keyFor(m.channelSlug, m.messageId);
    const current = get().byKey;
    if (current.has(key)) return;
    const next = new Map(current);
    next.set(key, m);
    set({ byKey: next });
  },

  remove: (channelSlug, messageId) => {
    const key = keyFor(channelSlug, messageId);
    const current = get().byKey;
    if (!current.has(key)) return;
    const next = new Map(current);
    next.delete(key);
    set({ byKey: next });
  },

  clearForChannel: (channelSlug) => {
    const next = new Map<string, KickHeldMessage>();
    for (const [k, v] of get().byKey.entries()) {
      if (v.channelSlug !== channelSlug) next.set(k, v);
    }
    set({ byKey: next });
  },

  countForChannel: (channelSlug) => {
    let n = 0;
    for (const v of get().byKey.values()) {
      if (v.channelSlug === channelSlug) n++;
    }
    return n;
  },

  listForChannel: (channelSlug) => {
    const out: KickHeldMessage[] = [];
    for (const v of get().byKey.values()) {
      if (v.channelSlug === channelSlug) out.push(v);
    }
    out.sort((a, b) => a.heldAt - b.heldAt);
    return out;
  },
}));
