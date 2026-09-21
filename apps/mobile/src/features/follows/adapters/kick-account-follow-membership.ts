import {
  parseGuestFollowWrite,
  type GuestFollow,
} from "@streamfusion/core/follows";

import type {
  AccountFollowMembershipOutcome,
  AccountFollowMembershipSource,
} from "../capabilities/account-follow-membership";

export type KickAccountCredentialRead = {
  readonly accessToken: string;
};

/** Undocumented Kick web catalog — same URL desktop `_tryBearerFetch` uses. */
export const KICK_FOLLOWED_CHANNELS_URL =
  "https://kick.com/api/v2/channels/followed";

const FETCH_TIMEOUT_MS = 10_000;
const KICK_AVATAR_USER_ID_PATTERN = /\/images\/user\/(\d+)\//i;

/**
 * Lists Kick account follows via the legacy web followed-channels catalog
 * (`kick.com/api/v2/channels/followed`) with the signed-in OAuth Bearer token.
 * Official `api.kick.com` has no followed-channels endpoint; desktop may also
 * use cookie/BrowserWindow fallbacks that mobile cannot. On auth/network/parse
 * failure returns unavailable so Guest Follows keep working.
 */
export function createKickAccountFollowMembership(input: {
  readonly fetch?: typeof globalThis.fetch;
  readonly readCredential: () => Promise<KickAccountCredentialRead | null>;
}): AccountFollowMembershipSource {
  return {
    async read(): Promise<AccountFollowMembershipOutcome> {
      const credential = await input.readCredential();
      if (credential === null) {
        return { kind: "unavailable", reason: "kick-signed-out" };
      }
      const outcome = await fetchKickFollowedChannels({
        accessToken: credential.accessToken,
        fetch: input.fetch ?? globalThis.fetch,
      });
      if (outcome.kind === "error") {
        return { kind: "unavailable", reason: outcome.reason };
      }
      return {
        kind: "available",
        follows: kickFollowedChannelsToGuestFollows(outcome.channels),
      };
    },
  };
}

/** @deprecated Prefer createKickAccountFollowMembership; kept for explicit unavailable stubs in tests. */
export function createKickAccountFollowMembershipUnavailable(): AccountFollowMembershipSource {
  return {
    async read() {
      return {
        kind: "unavailable",
        reason: "kick-followed-unavailable",
      };
    },
  };
}

export type KickFollowedChannelRow = {
  readonly channelId: string;
  readonly channelLogin: string;
  readonly displayName: string;
};

export type KickFollowedFetchOutcome =
  | { readonly kind: "ok"; readonly channels: readonly KickFollowedChannelRow[] }
  | {
      readonly kind: "error";
      readonly reason:
        | "kick-followed-auth-failed"
        | "kick-followed-cloudflare"
        | "kick-followed-network"
        | "kick-followed-parse";
    };

export async function fetchKickFollowedChannels(input: {
  readonly accessToken: string;
  readonly fetch: typeof globalThis.fetch;
  readonly url?: string;
  readonly timeoutMs?: number;
}): Promise<KickFollowedFetchOutcome> {
  const url = input.url ?? KICK_FOLLOWED_CHANNELS_URL;
  let response: Response;
  try {
    response = await input.fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      signal: AbortSignal.timeout(input.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
  } catch {
    return { kind: "error", reason: "kick-followed-network" };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: "error", reason: "kick-followed-auth-failed" };
  }
  if (!response.ok) {
    return { kind: "error", reason: "kick-followed-network" };
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return { kind: "error", reason: "kick-followed-network" };
  }

  const lower = body.toLowerCase();
  if (
    lower.includes("<!doctype html") ||
    lower.includes("just a moment") ||
    lower.includes("cf-browser-verification")
  ) {
    return { kind: "error", reason: "kick-followed-cloudflare" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: "error", reason: "kick-followed-parse" };
  }

  const channels = parseKickFollowedChannelsPayload(parsed);
  if (channels === null) {
    return { kind: "error", reason: "kick-followed-parse" };
  }
  return { kind: "ok", channels };
}

export function kickFollowedChannelsToGuestFollows(
  channels: readonly KickFollowedChannelRow[],
): readonly GuestFollow[] {
  const followedAt = new Date(0).toISOString();
  const follows: GuestFollow[] = [];
  for (const channel of channels) {
    const follow = parseGuestFollowWrite({
      channelId: channel.channelId,
      channelLogin: channel.channelLogin,
      displayName: channel.displayName,
      followedAt,
      platform: "kick",
    });
    if (follow) follows.push(follow);
  }
  return follows;
}

/**
 * Accepts desktop Bearer shapes (`[]` / `{ data: [] }`) and the Kick web page
 * shape (`{ channels: [{ channel_slug, ... }], nextCursor }`).
 */
export function parseKickFollowedChannelsPayload(
  payload: unknown,
): KickFollowedChannelRow[] | null {
  const pageRows = parseKickWebFollowPageChannels(payload);
  if (pageRows !== null) return pageRows;

  const rawItems = extractLegacyItems(payload);
  if (rawItems === null) return null;
  const channels: KickFollowedChannelRow[] = [];
  for (const item of rawItems) {
    const row = mapLegacyFollowedItem(item);
    if (row === null) return null;
    channels.push(row);
  }
  return channels;
}

function extractLegacyItems(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { data?: unknown }).data)
  ) {
    return (parsed as { data: unknown[] }).data;
  }
  return null;
}

function parseKickWebFollowPageChannels(
  payload: unknown,
): KickFollowedChannelRow[] | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.channels)) return null;
  const nextCursor = record.nextCursor;
  if (
    nextCursor !== undefined &&
    (typeof nextCursor !== "number" ||
      !Number.isSafeInteger(nextCursor) ||
      nextCursor < 0)
  ) {
    return null;
  }

  const channels: KickFollowedChannelRow[] = [];
  for (const value of record.channels) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const item = value as Record<string, unknown>;
    if (typeof item.channel_slug !== "string" || !item.channel_slug.trim()) {
      continue;
    }
    const slug = item.channel_slug.trim().toLowerCase();
    const displayName =
      typeof item.user_username === "string" && item.user_username.trim()
        ? item.user_username.trim()
        : item.channel_slug.trim();
    const avatar =
      typeof item.profile_picture === "string" ? item.profile_picture : "";
    const fromAvatar = broadcasterIdFromAvatar(avatar);
    channels.push({
      channelId: fromAvatar ?? slug,
      channelLogin: slug,
      displayName,
    });
  }
  return channels;
}

function mapLegacyFollowedItem(item: unknown): KickFollowedChannelRow | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const record = item as Record<string, unknown>;
  const user =
    record.user !== null &&
    typeof record.user === "object" &&
    !Array.isArray(record.user)
      ? (record.user as Record<string, unknown>)
      : null;
  const avatar =
    (typeof user?.profile_pic === "string" ? user.profile_pic : null) ??
    (typeof record.profile_pic === "string" ? record.profile_pic : "") ??
    "";
  const broadcasterUserId = firstValidKickBroadcasterUserId(
    record.user_id,
    user?.id,
    broadcasterIdFromAvatar(avatar),
  );
  const legacyId =
    typeof record.id === "number" || typeof record.id === "string"
      ? String(record.id)
      : null;
  const channelId = broadcasterUserId ?? legacyId;
  const slug =
    typeof record.slug === "string" ? record.slug.trim().toLowerCase() : "";
  if ((channelId === null || channelId.length === 0) && slug.length === 0) {
    return null;
  }
  const displayNameRaw =
    (typeof user?.username === "string" && user.username.trim()
      ? user.username
      : null) ??
    (typeof record.username === "string" && record.username.trim()
      ? record.username
      : null) ??
    (slug.length > 0 ? slug : channelId);
  const displayName =
    typeof displayNameRaw === "string" ? displayNameRaw.trim() : "";
  const resolvedId = channelId && channelId.length > 0 ? channelId : slug;
  const resolvedLogin = slug.length > 0 ? slug : resolvedId.toLowerCase();
  if (!resolvedId || !resolvedLogin || !displayName) return null;
  return {
    channelId: resolvedId,
    channelLogin: resolvedLogin,
    displayName,
  };
}

function firstValidKickBroadcasterUserId(
  ...candidates: Array<string | number | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const value = String(candidate).trim();
    if (/^[1-9]\d*$/.test(value)) return value;
  }
  return null;
}

function broadcasterIdFromAvatar(avatarUrl: string): string | null {
  const match = avatarUrl.match(KICK_AVATAR_USER_ID_PATTERN);
  return match?.[1] ?? null;
}
