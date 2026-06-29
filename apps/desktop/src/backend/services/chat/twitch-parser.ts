/**
 * Twitch IRC Message Parser
 *
 * Parses raw Twitch IRC messages and tmi.js events into our
 * unified ChatMessage format.
 */

import type {
  ChatBadge,
  ChatMessage,
  ContentFragment,
  EmotePosition,
  MessageType,
  ReplyInfo,
} from "../../../shared/chat-types";

// ========== Types ==========

/** Raw emote position from Twitch IRC tags */
interface TwitchEmoteTag {
  id: string;
  positions: Array<{ start: number; end: number }>;
}

/** tmi.js userstate/tags object */
export interface TwitchTags {
  "badge-info"?: { [key: string]: string };
  badges?: { [key: string]: string };
  color?: string;
  "display-name"?: string;
  emotes?: { [emoteId: string]: string[] } | null;
  id?: string;
  mod?: boolean;
  "room-id"?: string;
  subscriber?: boolean;
  turbo?: boolean;
  "user-id"?: string;
  "user-type"?: "" | "admin" | "global_mod" | "staff";
  "message-type"?: "action" | "chat" | "whisper";
  "reply-parent-msg-id"?: string;
  "reply-parent-user-id"?: string;
  "reply-parent-user-login"?: string;
  "reply-parent-display-name"?: string;
  "reply-parent-msg-body"?: string;
  "first-msg"?: boolean;
  "returning-chatter"?: boolean;
  bits?: string;
  "custom-reward-id"?: string;
  "msg-id"?: string;
  // Moderation event tags
  "target-user-id"?: string;
  "target-msg-id"?: string;
  "system-msg"?: string;
  // Allow additional string keys for extensibility
  [key: string]:
    | string
    | boolean
    | { [key: string]: string }
    | { [emoteId: string]: string[] }
    | null
    | undefined;
}

// ========== Default Color ==========

const DEFAULT_COLORS = [
  "#FF0000",
  "#0000FF",
  "#00FF00",
  "#B22222",
  "#FF7F50",
  "#9ACD32",
  "#FF4500",
  "#2E8B57",
  "#DAA520",
  "#D2691E",
  "#5F9EA0",
  "#1E90FF",
  "#FF69B4",
  "#8A2BE2",
  "#00FF7F",
];

/**
 * Get a consistent color for a user based on their username
 */
export function getDefaultColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

// ========== Emote Parsing ==========

/**
 * Parse Twitch emote tags into EmotePosition array
 */
function parseEmoteTags(
  emotesTag: { [emoteId: string]: string[] } | null | undefined
): TwitchEmoteTag[] {
  if (!emotesTag) return [];

  const emotes: TwitchEmoteTag[] = [];

  for (const [emoteId, positions] of Object.entries(emotesTag)) {
    const parsedPositions = positions.map((pos) => {
      const [start, end] = pos.split("-").map(Number);
      return { start, end: end + 1 }; // Make end exclusive
    });
    emotes.push({ id: emoteId, positions: parsedPositions });
  }

  return emotes;
}

/**
 * Get Twitch emote URL
 */
function getTwitchEmoteUrl(emoteId: string, size: "1.0" | "2.0" | "3.0" = "3.0"): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/${size}`;
}

// ========== Content Parsing ==========

/**
 * Parse message content into ContentFragment array
 * Handles emotes, mentions, and links
 */
function parseContent(message: string, emoteTags: TwitchEmoteTag[]): ContentFragment[] {
  const fragments: ContentFragment[] = [];

  // Build a map of positions to emotes
  const emotePositions: EmotePosition[] = [];

  for (const emote of emoteTags) {
    for (const pos of emote.positions) {
      const emoteName = message.substring(pos.start, pos.end);
      emotePositions.push({
        emote: {
          id: emote.id,
          name: emoteName,
          url: getTwitchEmoteUrl(emote.id),
          provider: "twitch",
        },
        start: pos.start,
        end: pos.end,
      });
    }
  }

  // Sort by position
  emotePositions.sort((a, b) => a.start - b.start);

  // Build fragments
  let currentIndex = 0;

  for (const emotePos of emotePositions) {
    // Add text before emote
    if (currentIndex < emotePos.start) {
      const textBefore = message.substring(currentIndex, emotePos.start);
      fragments.push(...parseTextFragment(textBefore));
    }

    // Add emote. Native Twitch emotes are never zero-width overlays (only
    // third-party 7TV/FFZ emotes carry that flag), so `isZeroWidth` is always
    // false here — the field is threaded through so the renderer's overlay
    // gate is uniform across fragment sources (U3).
    fragments.push({
      type: "emote",
      id: emotePos.emote.id,
      name: emotePos.emote.name,
      url: emotePos.emote.url,
      isZeroWidth: false,
    });

    currentIndex = emotePos.end;
  }

  // Add remaining text
  if (currentIndex < message.length) {
    const remainingText = message.substring(currentIndex);
    fragments.push(...parseTextFragment(remainingText));
  }

  return fragments;
}

/**
 * Parse a text fragment for mentions and links
 */
function parseTextFragment(text: string): ContentFragment[] {
  const fragments: ContentFragment[] = [];

  // URL regex
  const urlRegex = /https?:\/\/[^\s]+/g;
  // Mention regex
  const mentionRegex = /@(\w+)/g;

  // Combined parsing - find all special tokens
  const tokens: Array<{
    type: "url" | "mention";
    value: string;
    start: number;
    end: number;
    username?: string;
  }> = [];

  // Find URLs
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    tokens.push({
      type: "url",
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Find mentions
  while ((match = mentionRegex.exec(text)) !== null) {
    tokens.push({
      type: "mention",
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
      username: match[1],
    });
  }

  // Sort by position
  tokens.sort((a, b) => a.start - b.start);

  // Build fragments
  let currentIndex = 0;

  for (const token of tokens) {
    // Skip overlapping tokens (shouldn't happen, but be safe)
    if (token.start < currentIndex) continue;

    // Add text before token
    if (currentIndex < token.start) {
      const textBefore = text.substring(currentIndex, token.start);
      if (textBefore) {
        fragments.push({ type: "text", content: textBefore });
      }
    }

    // Add token
    if (token.type === "url") {
      fragments.push({
        type: "link",
        url: token.value,
        text: token.value,
      });
    } else if (token.type === "mention" && token.username) {
      fragments.push({
        type: "mention",
        username: token.username,
      });
    }

    currentIndex = token.end;
  }

  // Add remaining text
  if (currentIndex < text.length) {
    const remainingText = text.substring(currentIndex);
    if (remainingText) {
      fragments.push({ type: "text", content: remainingText });
    }
  }

  // If no tokens found, just return the text
  if (fragments.length === 0 && text) {
    fragments.push({ type: "text", content: text });
  }

  return fragments;
}

// ========== Badge Parsing ==========

/**
 * Parse badge tags into basic badge info
 * Full badge resolution (with images) is done by BadgeResolver
 */
export function parseBadgeTags(badgesTag: { [key: string]: string } | undefined): ChatBadge[] {
  if (!badgesTag) return [];

  return Object.entries(badgesTag).map(([setId, version]) => ({
    setId,
    version,
    // Placeholder - will be resolved by BadgeResolver
    imageUrl: "",
    title: setId,
  }));
}

// ========== Reply Parsing ==========

/**
 * Parse reply information from tags
 */
function parseReplyInfo(tags: TwitchTags): ReplyInfo | undefined {
  if (!tags["reply-parent-msg-id"]) return undefined;

  return {
    parentMessageId: tags["reply-parent-msg-id"],
    parentUserId: tags["reply-parent-user-id"] ?? "",
    parentUsername: tags["reply-parent-user-login"] ?? "",
    parentDisplayName: tags["reply-parent-display-name"] ?? "",
    parentMessageBody: tags["reply-parent-msg-body"] ?? "",
  };
}

// ========== Main Parser ==========

/**
 * Parse a tmi.js message event into our ChatMessage format
 */
export function parseTwitchMessage(
  channel: string,
  tags: TwitchTags,
  message: string,
  _self: boolean
): ChatMessage {
  const username = tags["display-name"]?.toLowerCase() ?? "";
  const emoteTags = parseEmoteTags(tags.emotes);

  // Determine message type
  let messageType: MessageType = "message";
  if (tags["message-type"] === "action") {
    messageType = "action";
  } else if (tags.bits) {
    messageType = "bits";
  }

  // Handle /me action messages (tmi.js strips the /me but sets message-type)
  const isAction = tags["message-type"] === "action";

  return {
    id: tags.id ?? crypto.randomUUID(),
    platform: "twitch",
    type: messageType,
    channel: channel.replace("#", ""),
    userId: tags["user-id"] ?? "",
    username,
    displayName: tags["display-name"] ?? username,
    color: tags.color || getDefaultColor(username),
    badges: parseBadgeTags(tags.badges),
    content: parseContent(message, emoteTags),
    rawContent: message,
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: tags["first-msg"] === true || !!tags["custom-reward-id"],
    highlightKind: tags.bits
      ? "cheer"
      : tags["custom-reward-id"]
        ? "highlighted-message"
        : tags["first-msg"] === true
          ? "first-time-chat"
          : undefined,
    isAction,
    replyTo: parseReplyInfo(tags),
    bits: tags.bits ? parseInt(tags.bits, 10) : undefined,
  };
}

/**
 * Parse a /me action message with the action indicator
 */
function formatActionMessage(message: ChatMessage): string {
  if (message.isAction) {
    return `${message.displayName} ${message.rawContent}`;
  }
  return message.rawContent;
}
