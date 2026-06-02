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
import type { OnBeforeSendHeadersListenerDetails, Session } from "electron";

import { sleep } from "@/lib/sleep";

import { acquireBrowserWindowSlot } from "./endpoints/channel-endpoints";

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

/**
 * Register a read-only Authorization-header watcher on the session.
 * Updates the module-level bearer cache whenever kick.com fires an
 * authenticated request. We pass requestHeaders straight through so the
 * filter has zero behavioural effect on kick.com's traffic.
 *
 * Per spec R6-R9.
 */
export function installBearerInterceptor(targetSession: Session): void {
  targetSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*.kick.com/*"] },
    (details: OnBeforeSendHeadersListenerDetails, callback) => {
      const auth = details.requestHeaders?.Authorization;
      if (typeof auth === "string" && isSanctumBearer(auth)) {
        latestKickWebBearer = auth;
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

const WARMUP_TIMEOUT_MS = 10_000;
const PREDICATE_POLL_MS = 200;

const COOKIE_PREDICATE_IIFE = `(() => document.cookie.indexOf("session_token=") >= 0)()`;

async function _pollPredicate(win: BrowserWindow, deadline: number): Promise<void> {
  // Poll until both: session_token cookie is set AND latestKickWebBearer was
  // captured by the interceptor on some kick.com request.
  while (Date.now() < deadline) {
    if (win.isDestroyed()) {
      throw new Error("send-window-warmup-timeout: window destroyed during warmup");
    }
    const cookieOk = (await win.webContents.executeJavaScript(COOKIE_PREDICATE_IIFE)) === true;
    if (cookieOk && latestKickWebBearer !== null) return;
    await sleep(PREDICATE_POLL_MS);
  }
  throw new Error("send-window-warmup-timeout: predicate did not resolve within 10s");
}

export async function ensureSendWindowReady(): Promise<void> {
  if (warmupPromise) return warmupPromise;
  if (sendWindow && !sendWindow.isDestroyed() && latestKickWebBearer !== null) {
    return;
  }
  warmupPromise = (async () => {
    const releaseSlot = await acquireBrowserWindowSlot();
    try {
      const win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      installBearerInterceptor(win.webContents.session);
      win.webContents.on("render-process-gone", () => {
        if (sendWindow !== win) return;
        sendWindow = null;
        latestKickWebBearer = null;
        warmupPromise = null;
      });
      sendWindow = win;
      try {
        await win.loadURL("https://kick.com/");
        await _pollPredicate(win, Date.now() + WARMUP_TIMEOUT_MS);
      } catch (err) {
        // Warmup failed (timeout, navigation error, etc.). Without this
        // cleanup the hidden window would stay resident and the next
        // ensureSendWindowReady call would construct a SECOND window
        // (because the fast-path requires latestKickWebBearer !== null,
        // which a failed warmup never sets). The old window's
        // render-process-gone listener would also race with the
        // successor's state. Destroy now, null the slot, re-throw.
        sendWindow = null;
        try {
          win.destroy();
        } catch {
          // Already torn down — ignore.
        }
        throw err;
      }
    } finally {
      releaseSlot();
    }
  })();
  try {
    await warmupPromise;
  } finally {
    // Clear the promise slot only after it has fully resolved so concurrent
    // callers from step (1) keep sharing it.
    warmupPromise = null;
  }
}
async function _reloadAndRecapture(win: BrowserWindow): Promise<void> {
  // Single-flight: if a reload is already in progress, share its promise.
  if (reloadPromise) return reloadPromise;
  // Clear bearer so the predicate genuinely waits for a fresh capture.
  latestKickWebBearer = null;
  reloadPromise = (async () => {
    try {
      await win.loadURL("https://kick.com/");
      await _pollPredicate(win, Date.now() + WARMUP_TIMEOUT_MS);
    } finally {
      reloadPromise = null;
    }
  })();
  return reloadPromise;
}

export async function sendKickChatMessage(
  chatroomId: number,
  content: string,
): Promise<KickSendResult> {
  await ensureSendWindowReady();
  if (!sendWindow || sendWindow.isDestroyed() || latestKickWebBearer === null) {
    return {
      ok: false,
      kind: "network",
      message: "Send window failed to initialize.",
    };
  }
  let result = await _fireSend(chatroomId, content);
  if (!result.ok && result.kind === "auth-expired") {
    // One reload + one retry. Failing again surfaces auth-expired without
    // a second reload (per spec R25).
    try {
      await _reloadAndRecapture(sendWindow);
    } catch {
      return result;
    }
    if (latestKickWebBearer === null || sendWindow.isDestroyed()) return result;
    result = await _fireSend(chatroomId, content);
  }
  return result;
}

async function _fireSend(chatroomId: number, content: string): Promise<KickSendResult> {
  if (!sendWindow || latestKickWebBearer === null) {
    return {
      ok: false,
      kind: "network",
      message: "Send window not ready.",
    };
  }
  const iife = buildSendIIFE(chatroomId, content, latestKickWebBearer);
  let raw: string;
  try {
    raw = (await sendWindow.webContents.executeJavaScript(iife)) as string;
  } catch (err) {
    return {
      ok: false,
      kind: "network",
      message: `Send window error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let parsed: { ok: boolean; status: number; body: string; retryAfter: string | null };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return {
      ok: false,
      kind: "unknown",
      message: "Send window returned non-JSON response.",
    };
  }
  return classifySendResult({
    status: parsed.status,
    body: parsed.body,
    retryAfter: parsed.retryAfter,
  });
}
export async function disposeSendWindow(): Promise<void> {
  const w = sendWindow;
  sendWindow = null;
  latestKickWebBearer = null;
  warmupPromise = null;
  reloadPromise = null;
  if (w && !w.isDestroyed()) {
    try {
      w.destroy();
    } catch {
      // Already gone.
    }
  }
}
