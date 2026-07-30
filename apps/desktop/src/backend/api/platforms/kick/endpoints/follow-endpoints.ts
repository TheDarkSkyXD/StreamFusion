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
import { logger } from "@/backend/logging/logger";
import { hasCanonicalKickScopes } from "../../../../auth/kick-scope-validation";
import { storageService } from "../../../../services/storage-service";
import { waitForWebContentsCondition } from "../../../../services/web-contents-ready";
import type { UnifiedChannel } from "../../../unified/platform-types";
import { transformKickFollowedChannelLegacy } from "../kick-transformers";
import type { KickLegacyApiFollowedChannel } from "../kick-types";
import { KICK_LEGACY_API_V2_BASE } from "../kick-types";
import { acquireBrowserWindowSlot } from "./channel-endpoints";

const FOLLOWED_CHANNELS_URL = `${KICK_LEGACY_API_V2_BASE}/channels/followed`;
const FETCH_TIMEOUT_MS = 10000;

/**
 * Readiness predicate (page-context JS) for the /following/channels scrape:
 * true once the "Followed Channels" heading exists AND its container holds at
 * least one channel anchor with an avatar image. Mirrors the scoping logic of
 * the scrape itself. Exported for unit testing against fixture DOM.
 */
export const GRID_READY_PREDICATE = `(() => {
  for (const h of document.querySelectorAll('h2, h3, [role="heading"]')) {
    if (/followed channel|channels you follow|following channels/i.test((h.textContent || '').trim())) {
      let p = h.parentElement;
      for (let i = 0; i < 6 && p; i++) {
        if (p.querySelectorAll('a[href] img').length >= 1) return true;
        p = p.parentElement;
      }
    }
  }
  return false;
})()`;

export type FollowedChannelsResult =
  | { status: "ok"; channels: UnifiedChannel[]; canPruneAbsent: boolean }
  | { status: "error"; reason: ErrorReason };

export type ErrorReason =
  | "no-token"
  | "auth-failed"
  | "parse-error"
  | "network-error"
  | "cloudflare-challenge";

interface FollowedChannelsOptions {
  allowBrowserWindowFallback?: boolean;
}

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
export async function getAllFollowedChannels(
  options: FollowedChannelsOptions = {}
): Promise<FollowedChannelsResult> {
  if (_inFlight) return _inFlight;
  _inFlight = _doFetch(options).finally(() => {
    _inFlight = null;
  });
  return _inFlight;
}

async function _doFetch(options: FollowedChannelsOptions): Promise<FollowedChannelsResult> {
  const storedToken = storageService.getToken("kick");
  const token = hasCanonicalKickScopes(storedToken?.scope) ? storedToken?.accessToken : null;
  if (!token) {
    // No token = user not signed in. syncFollowsOnLogin guards this upstream,
    // but defending here lets callers reuse the function without that assumption.
    return { status: "error", reason: "no-token" };
  }

  const bearerResult = await _tryBearerFetch(token);
  if (bearerResult.status === "ok") return bearerResult;
  if (!options.allowBrowserWindowFallback) return bearerResult;

  // The Bearer path is cheap and does not spin up Chromium. If Kick rejects it
  // for this account/session, fall back to the cookie-auth BrowserWindow path.
  logger.debug(
    "Kick:Endpoints:Follow",
    "Using BrowserWindow cookie-auth fallback for followed channels",
    { reason: bearerResult.reason }
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
  let response: Response;
  try {
    response = await fetch(FOLLOWED_CHANNELS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // Network-level failures (DNS, refused, abort). Debug-log only — these are
    // transient and re-fire on the next login. AbortError/TimeoutError filtered
    // out explicitly so the warn channel doesn't get noise from rapid retriggers.
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      logger.debug("Kick:Endpoints:Follow", "Fetch aborted (timeout or re-trigger)");
    } else {
      logger.debug("Kick:Endpoints:Follow", "Network error", {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
    }
    return { status: "error", reason: "network-error" };
  }

  if (response.status === 401 || response.status === 403) {
    logger.debug("Kick:Endpoints:Follow", "Kick v2 followed-channels rejected Bearer auth", {
      status: response.status,
    });
    return { status: "error", reason: "auth-failed" };
  }

  if (!response.ok) {
    // 5xx or other transient — debug only.
    logger.debug("Kick:Endpoints:Follow", "Non-2xx response", { status: response.status });
    return { status: "error", reason: "network-error" };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (err) {
    logger.debug("Kick:Endpoints:Follow", "Response body read failed", {
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : String(err),
    });
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
  return { status: "ok", channels, canPruneAbsent: true };
}

const PAGE_LOAD_TIMEOUT_MS = 10000;
// Outer cap on the scroll-and-scrape phase (wall clock). Bounds the worst
// case where a hung renderer / GPU stall / unending lazy-loader would hold
// `_inFlight` forever and wedge the BrowserWindow slot mutex.
const SCROLL_AND_SCRAPE_TIMEOUT_MS = 30_000;

/**
 * Page-context script that scrolls the kick.com/following/channels list and
 * collects channels DURING each scroll step (not after). kick.com's grid
 * lazy-renders ~20 cards per viewport, and may virtualize (unmount off-screen
 * cards). Collecting at each step accumulates the full list into a Map keyed
 * by slug regardless of whether earlier cards are still mounted by the end.
 *
 * Terminates when STABLE_ROUNDS consecutive scrolls add no new channels, or
 * after MAX_ROUNDS, whichever comes first. Returns the same JSON shape the
 * original single-pass scrape returned, so the caller's parsing is unchanged.
 */
const SCROLL_AND_SCRAPE = `(async () => {
  // timer-allowlist: page-context script literal — runs inside kick.com via executeJavaScript
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STABLE_ROUNDS = 3;
  const MAX_ROUNDS = 80;
  const SCROLL_DELAY_MS = 350;

  const reservedPaths = new Set([
    'login','signup','signin','signout','logout','about','help',
    'dashboard','settings','profile','admin','browse','category',
    'categories','games','search','following','followers','vods',
    'clips','subscriptions','community','dmca','privacy','terms',
    'rules','features','app','schedule','wallet','partner','support',
  ]);

  const findScope = () => {
    for (const h of document.querySelectorAll('h2, h3, [role="heading"]')) {
      const text = (h.textContent || '').trim().toLowerCase();
      if (/followed channel|channels you follow|following channels/.test(text)) {
        let p = h.parentElement;
        for (let i = 0; i < 6 && p; i++) {
          if (p.querySelectorAll('a[href]').length >= 5) return p;
          p = p.parentElement;
        }
      }
    }
    return null;
  };

  const seen = new Map();
  // Returns the number of slugs that were newly added on this pass.
  const collect = () => {
    const root = findScope() || document;
    const anchors = root.querySelectorAll('a[href]');
    let added = 0;
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^\\/([^\\/?#]+)\\/?$/);
      if (!m) continue;
      const slug = m[1].toLowerCase();
      if (reservedPaths.has(slug)) continue;
      if (!/^[a-z0-9_-]{2,}$/.test(slug)) continue;
      const img = a.querySelector('img');
      if (!img) continue;
      const alt = (img.alt || '').trim();
      const src = img.getAttribute('src') || '';
      const existing = seen.get(slug);
      if (!existing) {
        seen.set(slug, { slug, displayName: (alt || slug).slice(0, 100), avatarUrl: src, _altLen: alt.length });
        added += 1;
      } else if (alt.length < existing._altLen) {
        seen.set(slug, { slug, displayName: (alt || slug).slice(0, 100), avatarUrl: src, _altLen: alt.length });
      }
    }
    return added;
  };

  collect();
  let stable = 0;
  let rounds = 0;
  while (stable < STABLE_ROUNDS && rounds < MAX_ROUNDS) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(SCROLL_DELAY_MS);
    const added = collect();
    if (added > 0) {
      stable = 0;
    } else {
      stable += 1;
    }
    rounds += 1;
  }

  for (const v of seen.values()) delete v._altLen;

  const headings = [];
  for (const h of document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
    const text = (h.textContent || '').trim().slice(0, 80);
    if (text) headings.push({ tag: h.tagName, text });
    if (headings.length >= 20) break;
  }
  const navLinks = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    const text = (a.textContent || '').trim().slice(0, 40);
    if (/follow/i.test(href) && href !== '/following') {
      navLinks.push({ href, text });
      if (navLinks.length >= 10) break;
    }
  }

  return JSON.stringify({
    channels: Array.from(seen.values()),
    url: window.location.href,
    title: document.title,
    anchorCount: document.querySelectorAll('a[href]').length,
    cardCount: document.querySelectorAll('a[href]').length,
    acceptedCardCount: seen.size,
    channelCount: seen.size,
    sectionTestids: [],
    headings,
    navLinks,
    scoped: !!findScope(),
    scrollRounds: rounds,
    scrollSettled: stable >= STABLE_ROUNDS,
  });
})()`;

/**
 * Cookie-auth fallback path: open a hidden BrowserWindow in the DEFAULT
 * Electron session (where the Kick OAuth window's id.kick.com cookies live),
 * navigate straight to the dedicated following page, and scrape channel info
 * from the rendered DOM.
 *
 * The default session is intentional — `persist:kick_public` doesn't carry
 * the user's authentication state (OAuth ran in default), and forcing a
 * partition migration would require every existing user to re-login.
 *
 * Mutex-serialized via `acquireBrowserWindowSlot` so we never contend with
 * `getPublicChannel` for the GPU subprocess.
 */
async function _fetchViaBrowserWindow(): Promise<FollowedChannelsResult> {
  // Normal-flow traces go to debug. Only actual failures emit warn so the
  // user's log file stays signal-dense.
  logger.debug("Kick:Endpoints:Follow", "BrowserWindow fallback: acquiring window slot");
  const releaseSlot = await acquireBrowserWindowSlot();
  logger.debug("Kick:Endpoints:Follow", "BrowserWindow fallback: slot acquired, creating window");
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

    const defaultSession = session.defaultSession;
    const cookies = await defaultSession.cookies.get({ domain: "kick.com" });
    const cookieSummary = cookies.map((c) => `${c.name}@${c.domain}`).join(", ") || "(none)";
    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback: kick.com cookies before scrape",
      {
        cookieSummary,
      }
    );

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
    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback: fetching followed-channels URL via page context with XSRF header",
      { url: FOLLOWED_CHANNELS_URL }
    );

    // Programmatic API fetches consistently fail against Kick's v2 endpoint
    // (live-tested 2026-05-22: kick.com 401 even with full session cookies +
    // XSRF header + AJAX-Requested header; web.kick.com cross-origin
    // blocked). The SPA itself loads the user's follows just fine on
    // kick.com/following because its own context has Kasada's bot-detection
    // tokens injected. We piggyback on that: navigate the BrowserWindow to
    // the /following page, wait for the SPA to render the follows grid,
    // then scrape channel info from the rendered DOM.
    // /following is a hybrid view that mixes "live follows" + "Live Channels"
    // (general recommendations). /following/channels is the dedicated user-
    // follows page exposed in the page's own navigation. Live-diagnostic on
    // 2026-05-22: /following heading hierarchy = [H2:Following, H2:Live Channels]
    // with nav link [Channels → /following/channels]. Scrape the dedicated
    // page so we don't mix recommendations into the follow list.
    const FOLLOWING_PAGE_URL = "https://kick.com/following/channels";
    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback: navigating to following page for DOM-scrape extraction",
      { url: FOLLOWING_PAGE_URL }
    );

    try {
      const navPromise = win.loadURL(FOLLOWING_PAGE_URL);
      const navTimeout = new Promise<never>((_, reject) =>
        // timer-allowlist: Promise.race page-load nav-timeout (SP3 out-of-scope)
        setTimeout(() => reject(new Error("following-page-load-timeout")), PAGE_LOAD_TIMEOUT_MS)
      );
      await Promise.race([navPromise, navTimeout]);
      logger.debug("Kick:Endpoints:Follow", "BrowserWindow fallback: /following page loaded");
    } catch (err) {
      // Real failure — keep at warn. Deduped via _warnOnce so reconnect
      // loops don't spam the log.
      _warnOnce(
        "network-error",
        `BrowserWindow fallback: /following navigation failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return { status: "error", reason: "network-error" };
    }

    // Wait for the SPA to render the follows grid rather than guessing a fixed
    // delay. Resolves as soon as the grid is present (typically < 6s); a slow
    // render is covered up to the 8s cap; a zero-follow account never populates
    // the grid, so the poll hits the cap and the scrape below returns empty
    // (same outcome as the old flat wait). Return value intentionally ignored —
    // the scrape runs either way.
    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback: waiting for /following grid to render"
    );
    await waitForWebContentsCondition(win.webContents, GRID_READY_PREDICATE, {
      timeoutMs: 8000,
    });

    // Scroll + collect-during-scroll in a single page-context script.
    // kick.com/following/channels uses a virtualized/lazy-loaded list — first
    // paint only renders ~20 cards regardless of how many channels the user
    // follows. Collecting at each scroll step accumulates the full list
    // regardless of whether earlier cards are still mounted by the end.
    let scrapeResult: string;
    try {
      const scrapePromise = win.webContents.executeJavaScript(SCROLL_AND_SCRAPE);
      const scrapeTimeout = new Promise<never>((_, reject) =>
        // timer-allowlist: Promise.race wall-clock cap on executeJavaScript (scroll+scrape)
        setTimeout(
          () => reject(new Error("scroll-and-scrape-timeout")),
          SCROLL_AND_SCRAPE_TIMEOUT_MS
        )
      );
      scrapeResult = (await Promise.race([scrapePromise, scrapeTimeout])) as string;
    } catch (err) {
      _warnOnce(
        "parse-error",
        `BrowserWindow fallback: DOM scrape threw: ${err instanceof Error ? err.message : String(err)}`
      );
      return { status: "error", reason: "parse-error" };
    }

    let scraped: {
      channels: Array<{ slug: string; displayName: string; avatarUrl: string }>;
      url: string;
      title: string;
      anchorCount: number;
      cardCount: number;
      acceptedCardCount: number;
      channelCount: number;
      sectionTestids: string[];
      headings: Array<{ tag: string; text: string }>;
      navLinks: Array<{ href: string; text: string }>;
      scrollRounds?: number;
      scrollSettled?: boolean;
    };
    try {
      scraped = JSON.parse(scrapeResult);
    } catch (err) {
      _warnOnce(
        "parse-error",
        `BrowserWindow fallback: DOM scrape result was not JSON: ${scrapeResult.slice(0, 200)}`
      );
      return { status: "error", reason: "parse-error" };
    }

    logger.debug("Kick:Endpoints:Follow", "BrowserWindow fallback: scraped result", {
      url: scraped.url,
      title: scraped.title,
      cards: scraped.cardCount,
      accepted: scraped.acceptedCardCount,
      channels: scraped.channelCount,
      scrollRounds: scraped.scrollRounds ?? "?",
      scrollSettled: scraped.scrollSettled ?? "?",
      sectionTestids: scraped.sectionTestids,
    });
    logger.debug("Kick:Endpoints:Follow", "Page headings", {
      headings: scraped.headings.map((h) => `${h.tag}:${h.text}`),
    });
    logger.debug("Kick:Endpoints:Follow", "Follow-related nav links", {
      navLinks: scraped.navLinks.map((l) => `${l.text}→${l.href}`),
    });

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

    // The DB enforces UNIQUE(platform, channel_id, source). Empty channelId
    // would collide across all rows after the first, dropping 21 of 22
    // imported follows on a typical user. The dual-id solution doc reserves
    // id="" as the in-memory sentinel for "canonical not yet known," but
    // that's a renderer-side convention; at the storage layer we need
    // SOMETHING unique per channel. Slugs are unique per channel on Kick,
    // so use the slug as channel_id for DOM-scraped rows. The slug bridge
    // in channelsMatch (matches by platform+id OR platform+slug) means
    // FollowButton, the sidebar, and dedupe paths all still work.
    const channels: UnifiedChannel[] = scraped.channels.map((c) => ({
      id: c.slug,
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

    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback SUCCESS: scraped followed channels from /following DOM",
      { channelCount: channels.length }
    );
    return { status: "ok", channels, canPruneAbsent: false };
  } catch (err) {
    _warnOnce(
      "network-error",
      `BrowserWindow fallback unexpected error: ${err instanceof Error ? err.message : String(err)}`
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
  logger.warn("Kick:Endpoints:Follow", message, { reason });
}

/**
 * Test-only helper. Resets the warn-once Set so individual tests can assert
 * warn-fires on each scenario without ordering coupling.
 */
export function _resetWarnedForTests(): void {
  _warned.clear();
}
