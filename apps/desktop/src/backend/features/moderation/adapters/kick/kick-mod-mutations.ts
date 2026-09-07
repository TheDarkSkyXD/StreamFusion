import type { KickChatModeUpdate, KickModerationResult } from "@shared/kick-moderation-types";

/**
 * Official Kick ban/timeout mutations. Chat room modes use the separate legacy
 * operation below because the Public API does not expose room-mode updates.
 */

const KICK_LEGACY_API_BASE = "https://kick.com/api/v2";
const KICK_OFFICIAL_API_BASE = "https://api.kick.com/public/v1";
const REQUEST_TIMEOUT_MS = 10_000;

export type {
  KickChatModeUpdate,
  KickModerationErrorKind as KickModErrorKind,
  KickModerationResult as KickModResult,
} from "@shared/kick-moderation-types";

function classify(
  status: number,
  body: unknown
): "unauthenticated" | "forbidden" | "not-found" | "network" | "unknown" {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 500) return "network";
  if (typeof body === "object" && body && "message" in body) {
    const m = String((body as { message: unknown }).message || "").toLowerCase();
    if (m.includes("unauthorize") || m.includes("unauthenticat")) return "unauthenticated";
    if (m.includes("forbid") || m.includes("permission")) return "forbidden";
  }
  return "unknown";
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

interface KickRequestArgs {
  method: "POST" | "DELETE";
  url: string;
  accessToken: string;
  body?: unknown;
}

async function kickRequest(args: KickRequestArgs): Promise<KickModerationResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    Accept: "application/json",
  };
  if (args.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(args.url, {
      method: args.method,
      headers,
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }

  if (res.ok || res.status === 204) return { ok: true };

  if (res.status === 429) {
    return {
      ok: false,
      kind: "rate-limited",
      message: `${res.status}`,
      retryAfterSeconds: parseRetryAfter(res.headers.get("Retry-After")),
    };
  }

  const respBody = await res.json().catch(() => null);
  return { ok: false, kind: classify(res.status, respBody), message: `${res.status}` };
}

export interface OfficialBanKickUserArgs {
  accessToken: string;
  broadcasterUserId: number;
  userId: number;
  reason?: string;
}

function hasValidOfficialModerationUsers(args: {
  broadcasterUserId: number;
  userId: number;
}): boolean {
  return (
    Number.isSafeInteger(args.broadcasterUserId) &&
    args.broadcasterUserId > 0 &&
    Number.isSafeInteger(args.userId) &&
    args.userId > 0
  );
}

function invalidOfficialModerationResult(): KickModerationResult {
  return { ok: false, kind: "unknown", message: "Invalid official Kick moderation input." };
}

/** Official-only permanent ban used by slash-command execution. */
export function banKickUserOfficial(args: OfficialBanKickUserArgs): Promise<KickModerationResult> {
  if (!hasValidOfficialModerationUsers(args) || (args.reason?.length ?? 0) > 100) {
    return Promise.resolve(invalidOfficialModerationResult());
  }
  return kickRequest({
    method: "POST",
    url: `${KICK_OFFICIAL_API_BASE}/moderation/bans`,
    accessToken: args.accessToken,
    body: {
      broadcaster_user_id: args.broadcasterUserId,
      user_id: args.userId,
      ...(args.reason ? { reason: args.reason } : {}),
    },
  });
}

export interface OfficialTimeoutKickUserArgs {
  accessToken: string;
  broadcasterUserId: number;
  userId: number;
  /** Kick timeout duration in whole minutes. */
  duration: number;
  reason?: string;
}

/**
 * Strict official-only Timeout seam used by state-aware moderation.
 *
 * There is deliberately no legacy retry here: once an official mutation has
 * produced an uncertain response, replaying it through another endpoint could
 * duplicate the action.
 */
export function timeoutKickUserOfficial(
  args: OfficialTimeoutKickUserArgs
): Promise<KickModerationResult> {
  if (
    !hasValidOfficialModerationUsers(args) ||
    !Number.isInteger(args.duration) ||
    args.duration < 1 ||
    args.duration > 10_080 ||
    (args.reason?.length ?? 0) > 100
  ) {
    return Promise.resolve(invalidOfficialModerationResult());
  }
  return kickRequest({
    method: "POST",
    url: `${KICK_OFFICIAL_API_BASE}/moderation/bans`,
    accessToken: args.accessToken,
    body: {
      broadcaster_user_id: args.broadcasterUserId,
      user_id: args.userId,
      duration: args.duration,
      ...(args.reason ? { reason: args.reason } : {}),
    },
  });
}

export interface OfficialUnbanKickUserArgs {
  accessToken: string;
  broadcasterUserId: number;
  userId: number;
}

/** Official-only unban used by slash-command execution. */
export function unbanKickUserOfficial(
  args: OfficialUnbanKickUserArgs
): Promise<KickModerationResult> {
  if (!hasValidOfficialModerationUsers(args)) {
    return Promise.resolve(invalidOfficialModerationResult());
  }
  return kickRequest({
    method: "DELETE",
    url: `${KICK_OFFICIAL_API_BASE}/moderation/bans`,
    accessToken: args.accessToken,
    body: {
      broadcaster_user_id: args.broadcasterUserId,
      user_id: args.userId,
    },
  });
}

export interface SetKickChatModeArgs {
  channelSlug: string;
  update: KickChatModeUpdate;
  accessToken: string;
}

function buildChatModeBody(update: KickChatModeUpdate): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (update.slowMode) {
    body.slow_mode = update.slowMode.enabled
      ? {
          enabled: true,
          message_interval: update.slowMode.seconds ?? 0,
        }
      : { enabled: false, message_interval: 0 };
  }

  if (update.followersOnly) {
    body.followers_mode = update.followersOnly.enabled
      ? {
          enabled: true,
          min_duration: update.followersOnly.minutes ?? 0,
        }
      : { enabled: false, min_duration: 0 };
  }

  if (update.subscribersOnly) {
    body.subscribers_mode = { enabled: update.subscribersOnly.enabled };
  }

  if (update.emoteOnly) {
    body.emotes_mode = { enabled: update.emoteOnly.enabled };
  }

  return body;
}

export function setKickChatMode(args: SetKickChatModeArgs): Promise<KickModerationResult> {
  return kickRequest({
    method: "POST",
    url: `${KICK_LEGACY_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/chatroom`,
    accessToken: args.accessToken,
    body: buildChatModeBody(args.update),
  });
}
