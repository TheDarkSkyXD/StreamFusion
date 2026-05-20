/**
 * Strip Set-Cookie from third-party CDN responses so Chromium stops emitting
 * "Reading cookie in cross-site context" warnings in DevTools.
 *
 * Renderer document origin is http://localhost:5173 in dev (and file:// in
 * production), so every request to Twitch/Kick CDNs is cross-site. Those
 * CDNs return SameSite=None; Secure cookies without the Partitioned attribute,
 * which Chromium flags on every read against the future third-party cookie
 * phase-out. With ~250 cross-site requests across a session, ~8 cookies pile
 * up and Chromium can spam 1000+ warnings.
 *
 * Cookies are stripped only from hosts that never need them:
 *   - Image/asset CDNs (jtvnw.net, files.kick.com, images.kick.com)
 *   - Emote CDNs (7tv, BetterTTV, FrankerFaceZ, kicktalk)
 *   - Twitch GQL / Helix / HLS (we authenticate with Bearer tokens)
 *
 * Cookies are intentionally PRESERVED on:
 *   - id.twitch.tv / id.kick.com (OAuth flow needs them)
 *   - kick.com root (Cloudflare WAF clearance cookies live here and are
 *     reused by the `persist:kick_public` partition in channel-endpoints.ts)
 */

import type { Session } from "electron";

/**
 * Electron webRequest URL filter patterns. These are passed verbatim into
 * `session.webRequest.onHeadersReceived({ urls: [...] }, ...)`.
 *
 * Keep entries in sync with `shouldStripSetCookieForUrl` — the patterns
 * decide which responses the callback fires for, the predicate is the
 * defense-in-depth check that nothing slipped through.
 */
export const THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS: readonly string[] = [
  // Twitch CDN (avatars, badges, thumbnails) — biggest source of warnings
  "*://*.jtvnw.net/*",
  // Twitch HLS + API (already handled inside the *.twitch.tv handler, but
  // listing here keeps the stripper self-contained when reused on partitions)
  "*://gql.twitch.tv/*",
  "*://api.twitch.tv/*",
  "*://*.ttvnw.net/*",
  // Kick image CDN
  "*://files.kick.com/*",
  "*://*.files.kick.com/*",
  "*://images.kick.com/*",
  "*://*.images.kick.com/*",
  // Kick API (Bearer auth — no cookie needed)
  "*://api.kick.com/*",
  // Emote CDNs
  "*://cdn.7tv.app/*",
  "*://cdn.betterttv.net/*",
  "*://cdn.frankerfacez.com/*",
  "*://cdn.kicktalk.app/*",
];

const STRIP_HOST_MATCHERS: ReadonlyArray<(host: string) => boolean> = [
  (h) => h === "jtvnw.net" || h.endsWith(".jtvnw.net"),
  (h) => h === "gql.twitch.tv",
  (h) => h === "api.twitch.tv",
  (h) => h === "ttvnw.net" || h.endsWith(".ttvnw.net"),
  (h) => h === "files.kick.com" || h.endsWith(".files.kick.com"),
  (h) => h === "images.kick.com" || h.endsWith(".images.kick.com"),
  (h) => h === "api.kick.com",
  (h) => h === "cdn.7tv.app",
  (h) => h === "cdn.betterttv.net",
  (h) => h === "cdn.frankerfacez.com",
  (h) => h === "cdn.kicktalk.app",
];

/**
 * Predicate companion to `THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS`. Use this
 * inside the webRequest callback to confirm the URL is actually one we want
 * to strip — gives a clean denylist for id.twitch.tv, kick.com, etc. when
 * a broader pattern (e.g. *.twitch.tv) is reused elsewhere.
 */
export function shouldStripSetCookieForUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return STRIP_HOST_MATCHERS.some((match) => match(host));
}

type HeaderMap = Record<string, string[] | undefined>;

/**
 * Return a shallow copy of `headers` with every Set-Cookie variant removed.
 * Header keys arrive in arbitrary casing depending on the upstream server.
 */
export function stripSetCookieFromHeaders(headers: HeaderMap): HeaderMap {
  const next: HeaderMap = {};
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "set-cookie") continue;
    next[key] = headers[key];
  }
  return next;
}

/**
 * Wire the stripper into an Electron session. Safe to call once per session
 * (default + each persistent partition we use for Kick scraping).
 */
export function registerThirdPartyCookieStripper(session: Session): void {
  session.webRequest.onHeadersReceived(
    { urls: [...THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS] },
    (details, callback) => {
      // callback({}) = "no modifications, pass response through" per Electron's
      // contract. We use it for every non-mutating path: hosts the predicate
      // excludes, responses that arrive without headers, and any unexpected
      // throw from the strip path (a malformed header shape should never hang
      // the response — passthrough is always safer than nothing).
      if (!shouldStripSetCookieForUrl(details.url) || !details.responseHeaders) {
        callback({});
        return;
      }
      try {
        const responseHeaders = stripSetCookieFromHeaders(details.responseHeaders as HeaderMap);
        callback({ responseHeaders: responseHeaders as Record<string, string[]> });
      } catch {
        callback({});
      }
    }
  );
}

const PURGE_COOKIE_DOMAINS: readonly string[] = [
  "jtvnw.net",
  "ttvnw.net",
  "gql.twitch.tv",
  "api.twitch.tv",
  "files.kick.com",
  "images.kick.com",
  "api.kick.com",
  "cdn.7tv.app",
  "cdn.betterttv.net",
  "cdn.frankerfacez.com",
  "cdn.kicktalk.app",
];

/**
 * Evict cookies that already accumulated for the strip-list domains. Without
 * this, the 8 cookies that landed in the jar before the stripper was wired
 * up keep getting read on every cross-site request — and Chromium keeps
 * warning — until the user clears storage manually.
 */
export async function purgeStoredThirdPartyCookies(session: Session): Promise<void> {
  for (const domain of PURGE_COOKIE_DOMAINS) {
    let cookies: Electron.Cookie[] = [];
    try {
      cookies = await session.cookies.get({ domain });
    } catch {
      continue;
    }
    for (const cookie of cookies) {
      const cookieHost = (cookie.domain || domain).replace(/^\./, "");
      const url = `https://${cookieHost}${cookie.path || "/"}`;
      try {
        await session.cookies.remove(url, cookie.name);
      } catch {
        // Best-effort — a missing cookie or path mismatch isn't worth failing
        // app startup over.
      }
    }
  }
  try {
    await session.cookies.flushStore();
  } catch {
    // Same — flush is an optimization, not a correctness requirement.
  }
}
