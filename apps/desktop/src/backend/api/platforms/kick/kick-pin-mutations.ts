/**
 * Kick — Pin / Unpin Mutations
 *
 * Endpoints (captured from KickTalk's reference implementation, 2026-05-18):
 *
 *   POST   /api/v2/channels/{slug}/pinned-message
 *     body: { duration: <seconds>, message: { id, content, chatroom_id, created_at, sender, type: "message" } }
 *   DELETE /api/v2/channels/{slug}/pinned-message
 *
 * Auth: Bearer token from our Kick OAuth flow. KickTalk passes a session
 * cookie in this header — Kick's API appears to accept either flavor for
 * authenticated mod actions. If the OAuth Bearer token is rejected in
 * practice, the cookie-jar approach is the fallback (would require IPC).
 *
 * The duration parameter is in seconds. Kick's UI offers 20m / 1h / 24h /
 * indefinite; KickTalk hardcodes 1200s (20min) as a single default. We
 * preserve the duration the caller supplies so the dialog's choice flows
 * through.
 */

const KICK_API_BASE = "https://kick.com/api/v2";
const REQUEST_TIMEOUT_MS = 10_000;

export type KickPinMutationErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "network"
  | "unknown";

export type KickPinMutationResult =
  | { ok: true }
  | { ok: false; kind: KickPinMutationErrorKind; message: string };

function classify(status: number, body: unknown): KickPinMutationErrorKind {
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

export interface KickPinPayload {
  /** Channel slug (the lowercased streamer name in the URL). */
  channelSlug: string;
  /** Kick chat-message UUID. */
  messageId: string;
  /** Numeric chatroom id for the channel. */
  chatroomId: number;
  /** Raw message body. */
  content: string;
  /** Sender envelope as Kick's v2 endpoint expects it. */
  sender: { id: number; username: string; slug?: string; identity?: unknown };
  /** Pin duration in seconds. `null` lets the caller skip the field. */
  durationSeconds: number | null;
  /** OAuth Bearer token from our Kick auth flow. */
  accessToken: string;
}

export async function pinKickMessage(payload: KickPinPayload): Promise<KickPinMutationResult> {
  const url = `${KICK_API_BASE}/channels/${encodeURIComponent(payload.channelSlug)}/pinned-message`;
  const body: Record<string, unknown> = {
    message: {
      id: payload.messageId,
      chatroom_id: payload.chatroomId,
      content: payload.content,
      created_at: new Date().toISOString(),
      sender: payload.sender,
      type: "message",
    },
  };
  if (payload.durationSeconds !== null) body.duration = payload.durationSeconds;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${payload.accessToken}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const respBody = await res.json().catch(() => null);
    return { ok: false, kind: classify(res.status, respBody), message: `${res.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }
}

export async function unpinKickMessage(
  channelSlug: string,
  accessToken: string,
): Promise<KickPinMutationResult> {
  const url = `${KICK_API_BASE}/channels/${encodeURIComponent(channelSlug)}/pinned-message`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const respBody = await res.json().catch(() => null);
    return { ok: false, kind: classify(res.status, respBody), message: `${res.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }
}
