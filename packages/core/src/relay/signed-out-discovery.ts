import {
  hasOnlyKeys,
  isArrayOf,
  isOptional,
  isRecord,
  isString,
  type ContractSchema,
} from "../foundations/contract-schema.ts";
import {
  categorySchema,
  channelSchema,
  clipSchema,
  streamSchema,
  videoSchema,
  type Category,
  type Channel,
  type Clip,
  type Stream,
  type Video,
} from "../features/content/domain/index.ts";
import type { Platform } from "../platform/index.ts";

export type SignedOutTopStreamsBody = {
  readonly platform: Platform;
  readonly streams: readonly Stream[];
  readonly cursor?: string;
};

export type SignedOutCategoriesBody = {
  readonly platform: Platform;
  readonly categories: readonly Category[];
  readonly cursor?: string;
};

export type SignedOutSearchBody = {
  readonly platform: Platform;
  readonly query: string;
  readonly streams: readonly Stream[];
  readonly channels: readonly Channel[];
  readonly categories: readonly Category[];
};

export type SignedOutChannelSupport = "available" | "unsupported";

export type SignedOutChannelBody = {
  readonly platform: Platform;
  readonly channel: Channel;
  readonly live: Stream | null;
};

export type SignedOutVideosBody = {
  readonly platform: Platform;
  readonly channelId: string;
  readonly support: SignedOutChannelSupport;
  readonly videos: readonly Video[];
  readonly cursor?: string;
};

export type SignedOutClipsBody = {
  readonly platform: Platform;
  readonly channelId: string;
  readonly support: SignedOutChannelSupport;
  readonly clips: readonly Clip[];
  readonly cursor?: string;
};

export const signedOutTopStreamsBodySchema: ContractSchema<SignedOutTopStreamsBody> =
  {
    is: isSignedOutTopStreamsBody,
  };

export const signedOutCategoriesBodySchema: ContractSchema<SignedOutCategoriesBody> =
  {
    is: isSignedOutCategoriesBody,
  };

export const signedOutSearchBodySchema: ContractSchema<SignedOutSearchBody> = {
  is: isSignedOutSearchBody,
};

export const signedOutChannelBodySchema: ContractSchema<SignedOutChannelBody> =
  {
    is: isSignedOutChannelBody,
  };

export const signedOutVideosBodySchema: ContractSchema<SignedOutVideosBody> = {
  is: isSignedOutVideosBody,
};

export const signedOutClipsBodySchema: ContractSchema<SignedOutClipsBody> = {
  is: isSignedOutClipsBody,
};

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isCursor(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 512;
}

function isSignedOutTopStreamsBody(
  value: unknown,
): value is SignedOutTopStreamsBody {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "streams", "cursor"]) &&
    isPlatform(value.platform) &&
    isArrayOf(value.streams, streamSchema.is) &&
    isOptional(value.cursor, isCursor)
  );
}

function isSignedOutCategoriesBody(
  value: unknown,
): value is SignedOutCategoriesBody {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "categories", "cursor"]) &&
    isPlatform(value.platform) &&
    isArrayOf(value.categories, categorySchema.is) &&
    isOptional(value.cursor, isCursor)
  );
}

function isSignedOutSearchBody(value: unknown): value is SignedOutSearchBody {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "platform",
      "query",
      "streams",
      "channels",
      "categories",
    ]) &&
    isPlatform(value.platform) &&
    isString(value.query) &&
    value.query.length > 0 &&
    isArrayOf(value.streams, streamSchema.is) &&
    isArrayOf(value.channels, channelSchema.is) &&
    isArrayOf(value.categories, categorySchema.is)
  );
}

function isSupport(value: unknown): value is SignedOutChannelSupport {
  return value === "available" || value === "unsupported";
}

function isSignedOutChannelBody(value: unknown): value is SignedOutChannelBody {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "channel", "live"]) &&
    isPlatform(value.platform) &&
    channelSchema.is(value.channel) &&
    (value.live === null || streamSchema.is(value.live))
  );
}

function isSignedOutVideosBody(value: unknown): value is SignedOutVideosBody {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "platform",
      "channelId",
      "support",
      "videos",
      "cursor",
    ]) ||
    !isPlatform(value.platform) ||
    !isString(value.channelId) ||
    value.channelId.length === 0 ||
    !isSupport(value.support) ||
    !isArrayOf(value.videos, videoSchema.is) ||
    !isOptional(value.cursor, isCursor)
  ) {
    return false;
  }
  return value.support === "available" || value.videos.length === 0;
}

function isSignedOutClipsBody(value: unknown): value is SignedOutClipsBody {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "platform",
      "channelId",
      "support",
      "clips",
      "cursor",
    ]) ||
    !isPlatform(value.platform) ||
    !isString(value.channelId) ||
    value.channelId.length === 0 ||
    !isSupport(value.support) ||
    !isArrayOf(value.clips, clipSchema.is) ||
    !isOptional(value.cursor, isCursor)
  ) {
    return false;
  }
  return value.support === "available" || value.clips.length === 0;
}
