/**
 * Kick v2 — Moderation Mutations (authenticated)
 *
 * Endpoints (captured from KickTalk's reference implementation, 2026-05-18:
 * `reference/KickTalk-main/utils/services/kick/kickAPI.js`):
 *
 *   POST   /api/v2/channels/{slug}/bans
 *     body: { banned_username, permanent: true }                          — ban
 *     body: { banned_username, duration, permanent: false }               — timeout
 *   DELETE /api/v2/channels/{slug}/bans/{username}                        — unban
 *   DELETE /api/v2/chatrooms/{chatroomId}/messages/{messageId}            — delete message
 *   POST   /api/v2/channels/{slug}/chatroom                               — chat-mode update
 *
 * Auth: Bearer token from our Kick OAuth flow (same as kick-pin-mutations).
 * We deliberately do NOT reproduce KickTalk's cookie-jar / X-XSRF-TOKEN
 * setup — see kick-pin-mutations.ts for the rationale.
 *
 * Slug handling: we pass the slug through cleanly and rely on the caller
 * to give us the canonical Kick slug. KickTalk performs an
 * underscore-to-dash retry on failure; that's a KickTalk-specific quirk
 * and is intentionally not mirrored here.
 *
 * U7 ships the helpers in isolation; U11 wires them into call-sites.
 */

const KICK_API_BASE = "https://kick.com/api/v2";
const REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Result types (mirrors kick-pin-mutations + rate-limited branch for parity
// with U6's Helix moderation helpers).
// ---------------------------------------------------------------------------

export type KickModErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "network"
  | "unknown";

export type KickModResult =
  | { ok: true }
  | { ok: false; kind: "rate-limited"; message: string; retryAfterSeconds: number | null }
  | {
      ok: false;
      kind: "unauthenticated" | "forbidden" | "not-found" | "network" | "unknown";
      message: string;
    };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classify(
  status: number,
  body: unknown,
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

  if (res.ok) return { ok: true };

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

// ---------------------------------------------------------------------------
// 1. banKickUser — permanent ban
// ---------------------------------------------------------------------------

export interface BanKickUserArgs {
  channelSlug: string;
  username: string;
  accessToken: string;
}

export function banKickUser(args: BanKickUserArgs): Promise<KickModResult> {
  const url = `${KICK_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/bans`;
  return kickRequest({
    method: "POST",
    url,
    accessToken: args.accessToken,
    body: { banned_username: args.username, permanent: true },
  });
}

// ---------------------------------------------------------------------------
// 2. timeoutKickUser — temporary ban
// ---------------------------------------------------------------------------

export interface TimeoutKickUserArgs {
  channelSlug: string;
  username: string;
  /**
   * Timeout duration. Per Kick's API (and KickTalk's `getTimeoutUser`,
   * kickAPI.js ~line 389), the wire field is `duration` and Kick's UI uses
   * minutes. This helper does NOT convert — it passes whatever the caller
   * supplies through to the API as-is. Callers should pass minutes.
   */
  duration: number;
  accessToken: string;
}

export function timeoutKickUser(args: TimeoutKickUserArgs): Promise<KickModResult> {
  const url = `${KICK_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/bans`;
  return kickRequest({
    method: "POST",
    url,
    accessToken: args.accessToken,
    body: {
      banned_username: args.username,
      duration: args.duration,
      permanent: false,
    },
  });
}

// ---------------------------------------------------------------------------
// 3. unbanKickUser
// ---------------------------------------------------------------------------

export interface UnbanKickUserArgs {
  channelSlug: string;
  username: string;
  accessToken: string;
}

export function unbanKickUser(args: UnbanKickUserArgs): Promise<KickModResult> {
  const url = `${KICK_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/bans/${encodeURIComponent(args.username)}`;
  return kickRequest({ method: "DELETE", url, accessToken: args.accessToken });
}

// ---------------------------------------------------------------------------
// 4. deleteKickMessage — note: chatroomId, not slug
// ---------------------------------------------------------------------------

export interface DeleteKickMessageArgs {
  chatroomId: number;
  messageId: string;
  accessToken: string;
}

export function deleteKickMessage(args: DeleteKickMessageArgs): Promise<KickModResult> {
  const url = `${KICK_API_BASE}/chatrooms/${args.chatroomId}/messages/${encodeURIComponent(args.messageId)}`;
  return kickRequest({ method: "DELETE", url, accessToken: args.accessToken });
}

// ---------------------------------------------------------------------------
// 5. setKickChatMode — partial chat-mode update
// ---------------------------------------------------------------------------

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

/**
 * Builds the Kick `/chatroom` body from a partial settings object.
 *
 * Body shapes (room-state mirror — read off KickTalk's
 * `src/renderer/src/components/Chat/Input/InfoBar.jsx` lines 13-22, which
 * reads `slow_mode.message_interval`, `followers_mode.min_duration`,
 * `subscribers_mode.enabled`, `emotes_mode.enabled`):
 *
 *   slow on  → { slow_mode:        { enabled: true,  message_interval: N } }
 *   slow off → { slow_mode:        { enabled: false, message_interval: 0 } }
 *   foll on  → { followers_mode:   { enabled: true,  min_duration: N } }
 *   foll off → { followers_mode:   { enabled: false, min_duration: 0 } }
 *   subs     → { subscribers_mode: { enabled: bool } }
 *   emote    → { emotes_mode:      { enabled: bool } }
 *
 * Multiple modes may be combined in a single call — Kick's `/chatroom`
 * endpoint accepts the merged body.
 *
 * Slow-off note: per the plan's rationale (and the KickTalk room-state
 * shape it reads), we send `slow_mode: { enabled: false, message_interval: 0 }`
 * to the same `/chatroom` endpoint rather than a separate `/slow-off`
 * route. KickTalk's current code has the wire path commented out
 * (`preload/index.js:368`) so there is no live precedent to copy — the
 * room-state shape on InfoBar.jsx is the only ground truth.
 */
function buildChatModeBody(update: KickChatModeUpdate): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (update.slowMode) {
    if (update.slowMode.enabled) {
      body.slow_mode = {
        enabled: true,
        message_interval: update.slowMode.seconds ?? 0,
      };
    } else {
      body.slow_mode = { enabled: false, message_interval: 0 };
    }
  }

  if (update.followersOnly) {
    if (update.followersOnly.enabled) {
      body.followers_mode = {
        enabled: true,
        min_duration: update.followersOnly.minutes ?? 0,
      };
    } else {
      body.followers_mode = { enabled: false, min_duration: 0 };
    }
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
  const url = `${KICK_API_BASE}/channels/${encodeURIComponent(args.channelSlug)}/chatroom`;
  return kickRequest({
    method: "POST",
    url,
    accessToken: args.accessToken,
    body: buildChatModeBody(args.update),
  });
}
