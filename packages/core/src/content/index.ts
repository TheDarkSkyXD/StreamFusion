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

export type SocialLink = {
  readonly platform: string;
  readonly url: string;
};

export type Stream = {
  readonly id: string;
  readonly platform: Platform;
  readonly channelId: string;
  readonly channelName: string;
  readonly channelDisplayName: string;
  readonly channelAvatar: string;
  readonly channelIsVerified?: boolean;
  readonly title: string;
  readonly viewerCount: number;
  readonly thumbnailUrl: string;
  readonly isLive: boolean;
  readonly startedAt: SerializedTimestamp | null;
  readonly language: string;
  readonly tags: readonly string[];
  readonly isMature?: boolean;
  readonly categoryId?: string;
  readonly categoryName?: string;
};

export type Channel = {
  readonly id: string;
  readonly platform: Platform;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string;
  readonly bannerUrl?: string;
  readonly bio?: string;
  readonly isLive: boolean;
  readonly isVerified: boolean;
  readonly isPartner: boolean;
  readonly followerCount?: number;
  readonly subscriberCount?: number;
  readonly viewCount?: number;
  readonly createdAt?: SerializedTimestamp;
  readonly lastLiveAt?: SerializedTimestamp;
  readonly socialLinks?: readonly SocialLink[];
  readonly categoryId?: string;
  readonly categoryName?: string;
  readonly lastStreamTitle?: string;
};

export type Category = {
  readonly id: string;
  readonly platform: Platform;
  readonly name: string;
  readonly boxArtUrl: string;
  readonly viewerCount?: number;
  readonly tags?: readonly string[];
};

export type Video = {
  readonly id: string;
  readonly platform: Platform;
  readonly channelId: string;
  readonly channelName: string;
  readonly channelDisplayName: string;
  readonly channelAvatar: string;
  readonly title: string;
  readonly description?: string;
  readonly thumbnailUrl: string;
  readonly duration: number;
  readonly viewCount: number;
  readonly publishedAt: SerializedTimestamp;
  readonly url: string;
  readonly shareUrl?: string;
  readonly type: "archive" | "highlight" | "upload";
  readonly categoryId?: string;
  readonly categoryName?: string;
};

export type Clip = {
  readonly id: string;
  readonly platform: Platform;
  readonly channelId: string;
  readonly channelName: string;
  readonly channelDisplayName: string;
  readonly channelAvatar: string;
  readonly title: string;
  readonly thumbnailUrl: string;
  readonly clipUrl: string;
  readonly shareUrl?: string;
  readonly duration: number;
  readonly viewCount: number;
  readonly createdAt: SerializedTimestamp;
  readonly creatorName: string;
  readonly categoryId?: string;
  readonly categoryName?: string;
};

const STREAM_KEYS = [
  "id",
  "platform",
  "channelId",
  "channelName",
  "channelDisplayName",
  "channelAvatar",
  "channelIsVerified",
  "title",
  "viewerCount",
  "thumbnailUrl",
  "isLive",
  "startedAt",
  "language",
  "tags",
  "isMature",
  "categoryId",
  "categoryName",
] as const;

const CHANNEL_KEYS = [
  "id",
  "platform",
  "username",
  "displayName",
  "avatarUrl",
  "bannerUrl",
  "bio",
  "isLive",
  "isVerified",
  "isPartner",
  "followerCount",
  "subscriberCount",
  "viewCount",
  "createdAt",
  "lastLiveAt",
  "socialLinks",
  "categoryId",
  "categoryName",
  "lastStreamTitle",
] as const;

const CATEGORY_KEYS = [
  "id",
  "platform",
  "name",
  "boxArtUrl",
  "viewerCount",
  "tags",
] as const;

const VIDEO_KEYS = [
  "id",
  "platform",
  "channelId",
  "channelName",
  "channelDisplayName",
  "channelAvatar",
  "title",
  "description",
  "thumbnailUrl",
  "duration",
  "viewCount",
  "publishedAt",
  "url",
  "shareUrl",
  "type",
  "categoryId",
  "categoryName",
] as const;

const CLIP_KEYS = [
  "id",
  "platform",
  "channelId",
  "channelName",
  "channelDisplayName",
  "channelAvatar",
  "title",
  "thumbnailUrl",
  "clipUrl",
  "shareUrl",
  "duration",
  "viewCount",
  "createdAt",
  "creatorName",
  "categoryId",
  "categoryName",
] as const;

export const streamSchema: ContractSchema<Stream> = { is: isStream };
export const channelSchema: ContractSchema<Channel> = { is: isChannel };
export const categorySchema: ContractSchema<Category> = { is: isCategory };
export const videoSchema: ContractSchema<Video> = { is: isVideo };
export const clipSchema: ContractSchema<Clip> = { is: isClip };

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isSocialLink(value: unknown): value is SocialLink {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "url"]) &&
    isString(value.platform) &&
    isString(value.url)
  );
}

function isStream(value: unknown): value is Stream {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, STREAM_KEYS) &&
    isString(value.id) &&
    isPlatform(value.platform) &&
    isString(value.channelId) &&
    isString(value.channelName) &&
    isString(value.channelDisplayName) &&
    isString(value.channelAvatar) &&
    isOptional(value.channelIsVerified, isBoolean) &&
    isString(value.title) &&
    isNonNegativeNumber(value.viewerCount) &&
    isString(value.thumbnailUrl) &&
    isBoolean(value.isLive) &&
    (value.startedAt === null || isSerializedTimestamp(value.startedAt)) &&
    isString(value.language) &&
    isStringArray(value.tags) &&
    isOptional(value.isMature, isBoolean) &&
    isOptional(value.categoryId, isString) &&
    isOptional(value.categoryName, isString)
  );
}

function isChannel(value: unknown): value is Channel {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, CHANNEL_KEYS) &&
    isString(value.id) &&
    isPlatform(value.platform) &&
    isString(value.username) &&
    isString(value.displayName) &&
    isString(value.avatarUrl) &&
    isOptional(value.bannerUrl, isString) &&
    isOptional(value.bio, isString) &&
    isBoolean(value.isLive) &&
    isBoolean(value.isVerified) &&
    isBoolean(value.isPartner) &&
    isOptional(value.followerCount, isNonNegativeNumber) &&
    isOptional(value.subscriberCount, isNonNegativeNumber) &&
    isOptional(value.viewCount, isNonNegativeNumber) &&
    isOptional(value.createdAt, isSerializedTimestamp) &&
    isOptional(value.lastLiveAt, isSerializedTimestamp) &&
    isOptional(value.socialLinks, (candidate) =>
      isArrayOf(candidate, isSocialLink),
    ) &&
    isOptional(value.categoryId, isString) &&
    isOptional(value.categoryName, isString) &&
    isOptional(value.lastStreamTitle, isString)
  );
}

function isCategory(value: unknown): value is Category {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, CATEGORY_KEYS) &&
    isString(value.id) &&
    isPlatform(value.platform) &&
    isString(value.name) &&
    isString(value.boxArtUrl) &&
    isOptional(value.viewerCount, isNonNegativeNumber) &&
    isOptional(value.tags, isStringArray)
  );
}

function isVideo(value: unknown): value is Video {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, VIDEO_KEYS) &&
    isString(value.id) &&
    isPlatform(value.platform) &&
    isString(value.channelId) &&
    isString(value.channelName) &&
    isString(value.channelDisplayName) &&
    isString(value.channelAvatar) &&
    isString(value.title) &&
    isOptional(value.description, isString) &&
    isString(value.thumbnailUrl) &&
    isNonNegativeNumber(value.duration) &&
    isNonNegativeNumber(value.viewCount) &&
    isSerializedTimestamp(value.publishedAt) &&
    isString(value.url) &&
    isOptional(value.shareUrl, isString) &&
    (value.type === "archive" ||
      value.type === "highlight" ||
      value.type === "upload") &&
    isOptional(value.categoryId, isString) &&
    isOptional(value.categoryName, isString)
  );
}

function isClip(value: unknown): value is Clip {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, CLIP_KEYS) &&
    isString(value.id) &&
    isPlatform(value.platform) &&
    isString(value.channelId) &&
    isString(value.channelName) &&
    isString(value.channelDisplayName) &&
    isString(value.channelAvatar) &&
    isString(value.title) &&
    isString(value.thumbnailUrl) &&
    isString(value.clipUrl) &&
    isOptional(value.shareUrl, isString) &&
    isNonNegativeNumber(value.duration) &&
    isNonNegativeNumber(value.viewCount) &&
    isSerializedTimestamp(value.createdAt) &&
    isString(value.creatorName) &&
    isOptional(value.categoryId, isString) &&
    isOptional(value.categoryName, isString)
  );
}
