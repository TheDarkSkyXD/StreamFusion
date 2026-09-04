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

export const chatMessageSchema: ContractSchema<ChatMessage> = {
  is: isChatMessage,
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
