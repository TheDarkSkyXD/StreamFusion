/**
 * Kick WebSocket Message Parser
 *
 * Parses Kick Pusher WebSocket messages into our unified ChatMessage format.
 * Handles chat messages, events (subs, gifts, raids), and moderation actions.
 */

import { getBundledBadgeUrl } from "../../../assets/platforms/kick/badges";
import type {
  ChatBadge,
  ChatMessage,
  ClearChat,
  ContentFragment,
  MessageDeletion,
  MessageType,
  UserNotice,
} from "../../../shared/chat-types";

// ========== Kick WebSocket Event Types ==========

/** Raw Kick chat message from Pusher WebSocket */
export interface KickChatMessageEvent {
  id: string;
  chatroom_id: number;
  content: string;
  type: string; // 'message', 'reply', etc.
  created_at: string;
  sender: {
    id: number;
    username: string;
    slug: string;
    identity: {
      color: string;
      badges: KickBadge[];
    };
  };
  metadata?: {
    original_sender?: {
      id: number;
      username: string;
    };
    original_message?: {
      id: string;
      content: string;
    };
  };
}

/** Kick badge structure */
export interface KickBadge {
  type: string; // 'subscriber', 'moderator', 'broadcaster', 'vip', 'og', 'founder', 'verified'
  text: string;
  count?: number; // For subscriber months
}

/** Kick subscription event */
export interface KickSubscriptionEvent {
  chatroom_id: number;
  username: string;
  months: number;
}

/** Kick gifted subscription event */
export interface KickGiftedSubEvent {
  chatroom_id: number;
  gifter_username: string;
  gifted_usernames: string[];
}

/** Kick user banned event */
export interface KickUserBannedEvent {
  id: string;
  user: {
    id: number;
    username: string;
    slug: string;
  };
  banned_by?: {
    id: number;
    username: string;
    slug: string;
  };
  permanent?: boolean;
  duration?: number; // In minutes
}

/** Kick user unbanned event */
export interface KickUserUnbannedEvent {
  id: string;
  user: {
    id: number;
    username: string;
    slug: string;
  };
  unbanned_by?: {
    id: number;
    username: string;
    slug: string;
  };
}

/** Kick message deleted event */
export interface KickMessageDeletedEvent {
  id: string;
  message: {
    id: string;
  };
}

/** Kick chat cleared event */
export interface KickChatClearedEvent {
  id: string;
}

/** Kick host/raid event */
export interface KickHostRaidEvent {
  chatroom_id: number;
  host_username?: string;
  number_viewers?: number;
  optional_message?: string;
}

/** Kick follow event */
export interface KickFollowEvent {
  chatroom_id: number;
  username: string;
  followers_count: number;
}

// ========== Pusher Protocol Types ==========

export interface PusherEvent {
  event: string;
  channel?: string;
  data: string; // JSON string
}

export type KickEventType =
  | "App\\Events\\ChatMessageEvent"
  | "App\\Events\\MessageDeletedEvent"
  | "App\\Events\\UserBannedEvent"
  | "App\\Events\\UserUnbannedEvent"
  | "App\\Events\\ChatroomClearEvent"
  | "App\\Events\\SubscriptionEvent"
  | "App\\Events\\GiftedSubscriptionsEvent"
  | "App\\Events\\FollowersUpdated"
  | "App\\Events\\StreamHostEvent"
  | "App\\Events\\ChatMoveToBannedEvent"
  | "App\\Events\\PollUpdateEvent"
  | "App\\Events\\PinnedMessageCreatedEvent"
  | "App\\Events\\PinnedMessageDeletedEvent";

// ========== Hot-path Regexes (module-scope to avoid per-message allocation) ==========
// All carry /g — callers use `.matchAll()` (or `.replace()` for KICK_EMOTE_REGEX)
// so `lastIndex` state is not shared across invocations.

const KICK_EMOTE_REGEX = /\[emote:(\d+):([^\]]+)\]/g;
const URL_REGEX = /https?:\/\/[^\s]+/g;
const MENTION_REGEX = /@(\w+)/g;

// ========== Default Colors ==========

const DEFAULT_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
  "#F8B500",
  "#00CED1",
  "#FF6347",
  "#7B68EE",
  "#3CB371",
];

/**
 * Get a consistent color for a user based on their username
 */
function getDefaultColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

// ========== Badge Mapping ==========

// Badge URLs are now provided by bundled local assets instead of external CDNs
// See: src/assets/platforms/kick/badges/index.ts
// This eliminates dependency on unreliable third-party CDNs like cdn.kicktalk.app

// ========== Subscriber Badge Type ==========

export interface SubscriberBadge {
  id: number;
  channel_id: number;
  months: number;
  badge_image: {
    src: string;
    srcset: string;
  };
}

/**
 * Map Kick badges to our unified ChatBadge format
 * Uses bundled local badge assets - no external CDN required
 */
function parseKickBadges(badges: KickBadge[], subscriberBadges?: SubscriberBadge[]): ChatBadge[] {
  return badges.map((badge) => {
    // Use bundled badge assets (embedded as data URIs)
    let imageUrl = getBundledBadgeUrl(badge.type) || "";
    const title = badge.text || badge.type;

    // Custom Subscriber Badge Logic - channel-specific badges from API
    if (badge.type === "subscriber" && subscriberBadges?.length) {
      const months = badge.count || 0;
      // Sort descending by months, find first badge where user months >= badge months.
      // toSorted() returns a copy — callers must not have their input mutated.
      const match = subscriberBadges
        .toSorted((a, b) => b.months - a.months)
        .find((b) => months >= b.months);

      if (match) {
        // Use channel's custom subscriber badge (from Kick API)
        imageUrl = match.badge_image.src;
      }
    }

    return {
      setId: badge.type,
      version: badge.count?.toString() ?? "1",
      imageUrl,
      title,
    };
  });
}

// ========== Content Parsing ==========

/**
 * Parse emotes from Kick message content
 * Kick uses [emote:id:name] format in messages
 */
function parseKickEmotes(content: string): { cleanContent: string; fragments: ContentFragment[] } {
  const fragments: ContentFragment[] = [];

  // matchAll() avoids the shared-lastIndex hazard of reusing a module-scope /g regex.
  const matches = Array.from(content.matchAll(KICK_EMOTE_REGEX));

  let lastIndex = 0;
  for (const m of matches) {
    const start = m.index ?? 0;
    const end = start + m[0].length;

    if (lastIndex < start) {
      const textBefore = content.substring(lastIndex, start);
      if (textBefore) {
        fragments.push(...parseTextFragment(textBefore));
      }
    }

    fragments.push({
      type: "emote",
      id: m[1],
      name: m[2],
      url: getKickEmoteUrl(m[1]),
    });

    lastIndex = end;
  }

  if (lastIndex < content.length) {
    const remainingText = content.substring(lastIndex);
    if (remainingText) {
      fragments.push(...parseTextFragment(remainingText));
    }
  }

  // Clean content for raw display — .replace() with /g regex is safe (it iterates
  // internally without sharing lastIndex state to the caller).
  const cleanContent = content.replace(KICK_EMOTE_REGEX, (_, __, name) => name);

  // If no emotes found, parse the whole content as text
  if (fragments.length === 0 && content) {
    fragments.push(...parseTextFragment(content));
  }

  return { cleanContent, fragments };
}

/**
 * Get Kick emote URL
 */
function getKickEmoteUrl(emoteId: string): string {
  return `https://files.kick.com/emotes/${emoteId}/fullsize`;
}

/**
 * Parse text fragment for mentions and links
 */
function parseTextFragment(text: string): ContentFragment[] {
  const fragments: ContentFragment[] = [];

  // Combined parsing - find all special tokens.
  // matchAll() avoids the shared-lastIndex hazard of reusing module-scope /g regexes.
  const tokens: Array<{
    type: "url" | "mention";
    value: string;
    start: number;
    end: number;
    username?: string;
  }> = [];

  for (const m of text.matchAll(URL_REGEX)) {
    const start = m.index ?? 0;
    tokens.push({
      type: "url",
      value: m[0],
      start,
      end: start + m[0].length,
    });
  }

  for (const m of text.matchAll(MENTION_REGEX)) {
    const start = m.index ?? 0;
    tokens.push({
      type: "mention",
      value: m[0],
      start,
      end: start + m[0].length,
      username: m[1],
    });
  }

  // Sort by position
  tokens.sort((a, b) => a.start - b.start);

  // Build fragments
  let currentIndex = 0;

  for (const token of tokens) {
    // Skip overlapping tokens
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

// ========== Main Parsers ==========

/**
 * Parse a Kick chat message event into our unified ChatMessage format
 */
export function parseKickChatMessage(
  event: KickChatMessageEvent,
  channel: string,
  subscriberBadges?: SubscriberBadge[]
): ChatMessage {
  const { cleanContent, fragments } = parseKickEmotes(event.content);

  // Determine message type
  let messageType: MessageType = "message";
  if (event.type === "reply") {
    messageType = "message"; // Replies are still messages, but with replyTo set
  }

  // Parse reply info if present
  const replyTo = event.metadata?.original_message
    ? {
        parentMessageId: event.metadata.original_message.id,
        parentUserId: event.metadata.original_sender?.id.toString() ?? "",
        parentUsername: event.metadata.original_sender?.username ?? "",
        parentDisplayName: event.metadata.original_sender?.username ?? "",
        parentMessageBody: event.metadata.original_message.content,
      }
    : undefined;

  return {
    id: event.id,
    platform: "kick",
    type: messageType,
    channel,
    userId: event.sender.id.toString(),
    username: event.sender.slug,
    displayName: event.sender.username,
    color: event.sender.identity.color || getDefaultColor(event.sender.username),
    badges: parseKickBadges(event.sender.identity.badges, subscriberBadges),
    content: fragments,
    rawContent: cleanContent,
    timestamp: new Date(event.created_at),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
    replyTo,
  };
}

/**
 * Parse a Kick subscription event into our UserNotice format
 */
export function parseKickSubscription(event: KickSubscriptionEvent, channel: string): UserNotice {
  const isResub = event.months > 1;

  return {
    id: crypto.randomUUID(),
    platform: "kick",
    channel,
    type: isResub ? "resub" : "sub",
    userId: "",
    username: event.username.toLowerCase(),
    displayName: event.username,
    systemMessage: isResub
      ? `${event.username} has resubscribed for ${event.months} months!`
      : `${event.username} subscribed!`,
    timestamp: new Date(),
    months: event.months,
    cumulativeMonths: event.months,
  };
}

/**
 * Parse a Kick gifted subscription event into our UserNotice format
 */
export function parseKickGiftedSub(event: KickGiftedSubEvent, channel: string): UserNotice {
  const count = event.gifted_usernames.length;
  const systemMessage =
    count === 1
      ? `${event.gifter_username} gifted a subscription to ${event.gifted_usernames[0]}!`
      : `${event.gifter_username} gifted ${count} subscriptions!`;

  return {
    id: crypto.randomUUID(),
    platform: "kick",
    channel,
    type: "subgift",
    userId: "",
    username: event.gifter_username.toLowerCase(),
    displayName: event.gifter_username,
    systemMessage,
    timestamp: new Date(),
    giftCount: count,
  };
}

/**
 * Parse a Kick user banned event into our ClearChat format
 */
export function parseKickUserBanned(event: KickUserBannedEvent, channel: string): ClearChat {
  return {
    platform: "kick",
    channel,
    targetUserId: event.user.id.toString(),
    targetUsername: event.user.username,
    bannedByUsername: event.banned_by?.username,
    duration: event.permanent ? undefined : (event.duration ?? 0) * 60, // Convert minutes to seconds
    isClearAll: false,
    timestamp: new Date(),
  };
}

/**
 * Parse a Kick message deleted event
 */
export function parseKickMessageDeleted(
  event: KickMessageDeletedEvent,
  channel: string
): MessageDeletion {
  return {
    platform: "kick",
    channel,
    messageId: event.message.id,
    timestamp: new Date(),
  };
}

/**
 * Parse a Kick chat cleared event
 */
export function parseKickChatCleared(_event: KickChatClearedEvent, channel: string): ClearChat {
  return {
    platform: "kick",
    channel,
    isClearAll: true,
    timestamp: new Date(),
  };
}

/**
 * Parse a Kick host/raid event into our UserNotice format
 */
export function parseKickHostRaid(event: KickHostRaidEvent, channel: string): UserNotice {
  return {
    id: crypto.randomUUID(),
    platform: "kick",
    channel,
    type: "raid",
    userId: "",
    username: event.host_username?.toLowerCase() ?? "",
    displayName: event.host_username ?? "",
    systemMessage: `${event.host_username} is raiding with ${event.number_viewers} viewers!`,
    timestamp: new Date(),
    viewerCount: event.number_viewers,
  };
}

// ========== Utility Functions ==========

/**
 * Check if user has broadcaster badge
 */
export function isBroadcaster(badges: ChatBadge[]): boolean {
  return badges.some((b) => b.setId === "broadcaster");
}

/**
 * Check if user has moderator badge
 */
export function isModerator(badges: ChatBadge[]): boolean {
  return badges.some((b) => b.setId === "moderator" || b.setId === "broadcaster");
}

/**
 * Check if user has VIP badge
 */
export function isVIP(badges: ChatBadge[]): boolean {
  return badges.some((b) => b.setId === "vip");
}

/**
 * Check if user has subscriber badge
 */
export function isSubscriber(badges: ChatBadge[]): boolean {
  return badges.some((b) => b.setId === "subscriber" || b.setId === "founder");
}
