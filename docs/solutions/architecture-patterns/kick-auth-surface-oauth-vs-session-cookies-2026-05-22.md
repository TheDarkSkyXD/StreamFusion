---
title: Kick auth has two disjoint surfaces — id.kick.com OAuth and kick.com session cookies
date: 2026-05-22
category: architecture-patterns
module: apps/desktop/backend/api/platforms/kick
problem_type: architecture_pattern
component: authentication
severity: high
related_components:
  - kick-auth-service
  - follow-endpoints
  - storage-service
  - auth-handlers
  - browser-window-mutex
applies_when:
  - "Calling any kick.com endpoint outside the documented id.kick.com public/v1 surface (e.g. /api/v2/*)"
  - "Implementing logout for Kick — must clear OAuth token AND kick.com session cookies"
  - "Building background refresh that relies on cookie-auth scraping while the OAuth token may have expired"
  - "Gating UI on Kick connection state — check token presence, not just persisted account data"
  - "Debugging a 403 on a kick.com endpoint despite a valid OAuth Bearer token"
tags:
  - kick
  - oauth
  - session-cookies
  - electron-session
  - authentication
  - browserwindow-scrape
  - follows-sync
  - logout
---

# Kick auth has two disjoint surfaces — id.kick.com OAuth and kick.com session cookies

## Context

Kick exposes user-specific data through two completely disjoint authentication systems, and using the wrong one for an endpoint produces silent, hard-to-debug failures.

- **OAuth (`api.kick.com/public/v1/*`)**: documented in `docs.kick.com`, takes `Authorization: Bearer <token>` from the `id.kick.com` OAuth flow.
- **SPA-backed (`kick.com/api/v2/*` and `kick.com/<page>`)**: predates the public API, validates `kick_session` cookies on the kick.com apex, and requires Kasada bot-detection tokens that only kick.com's own page context can mint.

The followed-channels feature is the canonical example: there is no `/public/v1/followed-channels`, only `kick.com/api/v2/channels/followed`. Live-testing on 2026-05-21 confirmed Bearer auth to v2 returns **403** unconditionally; direct main-process `fetch` with full session cookies + `X-XSRF-TOKEN` + `X-Requested-With` returns **401** (no Kasada tokens); `web.kick.com` is cross-origin blocked. The only path that works is opening a hidden `BrowserWindow` in the **default Electron session** (where the OAuth window deposited cookies) and DOM-scraping the SPA-rendered `kick.com/following/channels` page. What surprised us: the SPA's kick.com session cookies outlive any single OAuth token's lifetime (weeks-months), so they can drive background refresh without re-authenticating — but it also means logout has to clear *both* credentials or cross-subdomain SSO auto-completes the next OAuth flow as the prior user. (auto memory [claude])

## Guidance

Always classify a Kick endpoint by which auth system it uses *before* writing the consumer. The same `accessToken` works only on `api.kick.com/public/v1/*`; everything else needs the BrowserWindow path.

**1. OAuth-API endpoints (`/public/v1/*`) — use Bearer via `fetch`/`kickClient`.** See `kick-auth.ts:184` (`fetchCurrentUser`). Refresh, revoke, and current-user calls go here.

**2. SPA-rendered or `/api/v2/*` data — open a `BrowserWindow` in the default session, never direct fetch.** The orchestration in `follow-endpoints.ts:72-106` (`_doFetch`) tries Bearer first as cheap insurance against the API surface expanding, then falls through to `_fetchViaBrowserWindow` (`follow-endpoints.ts:231`) on any failure. The window inherits the OAuth window's cookies via the default session — `persist:kick_public` would not, which is why the partition is intentional even though it mixes credentials with anything else opened in the default session (a known P1 tradeoff).

```ts
// follow-endpoints.ts:231 — note the default session is intentional
win = new BrowserWindow({
  show: false, width: 800, height: 600,
  webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  // No `session:` override — inherits id.kick.com OAuth cookies.
});
```

Always wrap `executeJavaScript` in a timeout (`EXECUTE_JS_TIMEOUT_MS = 8000` at `follow-endpoints.ts:215`) or a hung renderer holds the single-flight mutex forever and wedges every future sync.

**3. Logout must clear BOTH the OAuth token AND the kick.com session cookies.** `kick-auth.ts:41-72` enumerates four domains (`.kick.com`, `kick.com`, `id.kick.com`, `.id.kick.com`) and removes user-session cookies while preserving Cloudflare clearance (`cf_clearance`, `__cf_bm`). Called from both `logout()` (line 162) and the `_doRefresh` permanent-failure path (line 112).

```ts
async function clearKickSessionCookies(): Promise<void> { /* enumerates 4 domains, preserves CF cookies */ }
```

**4. Background refresh runs against session cookies independently of OAuth token refresh** (`auth-handlers.ts:150-182`). Cookies live for weeks, OAuth tokens for hours — they are on different lifecycles.

```ts
// auth-handlers.ts:164-182
const KICK_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const FOCUS_REFRESH_COOLDOWN_MS = 60 * 1000;
function maybeRefreshKickFollows(trigger: "interval" | "focus"): void {
  if (!storageService.hasToken("kick")) return; // token presence gates refresh
  /* cooldown logic */
  syncFollowsOnLogin("kick").catch(() => {});
}
setInterval(() => maybeRefreshKickFollows("interval"), KICK_REFRESH_INTERVAL_MS);
mainWindow.on("focus", () => maybeRefreshKickFollows("focus"));
```

**5. Token presence is the source of truth for "signed in," not DB rows.** `storage-service.ts:327-335` checks `hasToken` *first*, falls back to `hasAccountFollows` only after. A crashed logout that leaves account-source rows behind must still surface guest follows.

## Why This Matters

Forgetting which endpoint uses which credential burns days. Building any new feature against `/api/v2/*` with Bearer auth produces 403s that look like a scope/permission problem but are unfixable — the endpoint simply does not speak OAuth. A logout that only clears the OAuth token leaves kick.com session cookies behind, so id.kick.com SSO auto-completes the next OAuth flow against the previous user's identity (the U6 bug); cookies must be cleared with the four-domain enumeration in `kick-auth.ts:43`. Using "are there rows in `follows`?" as the signed-in check shows stale account data after a crashed logout — the A5 fix flipped this so token presence wins. Finally, the DOM-scrape path is brittle by construction: it depends on the H2 heading text matching `/followed channel|channels you follow|following channels/i` (`follow-endpoints.ts:372`), and we have already had to rewrite the selector twice as Kick's UI shifted. Treat any scrape change as a contract change.

## When to Apply

- Adding any new Kick endpoint that reads user-specific data — check `docs.kick.com` first; if it's not in `/public/v1/*`, plan for the BrowserWindow path.
- Working on the logout, disconnect, or "switch account" flow for Kick — both credentials must be invalidated.
- Building any "while signed in" background task for Kick — gate on `hasToken`, refresh off cookies, do not assume OAuth token refresh covers it.
- Debugging "I'm signed in but the data is wrong / I see the previous user's follows" — almost always a credential-mixing or DB-rows-as-source-of-truth bug.
- Reviewing the security boundary around the default Electron session — any new BrowserWindow opened there inherits kick.com session cookies (a known P1 from the recent code review).
- Reviewing any scrape-dependent code path — Kick UI changes break it silently; an "all-zero results" outcome must classify as error, not "user follows nobody," to avoid wiping the DB (`follow-endpoints.ts:497-506`).

## Examples

**Example 1: Dormant Bearer path next to the working BrowserWindow path** (`follow-endpoints.ts:72-106`). The Bearer attempt is kept because (a) it costs ~30ms, (b) if Kick ever extends `/public/v1/*` to cover follows we'll pick it up automatically, and (c) its per-cause classification feeds the warn-once channel. But the BrowserWindow fallback is the real workhorse on every production code path.

```ts
async function _doFetch(): Promise<FollowedChannelsResult> {
  const token = storageService.getToken("kick")?.accessToken;
  if (!token) return { status: "error", reason: "no-token" };

  // Live testing 2026-05-21: Bearer is rejected with 403. Kept as cheap insurance.
  const bearerResult = await _tryBearerFetch(token);
  if (bearerResult.status === "ok") return bearerResult;
  if (bearerResult.reason === "no-token") return bearerResult;

  // Fall through for auth-failed / cloudflare-challenge / parse-error / network-error.
  // BrowserWindow inherits default-session cookies (where OAuth window deposited them).
  _warnOnce(bearerResult.reason, `Bearer path failed reason="${bearerResult.reason}". Trying BrowserWindow cookie-auth fallback...`);
  return _fetchViaBrowserWindow();
}
```

**Example 2: Pre-A5 vs post-A5 `getActiveFollowsByPlatform`** (`storage-service.ts:327-335`). Before A5 the gating order was DB-first, so a user with stale account rows but no valid token saw the previous user's follows. After A5 the token check fires first.

```ts
// BEFORE (DB-gated — leaks prior user's data after crashed logout):
getActiveFollowsByPlatform(platform: Platform): LocalFollow[] {
  if (dbService.hasAccountFollows(platform)) {
    return dbService.getFollowsByPlatformAndSource(platform, "account");
  }
  return dbService.getFollowsByPlatformAndSource(platform, "guest");
}

// AFTER (token-gated — no token means guest follows, period):
getActiveFollowsByPlatform(platform: Platform): LocalFollow[] {
  if (!this.hasToken(platform)) {
    return dbService.getFollowsByPlatformAndSource(platform, "guest");
  }
  if (dbService.hasAccountFollows(platform)) {
    return dbService.getFollowsByPlatformAndSource(platform, "account");
  }
  return dbService.getFollowsByPlatformAndSource(platform, "guest");
}
```

The companion to this fix is `clearKickSessionCookies` running on logout (`kick-auth.ts:165`) — together they ensure that after sign-out (1) no stale token says "signed in," (2) no stale cookies let the next OAuth flow SSO-complete as the prior user, and (3) the UI falls back to guest follows correctly. Slug-based row IDs from the DOM scrape (`follow-endpoints.ts:517`) play nicely with this because `channelsMatch` matches on platform+id OR platform+slug, so canonical-id rows from later VOD-page resolution don't conflict with the slug-only rows the scrape produces.

## Related

- [`docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md`](../logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md) — Kick's `user_id` vs `channel.id` dual-id mismatch in the guest-mode local follow store. Companion fact: authenticated follows now go through the architecture this doc describes (BrowserWindow + session cookies), so the dual-id concern surfaces at the DB write boundary (`channel_id` defaults to slug when canonical id is unknown) rather than at the renderer.
- [`docs/solutions/integration-issues/kick-chat-401-missing-scope-and-broadcaster-id-2026-05-21.md`](../integration-issues/kick-chat-401-missing-scope-and-broadcaster-id-2026-05-21.md) — Kick chat send 401: scope and id-field mismatch. Operates entirely on the OAuth surface (`/public/v1/chat`); a sibling example of getting the credential right but the request shape wrong.
- [`docs/solutions/integration-issues/electron-third-party-cookie-cross-site-warnings-2026-05-19.md`](../integration-issues/electron-third-party-cookie-cross-site-warnings-2026-05-19.md) — Cookie stripper carve-outs for `id.kick.com` (OAuth) and `kick.com` apex (session) explicitly preserve both auth surfaces. Touches the two-system distinction in passing as a carve-out justification.
- [`docs/solutions/integration-issues/twitch-irc-missing-chat-scopes-2026-05-19.md`](../integration-issues/twitch-irc-missing-chat-scopes-2026-05-19.md) — Sibling pattern on Twitch: token validates but lacks scope for a specific endpoint family. Same "wrong auth credentials for the wrong endpoint" mental model.
