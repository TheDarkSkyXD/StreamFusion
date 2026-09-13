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
  clipSchema,
  streamSchema,
  videoSchema,
  type Category,
  type Clip,
  type Stream,
  type Video,
} from "../features/content/domain/index.ts";
import type { Platform } from "../platform/index.ts";

export type SignedOutCategoryBody = {
  readonly platform: Platform;
  readonly category: Category;
};

export type SignedOutCategoryStreamsBody = {
  readonly platform: Platform;
  readonly streams: readonly Stream[];
  readonly cursor?: string;
};

export type SignedOutClipTimeRange = "day" | "week" | "month" | "all";
export type SignedOutCategoryClipsUnavailableReason = "kick-clips-unsupported";
export type SignedOutCategoryVideosUnavailableReason =
  "kick-videos-unsupported";

export type SignedOutCategoryClipsBody =
  | {
      readonly kind: "available";
      readonly platform: Platform;
      readonly clips: readonly Clip[];
      readonly cursor?: string;
    }
  | {
      readonly kind: "unsupported";
      readonly platform: Platform;
      readonly reason: SignedOutCategoryClipsUnavailableReason;
    };

export type SignedOutCategoryVideosBody =
  | {
      readonly kind: "available";
      readonly platform: Platform;
      readonly videos: readonly Video[];
      readonly cursor?: string;
    }
  | {
      readonly kind: "unsupported";
      readonly platform: Platform;
      readonly reason: SignedOutCategoryVideosUnavailableReason;
    };

export const signedOutCategoryBodySchema: ContractSchema<SignedOutCategoryBody> =
  { is: isSignedOutCategoryBody };

export const signedOutCategoryStreamsBodySchema: ContractSchema<SignedOutCategoryStreamsBody> =
  { is: isSignedOutCategoryStreamsBody };

export const signedOutCategoryClipsBodySchema: ContractSchema<SignedOutCategoryClipsBody> =
  { is: isSignedOutCategoryClipsBody };

export const signedOutCategoryVideosBodySchema: ContractSchema<SignedOutCategoryVideosBody> =
  { is: isSignedOutCategoryVideosBody };

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isCursor(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 512;
}

function isSignedOutCategoryBody(
  value: unknown,
): value is SignedOutCategoryBody {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "category"]) &&
    isPlatform(value.platform) &&
    categorySchema.is(value.category)
  );
}

function isSignedOutCategoryStreamsBody(
  value: unknown,
): value is SignedOutCategoryStreamsBody {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "streams", "cursor"]) &&
    isPlatform(value.platform) &&
    isArrayOf(value.streams, streamSchema.is) &&
    isOptional(value.cursor, isCursor)
  );
}

function isSignedOutCategoryClipsBody(
  value: unknown,
): value is SignedOutCategoryClipsBody {
  if (!isRecord(value) || !isPlatform(value.platform)) return false;
  if (value.kind === "unsupported") {
    return (
      hasOnlyKeys(value, ["kind", "platform", "reason"]) &&
      value.reason === "kick-clips-unsupported"
    );
  }
  return (
    value.kind === "available" &&
    hasOnlyKeys(value, ["kind", "platform", "clips", "cursor"]) &&
    isArrayOf(value.clips, clipSchema.is) &&
    isOptional(value.cursor, isCursor)
  );
}

function isSignedOutCategoryVideosBody(
  value: unknown,
): value is SignedOutCategoryVideosBody {
  if (!isRecord(value) || !isPlatform(value.platform)) return false;
  if (value.kind === "unsupported") {
    return (
      hasOnlyKeys(value, ["kind", "platform", "reason"]) &&
      value.reason === "kick-videos-unsupported"
    );
  }
  return (
    value.kind === "available" &&
    hasOnlyKeys(value, ["kind", "platform", "videos", "cursor"]) &&
    isArrayOf(value.videos, videoSchema.is) &&
    isOptional(value.cursor, isCursor)
  );
}
