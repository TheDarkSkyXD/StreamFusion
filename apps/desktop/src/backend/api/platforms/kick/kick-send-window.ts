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
