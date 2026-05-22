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

    // Programmatic API fetches consistently fail against Kick's v2 endpoint
    // (live-tested 2026-05-22: kick.com 401 even with full session cookies +
    // XSRF header + AJAX-Requested header; web.kick.com cross-origin
    // blocked). The SPA itself loads the user's follows just fine on
    // kick.com/following because its own context has Kasada's bot-detection
    // tokens injected. We piggyback on that: navigate the BrowserWindow to
    // the /following page, wait for the SPA to render the follows grid,
    // then scrape channel info from the rendered DOM.
    const FOLLOWING_PAGE_URL = "https://kick.com/following";
    console.warn(
      `[KickFollows] BrowserWindow fallback: navigating to ${FOLLOWING_PAGE_URL} for DOM-scrape extraction`
    );

    try {
      const navPromise = win.loadURL(FOLLOWING_PAGE_URL);
      const navTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("following-page-load-timeout")), PAGE_LOAD_TIMEOUT_MS)
      );
      await Promise.race([navPromise, navTimeout]);
      console.warn("[KickFollows] BrowserWindow fallback: /following page loaded");
    } catch (err) {
      console.warn(
        `[KickFollows] BrowserWindow fallback: /following navigation failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return { status: "error", reason: "network-error" };
    }

    // Give the SPA time to fetch + render the follows grid. Kick's SPA does
    // its own auth-aware API call here; we just wait for it to populate the
    // DOM. 6s is conservative; if performance allows, tighten later.
    console.warn(
      "[KickFollows] BrowserWindow fallback: waiting 6s for /following SPA render"
    );
    await new Promise((resolve) => setTimeout(resolve, 6000));

    let scrapeResult: string;
    try {
      scrapeResult = (await win.webContents.executeJavaScript(
        `(() => {
          // The /following page renders a grid of channel cards. Each card
          // is an anchor pointing at /<slug> with an avatar img inside and
          // the channel's display name as text content.
          //
          // We look for anchors whose href is a single-segment path (e.g.
          // "/summit1g" or "/summit1g/") and which contain an <img>. That
          // catches channel cards and excludes nav links / category cards.
          // We then dedupe by slug since the SPA can render the same channel
          // multiple times (live indicator + name link both inside one card).
          const reservedPaths = new Set([
            'login','signup','signin','signout','logout','about','help',
            'dashboard','settings','profile','admin','browse','category',
            'categories','games','search','following','followers','vods',
            'clips','subscriptions','community','dmca','privacy','terms',
            'rules','features','app','schedule','wallet','partner','support',
          ]);

          const seen = new Map();
          for (const a of document.querySelectorAll('a[href]')) {
            const href = a.getAttribute('href') || '';
            const match = href.match(/^\\/([^\\/?#]+)\\/?$/);
            if (!match) continue;
            const slug = match[1].toLowerCase();
            if (reservedPaths.has(slug)) continue;
            if (!/^[a-z0-9_-]{2,}$/.test(slug)) continue;
            const img = a.querySelector('img');
            if (!img) continue;
            const displayName = (img.alt || a.textContent || slug).trim().slice(0, 100);
            const avatarUrl = img.getAttribute('src') || '';
            if (!seen.has(slug)) {
              seen.set(slug, { slug, displayName, avatarUrl });
            }
          }
          return JSON.stringify({
            channels: Array.from(seen.values()),
            url: window.location.href,
            title: document.title,
            anchorCount: document.querySelectorAll('a[href]').length,
          });
        })()`
      )) as string;
    } catch (err) {
      console.warn(
        `[KickFollows] BrowserWindow fallback: DOM scrape threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return { status: "error", reason: "parse-error" };
    }

    let scraped: { channels: Array<{ slug: string; displayName: string; avatarUrl: string }>; url: string; title: string; anchorCount: number };
    try {
      scraped = JSON.parse(scrapeResult);
    } catch (err) {
      console.warn(
        `[KickFollows] BrowserWindow fallback: DOM scrape result was not JSON: ${scrapeResult.slice(0, 200)}`
      );
      return { status: "error", reason: "parse-error" };
    }

    console.warn(
      `[KickFollows] BrowserWindow fallback: scraped url="${scraped.url}" title="${scraped.title}" anchors=${scraped.anchorCount} channels=${scraped.channels.length}`
    );

    if (scraped.channels.length === 0) {
      // Either the user genuinely follows zero channels or the page didn't
      // render (auth still required, slow network, layout change). Treat as
      // an error so we don't wipe existing account follows.
      _warnOnce(
        "parse-error",
        `Kick /following DOM scrape returned zero channels. Page url=${scraped.url}, title="${scraped.title}", anchor count=${scraped.anchorCount}. If you follow zero channels on kick.com this is expected; otherwise the page didn't render (auth required, slow network, or layout changed).`
      );
      return { status: "error", reason: "parse-error" };
    }

    const channels: UnifiedChannel[] = scraped.channels.map((c) => ({
      id: "", // We don't have channel.id from DOM scraping — slug only.
      platform: "kick" as const,
      username: c.slug,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      bannerUrl: undefined,
      bio: undefined,
      isLive: false,
      isVerified: false,
      isPartner: false,
    }));

    console.warn(
      `[KickFollows] BrowserWindow fallback SUCCESS: scraped ${channels.length} followed channels from /following DOM`
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
