/**
 * Followed-channels fetch for the signed-in Kick user.
 *
 * The official Kick public API (api.kick.com/public/v1) has no followed-channels
 * endpoint — confirmed live against docs.kick.com on 2026-05-21. The only path
 * is the undocumented internal v2 endpoint at kick.com/api/v2/channels/followed.
 *
 * This module tries Bearer auth via `fetch()` first (cheapest path — mirrors
 * `kickAuthService.fetchCurrentUser`). If the v2 endpoint accepts the OAuth
 * Bearer token, no BrowserWindow / cookie-warming dance is needed. If it
 * rejects with 401/403 or returns a Cloudflare HTML challenge, this module
 * surfaces the failure class so a follow-up cookie-auth BrowserWindow path
 * can be added if needed.
 *
 * Returns a tagged result rather than throwing. Callers (notably
 * `syncFollowsOnLogin`) use the tag to decide whether to mutate the local
 * follow DB — a destructive `clearAccountFollows` must not fire on an `error`
 * outcome or transient failures would wipe a user's prior synced follows.
 */

import { BrowserWindow, session } from "electron";

import type { UnifiedChannel } from "../../../unified/platform-types";
import { transformKickFollowedChannelLegacy } from "../kick-transformers";
import type { KickLegacyApiFollowedChannel } from "../kick-types";
import { KICK_LEGACY_API_V2_BASE } from "../kick-types";

import { storageService } from "../../../../services/storage-service";
import { acquireBrowserWindowSlot } from "./channel-endpoints";

const FOLLOWED_CHANNELS_URL = `${KICK_LEGACY_API_V2_BASE}/channels/followed`;
const FETCH_TIMEOUT_MS = 10000;

export type FollowedChannelsResult =
  | { status: "ok"; channels: UnifiedChannel[] }
  | { status: "error"; reason: ErrorReason };

export type ErrorReason =
  | "no-token"
  | "auth-failed"
  | "parse-error"
  | "network-error"
  | "cloudflare-challenge";

// Single-flight guard. A second caller arriving while a fetch is in flight
// shares the same Promise rather than firing a duplicate request.
let _inFlight: Promise<FollowedChannelsResult> | null = null;

// Warn-once-per-session by failure class. Module-scoped Set lives until the
// main process restarts. Prevents log spam if `syncFollowsOnLogin` fires on
// every reconnect attempt during a flaky network. Matches the
// `_publicChannelWarnedSlugs` pattern in channel-endpoints.ts.
const _warned = new Set<ErrorReason>();

/**
 * Fetch the channels the signed-in Kick user follows on kick.com.
 *
 * Never throws. Returns `{ status: 'ok' }` with the imported channels (possibly
 * empty if the user follows zero channels) or `{ status: 'error', reason }`
 * with a classified failure. Callers should treat `error` as "do not mutate
 * the local DB" — preserving the user's last-known account-source rows under
 * transient failure is more important than freshness.
 */
export async function getAllFollowedChannels(): Promise<FollowedChannelsResult> {
  if (_inFlight) return _inFlight;
  _inFlight = _doFetch().finally(() => {
    _inFlight = null;
  });
  return _inFlight;
}

async function _doFetch(): Promise<FollowedChannelsResult> {
  const token = storageService.getToken("kick")?.accessToken;
  if (!token) {
    // No token = user not signed in. syncFollowsOnLogin guards this upstream,
    // but defending here lets callers reuse the function without that assumption.
    return { status: "error", reason: "no-token" };
  }

  // Try the cheap path first: Bearer auth via fetch(). If Kick ever extends
  // the OAuth API to cover follows, this lets us pick it up automatically.
  // Live testing on 2026-05-21 confirmed Bearer is rejected with 403, so the
  // BrowserWindow fallback below is the real workhorse — but the Bearer
  // attempt costs ~30ms and the fallback covers every failure path it produces.
  const bearerResult = await _tryBearerFetch(token);
  if (bearerResult.status === "ok") return bearerResult;
  if (bearerResult.status === "error" && bearerResult.reason === "no-token") {
    return bearerResult;
  }

  // Fall through to cookie-auth BrowserWindow for auth-failed,
  // cloudflare-challenge, parse-error, and network-error. The window inherits
  // the OAuth window's session cookies (default session, where id.kick.com
  // cookies live) — Kick's cross-subdomain SSO sets a kick.com apex session
  // when we visit kick.com while authenticated on id.kick.com.
  console.warn(
    `[KickFollows] Bearer path failed with reason="${bearerResult.reason}". Trying BrowserWindow cookie-auth fallback...`
  );
  return _fetchViaBrowserWindow();
}

/**
 * Test-visible Bearer-fetch path. Exported (with underscore prefix) so unit
 * tests can validate the per-cause classification logic without mocking
 * Electron's BrowserWindow constructor. The orchestration in `_doFetch` is
 * validated by live integration testing — see plan task #6.
 */
export async function _tryBearerFetch(token: string): Promise<FollowedChannelsResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(FOLLOWED_CHANNELS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    // Network-level failures (DNS, refused, abort). Debug-log only — these are
    // transient and re-fire on the next login. AbortError filtered out
    // explicitly so the warn channel doesn't get noise from rapid retriggers.
    if (err instanceof Error && err.name === "AbortError") {
      console.debug("[KickFollows] Fetch aborted (timeout or re-trigger)");
    } else {
      console.debug("[KickFollows] Network error:", err);
    }
    return { status: "error", reason: "network-error" };
  }
  clearTimeout(timeout);

  if (response.status === 401 || response.status === 403) {
    _warnOnce("auth-failed", `Kick v2 followed-channels rejected Bearer auth (status ${response.status}). If this persists, the endpoint may require session-cookie auth via BrowserWindow.`);
    return { status: "error", reason: "auth-failed" };
  }

  if (!response.ok) {
    // 5xx or other transient — debug only.
    console.debug(`[KickFollows] Non-2xx response: ${response.status}`);
    return { status: "error", reason: "network-error" };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (err) {
    console.debug("[KickFollows] Response body read failed:", err);
    return { status: "error", reason: "network-error" };
  }

  // Detect Cloudflare challenge HTML before JSON parse — gives a clearer
  // failure class than a generic parse-error.
  const lower = body.toLowerCase();
  if (
    lower.includes("<!doctype html") ||
    lower.includes("just a moment") ||
    lower.includes("cf-browser-verification")
  ) {
    _warnOnce(
      "cloudflare-challenge",
      "Kick v2 followed-channels returned a Cloudflare challenge page. The endpoint likely requires session cookies from a kick.com browser context; a BrowserWindow fallback is needed."
    );
    return { status: "error", reason: "cloudflare-challenge" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    _warnOnce(
      "parse-error",
      `Kick v2 followed-channels returned non-JSON. Preview: ${body.slice(0, 120)}`
    );
    return { status: "error", reason: "parse-error" };
  }

  // Accept either `{ data: [...] }` (Laravel convention) or a top-level array.
  const rawItems = _extractItems(parsed);
  if (!rawItems) {
    _warnOnce(
      "parse-error",
      `Kick v2 followed-channels JSON did not contain an array under 'data' or at top level. Got: ${typeof parsed}`
    );
    return { status: "error", reason: "parse-error" };
  }

  const channels: UnifiedChannel[] = [];
  for (const item of rawItems) {
    const channel = transformKickFollowedChannelLegacy(item as KickLegacyApiFollowedChannel);
    if (channel) channels.push(channel);
  }

  // Empty list IS a valid outcome — user genuinely follows zero channels.
  // No warn. The caller (syncFollowsOnLogin) handles the clear+insert with
  // zero inserts as a successful sync.
  return { status: "ok", channels };
}

const WARM_VISIT_URL = "https://kick.com/";
const WARM_VISIT_TIMEOUT_MS = 6000;
const PAGE_LOAD_TIMEOUT_MS = 10000;

/**
 * Cookie-auth fallback path: open a hidden BrowserWindow in the DEFAULT
 * Electron session (where the Kick OAuth window's id.kick.com cookies live),
 * warm-visit kick.com apex to let Kick's cross-subdomain SSO set the
 * `kick_session` cookie, then load the v2 followed-channels endpoint and
 * extract the response body via executeJavaScript.
 *
 * The default session is intentional — `persist:kick_public` doesn't carry
 * the user's authentication state (OAuth ran in default), and forcing a
 * partition migration would require every existing user to re-login.
 *
 * Mutex-serialized via `acquireBrowserWindowSlot` so we never contend with
 * `getPublicChannel` for the GPU subprocess.
 */
async function _fetchViaBrowserWindow(): Promise<FollowedChannelsResult> {
  console.warn("[KickFollows] BrowserWindow fallback: acquiring window slot...");
  const releaseSlot = await acquireBrowserWindowSlot();
  console.warn("[KickFollows] BrowserWindow fallback: slot acquired, creating window");
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Default session — inherits OAuth window's id.kick.com cookies.
      },
    });

    // Warm visit to kick.com apex. If Kick's SSO sets a .kick.com session
    // cookie in response to id.kick.com authentication, this navigation
    // deposits it. Failures here aren't fatal — we proceed to the v2 visit
    // and let the response classification decide.
    console.warn(`[KickFollows] BrowserWindow fallback: warm visit to ${WARM_VISIT_URL}`);
    try {
      const warmLoad = win.loadURL(WARM_VISIT_URL);
      const warmTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("warm-timeout")), WARM_VISIT_TIMEOUT_MS)
      );
      await Promise.race([warmLoad, warmTimeout]);
      console.warn("[KickFollows] BrowserWindow fallback: warm visit completed");

      // Give Kick's SPA a moment to bootstrap and make its auth-bridge API
      // calls (the homepage typically fetches /api/v2/user on load to set the
      // apex session cookie if the user is authed on id.kick.com).
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Diagnostic: log what cookies actually landed for kick.com.
      const defaultSession = session.defaultSession;
      const cookies = await defaultSession.cookies.get({ domain: "kick.com" });
      const cookieSummary = cookies.map((c) => `${c.name}@${c.domain}`).join(", ") || "(none)";
      console.warn(
        `[KickFollows] BrowserWindow fallback: kick.com cookies after warm visit: ${cookieSummary}`
      );
    } catch (err) {
      console.warn(
        `[KickFollows] BrowserWindow fallback: warm visit failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Fetch the v2 endpoint FROM INSIDE the kick.com page context, NOT via
    // a direct loadURL. Laravel's session middleware requires a matching
    // X-XSRF-TOKEN header (value sourced from the XSRF-TOKEN cookie) on
    // session-authenticated API requests; direct top-level navigation
    // doesn't send that header, which is why earlier test runs got
    // {"message":"Unauthenticated."} even with all session cookies present.
    // The page-context fetch reads the XSRF cookie and attaches the header,
    // mirroring what kick.com's SPA does for its own API calls. Also sends
    // X-Requested-With so Laravel respects Accept: application/json instead
    // of redirecting an unauthed request to /login.
    console.warn(
      `[KickFollows] BrowserWindow fallback: fetching ${FOLLOWED_CHANNELS_URL} via page context with XSRF header`
    );

    // Try each candidate hostname in order. Live testing showed that
    // kick_session_id is scoped to web.kick.com (not .kick.com), so a fetch
    // to kick.com/api/v2/... omits that cookie even though kick_session is
    // present — and the v2 endpoint may verify against the subdomain-scoped
    // cookie. Trying web.kick.com first lets Laravel see the full session.
    let pageContent: string;
    const candidates = [
      "https://web.kick.com/api/v2/channels/followed",
      "https://kick.com/api/v2/channels/followed",
    ];
    let lastFailure: { status: number; body: string; hadXsrf: boolean | null; url: string } | null =
      null;

    try {
      let success = false;
      for (const url of candidates) {
        const fetchResult = (await win.webContents.executeJavaScript(
          `(async () => {
            try {
              const xsrfMatch = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/);
              const xsrf = xsrfMatch ? decodeURIComponent(xsrfMatch[1]) : '';
              const response = await fetch(${JSON.stringify(url)}, {
                method: 'GET',
                credentials: 'include',
                headers: {
                  'Accept': 'application/json',
                  'X-Requested-With': 'XMLHttpRequest',
                  ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
                },
              });
              const status = response.status;
              const body = await response.text().catch(() => '');
              return JSON.stringify({ status, body, hadXsrf: !!xsrf });
            } catch (e) {
              return JSON.stringify({ status: 0, body: 'fetch-threw: ' + String(e), hadXsrf: null });
            }
          })()`
        )) as string;

        const parsed = JSON.parse(fetchResult) as {
          status: number;
          body: string;
          hadXsrf: boolean | null;
        };
        console.warn(
          `[KickFollows] BrowserWindow fallback: tried ${url} → status=${parsed.status} hadXsrf=${parsed.hadXsrf} bodyLen=${parsed.body.length}`
        );

        if (parsed.status === 200) {
          pageContent = parsed.body;
          success = true;
          break;
        }
        lastFailure = { ...parsed, url };
      }

      if (!success) {
        if (!lastFailure) {
          return { status: "error", reason: "network-error" };
        }
        if (lastFailure.status === 0) {
          console.warn(`[KickFollows] BrowserWindow fallback: ${lastFailure.body}`);
          return { status: "error", reason: "network-error" };
        }
        if (lastFailure.status === 401 || lastFailure.status === 403) {
          _warnOnce(
            "auth-failed",
            `Kick v2 followed-channels rejected all candidate hosts. Last: ${lastFailure.url} → HTTP ${lastFailure.status}. XSRF header was ${lastFailure.hadXsrf ? "attached" : "MISSING"}. Body: "${lastFailure.body.slice(0, 200)}"`
          );
          return { status: "error", reason: "auth-failed" };
        }
        _warnOnce(
          "parse-error",
          `Kick v2 followed-channels: unexpected status ${lastFailure.status} from ${lastFailure.url}. Body: "${lastFailure.body.slice(0, 200)}"`
        );
        return { status: "error", reason: "parse-error" };
      }

      // TypeScript narrowing: success path means pageContent is set.
      pageContent ??= "";
    } catch (err) {
      console.warn(
        `[KickFollows] BrowserWindow fallback: page-context fetch threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return { status: "error", reason: "network-error" };
    }

    if (!pageContent || pageContent.length === 0) {
      _warnOnce(
        "parse-error",
        "Kick v2 followed-channels (BrowserWindow) returned an empty body."
      );
      return { status: "error", reason: "parse-error" };
    }

    // Detect Cloudflare challenge HTML in the rendered page (looks the same
    // as the fetch() classification path).
    const lower = pageContent.toLowerCase();
    if (
      lower.includes("<!doctype html") ||
      lower.includes("just a moment") ||
      lower.includes("cf-browser-verification") ||
      lower.includes("checking your browser")
    ) {
      _warnOnce(
        "cloudflare-challenge",
        "Kick v2 followed-channels (BrowserWindow) returned a Cloudflare challenge. The default session may not carry the user's apex kick.com session yet — confirm the OAuth flow's id.kick.com cookies trigger Kick's SSO."
      );
      return { status: "error", reason: "cloudflare-challenge" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(pageContent);
    } catch (err) {
      _warnOnce(
        "parse-error",
        `Kick v2 followed-channels (BrowserWindow) returned non-JSON. Preview: ${pageContent.slice(0, 120)}`
      );
      return { status: "error", reason: "parse-error" };
    }

    // Auth challenge in JSON form — Laravel typically returns
    // { message: "Unauthenticated." } with a 401. The BrowserWindow doesn't
    // surface status codes, so detect by payload shape.
    if (parsed && typeof parsed === "object") {
      const message = (parsed as { message?: string }).message;
      if (message && /unauthenticated|unauthorized|forbidden/i.test(message)) {
        // Unconditional warn (bypasses warn-once) so this is always visible
        // when the BrowserWindow path can't auth — even when Bearer already
        // fired the same reason. Tagged with (BrowserWindow) so it's distinct.
        console.warn(
          `[KickFollows] BrowserWindow fallback: v2 endpoint returned auth challenge: "${message}". Response preview: ${pageContent.slice(0, 200)}`
        );
        return { status: "error", reason: "auth-failed" };
      }
    }

    const rawItems = _extractItems(parsed);
    if (!rawItems) {
      _warnOnce(
        "parse-error",
        `Kick v2 followed-channels (BrowserWindow) JSON did not contain an array under 'data' or at top level. Got: ${typeof parsed}`
      );
      return { status: "error", reason: "parse-error" };
    }

    const channels: UnifiedChannel[] = [];
    for (const item of rawItems) {
      const channel = transformKickFollowedChannelLegacy(item as KickLegacyApiFollowedChannel);
      if (channel) channels.push(channel);
    }

    console.warn(
      `[KickFollows] BrowserWindow fallback SUCCESS: fetched ${channels.length} followed channels`
    );
    return { status: "ok", channels };
  } catch (err) {
    console.warn(
      `[KickFollows] BrowserWindow fallback unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return { status: "error", reason: "network-error" };
  } finally {
    releaseSlot();
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }
}

function _extractItems(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)) {
    return (parsed as { data: unknown[] }).data;
  }
  return null;
}

function _warnOnce(reason: ErrorReason, message: string): void {
  if (_warned.has(reason)) return;
  _warned.add(reason);
  console.warn(`[KickFollows] ${message}`);
}

/**
 * Test-only helper. Resets the warn-once Set so individual tests can assert
 * warn-fires on each scenario without ordering coupling.
 */
export function _resetWarnedForTests(): void {
  _warned.clear();
}
