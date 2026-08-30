/**
 * Kick chat-history seeding
 *
 * Pulls the recent-message page Kick returns for a channel so users see prior
 * context on join, the way the official site and KickTalk do.
 *
 * Why a module function and not a component or a hook:
 * - There's no UI to render — this is pure side-effect coordination.
 * - KickChat awaits the fetch before subscribing to the live feed so history
 *   is inserted before live messages and connection markers.
 *
 * Why messages get an `isHistorical: true` flag:
 *   so the renderer can dim them (opacity 0.6) and the user can visually tell
 *   what's pre-join context vs. what's flowing in live — same convention
 *   KickTalk uses with its `is_old` flag.
 */

import { logger } from "@/renderer/logging/logger";
import { kickPinToNormalized } from "../../../../../../backend/services/chat/kick-chat";
import {
  type KickChatMessageEvent,
  parseKickChatMessage,
  type SubscriberBadge,
} from "../../../../../../backend/services/chat/kick-parser";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../../../../../shared/auth-types";
import type {
  ChatMessage,
  KickPinnedMessage,
  NormalizedPinnedMessage,
} from "../../../../../../shared/chat-types";
import { useAuthStore } from "../../../../../store/auth-store";
import { buildChannelKey } from "../../../../../store/chat-store";
import { resolveChatDisplayPreferences } from "../chat-display-preferences";

export interface SeedKickChatHistoryParams {
  /** Kick channel's internal db id (from `UnifiedChannel.id`). */
  channelId: string;
  /** Channel slug — stamped on each ChatMessage's `channel` field. */
  channel: string;
  /** Returns false once the host effect has been torn down — checked between awaits. */
  isMounted: () => boolean;
  /** Insert these parsed messages at the front of the store. */
  prependMessages: (channelKey: string, messages: ChatMessage[]) => void;
  /** Subscriber-badge lookup for the channel; pass undefined if unloaded. */
  subscriberBadges: SubscriberBadge[] | undefined;
  /** Restore the pinned-message banner if the history payload includes one. */
  onPinnedMessage: (pin: NormalizedPinnedMessage) => void;
  /** Observe parsed history messages for page-load role seeding. */
  onParsedMessages?: (messages: ChatMessage[]) => void;
}

export type KickChatHistoryResult = "loaded" | "empty" | "unavailable" | "disabled" | "cancelled";

/**
 * Fetch + parse history for `channelId` and prepend it to the chat store.
 * Best-effort: any Cloudflare challenge / network failure resolves to a no-op
 * rather than throwing, so the caller can fall back to live-only.
 */
export async function seedKickChatHistory(
  params: SeedKickChatHistoryParams
): Promise<KickChatHistoryResult> {
  const {
    channelId,
    channel,
    isMounted,
    prependMessages,
    subscriberBadges,
    onPinnedMessage,
    onParsedMessages,
  } = params;

  // U5 — `recentMessagesOnJoin` gates the recent-message seed; `recentMessagesLimit`
  // caps how many seed. The pinned-message restore below is a distinct feature
  // (its own banner) and is not gated by this toggle.
  const cd = resolveChatDisplayPreferences(useAuthStore.getState().preferences?.chatDisplay);
  const seedRecent = cd.recentMessagesOnJoin;
  const limit =
    Number.isFinite(cd.recentMessagesLimit) && cd.recentMessagesLimit > 0
      ? Math.floor(cd.recentMessagesLimit)
      : DEFAULT_CHAT_DISPLAY_PREFERENCES.recentMessagesLimit;

  try {
    const result = await window.electronAPI.chat.getKickHistory({
      channelId,
      channelSlug: channel,
    });
    if (!isMounted()) return "cancelled";
    if (!result.success || !result.data) return "unavailable";

    const { messages: rawMessages, pinnedMessage: rawPinned } = result.data;

    const parseRawMessage = (raw: (typeof rawMessages)[number]): ChatMessage => {
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
      return parseKickChatMessage(event, channel, subscriberBadges);
    };

    if (rawMessages.length > 0 && onParsedMessages) {
      onParsedMessages(rawMessages.map(parseRawMessage));
    }

    if (seedRecent && rawMessages.length > 0) {
      // Kick returns newest-first; reverse so the prepended block lands in
      // chronological order (oldest at the top, newest just above the
      // already-stored Connecting/live entries). Cap to the most-recent
      // `limit` entries — slice the head of the newest-first array before
      // reversing so the kept block is the freshest.
      const sourced = rawMessages.length > limit ? rawMessages.slice(0, limit) : rawMessages;
      const parsed: ChatMessage[] = [];
      for (let i = sourced.length - 1; i >= 0; i--) {
        const raw = sourced[i];
        const message = parseRawMessage(raw);
        message.isHistorical = true;
        parsed.push(message);
      }
      prependMessages(buildChannelKey("kick", channel), parsed);
    }

    if (rawPinned) {
      onPinnedMessage(kickPinToNormalized(rawPinned as KickPinnedMessage));
    }
    if (!seedRecent) return "disabled";
    return rawMessages.length > 0 ? "loaded" : "empty";
  } catch (error) {
    logger.debug("UI:Chat:KickHistory", "seed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "unavailable";
  }
}
