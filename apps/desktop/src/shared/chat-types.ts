/**
 * Unified Chat Types
 *
 * Shared type definitions for chat system across both
 * Twitch and Kick platforms.
 */

// ========== Platform Types ==========

export type ChatPlatform = "twitch" | "kick";

// ========== Badge Types ==========

export interface ChatBadge {
  /** Badge set identifier (e.g., 'subscriber', 'moderator') */
  setId: string;
  /** Badge version within the set (e.g., '0', '3', '12') */
  version: string;
  /** URL to the badge image */
  imageUrl: string;
  /** Alt text / title for the badge */
  title: string;
}

export interface BadgeSet {
  setId: string;
  versions: Map<string, BadgeVersion>;
}

export interface BadgeVersion {
  id: string;
  imageUrl1x: string;
  imageUrl2x: string;
  imageUrl4x: string;
  title: string;
  description: string;
}

// ========== Emote Types ==========

export interface ChatEmote {
  /** Unique emote identifier */
  id: string;
  /** Emote code/name used in chat */
  name: string;
  /** URL to the emote image */
  url: string;
  /** Provider of the emote */
  provider: "twitch" | "kick" | "bttv" | "ffz" | "7tv";
  /** Whether this is an animated emote */
  isAnimated?: boolean;
  /** Zero-width emote (overlays previous emote) */
  isZeroWidth?: boolean;
}

export interface EmotePosition {
  /** Emote data */
  emote: ChatEmote;
  /** Start position in the message text */
  start: number;
  /** End position in the message text (exclusive) */
  end: number;
}

// ========== Message Types ==========

export type MessageType =
  | "message"
  | "action"
  | "system"
  | "notice"
  | "subscription"
  | "raid"
  | "bits"
  | "ban";

/** A fragment of message content */
export type ContentFragment =
  | { type: "text"; content: string }
  | { type: "emote"; id: string; name: string; url: string; isAnimated?: boolean }
  | { type: "mention"; username: string }
  | { type: "link"; url: string; text: string }
  | { type: "cheermote"; id: string; name: string; url: string; bits: number };

export interface ReplyInfo {
  /** ID of the message being replied to */
  parentMessageId: string;
  /** User ID of the parent message author */
  parentUserId: string;
  /** Username of the parent message author */
  parentUsername: string;
  /** Display name of the parent message author */
  parentDisplayName: string;
  /** Content of the parent message (may be truncated) */
  parentMessageBody: string;
}

export interface ChatMessage {
  /** Unique message identifier */
  id: string;
  /** Platform the message came from */
  platform: ChatPlatform;
  /** Type of message */
  type: MessageType;
  /** Channel/room the message was sent in */
  channel: string;
  /** User ID of the sender */
  userId: string;
  /** Login/username of the sender */
  username: string;
  /** Display name of the sender */
  displayName: string;
  /** Username color (hex) */
  color: string;
  /** User's badges */
  badges: ChatBadge[];
  /** Parsed message content with emotes, mentions, and links */
  content: ContentFragment[];
  /** Original raw message text */
  rawContent: string;
  /** When the message was sent */
  timestamp: Date;
  /** Whether the message has been deleted */
  isDeleted: boolean;
  /** Whether this is a highlighted message (first-time chatter, etc.) */
  isHighlighted: boolean;
  /** Whether this is a /me action message */
  isAction: boolean;
  /** Reply information if this is a reply */
  replyTo?: ReplyInfo;
  /** Bits amount if this is a bits message */
  bits?: number;
  /** Ban/timeout info for ban-type messages */
  banInfo?: {
    bannedUsername: string;
    bannedByUsername?: string;
    lastMessage?: string;
    duration?: number;
  };
}

// ========== User Notice Types ==========

export interface UserNotice {
  id: string;
  platform: ChatPlatform;
  channel: string;
  type: "sub" | "resub" | "subgift" | "submysterygift" | "raid" | "ritual" | "bitsbadgetier";
  userId: string;
  username: string;
  displayName: string;
  message?: string;
  systemMessage: string;
  timestamp: Date;
  /** Subscription-specific data */
  subPlan?: string;
  subPlanName?: string;
  months?: number;
  cumulativeMonths?: number;
  /** Gift-specific data */
  recipientId?: string;
  recipientUsername?: string;
  recipientDisplayName?: string;
  giftCount?: number;
  /** Raid-specific data */
  viewerCount?: number;
}

// ========== Clear/Moderation Types ==========

export interface ClearChat {
  platform: ChatPlatform;
  channel: string;
  /** If present, only this user's messages should be cleared */
  targetUserId?: string;
  targetUsername?: string;
  bannedByUsername?: string;
  /** Timeout duration in seconds (if timeout, not ban) */
  duration?: number;
  /** If true, this is a full chat clear */
  isClearAll: boolean;
  timestamp: Date;
}

export interface MessageDeletion {
  platform: ChatPlatform;
  channel: string;
  /** ID of the deleted message */
  messageId: string;
  timestamp: Date;
}

// ========== Connection State ==========

export type ChatConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface ChatConnectionStatus {
  platform: ChatPlatform;
  state: ChatConnectionState;
  /** Currently joined channels */
  channels: string[];
  /** Whether authenticated (can send messages) */
  isAuthenticated: boolean;
  /** Last error message if any */
  error?: string;
  /** Timestamp of last successful connection */
  connectedAt?: Date;
}

// ========== Kick-specific Event Types ==========

export interface KickPinnedMessage {
  message: {
    id: string;
    content: string;
    created_at: string;
    sender: {
      username: string;
      identity: { color: string };
    };
  };
  pinned_by: {
    username: string;
    identity: { color: string };
  };
  finish_at?: string;
}

export interface KickPollOption {
  id: number;
  label: string;
  votes: number;
}

export interface KickPoll {
  title: string;
  options: KickPollOption[];
  remaining: number;
  duration: number;
}

// ========== Chat Service Events ==========

export interface ChatServiceEvents {
  message: (message: ChatMessage) => void;
  userNotice: (notice: UserNotice) => void;
  clearChat: (clear: ClearChat) => void;
  messageDeleted: (deletion: MessageDeletion) => void;
  connectionStateChange: (status: ChatConnectionStatus) => void;
  error: (error: Error) => void;
  pinnedMessage: (msg: KickPinnedMessage) => void;
  pinnedMessageCleared: () => void;
  pollUpdate: (poll: KickPoll) => void;
}
