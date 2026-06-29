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

import type { OnBeforeSendHeadersListenerDetails, Session } from "electron";
import { BrowserWindow } from "electron";

import { kickAuthService } from "@/backend/auth/kick-auth";
import { logger } from "@/backend/logging/logger";
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

export type KickWebApiGetResult =
  | { ok: true; status: number; body: string }
  | {
      ok: false;
      kind: "auth-expired" | "network" | "unknown";
      status: number;
      body: string;
      message: string;
    };

export type KickChannelViewerRoleResult =
  | { ok: true; isModerator: boolean | null; status: number }
  | {
      ok: false;
      kind: "auth-expired" | "network" | "unknown";
      status: number;
      message: string;
    };

export type KickWebApiMutationMethod = "POST" | "DELETE";

export type KickWebApiMutationResult =
  | { ok: true; status: number; body: string }
  | {
      ok: false;
      kind: "auth-expired" | "network" | "unknown";
      status: number;
      body: string;
      message: string;
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
export function buildSendIIFE(chatroomId: number, content: string, bearer: string): string {
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
 * Build a read-only Kick web API request fired from inside the hidden kick.com
 * page so session cookies, Sanctum bearer, and Kick's web runtime state attach.
 *
 * Keep this helper path-scoped. It exists for web-only account data that the
 * public Kick API does not expose, not as a generic renderer fetch proxy.
 */
export function buildKickWebApiGetIIFE(path: string, bearer: string): string {
  const p = JSON.stringify(path);
  const b = JSON.stringify(bearer);
  return `(async () => {
  try {
    const response = await fetch(${p}, {
      method: "GET",
      credentials: "include",
      headers: {
        "Authorization": ${b},
        "Accept": "application/json",
        "Referer": "https://kick.com",
        "X-App-Platform": "web",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      body: await response.text()
    });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      status: 0,
      body: String(err)
    });
  }
})()`;
}

/**
 * Build a Kick web API mutation fired from inside the hidden kick.com page.
 * This is for legacy/internal endpoints that reject OAuth bearer tokens but
 * accept Kick's web session cookies + Sanctum bearer.
 */
export function buildKickWebApiMutationIIFE(
  method: KickWebApiMutationMethod,
  path: string,
  bearer: string,
  body: unknown
): string {
  const p = JSON.stringify(path);
  const b = JSON.stringify(bearer);
  const m = JSON.stringify(method);
  const serializedBody = body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body));
  return `(async () => {
  try {
    const response = await fetch(${p}, {
      method: ${m},
      credentials: "include",
      headers: {
        "Authorization": ${b},
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Referer": "https://kick.com",
        "X-App-Platform": "web",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: ${serializedBody}
    });
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      body: await response.text()
    });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      status: 0,
      body: String(err)
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
    }
  );
}

const WARMUP_TIMEOUT_MS = 10_000;
const PREDICATE_POLL_MS = 200;
const KICK_OFFICIAL_CHAT_URL = "https://api.kick.com/public/v1/chat";

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
  broadcasterUserId?: number
): Promise<KickSendResult> {
  if (broadcasterUserId !== undefined) {
    const officialResult = await sendKickOfficialChatMessage(broadcasterUserId, content);
    if (officialResult) {
      if (officialResult.ok) return officialResult;
      logger.warn("Kick:SendWindow", "Official Kick chat send failed; falling back to legacy", {
        chatroomId,
        broadcasterUserId,
        kind: officialResult.kind,
        message: officialResult.message,
      });
    }
  }

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

async function sendKickOfficialChatMessage(
  broadcasterUserId: number,
  content: string
): Promise<KickSendResult | null> {
  try {
    if (!kickAuthService.isAuthenticated()) return null;
    await kickAuthService.ensureValidToken();
    const accessToken = kickAuthService.getAccessToken();
    if (!accessToken) return null;

    const response = await fetch(KICK_OFFICIAL_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        broadcaster_user_id: broadcasterUserId,
        content,
        type: "user",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const bodyText = await response.text().catch(() => "");
    return classifyOfficialSendResult({
      status: response.status,
      body: bodyText,
      retryAfter: response.headers.get("Retry-After"),
    });
  } catch (error) {
    return {
      ok: false,
      kind: "network",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function classifyOfficialSendResult(input: {
  status: number;
  body: string;
  retryAfter: string | null;
}): KickSendResult {
  if (input.status >= 200 && input.status < 300) {
    try {
      const parsed = JSON.parse(input.body) as
        | { data?: { is_sent?: boolean; message_id?: string } }
        | undefined;
      if (parsed?.data?.is_sent === false) {
        return { ok: false, kind: "unknown", message: "Kick did not send the message." };
      }
      return { ok: true, messageId: parsed?.data?.message_id };
    } catch {
      return { ok: true, messageId: undefined };
    }
  }

  return classifySendResult(input);
}

const ALLOWED_KICK_WEB_API_GET_PATHS = [
  /^\/api\/v2\/user\/subscriptions$/,
  /^\/api\/v2\/channels\/[^/?#]+\/me$/,
] as const;
const ALLOWED_KICK_WEB_API_MUTATIONS: ReadonlyArray<{
  method: KickWebApiMutationMethod;
  pattern: RegExp;
}> = [
  {
    method: "POST",
    pattern: /^\/api\/v2\/channels\/[^/?#]+\/pinned-message$/,
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v2\/channels\/[^/?#]+\/pinned-message$/,
  },
  {
    method: "POST",
    pattern: /^\/api\/v2\/channels\/[^/?#]+\/bans$/,
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v2\/channels\/[^/?#]+\/bans\/[^/?#]+$/,
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v2\/chatrooms\/\d+\/messages\/[^/?#]+$/,
  },
];

export async function fetchKickWebApiGet(path: string): Promise<KickWebApiGetResult> {
  if (!isAllowedKickWebApiGet(path)) {
    return {
      ok: false,
      kind: "unknown",
      status: 0,
      body: "",
      message: "Unsupported Kick web API path.",
    };
  }

  await ensureSendWindowReady();
  if (!sendWindow || sendWindow.isDestroyed() || latestKickWebBearer === null) {
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: "",
      message: "Send window failed to initialize.",
    };
  }

  let result = await _fireKickWebApiGet(path);
  if (!result.ok && result.kind === "auth-expired") {
    try {
      await _reloadAndRecapture(sendWindow);
    } catch {
      return result;
    }
    if (latestKickWebBearer === null || sendWindow.isDestroyed()) return result;
    result = await _fireKickWebApiGet(path);
  }
  return result;
}

function isAllowedKickWebApiGet(path: string): boolean {
  return ALLOWED_KICK_WEB_API_GET_PATHS.some((pattern) => pattern.test(path));
}

function valueHasModRole(value: unknown): boolean | null {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (
      normalized === "moderator" ||
      normalized === "mod" ||
      normalized === "broadcaster" ||
      normalized === "owner" ||
      normalized === "channel_owner" ||
      normalized === "channel-owner"
    ) {
      return true;
    }
    if (normalized === "viewer" || normalized === "follower" || normalized === "subscriber") {
      return false;
    }
    return null;
  }

  if (Array.isArray(value)) {
    let sawExplicitFalse = false;
    for (const item of value) {
      const itemResult = valueHasModRole(item);
      if (itemResult === true) return true;
      if (itemResult === false) sawExplicitFalse = true;
    }
    return sawExplicitFalse ? false : null;
  }

  if (!value || typeof value !== "object") return null;
  return parseKickChannelViewerRoleObject(value as Record<string, unknown>);
}

function parseKickChannelViewerRoleObject(data: Record<string, unknown>): boolean | null {
  const explicitBooleanKeys = [
    "is_moderator",
    "isModerator",
    "is_mod",
    "isMod",
    "moderator",
    "can_moderate",
    "canModerate",
    "is_broadcaster",
    "isBroadcaster",
    "broadcaster",
    "is_channel_owner",
    "isChannelOwner",
  ];
  for (const key of explicitBooleanKeys) {
    if (typeof data[key] === "boolean") return data[key] as boolean;
  }

  const roleKeys = ["role", "roles", "badges", "permissions", "user_role", "userRole"];
  for (const key of roleKeys) {
    const result = valueHasModRole(data[key]);
    if (result !== null) return result;
  }

  let sawExplicitFalse = false;
  for (const value of Object.values(data)) {
    if (!value || typeof value !== "object") continue;
    const result = valueHasModRole(value);
    if (result === true) return true;
    if (result === false) sawExplicitFalse = true;
  }
  return sawExplicitFalse ? false : null;
}

export function parseKickChannelViewerRoleBody(body: string): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  return valueHasModRole(parsed);
}

export async function getKickChannelViewerRole(
  channelSlug: string
): Promise<KickChannelViewerRoleResult> {
  const slug = channelSlug.trim().toLowerCase();
  if (!slug) return { ok: true, isModerator: null, status: 0 };

  const result = await fetchKickWebApiGet(`/api/v2/channels/${encodeURIComponent(slug)}/me`);
  if (!result.ok) {
    return {
      ok: false,
      kind: result.kind,
      status: result.status,
      message: result.message,
    };
  }

  return {
    ok: true,
    isModerator: parseKickChannelViewerRoleBody(result.body),
    status: result.status,
  };
}

function isAllowedKickWebApiMutation(method: KickWebApiMutationMethod, path: string): boolean {
  return ALLOWED_KICK_WEB_API_MUTATIONS.some(
    (entry) => entry.method === method && entry.pattern.test(path)
  );
}

export async function fetchKickWebApiMutation(
  method: KickWebApiMutationMethod,
  path: string,
  body?: unknown
): Promise<KickWebApiMutationResult> {
  const logMeta = { method, path };
  if (!isAllowedKickWebApiMutation(method, path)) {
    logger.warn("Kick:SendWindow", "Rejected unsupported Kick web API mutation", logMeta);
    return {
      ok: false,
      kind: "unknown",
      status: 0,
      body: "",
      message: "Unsupported Kick web API mutation.",
    };
  }

  logger.info("Kick:SendWindow", "Kick web API mutation requested", logMeta);
  await ensureSendWindowReady();
  if (!sendWindow || sendWindow.isDestroyed() || latestKickWebBearer === null) {
    logger.warn("Kick:SendWindow", "Kick web API mutation send window unavailable", logMeta);
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: "",
      message: "Send window failed to initialize.",
    };
  }

  let result = await _fireKickWebApiMutation(method, path, body);
  if (!result.ok && result.kind === "auth-expired") {
    logger.warn("Kick:SendWindow", "Kick web API mutation auth expired; reloading session", {
      ...logMeta,
      status: result.status,
      kind: result.kind,
    });
    try {
      await _reloadAndRecapture(sendWindow);
    } catch {
      logger.warn("Kick:SendWindow", "Kick web API mutation session reload failed", {
        ...logMeta,
        status: result.status,
        kind: result.kind,
      });
      return result;
    }
    if (latestKickWebBearer === null || sendWindow.isDestroyed()) return result;
    result = await _fireKickWebApiMutation(method, path, body);
  }
  logger[result.ok ? "info" : "warn"](
    "Kick:SendWindow",
    result.ok ? "Kick web API mutation succeeded" : "Kick web API mutation failed",
    {
      ...logMeta,
      status: result.status,
      kind: result.ok ? "ok" : result.kind,
    }
  );
  return result;
}

export function deleteKickChatMessage(
  chatroomId: number,
  messageId: string
): Promise<KickWebApiMutationResult> {
  return fetchKickWebApiMutation(
    "DELETE",
    `/api/v2/chatrooms/${chatroomId}/messages/${encodeURIComponent(messageId)}`
  );
}

export function banKickChatUser(
  channelSlug: string,
  username: string
): Promise<KickWebApiMutationResult> {
  return fetchKickWebApiMutation(
    "POST",
    `/api/v2/channels/${encodeURIComponent(channelSlug)}/bans`,
    {
      banned_username: username,
      permanent: true,
    }
  );
}

export function timeoutKickChatUser(
  channelSlug: string,
  username: string,
  duration: number
): Promise<KickWebApiMutationResult> {
  return fetchKickWebApiMutation(
    "POST",
    `/api/v2/channels/${encodeURIComponent(channelSlug)}/bans`,
    {
      banned_username: username,
      duration,
      permanent: false,
    }
  );
}

export function unbanKickChatUser(
  channelSlug: string,
  username: string
): Promise<KickWebApiMutationResult> {
  return fetchKickWebApiMutation(
    "DELETE",
    `/api/v2/channels/${encodeURIComponent(channelSlug)}/bans/${encodeURIComponent(username)}`
  );
}

async function _fireKickWebApiGet(path: string): Promise<KickWebApiGetResult> {
  if (!sendWindow || latestKickWebBearer === null) {
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: "",
      message: "Send window not ready.",
    };
  }

  const iife = buildKickWebApiGetIIFE(path, latestKickWebBearer);
  let raw: string;
  try {
    raw = (await sendWindow.webContents.executeJavaScript(iife)) as string;
  } catch (err) {
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: "",
      message: `Kick web API window error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: { ok: boolean; status: number; body: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return {
      ok: false,
      kind: "unknown",
      status: 0,
      body: raw,
      message: "Kick web API window returned non-JSON response.",
    };
  }

  if (parsed.ok && parsed.status >= 200 && parsed.status < 300) {
    return { ok: true, status: parsed.status, body: parsed.body };
  }

  if (
    parsed.status === 401 ||
    parsed.status === 419 ||
    (parsed.status === 403 && parsed.body.includes("User is not authenticated"))
  ) {
    return {
      ok: false,
      kind: "auth-expired",
      status: parsed.status,
      body: parsed.body,
      message: "Kick session expired - reconnect Kick in Settings.",
    };
  }

  if (parsed.status === 0) {
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: parsed.body,
      message: "Network error fetching Kick web API.",
    };
  }

  return {
    ok: false,
    kind: "unknown",
    status: parsed.status,
    body: parsed.body,
    message: `Kick web API request failed (${parsed.status}).`,
  };
}

async function _fireKickWebApiMutation(
  method: KickWebApiMutationMethod,
  path: string,
  body: unknown
): Promise<KickWebApiMutationResult> {
  if (!sendWindow || latestKickWebBearer === null) {
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: "",
      message: "Send window not ready.",
    };
  }

  const iife = buildKickWebApiMutationIIFE(method, path, latestKickWebBearer, body);
  let raw: string;
  try {
    raw = (await sendWindow.webContents.executeJavaScript(iife)) as string;
  } catch (err) {
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: "",
      message: `Kick web API window error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: { ok: boolean; status: number; body: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return {
      ok: false,
      kind: "unknown",
      status: 0,
      body: raw,
      message: "Kick web API window returned non-JSON response.",
    };
  }

  if (parsed.ok && parsed.status >= 200 && parsed.status < 300) {
    return { ok: true, status: parsed.status, body: parsed.body };
  }

  if (
    parsed.status === 401 ||
    parsed.status === 419 ||
    (parsed.status === 403 && parsed.body.includes("User is not authenticated"))
  ) {
    return {
      ok: false,
      kind: "auth-expired",
      status: parsed.status,
      body: parsed.body,
      message: "Kick session expired - reconnect Kick in Settings.",
    };
  }

  if (parsed.status === 0) {
    return {
      ok: false,
      kind: "network",
      status: 0,
      body: parsed.body,
      message: "Network error mutating Kick web API.",
    };
  }

  return {
    ok: false,
    kind: "unknown",
    status: parsed.status,
    body: parsed.body,
    message: `Kick web API mutation failed (${parsed.status}).`,
  };
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
