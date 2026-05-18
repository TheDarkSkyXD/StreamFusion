/**
 * Twitch chat-history seeding
 *
 * Pulls recent chat from recent-messages.robotty.de so users see prior
 * context on join, mirroring what Chatterino and similar desktop clients do.
 *
 * Why a module function and not a component or a hook:
 * - There's no UI to render — this is pure side-effect coordination.
 * - The fetch runs once during the connect flow, before joining the live IRC
 *   feed, so history reliably lands above the "Connecting…" marker.
 *
 * Why messages get `isHistorical: true`:
 *   the renderer dims them (opacity 0.6) so users can visually tell what's
 *   pre-join context vs. what's flowing in live — same convention used for
 *   the Kick history seed.
 */

import { parseRawTwitchIrcLine } from "../../../backend/services/chat/twitch-irc-parser";
import { parseTwitchMessage } from "../../../backend/services/chat/twitch-parser";
import type { ChatMessage } from "../../../shared/chat-types";

export interface SeedTwitchChatHistoryParams {
  /** Channel login (slug) — recent-messages.robotty.de takes the login, not the broadcaster id. */
  channel: string;
  /** Returns false once the host effect has been torn down — checked between awaits. */
  isMounted: () => boolean;
  /** Insert these parsed messages at the front of the store. */
  prependMessages: (messages: ChatMessage[]) => void;
}

/**
 * Fetch + parse history for `channel` and prepend it to the chat store.
 * Best-effort: any network/service failure resolves to a no-op rather than
 * throwing, so the caller can fall back to live-only.
 */
export async function seedTwitchChatHistory(params: SeedTwitchChatHistoryParams): Promise<void> {
  const { channel, isMounted, prependMessages } = params;

  try {
    const result = await window.electronAPI.chat.getTwitchHistory({ channel });
    if (!isMounted()) return;
    if (!result.success || !result.data) return;

    const { rawMessages } = result.data;
    if (rawMessages.length === 0) return;

    // recent-messages.robotty.de returns messages oldest-first, which is the
    // order we want to prepend in — the array's first entry lands at the top
    // of the chat panel, the last entry just above the "Connecting…" marker.
    const parsed: ChatMessage[] = [];
    for (const raw of rawMessages) {
      const line = parseRawTwitchIrcLine(raw);
      if (!line) continue;

      const tmiSentTs = line.tags["tmi-sent-ts"];
      const timestamp =
        typeof tmiSentTs === "string" && tmiSentTs ? new Date(parseInt(tmiSentTs, 10)) : new Date();

      if (line.command === "PRIVMSG") {
        const message = parseTwitchMessage(line.channel, line.tags, line.message, false);
        // parseTwitchMessage stamps `new Date()` — fine for live messages but
        // wrong for history; override with the server-side send time.
        message.timestamp = timestamp;
        message.isHistorical = true;
        parsed.push(message);
      } else if (line.command === "USERNOTICE") {
        const systemMsg = line.tags["system-msg"];
        if (typeof systemMsg !== "string" || !systemMsg) continue;
        const id =
          typeof line.tags.id === "string" && line.tags.id ? line.tags.id : crypto.randomUUID();
        const userId = typeof line.tags["user-id"] === "string" ? line.tags["user-id"] : "";
        parsed.push({
          id,
          platform: "twitch",
          type: "system",
          channel: line.channel,
          userId,
          username: "System",
          displayName: "System",
          color: "#808080",
          badges: [],
          content: [{ type: "text", content: systemMsg }],
          rawContent: systemMsg,
          timestamp,
          isDeleted: false,
          isHighlighted: true,
          isAction: false,
          isHistorical: true,
        });
      }
    }

    if (parsed.length > 0) prependMessages(parsed);
  } catch (error) {
    console.debug("[seedTwitchChatHistory] failed:", error);
  }
}
