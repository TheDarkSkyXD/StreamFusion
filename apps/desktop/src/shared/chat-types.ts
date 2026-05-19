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
  /** True for messages seeded from the v2 history endpoint on join — rendered dimmer than live chat. */
  isHistorical?: boolean;
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

/** Raw badge shape carried inside a Kick Pusher payload. Mirrors the
 *  `KickBadge` type used by `kick-parser.ts` for live chat messages —
 *  pinned-message events on Kick use the same `sender.identity` envelope, so
 *  badges arrive alongside the username and color. */
export interface KickPinnedMessageBadge {
  type: string; // 'subscriber' | 'moderator' | 'broadcaster' | 'vip' | 'og' | 'founder' | 'verified' | ...
  text: string;
  count?: number; // Sub-month count for subscriber tiers
}

export interface KickPinnedMessage {
  message: {
    id: string;
    content: string;
    created_at: string;
    sender: {
      username: string;
      identity: {
        color: string;
        badges?: KickPinnedMessageBadge[];
      };
    };
  };
  pinned_by: {
    username: string;
    identity: {
      color: string;
      badges?: KickPinnedMessageBadge[];
    };
  };
  finish_at?: string;
}

// ========== Normalized Pinned Message ==========

/**
 * Platform-agnostic pinned-message payload consumed by the shared
 * PinnedMessageBanner. Twitch and Kick services normalize their raw payloads
 * to this shape before emitting `pinnedMessage`.
 */
export interface NormalizedPinnedMessage {
  platform: ChatPlatform;
  /** Underlying chat-message id (used for optimistic reconciliation and
   *  message-level operations like Reply). */
  messageId: string;
  /** The PinnedChatMessage record id (Twitch's outer pin record). Used by
   *  the Twitch unpin mutation, which takes the pin id, not the message id.
   *  Null when not known (e.g. Kick payloads, dev simulator). */
  pinRecordId: string | null;
  author: {
    username: string;
    displayName: string;
    color: string;
    /** Inline badges to render next to the sender username in the
     *  expanded card's attribution row. Empty array when none are known. */
    badges: ChatBadge[];
  };
  content: ContentFragment[];
  /** Moderator/broadcaster who created the pin. Null when unknown. */
  pinnedBy: {
    username: string;
    color: string;
    /** Inline badges to render before the username (e.g. Broadcaster).
     *  Empty array when none are known. */
    badges: ChatBadge[];
  } | null;
  /** ISO timestamp the pin was created. */
  pinnedAt: string;
  /** ISO timestamp the original chat message was sent. Used by the expanded
   *  card's sender-attribution row ("sent at HH:MM PM"). Null when unknown. */
  sentAt: string | null;
  /** ISO timestamp the pin auto-expires, or null when pinned indefinitely. */
  expiresAt: string | null;
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

/**
 * Normalized prediction outcome that maps Twitch and Kick payload shapes to a
 * single component-internal model. Twitch outcomes carry `color` (`BLUE` /
 * `PINK` / sequential palette values for multi-outcome predictions) and may
 * include `topPredictors`; Kick outcomes do not.
 */
export interface UnifiedPredictionOutcome {
  /** Stable outcome id from the platform. */
  id: string;
  /** Display title for the outcome. */
  title: string;
  /**
   * Platform color name when present. Twitch uses `blue` / `pink` for 2-outcome
   * predictions and sequential palette values (`yellow`, `green`, `orange`,
   * `purple`, `red`, `cyan`, `brown`, `gray`) for 3+. Kick has no color field.
   */
  color: "blue" | "pink" | "yellow" | "green" | "orange" | "purple" | "red" | "cyan" | "brown" | "gray" | null;
  /** Total points (Twitch channel points) or KCP (Kick) staked on this outcome. */
  totalAmount: number;
  /** Unique users who voted on this outcome. */
  userCount: number;
  /**
   * Top contributors for this outcome, when the read response includes them
   * (Twitch native ended-state surface). Optional; Kick and unified styles
   * omit the block.
   */
  topPredictors?: Array<{
    userId: string;
    userName: string;
    amount: number;
  }>;
}

/**
 * Normalized active or recently-ended prediction emitted through
 * `ChatServiceEvents.predictionUpdate`. The normalization happens at the
 * platform / chat-service boundary so the widget consumes a single shape
 * regardless of platform — see the viewer-prediction plan (U1).
 */
export interface UnifiedPrediction {
  /** Stable prediction id from the platform. */
  id: string;
  /** Source platform — drives style-branching in the widget. */
  platform: "twitch" | "kick";
  /**
   * Channel that owns this prediction. Required so multiview consumers can
   * filter incoming events to the channel rendered in each chat panel —
   * `twitchChatService` / `kickChatService` are singletons whose event bus
   * fans out to every mounted listener, so unfiltered handlers would render
   * a prediction in channels other than the one it came from.
   */
  channelId: string;
  /** Display title. */
  title: string;
  /** Lifecycle status. */
  status: "ACTIVE" | "LOCKED" | "RESOLVED" | "CANCELED";
  /** Outcomes in display order. */
  outcomes: UnifiedPredictionOutcome[];
  /** Winning outcome id when status is RESOLVED, otherwise null. */
  winningOutcomeId: string | null;
  /** Original prediction window in seconds, when known. */
  predictionWindowSeconds: number | null;
  /** ISO timestamp of resolve / cancel, otherwise null. */
  endedAt: string | null;
  /** Outcome id the signed-in viewer has already voted on, otherwise null. */
  viewerOutcomeId: string | null;
  /** Amount the signed-in viewer staked on `viewerOutcomeId`, otherwise null. */
  viewerStake: number | null;
}

// ========== Room State (chat-settings) Events ==========

/**
 * Partial room-state patch emitted by chat services for the info banner.
 * Mirrors RoomState's field shape; absent keys mean "no change for this
 * source." The `reason` tag distinguishes WS-pushed updates from initial
 * fetches in tests; production stores the same final values regardless.
 */
export interface RoomStatePatchEvent {
  platform: ChatPlatform;
  /** Channel identifier: slug for Kick, login (sans #) for Twitch. */
  channel: string;
  /** Numeric channel id: chatroom_id for Kick, broadcaster user-id for Twitch. */
  channelId: string;
  patch: {
    slowMode?: number | null;
    followersOnly?: number | null;
    subscribersOnly?: boolean;
    emoteOnly?: boolean;
    uniqueChat?: boolean;
    shieldMode?: boolean;
    accountAge?: number | null;
  };
  /** Source provenance: 'ws' for live WS events, 'fetch' for initial reads. */
  reason: "ws" | "fetch";
}

// ========== Chat Service Events ==========

export interface ChatServiceEvents {
  message: (message: ChatMessage) => void;
  userNotice: (notice: UserNotice) => void;
  clearChat: (clear: ClearChat) => void;
  messageDeleted: (deletion: MessageDeletion) => void;
  connectionStateChange: (status: ChatConnectionStatus) => void;
  error: (error: Error) => void;
  pinnedMessage: (msg: NormalizedPinnedMessage) => void;
  pinnedMessageCleared: () => void;
  pollUpdate: (poll: KickPoll) => void;
  predictionUpdate: (prediction: UnifiedPrediction) => void;
  roomState: (event: RoomStatePatchEvent) => void;
}
