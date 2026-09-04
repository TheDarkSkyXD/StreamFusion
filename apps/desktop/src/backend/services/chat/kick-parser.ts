/**
 * Kick WebSocket Message Parser
 *
 * Parses Kick Pusher WebSocket messages into our unified ChatMessage format.
 * Handles chat messages, events (subs, gifts, raids), and moderation actions.
 */

import { getBundledBadgeUrl } from "../../../frontend/assets/platforms/kick/badges";
import type {
  ChatMessage,
  ClearChat,
  MessageDeletion,
  SubscriberBadge,
  UserNotice,
} from "../../../shared/chat-types";
import {
  ChatBadge,
  ContentFragment,
  ChatMessageType as MessageType,
} from "@streamfusion/core/chat";
import {
  RAID_CONTRACT_PROFILES,
  isValidRaidChannelSlug,
  normalizeRaidChannelSlug,
  type KickRaidSource,
  type KickRaidTarget,
  type RaidHandoffEvent,
} from "../../../shared/raid-handoff-types";

export type { SubscriberBadge } from "../../../shared/chat-types";

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
    profile_pic?: string | null;
    profile_picture?: string | null;
    avatar?: string | null;
    avatar_url?: string | null;
    user?: {
      profile_pic?: string | null;
      profile_picture?: string | null;
      avatar?: string | null;
      avatar_url?: string | null;
    };
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

export interface KickOfficialChatMessageSentEvent {
  message_id: string;
  broadcaster_user_id: number;
  channel_slug: string;
  content: string;
  created_at: string;
  sender: {
    user_id: number;
    username: string;
    profile_picture?: string | null;
    identity?: {
      color?: string | null;
      badges?: KickBadge[];
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
interface KickMessageDeletedActor {
  id?: number | string;
  username?: string;
  slug?: string;
  name?: string;
  display_name?: string;
}

export interface KickMessageDeletedEvent {
  id: string;
  message: {
    id: string;
    deleted_by?: KickMessageDeletedActor | string | null;
    deletedBy?: KickMessageDeletedActor | string | null;
    moderator?: KickMessageDeletedActor | string | null;
    actor?: KickMessageDeletedActor | string | null;
  };
  deleted_by?: KickMessageDeletedActor | string | null;
  deletedBy?: KickMessageDeletedActor | string | null;
  moderator?: KickMessageDeletedActor | string | null;
  actor?: KickMessageDeletedActor | string | null;
  bot?: KickMessageDeletedActor | string | null;
  automod?: KickMessageDeletedActor | string | null;
  auto_mod?: KickMessageDeletedActor | string | null;
  automation?: KickMessageDeletedActor | string | null;
  source?: KickMessageDeletedActor | string | null;
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
export function getDefaultColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

function getKickSenderAvatarUrl(sender: KickChatMessageEvent["sender"]): string | undefined {
  return (
    sender.profile_picture ||
    sender.profile_pic ||
    sender.avatar_url ||
    sender.avatar ||
    sender.user?.profile_picture ||
    sender.user?.profile_pic ||
    sender.user?.avatar_url ||
    sender.user?.avatar ||
    undefined
  );
}

// ========== Badge Mapping ==========

// Badge URLs are now provided by bundled local assets instead of external CDNs
// See: src/frontend/assets/platforms/kick/badges/index.ts
// This eliminates dependency on unreliable third-party CDNs like cdn.kicktalk.app

/**
 * Map Kick badges to our unified ChatBadge format
 * Uses bundled local badge assets - no external CDN required
 */
export function parseKickBadges(
  badges: KickBadge[],
  subscriberBadges?: SubscriberBadge[]
): ChatBadge[] {
  return badges.map((badge) => {
    // Use bundled badge assets (embedded as data URIs). Sub-gifter badges use
    // Kick's current count-tiered gift icon colors, so pass the count through.
    let imageUrl = getBundledBadgeUrl(badge.type, badge.count) || "";
    // Sub-gifter badges carry the gift count in `badge.count`. Surface it in
    // the tooltip title so hovering reveals Kick-style text like
    // "Gifted 50 subs", consistent with subscriber month-count tooltips.
    const baseTitle = badge.text || badge.type;
    const isSubGifter = badge.type === "sub_gifter" || badge.type === "subgifter";
    const isSubscriber = badge.type === "subscriber";
    const title = (() => {
      if (isSubGifter && typeof badge.count === "number" && badge.count > 0) {
        return `Gifted ${badge.count} ${badge.count === 1 ? "sub" : "subs"}`;
      }
      if (isSubscriber && typeof badge.count === "number" && badge.count > 0) {
        return `${badge.count}-Month Subscriber`;
      }
      return baseTitle;
    })();

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

export function resolveKickSubscriberBadges(
  badges: ChatBadge[],
  subscriberBadges: SubscriberBadge[]
): ChatBadge[] {
  if (subscriberBadges.length === 0) return badges;
  const ordered = subscriberBadges.toSorted((a, b) => b.months - a.months);
  return badges.map((badge) => {
    if (badge.setId !== "subscriber") return badge;
    const months = Number.parseInt(badge.version, 10) || 0;
    const match = ordered.find((candidate) => months >= candidate.months);
    return match ? { ...badge, imageUrl: match.badge_image.src } : badge;
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

    // Native Kick emotes are static, single-glyph emotes — never zero-width
    // overlays (only third-party 7TV emotes carry that flag). `isZeroWidth` is
    // threaded through as false so the renderer's overlay gate is uniform
    // across fragment sources (U3).
    fragments.push({
      type: "emote",
      id: m[1],
      name: m[2],
      url: getKickEmoteUrl(m[1]),
      isZeroWidth: false,
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
 * Parse a raw Kick message body into renderable fragments.
 * Handles `[emote:id:name]` markers, URLs, @mentions, and plain text.
 *
 * Exposed so both live chat (parseKickChatMessage) and pinned-message
 * normalization (kickPinToNormalized) share the exact same fragment rules —
 * without this, pin bodies would render URLs as inert text instead of
 * clickable anchors.
 */
export function parseKickMessageContent(content: string): ContentFragment[] {
  return parseKickEmotes(content).fragments;
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

export function parseKickOfficialChatMessageSent(
  event: KickOfficialChatMessageSentEvent,
  subscriberBadges?: SubscriberBadge[]
): ChatMessage {
  return parseKickChatMessage(
    {
      id: event.message_id,
      chatroom_id: event.broadcaster_user_id,
      content: event.content,
      type: "message",
      created_at: event.created_at,
      sender: {
        id: event.sender.user_id,
        username: event.sender.username,
        slug: event.sender.username.toLowerCase(),
        profile_picture: event.sender.profile_picture,
        identity: {
          color: event.sender.identity?.color ?? "",
          badges: event.sender.identity?.badges ?? [],
        },
      },
    },
    event.channel_slug,
    subscriberBadges
  );
}

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
    avatarUrl: getKickSenderAvatarUrl(event.sender),
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
function formatKickDeleteActorName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^auto[-_\s]?mod$/i.test(trimmed)) return "AutoMod";
  if (/^bot$/i.test(trimmed)) return "Bot";
  return trimmed;
}

function getKickDeleteActorName(
  actor: KickMessageDeletedActor | string | null | undefined
): string | undefined {
  if (!actor) return undefined;
  if (typeof actor === "string") return formatKickDeleteActorName(actor);
  return (
    formatKickDeleteActorName(actor.username ?? "") ??
    formatKickDeleteActorName(actor.display_name ?? "") ??
    formatKickDeleteActorName(actor.name ?? "") ??
    formatKickDeleteActorName(actor.slug ?? "")
  );
}

function getKickMessageDeletedActorName(event: KickMessageDeletedEvent): string | undefined {
  return (
    getKickDeleteActorName(event.deleted_by) ??
    getKickDeleteActorName(event.deletedBy) ??
    getKickDeleteActorName(event.moderator) ??
    getKickDeleteActorName(event.actor) ??
    getKickDeleteActorName(event.bot) ??
    getKickDeleteActorName(event.automod) ??
    getKickDeleteActorName(event.auto_mod) ??
    getKickDeleteActorName(event.automation) ??
    getKickDeleteActorName(event.source) ??
    getKickDeleteActorName(event.message.deleted_by) ??
    getKickDeleteActorName(event.message.deletedBy) ??
    getKickDeleteActorName(event.message.moderator) ??
    getKickDeleteActorName(event.message.actor)
  );
}

export function parseKickMessageDeleted(
  event: KickMessageDeletedEvent,
  channel: string
): MessageDeletion {
  const deletedByUsername = getKickMessageDeletedActorName(event);
  return {
    platform: "kick",
    channel,
    messageId: event.message.id,
    ...(deletedByUsername ? { deletedByUsername } : {}),
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

export type KickRaidParseResult =
  { kind: "event"; event: RaidHandoffEvent } | { kind: "ignored" } | { kind: "contract-mismatch" };

export function parseKickRaidNotification(
  eventName: string,
  raw: unknown,
  source: KickRaidSource,
  receivedAt: number,
  sessionId: string
): KickRaidParseResult {
  if (eventName !== "App\\Events\\ChatMoveToSupportedChannelEvent") {
    return { kind: "ignored" };
  }
  if (!isUnknownRecord(raw) || !isUnknownRecord(raw.hosted)) {
    return { kind: "contract-mismatch" };
  }

  const hosted = raw.hosted;
  const channelSlug = readRequiredString(hosted, "slug");
  const displayName = readRequiredString(hosted, "username");
  if (
    !channelSlug ||
    !displayName ||
    !isValidRaidChannelSlug(channelSlug) ||
    normalizeRaidChannelSlug(channelSlug) === normalizeRaidChannelSlug(source.channelSlug)
  ) {
    return { kind: "contract-mismatch" };
  }

  const avatarResult = readKickAvatar(hosted.profile_pic);
  if (avatarResult.kind === "invalid") return { kind: "contract-mismatch" };

  const viewersResult = readKickViewerCount(hosted.viewers_count);
  if (viewersResult.kind === "invalid") return { kind: "contract-mismatch" };

  const target: KickRaidTarget = {
    platform: "kick",
    channelSlug,
    displayName,
    ...(avatarResult.kind === "value" ? { avatarUrl: avatarResult.value } : {}),
  };
  const deadlineAt = receivedAt + 8_000;

  return {
    kind: "event",
    event: {
      phase: "offer",
      offer: {
        sessionId,
        platform: "kick",
        source,
        target,
        audience:
          viewersResult.kind === "value"
            ? { kind: "target-viewers", count: viewersResult.value }
            : { kind: "unknown" },
        progress: {
          kind: "timed",
          startedAt: receivedAt,
          endsAt: deadlineAt,
          provenance: "observed-first-party-client",
        },
        launchAuthority: {
          kind: "deadline",
          deadlineAt,
          provenance: "observed-first-party-client",
        },
        receivedAt,
        contract: RAID_CONTRACT_PROFILES.kick,
      },
    },
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

type OptionalBoundaryValue<T> =
  { kind: "missing" } | { kind: "value"; value: T } | { kind: "invalid" };

function readKickAvatar(value: unknown): OptionalBoundaryValue<string> {
  if (value === undefined || value === null || value === "") return { kind: "missing" };
  if (typeof value !== "string") return { kind: "invalid" };
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? { kind: "value", value }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function readKickViewerCount(value: unknown): OptionalBoundaryValue<number> {
  if (value === undefined || value === null) return { kind: "missing" };
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? { kind: "value", value }
    : { kind: "invalid" };
}

// ========== Utility Functions ==========

/**
 * Check if user has broadcaster badge
 */
function isBroadcaster(badges: ChatBadge[]): boolean {
  return badges.some((b) => b.setId === "broadcaster");
}

/**
 * Check if user has moderator badge
 */
function isModerator(badges: ChatBadge[]): boolean {
  return badges.some((b) => b.setId === "moderator" || b.setId === "broadcaster");
}

/**
 * Check if user has VIP badge
 */
function isVIP(badges: ChatBadge[]): boolean {
  return badges.some((b) => b.setId === "vip");
}

/**
 * Check if user has subscriber badge
 */
function isSubscriber(badges: ChatBadge[]): boolean {
  return badges.some((b) => b.setId === "subscriber" || b.setId === "founder");
}
