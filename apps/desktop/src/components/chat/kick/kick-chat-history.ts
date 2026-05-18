/**
 * Kick chat-history seeding
 *
 * Pulls the recent-message page Kick returns for a channel so users see prior
 * context on join, the way the official site and KickTalk do.
 *
 * Why a module function and not a component or a hook:
 * - There's no UI to render — this is pure side-effect coordination.
 * - The fetch is fire-and-forget from KickChat: it runs in the background
 *   after the live Pusher subscription is up, then prepends history into the
 *   store so the live feed isn't disrupted by the latency of the v2 fetch.
 *
 * Why messages get an `isHistorical: true` flag:
 *   so the renderer can dim them (opacity 0.6) and the user can visually tell
 *   what's pre-join context vs. what's flowing in live — same convention
 *   KickTalk uses with its `is_old` flag.
 */

import type {
  ChatMessage,
  KickPinnedMessage,
  NormalizedPinnedMessage,
} from "../../../shared/chat-types";

import { kickPinToNormalized } from "../../../backend/services/chat/kick-chat";
import {
  type KickChatMessageEvent,
  parseKickChatMessage,
  type SubscriberBadge,
} from "../../../backend/services/chat/kick-parser";

export interface SeedKickChatHistoryParams {
  /** Kick channel's internal db id (from `UnifiedChannel.id`). */
  channelId: string;
  /** Channel slug — stamped on each ChatMessage's `channel` field. */
  channel: string;
  /** Returns false once the host effect has been torn down — checked between awaits. */
  isMounted: () => boolean;
  /** Insert these parsed messages at the front of the store. */
  prependMessages: (messages: ChatMessage[]) => void;
  /** Subscriber-badge lookup for the channel; pass undefined if unloaded. */
  subscriberBadges: SubscriberBadge[] | undefined;
  /** Restore the pinned-message banner if the history payload includes one. */
  onPinnedMessage: (pin: NormalizedPinnedMessage) => void;
}

/**
 * Fetch + parse history for `channelId` and prepend it to the chat store.
 * Best-effort: any Cloudflare challenge / network failure resolves to a no-op
 * rather than throwing, so the caller can fall back to live-only.
 */
export async function seedKickChatHistory(params: SeedKickChatHistoryParams): Promise<void> {
  const { channelId, channel, isMounted, prependMessages, subscriberBadges, onPinnedMessage } =
    params;

  try {
    const result = await window.electronAPI.chat.getKickHistory({ channelId });
    if (!isMounted()) return;
    if (!result.success || !result.data) return;

    const { messages: rawMessages, pinnedMessage: rawPinned } = result.data;

    if (rawMessages.length > 0) {
      // v2 returns newest-first; reverse so the prepended block lands in
      // chronological order (oldest at the top, newest just above the
      // already-stored Connecting/live entries).
      const parsed: ChatMessage[] = [];
      for (let i = rawMessages.length - 1; i >= 0; i--) {
        const raw = rawMessages[i];
        let parsedMetadata: KickChatMessageEvent["metadata"];
        if (raw.metadata) {
          try {
            parsedMetadata = JSON.parse(raw.metadata);
          } catch {
            parsedMetadata = undefined;
          }
        }
        const event: KickChatMessageEvent = {
          id: raw.id,
          chatroom_id: raw.chatroom_id,
          content: raw.content,
          type: raw.type,
          created_at: raw.created_at,
          sender: raw.sender,
          metadata: parsedMetadata,
        };
        const message = parseKickChatMessage(event, channel, subscriberBadges);
        message.isHistorical = true;
        parsed.push(message);
      }
      prependMessages(parsed);
    }

    if (rawPinned) {
      onPinnedMessage(kickPinToNormalized(rawPinned as KickPinnedMessage));
    }
  } catch (error) {
    console.debug("[seedKickChatHistory] failed:", error);
  }
}
