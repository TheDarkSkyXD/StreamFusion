import {
  hasOnlyKeys,
  isArrayOf,
  isBoolean,
  isNonNegativeNumber,
  isOptional,
  isRecord,
  isSerializedTimestamp,
  isString,
  isStringArray,
  type ContractSchema,
  type SerializedTimestamp,
} from "../foundations/contract-schema.ts";
import type { Platform } from "../platform/index.ts";

export type { ChatConnection } from "../capabilities/chat.ts";
export {
  CHAT_DISABLED_REASON,
  CHAT_RECONNECTING_REASON,
  resolveAccountAgeRequirement,
  resolveChatSendEligibility,
} from "../use-cases/chat-send-policy.ts";
export type {
  ChatSendEligibility,
  ViewerRequirementState,
} from "../use-cases/chat-send-policy.ts";

export type { SerializedTimestamp };
export { toSerializedTimestamp } from "../foundations/contract-schema.ts";

export const CHAT_MESSAGE_TYPES = [
  "message",
  "action",
  "system",
  "notice",
  "subscription",
  "raid",
  "bits",
  "ban",
] as const;

export type ChatMessageType = (typeof CHAT_MESSAGE_TYPES)[number];

export const CHAT_HIGHLIGHT_KINDS = [
  "first-time-chat",
  "highlighted-message",
  "subscription",
  "resub",
  "gifted-sub",
  "raid",
  "ritual",
  "bits",
  "cheer",
] as const;

export type ChatHighlightKind = (typeof CHAT_HIGHLIGHT_KINDS)[number];

export const CHAT_EMOTE_PROVIDERS = [
  "twitch",
  "kick",
  "bttv",
  "ffz",
  "7tv",
] as const;

export type ChatEmoteProvider = (typeof CHAT_EMOTE_PROVIDERS)[number];

export type ChatBadge = {
  readonly setId: string;
  readonly version: string;
  readonly imageUrl: string;
  readonly title: string;
  readonly backgroundColor?: string;
};

export type ContentFragment =
  | { readonly type: "text"; readonly content: string }
  | {
      readonly type: "emote";
      readonly id: string;
      readonly name: string;
      readonly url: string;
      readonly provider?: ChatEmoteProvider;
      readonly width?: number;
      readonly height?: number;
      readonly url1x?: string;
      readonly url2x?: string;
      readonly url4x?: string;
      readonly isAnimated?: boolean;
      readonly isZeroWidth?: boolean;
    }
  | { readonly type: "mention"; readonly username: string }
  | { readonly type: "link"; readonly url: string; readonly text: string }
  | {
      readonly type: "cheermote";
      readonly id: string;
      readonly name: string;
      readonly url: string;
      readonly bits: number;
    };

export type ReplyInfo = {
  readonly parentMessageId: string;
  readonly parentUserId: string;
  readonly parentUsername: string;
  readonly parentDisplayName: string;
  readonly parentMessageBody: string;
};

export type ChatUserPresentation = {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly color?: string;
  readonly badges: readonly ChatBadge[];
};

export type RetainedDeletedMessage = {
  readonly id: string;
  readonly author: ChatUserPresentation;
  readonly content: readonly ContentFragment[];
  readonly rawContent: string;
  readonly deletedAt?: SerializedTimestamp;
};

export type ChatBanInfo = {
  readonly bannedUsername: string;
  readonly bannedByUsername?: string;
  readonly bannedUser?: ChatUserPresentation;
  readonly bannedByUser?: ChatUserPresentation;
  readonly lastMessage?: string;
  readonly deletedMessages?: readonly string[];
  readonly deletedMessageDetails?: readonly RetainedDeletedMessage[];
  readonly duration?: number;
};

export type ChatMessage = {
  readonly id: string;
  readonly platform: Platform;
  readonly type: ChatMessageType;
  readonly channel: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly color: string;
  readonly avatarUrl?: string;
  readonly badges: readonly ChatBadge[];
  readonly content: readonly ContentFragment[];
  readonly rawContent: string;
  readonly timestamp: SerializedTimestamp;
  readonly isDeleted: boolean;
  readonly isHighlighted: boolean;
  readonly highlightKind?: ChatHighlightKind;
  readonly isAction: boolean;
  readonly isOptimistic?: true;
  readonly isHistorical?: boolean;
  readonly deletedAt?: SerializedTimestamp;
  readonly deletedByUsername?: string;
  readonly deletedByUser?: ChatUserPresentation;
  readonly replyTo?: ReplyInfo;
  readonly bits?: number;
  readonly banInfo?: ChatBanInfo;
};

export type ChatConnectionState =
  "disconnected" | "connecting" | "connected" | "reconnecting";

export type ChatConnectionStatus = {
  readonly platform: Platform;
  readonly state: ChatConnectionState;
  readonly channels: readonly string[];
  readonly isAuthenticated: boolean;
  readonly error?: string;
  readonly connectedAt?: SerializedTimestamp;
};

export type ChatMessageDeletion = {
  readonly platform: Platform;
  readonly channel: string;
  readonly messageId: string;
  readonly deletedByUsername?: string;
  readonly deletedByUser?: ChatUserPresentation;
  readonly timestamp: SerializedTimestamp;
};

export type ChatUserNotice = {
  readonly id: string;
  readonly platform: Platform;
  readonly channel: string;
  readonly type:
    | "sub"
    | "resub"
    | "subgift"
    | "submysterygift"
    | "raid"
    | "ritual"
    | "bitsbadgetier";
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly color?: string;
  readonly message?: string;
  readonly systemMessage: string;
  readonly timestamp: SerializedTimestamp;
  readonly subPlan?: string;
  readonly subPlanName?: string;
  readonly months?: number;
  readonly cumulativeMonths?: number;
  readonly recipientId?: string;
  readonly recipientUsername?: string;
  readonly recipientDisplayName?: string;
  readonly giftCount?: number;
  readonly viewerCount?: number;
};

export type ChatClear = {
  readonly platform: Platform;
  readonly channel: string;
  readonly targetUserId?: string;
  readonly targetUsername?: string;
  readonly bannedByUsername?: string;
  readonly duration?: number;
  readonly isClearAll: boolean;
  readonly timestamp: SerializedTimestamp;
};

export type ChatRoomStatePatch = {
  readonly platform: Platform;
  readonly channel: string;
  readonly channelId: string;
  readonly patch: {
    readonly slowMode?: number | null;
    readonly followersOnly?: number | null;
    readonly subscribersOnly?: boolean;
    readonly emoteOnly?: boolean;
    readonly uniqueChat?: boolean;
    readonly shieldMode?: boolean;
    readonly accountAge?: number | null;
  };
  readonly reason: "ws" | "fetch";
};

export type ChatModeratorState = {
  readonly platform: "twitch";
  readonly channel: string;
  readonly channelId: string;
  readonly isModerator: boolean;
  readonly reason: "ws";
};

export type ViewerChatSendRestriction =
  | {
      readonly platform: "twitch";
      readonly channel: string;
      readonly channelId: string;
      readonly restriction: "verification";
      readonly requirement: "phone" | "email" | "account";
    }
  | {
      readonly platform: "twitch";
      readonly channel: string;
      readonly channelId: string;
      readonly restriction: "banned";
    };

export type ChatConnectionFailure = {
  readonly message: string;
};

export type ChatEvent =
  | { readonly kind: "message"; readonly message: ChatMessage }
  | { readonly kind: "user-notice"; readonly notice: ChatUserNotice }
  | { readonly kind: "chat-cleared"; readonly clear: ChatClear }
  | {
      readonly kind: "connection-state-changed";
      readonly status: ChatConnectionStatus;
    }
  | {
      readonly kind: "message-deleted";
      readonly deletion: ChatMessageDeletion;
    }
  | {
      readonly kind: "viewer-send-restricted";
      readonly restriction: ViewerChatSendRestriction;
    }
  | { readonly kind: "room-state-changed"; readonly room: ChatRoomStatePatch }
  | {
      readonly kind: "moderator-state-changed";
      readonly moderator: ChatModeratorState;
    }
  | { readonly kind: "failure"; readonly failure: ChatConnectionFailure };

export interface ChatConnectionEvents {
  message: (message: ChatMessage) => void;
  userNotice: (notice: ChatUserNotice) => void;
  clearChat: (clear: ChatClear) => void;
  connectionStateChange: (status: ChatConnectionStatus) => void;
  messageDeleted: (deletion: ChatMessageDeletion) => void;
  viewerSendRestriction: (restriction: ViewerChatSendRestriction) => void;
  roomState: (room: ChatRoomStatePatch) => void;
  moderatorState: (moderator: ChatModeratorState) => void;
  error: (failure: ChatConnectionFailure) => void;
}

const BADGE_KEYS = [
  "setId",
  "version",
  "imageUrl",
  "title",
  "backgroundColor",
] as const;
const USER_KEYS = [
  "userId",
  "username",
  "displayName",
  "color",
  "badges",
] as const;
const REPLY_KEYS = [
  "parentMessageId",
  "parentUserId",
  "parentUsername",
  "parentDisplayName",
  "parentMessageBody",
] as const;
const RETAINED_MESSAGE_KEYS = [
  "id",
  "author",
  "content",
  "rawContent",
  "deletedAt",
] as const;
const BAN_INFO_KEYS = [
  "bannedUsername",
  "bannedByUsername",
  "bannedUser",
  "bannedByUser",
  "lastMessage",
  "deletedMessages",
  "deletedMessageDetails",
  "duration",
] as const;
const MESSAGE_KEYS = [
  "id",
  "platform",
  "type",
  "channel",
  "userId",
  "username",
  "displayName",
  "color",
  "avatarUrl",
  "badges",
  "content",
  "rawContent",
  "timestamp",
  "isDeleted",
  "isHighlighted",
  "highlightKind",
  "isAction",
  "isOptimistic",
  "isHistorical",
  "deletedAt",
  "deletedByUsername",
  "deletedByUser",
  "replyTo",
  "bits",
  "banInfo",
] as const;
const USER_NOTICE_KEYS = [
  "id",
  "platform",
  "channel",
  "type",
  "userId",
  "username",
  "displayName",
  "color",
  "message",
  "systemMessage",
  "timestamp",
  "subPlan",
  "subPlanName",
  "months",
  "cumulativeMonths",
  "recipientId",
  "recipientUsername",
  "recipientDisplayName",
  "giftCount",
  "viewerCount",
] as const;
const CHAT_CLEAR_KEYS = [
  "platform",
  "channel",
  "targetUserId",
  "targetUsername",
  "bannedByUsername",
  "duration",
  "isClearAll",
  "timestamp",
] as const;
const ROOM_STATE_PATCH_KEYS = [
  "slowMode",
  "followersOnly",
  "subscribersOnly",
  "emoteOnly",
  "uniqueChat",
  "shieldMode",
  "accountAge",
] as const;

export const chatMessageSchema: ContractSchema<ChatMessage> = {
  is: isChatMessage,
};

export const chatEventSchema: ContractSchema<ChatEvent> = {
  is: isChatEvent,
};

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isMessageType(value: unknown): value is ChatMessageType {
  return (
    typeof value === "string" &&
    CHAT_MESSAGE_TYPES.some((candidate) => candidate === value)
  );
}

function isHighlightKind(value: unknown): value is ChatHighlightKind {
  return (
    typeof value === "string" &&
    CHAT_HIGHLIGHT_KINDS.some((candidate) => candidate === value)
  );
}

function isEmoteProvider(value: unknown): value is ChatEmoteProvider {
  return (
    typeof value === "string" &&
    CHAT_EMOTE_PROVIDERS.some((candidate) => candidate === value)
  );
}

function isChatBadge(value: unknown): value is ChatBadge {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, BADGE_KEYS) &&
    isString(value.setId) &&
    isString(value.version) &&
    isString(value.imageUrl) &&
    isString(value.title) &&
    isOptional(value.backgroundColor, isString)
  );
}

function isContentFragment(value: unknown): value is ContentFragment {
  if (!isRecord(value) || !isString(value.type)) return false;

  switch (value.type) {
    case "text":
      return hasOnlyKeys(value, ["type", "content"]) && isString(value.content);
    case "emote":
      return (
        hasOnlyKeys(value, [
          "type",
          "id",
          "name",
          "url",
          "provider",
          "width",
          "height",
          "url1x",
          "url2x",
          "url4x",
          "isAnimated",
          "isZeroWidth",
        ]) &&
        isString(value.id) &&
        isString(value.name) &&
        isString(value.url) &&
        isOptional(value.provider, isEmoteProvider) &&
        isOptional(value.width, isNonNegativeNumber) &&
        isOptional(value.height, isNonNegativeNumber) &&
        isOptional(value.url1x, isString) &&
        isOptional(value.url2x, isString) &&
        isOptional(value.url4x, isString) &&
        isOptional(value.isAnimated, isBoolean) &&
        isOptional(value.isZeroWidth, isBoolean)
      );
    case "mention":
      return (
        hasOnlyKeys(value, ["type", "username"]) && isString(value.username)
      );
    case "link":
      return (
        hasOnlyKeys(value, ["type", "url", "text"]) &&
        isString(value.url) &&
        isString(value.text)
      );
    case "cheermote":
      return (
        hasOnlyKeys(value, ["type", "id", "name", "url", "bits"]) &&
        isString(value.id) &&
        isString(value.name) &&
        isString(value.url) &&
        isNonNegativeNumber(value.bits)
      );
    default:
      return false;
  }
}

function isChatUserPresentation(value: unknown): value is ChatUserPresentation {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, USER_KEYS) &&
    isString(value.userId) &&
    isString(value.username) &&
    isString(value.displayName) &&
    isOptional(value.color, isString) &&
    isArrayOf(value.badges, isChatBadge)
  );
}

function isReplyInfo(value: unknown): value is ReplyInfo {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, REPLY_KEYS) &&
    isString(value.parentMessageId) &&
    isString(value.parentUserId) &&
    isString(value.parentUsername) &&
    isString(value.parentDisplayName) &&
    isString(value.parentMessageBody)
  );
}

function isRetainedDeletedMessage(
  value: unknown,
): value is RetainedDeletedMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, RETAINED_MESSAGE_KEYS) &&
    isString(value.id) &&
    isChatUserPresentation(value.author) &&
    isArrayOf(value.content, isContentFragment) &&
    isString(value.rawContent) &&
    isOptional(value.deletedAt, isSerializedTimestamp)
  );
}

function isChatBanInfo(value: unknown): value is ChatBanInfo {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, BAN_INFO_KEYS) &&
    isString(value.bannedUsername) &&
    isOptional(value.bannedByUsername, isString) &&
    isOptional(value.bannedUser, isChatUserPresentation) &&
    isOptional(value.bannedByUser, isChatUserPresentation) &&
    isOptional(value.lastMessage, isString) &&
    isOptional(value.deletedMessages, isStringArray) &&
    isOptional(value.deletedMessageDetails, (candidate) =>
      isArrayOf(candidate, isRetainedDeletedMessage),
    ) &&
    isOptional(value.duration, isNonNegativeNumber)
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, MESSAGE_KEYS) &&
    isString(value.id) &&
    isPlatform(value.platform) &&
    isMessageType(value.type) &&
    isString(value.channel) &&
    isString(value.userId) &&
    isString(value.username) &&
    isString(value.displayName) &&
    isString(value.color) &&
    isOptional(value.avatarUrl, isString) &&
    isArrayOf(value.badges, isChatBadge) &&
    isArrayOf(value.content, isContentFragment) &&
    isString(value.rawContent) &&
    isSerializedTimestamp(value.timestamp) &&
    isBoolean(value.isDeleted) &&
    isBoolean(value.isHighlighted) &&
    isOptional(value.highlightKind, isHighlightKind) &&
    isBoolean(value.isAction) &&
    isOptional(
      value.isOptimistic,
      (candidate): candidate is true => candidate === true,
    ) &&
    isOptional(value.isHistorical, isBoolean) &&
    isOptional(value.deletedAt, isSerializedTimestamp) &&
    isOptional(value.deletedByUsername, isString) &&
    isOptional(value.deletedByUser, isChatUserPresentation) &&
    isOptional(value.replyTo, isReplyInfo) &&
    isOptional(value.bits, isNonNegativeNumber) &&
    isOptional(value.banInfo, isChatBanInfo)
  );
}

function isChatUserNotice(value: unknown): value is ChatUserNotice {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, USER_NOTICE_KEYS) &&
    isString(value.id) &&
    isPlatform(value.platform) &&
    isString(value.channel) &&
    (value.type === "sub" ||
      value.type === "resub" ||
      value.type === "subgift" ||
      value.type === "submysterygift" ||
      value.type === "raid" ||
      value.type === "ritual" ||
      value.type === "bitsbadgetier") &&
    isString(value.userId) &&
    isString(value.username) &&
    isString(value.displayName) &&
    isOptional(value.color, isString) &&
    isOptional(value.message, isString) &&
    isString(value.systemMessage) &&
    isSerializedTimestamp(value.timestamp) &&
    isOptional(value.subPlan, isString) &&
    isOptional(value.subPlanName, isString) &&
    isOptional(value.months, isNonNegativeNumber) &&
    isOptional(value.cumulativeMonths, isNonNegativeNumber) &&
    isOptional(value.recipientId, isString) &&
    isOptional(value.recipientUsername, isString) &&
    isOptional(value.recipientDisplayName, isString) &&
    isOptional(value.giftCount, isNonNegativeNumber) &&
    isOptional(value.viewerCount, isNonNegativeNumber)
  );
}

function isChatClear(value: unknown): value is ChatClear {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, CHAT_CLEAR_KEYS) &&
    isPlatform(value.platform) &&
    isString(value.channel) &&
    isOptional(value.targetUserId, isString) &&
    isOptional(value.targetUsername, isString) &&
    isOptional(value.bannedByUsername, isString) &&
    isOptional(value.duration, isNonNegativeNumber) &&
    isBoolean(value.isClearAll) &&
    isSerializedTimestamp(value.timestamp)
  );
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value);
}

function isChatRoomStatePatch(value: unknown): value is ChatRoomStatePatch {
  if (!isRecord(value) || !isRecord(value.patch)) return false;

  return (
    hasOnlyKeys(value, [
      "platform",
      "channel",
      "channelId",
      "patch",
      "reason",
    ]) &&
    isPlatform(value.platform) &&
    isString(value.channel) &&
    isString(value.channelId) &&
    hasOnlyKeys(value.patch, ROOM_STATE_PATCH_KEYS) &&
    isOptional(value.patch.slowMode, isNullableNonNegativeNumber) &&
    isOptional(value.patch.followersOnly, isNullableNonNegativeNumber) &&
    isOptional(value.patch.subscribersOnly, isBoolean) &&
    isOptional(value.patch.emoteOnly, isBoolean) &&
    isOptional(value.patch.uniqueChat, isBoolean) &&
    isOptional(value.patch.shieldMode, isBoolean) &&
    isOptional(value.patch.accountAge, isNullableNonNegativeNumber) &&
    (value.reason === "ws" || value.reason === "fetch")
  );
}

function isChatModeratorState(value: unknown): value is ChatModeratorState {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "platform",
      "channel",
      "channelId",
      "isModerator",
      "reason",
    ]) &&
    value.platform === "twitch" &&
    isString(value.channel) &&
    isString(value.channelId) &&
    isBoolean(value.isModerator) &&
    value.reason === "ws"
  );
}

function isConnectionState(value: unknown): value is ChatConnectionState {
  return (
    value === "disconnected" ||
    value === "connecting" ||
    value === "connected" ||
    value === "reconnecting"
  );
}

function isChatConnectionStatus(value: unknown): value is ChatConnectionStatus {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "platform",
      "state",
      "channels",
      "isAuthenticated",
      "error",
      "connectedAt",
    ]) &&
    isPlatform(value.platform) &&
    isConnectionState(value.state) &&
    isStringArray(value.channels) &&
    isBoolean(value.isAuthenticated) &&
    isOptional(value.error, isString) &&
    isOptional(value.connectedAt, isSerializedTimestamp)
  );
}

function isChatMessageDeletion(value: unknown): value is ChatMessageDeletion {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "platform",
      "channel",
      "messageId",
      "deletedByUsername",
      "deletedByUser",
      "timestamp",
    ]) &&
    isPlatform(value.platform) &&
    isString(value.channel) &&
    isString(value.messageId) &&
    isOptional(value.deletedByUsername, isString) &&
    isOptional(value.deletedByUser, isChatUserPresentation) &&
    isSerializedTimestamp(value.timestamp)
  );
}

function isViewerChatSendRestriction(
  value: unknown,
): value is ViewerChatSendRestriction {
  if (
    !isRecord(value) ||
    value.platform !== "twitch" ||
    !isString(value.channel) ||
    !isString(value.channelId)
  ) {
    return false;
  }

  if (value.restriction === "banned") {
    return hasOnlyKeys(value, [
      "platform",
      "channel",
      "channelId",
      "restriction",
    ]);
  }
  return (
    value.restriction === "verification" &&
    hasOnlyKeys(value, [
      "platform",
      "channel",
      "channelId",
      "restriction",
      "requirement",
    ]) &&
    (value.requirement === "phone" ||
      value.requirement === "email" ||
      value.requirement === "account")
  );
}

function isChatConnectionFailure(
  value: unknown,
): value is ChatConnectionFailure {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["message"]) &&
    isString(value.message)
  );
}

function isChatEvent(value: unknown): value is ChatEvent {
  if (!isRecord(value) || !isString(value.kind)) return false;

  switch (value.kind) {
    case "message":
      return (
        hasOnlyKeys(value, ["kind", "message"]) && isChatMessage(value.message)
      );
    case "user-notice":
      return (
        hasOnlyKeys(value, ["kind", "notice"]) && isChatUserNotice(value.notice)
      );
    case "chat-cleared":
      return hasOnlyKeys(value, ["kind", "clear"]) && isChatClear(value.clear);
    case "connection-state-changed":
      return (
        hasOnlyKeys(value, ["kind", "status"]) &&
        isChatConnectionStatus(value.status)
      );
    case "message-deleted":
      return (
        hasOnlyKeys(value, ["kind", "deletion"]) &&
        isChatMessageDeletion(value.deletion)
      );
    case "viewer-send-restricted":
      return (
        hasOnlyKeys(value, ["kind", "restriction"]) &&
        isViewerChatSendRestriction(value.restriction)
      );
    case "room-state-changed":
      return (
        hasOnlyKeys(value, ["kind", "room"]) && isChatRoomStatePatch(value.room)
      );
    case "moderator-state-changed":
      return (
        hasOnlyKeys(value, ["kind", "moderator"]) &&
        isChatModeratorState(value.moderator)
      );
    case "failure":
      return (
        hasOnlyKeys(value, ["kind", "failure"]) &&
        isChatConnectionFailure(value.failure)
      );
    default:
      return false;
  }
}
