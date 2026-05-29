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
