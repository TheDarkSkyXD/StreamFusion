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
  streamSchema,
  type Category,
  type Channel,
  type Stream,
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
