import { logger } from "@shared/utils/cross-logger";

/**
 * Kick moderation mutations.
 *
 * Official Kick Public API is primary where it covers the operation and the
 * caller has the required stable IDs. Legacy v2 web routes remain as fallback
 * for scope gaps, older call sites, and room-mode updates that the official
 * docs do not currently expose.
 */

const KICK_LEGACY_API_BASE = "https://kick.com/api/v2";
const KICK_OFFICIAL_API_BASE = "https://api.kick.com/public/v1";
const REQUEST_TIMEOUT_MS = 10_000;

export type KickModErrorKind =
  "unauthenticated" | "forbidden" | "not-found" | "rate-limited" | "network" | "unknown";

export type KickModResult =
  | { ok: true }
  | { ok: false; kind: "rate-limited"; message: string; retryAfterSeconds: number | null }
  | {
      ok: false;
      kind: "unauthenticated" | "forbidden" | "not-found" | "network" | "unknown";
      message: string;
    };

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

async function kickRequest(args: KickRequestArgs): Promise<KickModResult> {
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

async function withOfficialFallback(
  official: (() => Promise<KickModResult>) | null,
  legacy: () => Promise<KickModResult>,
  context: Record<string, unknown>
): Promise<KickModResult> {
  if (official) {
    const result = await official();
    if (result.ok) return result;
    logger.warn("Kick:Mod", "Official Kick moderation API failed; falling back to legacy", {
      ...context,
      kind: result.kind,
      message: result.message,
    });
  }
  return legacy();
}

function numericId(value: number | string | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface BanKickUserArgs {
  channelSlug: string;
  username: string;
  accessToken: string;
  broadcasterUserId?: number | string;
  userId?: number | string;
  reason?: string;
}

export function banKickUser(args: BanKickUserArgs): Promise<KickModResult> {
  const broadcasterUserId = numericId(args.broadcasterUserId);
  const userId = numericId(args.userId);
  const official =
    broadcasterUserId !== null && userId !== null
      ? () =>
          kickRequest({
            method: "POST",
            url: `${KICK_OFFICIAL_API_BASE}/moderation/bans`,
            accessToken: args.accessToken,
            body: {
              broadcaster_user_id: broadcasterUserId,
              user_id: userId,
              ...(args.reason ? { reason: args.reason } : {}),
            },
          })
      : null;

  return withOfficialFallback(
    official,
    () =>
      kickRequest({
        method: "POST",
        url: `${KICK_LEGACY_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/bans`,
        accessToken: args.accessToken,
        body: { banned_username: args.username, permanent: true },
      }),
    { action: "ban", channelSlug: args.channelSlug, username: args.username }
  );
}

export interface TimeoutKickUserArgs {
  channelSlug: string;
  username: string;
  /** Kick timeout duration in minutes. */
  duration: number;
  accessToken: string;
  broadcasterUserId?: number | string;
  userId?: number | string;
  reason?: string;
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
export function timeoutKickUserOfficial(args: OfficialTimeoutKickUserArgs): Promise<KickModResult> {
  if (
    !Number.isSafeInteger(args.broadcasterUserId) ||
    !Number.isSafeInteger(args.userId) ||
    !Number.isInteger(args.duration) ||
    args.duration < 1 ||
    args.duration > 10_080
  ) {
    return Promise.resolve({
      ok: false,
      kind: "unknown",
      message: "Invalid official Kick timeout input.",
    });
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

export function timeoutKickUser(args: TimeoutKickUserArgs): Promise<KickModResult> {
  const broadcasterUserId = numericId(args.broadcasterUserId);
  const userId = numericId(args.userId);
  const official =
    broadcasterUserId !== null && userId !== null
      ? () =>
          kickRequest({
            method: "POST",
            url: `${KICK_OFFICIAL_API_BASE}/moderation/bans`,
            accessToken: args.accessToken,
            body: {
              broadcaster_user_id: broadcasterUserId,
              user_id: userId,
              duration: args.duration,
              ...(args.reason ? { reason: args.reason } : {}),
            },
          })
      : null;

  return withOfficialFallback(
    official,
    () =>
      kickRequest({
        method: "POST",
        url: `${KICK_LEGACY_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/bans`,
        accessToken: args.accessToken,
        body: {
          banned_username: args.username,
          duration: args.duration,
          permanent: false,
        },
      }),
    { action: "timeout", channelSlug: args.channelSlug, username: args.username }
  );
}

export interface UnbanKickUserArgs {
  channelSlug: string;
  username: string;
  accessToken: string;
  broadcasterUserId?: number | string;
  userId?: number | string;
}

export function unbanKickUser(args: UnbanKickUserArgs): Promise<KickModResult> {
  const broadcasterUserId = numericId(args.broadcasterUserId);
  const userId = numericId(args.userId);
  const official =
    broadcasterUserId !== null && userId !== null
      ? () =>
          kickRequest({
            method: "DELETE",
            url: `${KICK_OFFICIAL_API_BASE}/moderation/bans`,
            accessToken: args.accessToken,
            body: {
              broadcaster_user_id: broadcasterUserId,
              user_id: userId,
            },
          })
      : null;

  return withOfficialFallback(
    official,
    () =>
      kickRequest({
        method: "DELETE",
        url: `${KICK_LEGACY_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/bans/${encodeURIComponent(args.username)}`,
        accessToken: args.accessToken,
      }),
    { action: "unban", channelSlug: args.channelSlug, username: args.username }
  );
}

export interface DeleteKickMessageArgs {
  chatroomId: number;
  messageId: string;
  accessToken: string;
}

export function deleteKickMessage(args: DeleteKickMessageArgs): Promise<KickModResult> {
  return withOfficialFallback(
    () =>
      kickRequest({
        method: "DELETE",
        url: `${KICK_OFFICIAL_API_BASE}/chat/${encodeURIComponent(args.messageId)}`,
        accessToken: args.accessToken,
      }),
    () =>
      kickRequest({
        method: "DELETE",
        url: `${KICK_LEGACY_API_BASE}/chatrooms/${args.chatroomId}/messages/${encodeURIComponent(args.messageId)}`,
        accessToken: args.accessToken,
      }),
    { action: "delete-message", chatroomId: args.chatroomId, messageId: args.messageId }
  );
}

export interface KickChatModeUpdate {
  /** When enabled, `seconds` is the message_interval. When disabled, `seconds` is ignored. */
  slowMode?: { enabled: boolean; seconds?: number };
  followersOnly?: { enabled: boolean; minutes?: number };
  subscribersOnly?: { enabled: boolean };
  emoteOnly?: { enabled: boolean };
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

export function setKickChatMode(args: SetKickChatModeArgs): Promise<KickModResult> {
  return kickRequest({
    method: "POST",
    url: `${KICK_LEGACY_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/chatroom`,
    accessToken: args.accessToken,
    body: buildChatModeBody(args.update),
  });
}
