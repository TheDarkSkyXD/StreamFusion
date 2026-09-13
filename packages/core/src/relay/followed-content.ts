import {
  hasOnlyKeys,
  isArrayOf,
  isBoolean,
  isOptional,
  isRecord,
  isString,
  type ContractSchema,
} from "../foundations/contract-schema.ts";
import {
  channelSchema,
  clipSchema,
  streamSchema,
  videoSchema,
  type Channel,
  type Clip,
  type Stream,
  type Video,
} from "../features/content/domain/index.ts";
import type { Platform } from "../platform/index.ts";

export const MAX_FOLLOWED_IDENTITY_REFS = 100;

export type FollowedIdentityKind = "id" | "login";

export type FollowedIdentityRef = {
  readonly kind: FollowedIdentityKind;
  readonly value: string;
};

export type FollowedStreamsBody = {
  readonly platform: Platform;
  readonly streams: readonly Stream[];
  readonly missing: readonly FollowedIdentityRef[];
};

export type FollowedChannelsBody = {
  readonly platform: Platform;
  readonly channels: readonly Channel[];
  readonly missing: readonly FollowedIdentityRef[];
};

export type FollowedVideosBody = {
  readonly platform: Platform;
  readonly channelId: string;
  readonly supported: boolean;
  readonly videos: readonly Video[];
  readonly cursor?: string;
};

export type FollowedClipsBody = {
  readonly platform: Platform;
  readonly channelId: string;
  readonly supported: boolean;
  readonly clips: readonly Clip[];
  readonly cursor?: string;
};

export type FollowedRecordedSort = "recent" | "views";
export type FollowedClipPeriod = "day" | "week" | "month" | "all";

export const followedIdentityRefSchema: ContractSchema<FollowedIdentityRef> = {
  is: isFollowedIdentityRef,
};

export const followedStreamsBodySchema: ContractSchema<FollowedStreamsBody> = {
  is: isFollowedStreamsBody,
};

export const followedChannelsBodySchema: ContractSchema<FollowedChannelsBody> =
  {
    is: isFollowedChannelsBody,
  };

export const followedVideosBodySchema: ContractSchema<FollowedVideosBody> = {
  is: isFollowedVideosBody,
};

export const followedClipsBodySchema: ContractSchema<FollowedClipsBody> = {
  is: isFollowedClipsBody,
};

export function parseFollowedIdentityRefs(input: {
  readonly ids: readonly string[];
  readonly logins: readonly string[];
}): readonly FollowedIdentityRef[] | null {
  const refs: FollowedIdentityRef[] = [];
  for (const id of input.ids) {
    const ref = identityRef("id", id);
    if (ref === null) return null;
    refs.push(ref);
  }
  for (const login of input.logins) {
    const ref = identityRef("login", login.trim().toLowerCase());
    if (ref === null) return null;
    refs.push(ref);
  }
  if (refs.length === 0 || refs.length > MAX_FOLLOWED_IDENTITY_REFS) {
    return null;
  }
  return refs;
}

function identityRef(
  kind: FollowedIdentityKind,
  value: string,
): FollowedIdentityRef | null {
  const ref = { kind, value };
  return isFollowedIdentityRef(ref) ? ref : null;
}

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isCursor(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 512;
}

function isChannelId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 128;
}

function isIdentityValue(value: unknown): value is string {
  return (
    isString(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isFollowedIdentityRef(value: unknown): value is FollowedIdentityRef {
  if (!isRecord(value) || !hasOnlyKeys(value, ["kind", "value"])) return false;
  if (!isIdentityValue(value.value)) return false;
  if (value.kind === "id") return true;
  return value.kind === "login" && value.value === value.value.toLowerCase();
}

function isFollowedStreamsBody(value: unknown): value is FollowedStreamsBody {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "streams", "missing"]) &&
    isPlatform(value.platform) &&
    isArrayOf(value.streams, streamSchema.is) &&
    isArrayOf(value.missing, isFollowedIdentityRef)
  );
}

function isFollowedChannelsBody(value: unknown): value is FollowedChannelsBody {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "channels", "missing"]) &&
    isPlatform(value.platform) &&
    isArrayOf(value.channels, channelSchema.is) &&
    isArrayOf(value.missing, isFollowedIdentityRef)
  );
}

function isFollowedVideosBody(value: unknown): value is FollowedVideosBody {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "platform",
      "channelId",
      "supported",
      "videos",
      "cursor",
    ]) ||
    !isPlatform(value.platform) ||
    !isChannelId(value.channelId) ||
    !isBoolean(value.supported) ||
    !isArrayOf(value.videos, videoSchema.is) ||
    !isOptional(value.cursor, isCursor)
  ) {
    return false;
  }
  return (
    value.supported || (value.videos.length === 0 && value.cursor === undefined)
  );
}

function isFollowedClipsBody(value: unknown): value is FollowedClipsBody {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "platform",
      "channelId",
      "supported",
      "clips",
      "cursor",
    ]) ||
    !isPlatform(value.platform) ||
    !isChannelId(value.channelId) ||
    !isBoolean(value.supported) ||
    !isArrayOf(value.clips, clipSchema.is) ||
    !isOptional(value.cursor, isCursor)
  ) {
    return false;
  }
  return (
    value.supported || (value.clips.length === 0 && value.cursor === undefined)
  );
}
