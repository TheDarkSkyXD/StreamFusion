import {
  hasOnlyKeys,
  isRecord,
  isSerializedTimestamp,
  isString,
  type ContractSchema,
  type SerializedTimestamp,
} from "../../../foundations/contract-schema.ts";
import type { Platform } from "../../../platform/index.ts";

export type GuestFollow = {
  readonly platform: Platform;
  readonly channelId: string;
  readonly channelLogin: string;
  readonly displayName: string;
  readonly followedAt: SerializedTimestamp;
};

export type GuestFollowIdentity = {
  readonly platform: Platform;
  readonly channelId?: string;
  readonly channelLogin?: string;
};

const GUEST_FOLLOW_KEYS = [
  "platform",
  "channelId",
  "channelLogin",
  "displayName",
  "followedAt",
] as const;

const CHANNEL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CHANNEL_LOGIN_PATTERN = /^[a-z0-9_-]{1,64}$/;

export const guestFollowSchema: ContractSchema<GuestFollow> = {
  is: isGuestFollow,
};

export function parseGuestFollowWrite(value: unknown): GuestFollow | null {
  if (!isRecord(value)) return null;
  const login =
    typeof value.channelLogin === "string"
      ? value.channelLogin.trim().toLowerCase()
      : value.channelLogin;
  const displayName =
    typeof value.displayName === "string"
      ? value.displayName.trim()
      : value.displayName;
  const candidate = { ...value, channelLogin: login, displayName };
  return isGuestFollow(candidate) ? candidate : null;
}

export function guestFollowKey(follow: {
  readonly platform: Platform;
  readonly channelId: string;
}): string {
  return `${follow.platform}:${follow.channelId}`;
}

export function findGuestFollow(
  follows: readonly GuestFollow[],
  identity: GuestFollowIdentity,
): GuestFollow | undefined {
  const login = identity.channelLogin?.trim().toLowerCase();
  return follows.find((follow) => matchesGuestFollow(follow, identity, login));
}

function matchesGuestFollow(
  follow: GuestFollow,
  identity: GuestFollowIdentity,
  login: string | undefined,
): boolean {
  if (follow.platform !== identity.platform) return false;
  if (identity.channelId !== undefined && identity.channelId.length > 0) {
    return follow.channelId === identity.channelId;
  }
  return (
    login !== undefined && login.length > 0 && follow.channelLogin === login
  );
}

function isGuestFollow(value: unknown): value is GuestFollow {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, GUEST_FOLLOW_KEYS) &&
    isPlatform(value.platform) &&
    isChannelId(value.channelId) &&
    isChannelLogin(value.channelLogin) &&
    isDisplayName(value.displayName) &&
    isSerializedTimestamp(value.followedAt)
  );
}

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isChannelId(value: unknown): value is string {
  return isString(value) && CHANNEL_ID_PATTERN.test(value);
}

function isChannelLogin(value: unknown): value is string {
  return isString(value) && CHANNEL_LOGIN_PATTERN.test(value);
}

function isDisplayName(value: unknown): value is string {
  return (
    isString(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    value.trim() === value
  );
}
