/**
 * Kick chat-send window owner.
 *
 * Owns a single hidden BrowserWindow parked on https://kick.com/ in the
 * default Electron session, captures the Sanctum bearer from outgoing
 * /api/v2/* requests, and fires chat-send fetches from inside the page
 * via executeJavaScript so Kasada-injected runtime state attaches.
 *
 * Spec: docs/brainstorms/2026-05-29-kick-chat-send-via-v2-broadcast-requirements.md
 */
import { BrowserWindow, session } from "electron";

export type KickSendResult =
  | { ok: true; messageId: string | undefined }
  | {
      ok: false;
      kind: "auth-expired" | "rate-limited" | "forbidden" | "network" | "unknown";
      message: string;
      retryAfterSeconds?: number;
    };

// Module-level state — single send window, single bearer cache.
let sendWindow: BrowserWindow | null = null;
let latestKickWebBearer: string | null = null;
let warmupPromise: Promise<void> | null = null;
let reloadPromise: Promise<void> | null = null;

const SANCTUM_BEARER_RE = /^Bearer \d+\|[A-Za-z0-9]+$/;

/**
 * Recognise the Laravel Sanctum personal-access-token format kick.com web
 * attaches to /api/v2/* requests. We use this to filter the webRequest
 * interceptor's capture so JWT-shaped bearers (e.g. id.kick.com OAuth
 * tokens that may leak into the same session) don't poison the cache.
 */
export function isSanctumBearer(value: string): boolean {
  return SANCTUM_BEARER_RE.test(value);
}

// @internal — exported only for tests
export function setBearerForTest(value: string | null): void {
  latestKickWebBearer = value;
}
// @internal
export function getBearerForTest(): string | null {
  return latestKickWebBearer;
}
// @internal
export function clearBearerForTest(): void {
  latestKickWebBearer = null;
  sendWindow = null;
  warmupPromise = null;
  reloadPromise = null;
}

/**
 * Build the IIFE source string fired via webContents.executeJavaScript.
 *
 * Interpolates `chatroomId`, `content`, and `bearer` via JSON.stringify so
 * embedded quotes/newlines in any of them cannot break out of the JS string
 * literal. `message_ref` is computed at runtime inside the IIFE so the
 * timestamp reflects when the fetch actually fires.
 *
 * Per spec R20-R21.
 */
export function buildSendIIFE(
  chatroomId: number,
  content: string,
  bearer: string,
): string {
  const url = JSON.stringify(`/api/v2/messages/send/${chatroomId}`);
  const c = JSON.stringify(content);
  const b = JSON.stringify(bearer);
  return `(async () => {
  try {
    const response = await fetch(${url}, {
      method: "POST",
      credentials: "include",
      headers: {
        "Authorization": ${b},
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Referer": "https://kick.com",
        "X-App-Platform": "web"
      },
      body: JSON.stringify({
        content: ${c},
        type: "message",
        message_ref: String(Date.now())
      })
    });
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      body: await response.text(),
      retryAfter: response.headers.get("Retry-After")
    });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      status: 0,
      body: String(err),
      retryAfter: null
    });
  }
})()`;
}

/**
 * Pure: turn the {status, body, retryAfter} the IIFE returned into a tagged
 * KickSendResult. Per spec R23-R29.
 *
 * The 403-with-"User is not authenticated." carve-out matches Kick's quirk
 * of returning 403 for both "session dead" and "banned/timed out" — these
 * are surfaced as different `kind` values so the caller can decide whether
 * to retry (auth-expired) or escalate to the user (forbidden).
 */
export function classifySendResult(input: {
  status: number;
  body: string;
  retryAfter: string | null;
}): KickSendResult {
  const { status, body, retryAfter } = input;

  if (status >= 200 && status < 300) {
    let messageId: string | undefined;
    try {
      const parsed = JSON.parse(body) as
        | { data?: { id?: string; message_id?: string } }
        | undefined;
      messageId = parsed?.data?.id ?? parsed?.data?.message_id;
    } catch {
      // Body wasn't JSON — leave messageId undefined.
    }
    return { ok: true, messageId };
  }

  if (status === 401 || status === 419) {
    return {
      ok: false,
      kind: "auth-expired",
      message: "Kick session expired — reconnect Kick in Settings.",
    };
  }

  if (status === 403) {
    // Distinguish "session dead" from "banned in channel" by body content.
    if (body.includes("User is not authenticated")) {
      return {
        ok: false,
        kind: "auth-expired",
        message: "Kick session expired — reconnect Kick in Settings.",
      };
    }
    return {
      ok: false,
      kind: "forbidden",
      message: "You are banned or timed out in this channel.",
    };
  }

  if (status === 429) {
    const parsed = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
    const retryAfterSeconds = Number.isFinite(parsed) ? parsed : undefined;
    return {
      ok: false,
      kind: "rate-limited",
      message: "Slow down — Kick rate limit.",
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
  }

  if (status === 0) {
    return {
      ok: false,
      kind: "network",
      message: "Network error sending message, please try again.",
    };
  }

  return {
    ok: false,
    kind: "unknown",
    message: `Send failed (${status}).`,
  };
}

export async function ensureSendWindowReady(): Promise<void> {
  throw new Error("not implemented");
}
export async function sendKickChatMessage(
  _chatroomId: number,
  _content: string,
): Promise<KickSendResult> {
  throw new Error("not implemented");
}
export async function disposeSendWindow(): Promise<void> {
  throw new Error("not implemented");
}
