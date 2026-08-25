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

import type { BrowserWindow, Session } from "electron";
import { session } from "electron";

import { logger } from "@/backend/logging/logger";
import { sleep } from "@/lib/sleep";

import { acquireBrowserWindowSlot } from "./endpoints/channel-endpoints";
import {
  clearPersistedKickWebBearer,
  installKickWebBearerCapture,
  isKickWebBearer,
  persistKickWebBearerCandidate,
  readPersistedKickWebBearer,
} from "./kick-web-credential";
import { createHiddenKickBrowserWindow } from "./kick-hidden-browser-window";
import { requestAuthenticatedKickSession } from "./kick-session-request";
import { persistDefaultKickWebSessionCookies } from "./kick-web-session";

export type KickSendResult =
  | { ok: true; messageId: string | undefined }
  | {
      ok: false;
      kind:
        "setup-required" | "auth-expired" | "rate-limited" | "forbidden" | "network" | "unknown";
      message: string;
      retryAfterSeconds?: number;
    };

export type KickWebApiGetResult =
  | { ok: true; status: number; body: string }
  | {
      ok: false;
      kind: "setup-required" | "auth-expired" | "network" | "unknown";
      status: number;
      body: string;
      message: string;
      retryAfterSeconds?: number;
    };

export type KickChannelViewerRoleResult =
  | { ok: true; isModerator: boolean | null; status: number }
  | {
      ok: false;
      kind: "setup-required" | "auth-expired" | "network" | "unknown";
      status: number;
      message: string;
    };

export type KickWebApiMutationMethod = "POST" | "DELETE";

export type KickWebApiMutationResult =
  | { ok: true; status: number; body: string }
  | {
      ok: false;
      kind: "setup-required" | "auth-expired" | "network" | "unknown";
      status: number;
      body: string;
      message: string;
    };

// Module-level state — single send window, single bearer cache.
let sendWindow: BrowserWindow | null = null;
let latestKickWebBearer: string | null = null;
let warmupPromise: Promise<void> | null = null;
let reloadPromise: Promise<void> | null = null;
let sessionRenewalPromise: Promise<void> | null = null;
let lastSessionRenewalAt = 0;

const SESSION_RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Recognise the Laravel Sanctum personal-access-token format kick.com web
 * attaches to /api/v2/* requests. We use this to filter the webRequest
 * interceptor's capture so JWT-shaped bearers (e.g. id.kick.com OAuth
 * tokens that may leak into the same session) don't poison the cache.
 */
export function isSanctumBearer(value: string): boolean {
  return isKickWebBearer(value);
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
  sessionRenewalPromise = null;
  lastSessionRenewalAt = 0;
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
      cache: "no-store",
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
        { data?: { id?: string; message_id?: string } } | undefined;
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
  installKickWebBearerCapture(targetSession, (bearer) => {
    latestKickWebBearer = bearer;
  });
}

const WARMUP_TIMEOUT_MS = 10_000;
const PREDICATE_POLL_MS = 200;
const WARMUP_ATTEMPTS = 2;
const WEB_API_GET_DEADLINE_MS = 30_000;

const KICK_WEB_SESSION_COOKIE_NAMES = new Set(["session_token", "kick_session"]);

async function hasPersistedKickWebSessionCookie(): Promise<boolean | null> {
  try {
    const cookies = await session.defaultSession.cookies.get({
      url: "https://kick.com/",
    });
    const sessionToken = cookies.find((cookie) => cookie.name === "session_token")?.value;
    if (sessionToken) {
      const recoveredBearer = persistKickWebBearerCandidate(sessionToken);
      if (recoveredBearer) latestKickWebBearer = recoveredBearer;
    }
    return cookies.some(
      (cookie) =>
        KICK_WEB_SESSION_COOKIE_NAMES.has(cookie.name) &&
        cookie.session === false &&
        typeof cookie.expirationDate === "number"
    );
  } catch {
    return null;
  }
}

export async function isKickWebApiReady(): Promise<boolean> {
  const win = sendWindow;
  return Boolean(win && !win.isDestroyed() && latestKickWebBearer !== null);
}

interface KickSendWindowReadinessDiagnostic {
  attempt: number;
  bearerCaptured: boolean;
  elapsedMs: number;
  windowDestroyed: boolean;
}

class KickSendWindowReadinessError extends Error {
  constructor(
    message: string,
    readonly kind: "setup-required" | "auth-expired" | "network",
    readonly diagnostic: KickSendWindowReadinessDiagnostic,
    readonly userMessage: string
  ) {
    super(message);
    this.name = "KickSendWindowReadinessError";
  }
}

function readinessError(
  reason: "destroyed" | "missing-session-cookie" | "timeout",
  diagnostic: KickSendWindowReadinessDiagnostic
): KickSendWindowReadinessError {
  const diagnosticText =
    `attempt=${diagnostic.attempt}/${WARMUP_ATTEMPTS} ` +
    `bearerCaptured=${diagnostic.bearerCaptured} ` +
    `windowDestroyed=${diagnostic.windowDestroyed} ` +
    `elapsedMs=${diagnostic.elapsedMs}`;
  const setupRequired = reason === "missing-session-cookie" || !diagnostic.bearerCaptured;
  const action = setupRequired
    ? "Kick chat authentication expired. Reconnect Kick in Settings."
    : "Kick send window did not become ready; try again.";
  return new KickSendWindowReadinessError(
    `send-window-warmup-timeout: ${reason}; ${action} ${diagnosticText}`,
    setupRequired ? "setup-required" : "network",
    diagnostic,
    action
  );
}

async function _pollForBearer(
  win: BrowserWindow,
  deadline: number,
  attempt: number
): Promise<void> {
  const startedAt = Date.now();
  // Cookie persistence is checked before the hidden window is created. Once
  // loaded, the Sanctum bearer emitted by Kick is the authoritative readiness
  // signal; kick_session is HttpOnly and cannot be observed via document.cookie.
  while (Date.now() < deadline) {
    if (win.isDestroyed()) {
      throw readinessError("destroyed", {
        attempt,
        bearerCaptured: latestKickWebBearer !== null,
        elapsedMs: Date.now() - startedAt,
        windowDestroyed: true,
      });
    }
    if (latestKickWebBearer !== null) return;
    await sleep(PREDICATE_POLL_MS);
  }
  throw readinessError("timeout", {
    attempt,
    bearerCaptured: latestKickWebBearer !== null,
    elapsedMs: Date.now() - startedAt,
    windowDestroyed: win.isDestroyed(),
  });
}

function getKickSessionBootstrapUrl(channelSlug?: string): string {
  const normalizedSlug = channelSlug?.trim().replace(/^@/, "");
  if (!normalizedSlug || !/^[A-Za-z0-9_-]{1,100}$/.test(normalizedSlug)) {
    return "https://kick.com/";
  }
  return `https://kick.com/${encodeURIComponent(normalizedSlug)}`;
}

async function ensureSendWindowReadyOnce(attempt: number, channelSlug?: string): Promise<void> {
  if (warmupPromise) return warmupPromise;
  if (sendWindow && !sendWindow.isDestroyed() && latestKickWebBearer !== null) {
    return;
  }
  warmupPromise = (async () => {
    const releaseSlot = await acquireBrowserWindowSlot("high", WARMUP_TIMEOUT_MS);
    try {
      const win = createHiddenKickBrowserWindow({
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
      });
      sendWindow = win;
      try {
        let navigationTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            win.loadURL(getKickSessionBootstrapUrl(channelSlug)),
            new Promise<never>((_, reject) => {
              // timer-allowlist: navigation must settle while this coroutine owns the shared slot.
              navigationTimer = setTimeout(
                () => reject(new Error("send-window-navigation-timeout")),
                WARMUP_TIMEOUT_MS
              );
            }),
          ]);
        } finally {
          if (navigationTimer) clearTimeout(navigationTimer);
        }
        await _pollForBearer(win, Date.now() + WARMUP_TIMEOUT_MS, attempt);
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

async function renewKickWebSessionIfDue(): Promise<void> {
  if (Date.now() - lastSessionRenewalAt < SESSION_RENEWAL_INTERVAL_MS) return;
  if (sessionRenewalPromise) return sessionRenewalPromise;

  sessionRenewalPromise = (async () => {
    const persistedCount = await persistDefaultKickWebSessionCookies();
    if (persistedCount === 0) {
      throw new Error("authenticated-kick-session-cookies-not-persisted");
    }
    lastSessionRenewalAt = Date.now();
  })().finally(() => {
    sessionRenewalPromise = null;
  });
  return sessionRenewalPromise;
}

function restorePersistedKickWebBearer(): string | null {
  if (latestKickWebBearer !== null) return latestKickWebBearer;
  const storedBearer = readPersistedKickWebBearer();
  if (storedBearer && isSanctumBearer(storedBearer)) latestKickWebBearer = storedBearer;
  return latestKickWebBearer;
}

export async function ensureSendWindowReady(channelSlug?: string): Promise<void> {
  restorePersistedKickWebBearer();
  if (!sendWindow || sendWindow.isDestroyed() || latestKickWebBearer === null) {
    const cookiePresent = await hasPersistedKickWebSessionCookie();
    if (cookiePresent === false) {
      throw readinessError("missing-session-cookie", {
        attempt: 1,
        bearerCaptured: latestKickWebBearer !== null,
        elapsedMs: 0,
        windowDestroyed: false,
      });
    }
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt += 1) {
    try {
      await ensureSendWindowReadyOnce(attempt, channelSlug);
      await renewKickWebSessionIfDue();
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof KickSendWindowReadinessError) {
        logger.warn("Kick:SendWindow", "Kick send window readiness attempt failed", {
          ...error.diagnostic,
          kind: error.kind,
        });
      }
    }
  }
  throw lastError;
}

async function _reloadAndRecapture(win: BrowserWindow): Promise<void> {
  // Single-flight: if a reload is already in progress, share its promise.
  if (reloadPromise) return reloadPromise;
  // Clear bearer so the predicate genuinely waits for a fresh capture.
  latestKickWebBearer = null;
  reloadPromise = (async () => {
    try {
      await win.loadURL("https://kick.com/");
      await _pollForBearer(win, Date.now() + WARMUP_TIMEOUT_MS, 1);
    } finally {
      reloadPromise = null;
    }
  })();
  return reloadPromise;
}

export async function sendKickChatMessage(
  chatroomId: number,
  content: string,
  channelSlug?: string
): Promise<KickSendResult> {
  try {
    await ensureSendWindowReady(channelSlug);
  } catch (error) {
    if (error instanceof KickSendWindowReadinessError) {
      return { ok: false, kind: error.kind, message: error.userMessage };
    }
    return {
      ok: false,
      kind: "network",
      message: "Kick send window failed to initialize; try again.",
    };
  }
  if (!sendWindow || sendWindow.isDestroyed() || latestKickWebBearer === null) {
    return {
      ok: false,
      kind: "network",
      message: "Send window failed to initialize.",
    };
  }
  let result = await _fireSend(chatroomId, content);
  if (!result.ok && result.kind === "auth-expired") {
    clearPersistedKickWebBearer();
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

const ALLOWED_KICK_WEB_API_GET_PATHS = [
  /^\/api\/v1\/user$/,
  /^\/api\/v2\/channels\/followed(?:\?cursor=\d+)?$/,
  /^\/api\/v2\/channels\/followed-page(?:\?cursor=\d+)?$/,
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
  {
    method: "POST",
    pattern: /^\/api\/v2\/channels\/[^/?#]+\/follow$/,
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v2\/channels\/[^/?#]+\/follow$/,
  },
];

async function fetchKickWebApiGetWithinDeadline(path: string): Promise<KickWebApiGetResult> {
  if (!isAllowedKickWebApiGet(path)) {
    return {
      ok: false,
      kind: "unknown",
      status: 0,
      body: "",
      message: "Unsupported Kick web API path.",
    };
  }

  logger.debug("Kick:SendWindow", "Kick web API GET phase", { phase: "request-start" });
  const directResult = await tryDirectKickWebApiGet(path);
  if (directResult) return directResult;

  logger.debug("Kick:SendWindow", "Kick web API GET phase", { phase: "renderer-fallback" });
  try {
    await ensureSendWindowReady();
  } catch (error) {
    const kind = error instanceof KickSendWindowReadinessError ? error.kind : "network";
    logger.info("Kick:SendWindow", "Kick web API GET phase", {
      phase: "ready-failed",
      reason: "readiness",
      kind,
    });
    return {
      ok: false,
      kind,
      status: 0,
      body: "",
      message:
        kind === "auth-expired"
          ? "Kick website session is required."
          : "Kick web API session was not ready before the deadline.",
    };
  }
  logger.debug("Kick:SendWindow", "Kick web API GET phase", { phase: "ready" });
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
    clearPersistedKickWebBearer();
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

export async function fetchKickWebApiGet(path: string): Promise<KickWebApiGetResult> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchKickWebApiGetWithinDeadline(path),
      new Promise<KickWebApiGetResult>((resolve) => {
        // timer-allowlist: hard wall-clock bound for readiness, reload, and renderer execution.
        deadline = setTimeout(() => {
          void disposeSendWindow();
          logger.warn("Kick:SendWindow", "Kick web API GET phase", {
            phase: "ready-failed",
            reason: "deadline",
          });
          resolve({
            ok: false,
            kind: "network",
            status: 0,
            body: "",
            message: "Kick web API request exceeded its deadline.",
          });
        }, WEB_API_GET_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

function isAllowedKickWebApiGet(path: string): boolean {
  return ALLOWED_KICK_WEB_API_GET_PATHS.some((pattern) => pattern.test(path));
}

export function parseKickChannelViewerRoleBody(_body: string): boolean | null {
  // Kick does not publish this legacy `/me` response contract. Guessed aliases
  // and recursive object scans must never become moderator authority.
  return null;
}

export async function getKickChannelViewerRole(
  channelSlug: string
): Promise<KickChannelViewerRoleResult> {
  if (!channelSlug.trim()) return { ok: true, isModerator: null, status: 0 };

  // The legacy `/me` response contract is unverified, so it cannot establish
  // authority and must not pay the hidden-window warmup cost.
  return { ok: true, isModerator: null, status: 0 };
}

export function isAllowedKickWebApiMutation(
  method: KickWebApiMutationMethod,
  path: string
): boolean {
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

  const parsed = parseKickWebApiRawResponse(raw);
  if (!parsed) {
    return {
      ok: false,
      kind: "unknown",
      status: 0,
      body: raw,
      message: "Kick web API window returned non-JSON response.",
    };
  }

  return classifyKickWebApiGetResponse(parsed);
}

interface KickWebApiRawResponse {
  ok: boolean;
  status: number;
  body: string;
  retryAfter: string | null;
}

function parseKickWebApiRawResponse(raw: string): KickWebApiRawResponse | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.ok !== "boolean" ||
    typeof record.status !== "number" ||
    typeof record.body !== "string"
  ) {
    return null;
  }
  return {
    ok: record.ok,
    status: record.status,
    body: record.body,
    retryAfter: typeof record.retryAfter === "string" ? record.retryAfter : null,
  };
}

function classifyKickWebApiGetResponse(response: KickWebApiRawResponse): KickWebApiGetResult {
  const { ok, status, body, retryAfter } = response;

  if (ok && status >= 200 && status < 300) {
    return { ok: true, status, body };
  }

  if (
    status === 401 ||
    status === 419 ||
    (status === 403 && body.includes("User is not authenticated"))
  ) {
    return {
      ok: false,
      kind: "auth-expired",
      status,
      body,
      message: "Kick session expired - reconnect Kick in Settings.",
    };
  }

  if (status === 0) {
    return {
      ok: false,
      kind: "network",
      status: 0,
      body,
      message: "Network error fetching Kick web API.",
    };
  }

  if (status === 429) {
    const retryAfterSeconds = Number.parseInt(retryAfter ?? "", 10);
    return {
      ok: false,
      kind: "unknown",
      status: 429,
      body,
      message: "Kick web API rate limit reached.",
      ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? { retryAfterSeconds }
        : {}),
    };
  }

  return {
    ok: false,
    kind: "unknown",
    status,
    body,
    message: `Kick web API request failed (${status}).`,
  };
}

// Guards: direct session reads are the fast path; renderer creation remains a compatibility fallback for Kick security challenges.
async function tryDirectKickWebApiGet(path: string): Promise<KickWebApiGetResult | null> {
  const bearer = restorePersistedKickWebBearer();
  if (!bearer) return null;

  const response = await requestAuthenticatedKickSession(path, bearer);
  if (response.kind === "network-error") return null;

  const contentType = response.contentType?.toLowerCase() ?? "";
  const securityFallback =
    response.status === 401 ||
    response.status === 403 ||
    response.status === 419 ||
    (response.ok && !contentType.includes("application/json"));
  if (securityFallback) return null;

  const result = classifyKickWebApiGetResponse({
    ok: response.ok,
    status: response.status,
    body: response.body,
    retryAfter: response.retryAfter,
  });
  if (result.ok) {
    try {
      await renewKickWebSessionIfDue();
    } catch (error) {
      logger.warn("Kick:SendWindow", "Could not renew durable Kick session after direct read", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
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
  sessionRenewalPromise = null;
  lastSessionRenewalAt = 0;
  if (w && !w.isDestroyed()) {
    try {
      w.destroy();
    } catch {
      // Already gone.
    }
  }
}
