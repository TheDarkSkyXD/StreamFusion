---
title: Electron "Reading cookie in cross-site context" DevTools spam — narrow webRequest filter let CDN Set-Cookie through
module: apps/desktop/backend/services/third-party-cookie-stripper
date: 2026-05-19
category: integration-issues
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "1801 warnings of type 'Reading cookie in cross-site context may be impacted on Chrome' in DevTools Issues panel"
  - "Chromium reports 8 distinct cookies across 259 requests, all SameSite=None; Secure without the Partitioned attribute"
  - "Warning count compounds across an app session — every page navigation that loads Twitch/Kick CDN assets re-attaches the cookies and re-fires the warning"
root_cause: incomplete_setup
resolution_type: code_fix
related_components: [authentication, chat, brief_system]
tags: [electron, cookies, webrequest, samesite, third-party, chromium, twitch, kick, cdn]
---

# Electron "Reading cookie in cross-site context" DevTools spam — narrow webRequest filter let CDN Set-Cookie through

## Problem

Chromium's DevTools Issues panel filled with 1801 "Reading cookie in cross-site context may be impacted on Chrome" warnings — 8 cookies, 259 requests. The renderer document origin is `http://localhost:5173` in dev (and `file://` in production), so every `<img src="https://static-cdn.jtvnw.net/...">` and every Helix/GQL fetch is a third-party request. Twitch and Kick CDNs answer with `SameSite=None; Secure` cookies without the `Partitioned` attribute, which Chromium flags against the third-party cookie phase-out on every read. The app already had a `Set-Cookie` stripper at `apps/desktop/src/main.ts:227-272` whose comment explicitly said it was there to suppress this warning, but the warnings kept coming.

## Symptoms

- DevTools Issues panel: 1801 warnings, 8 cookies, 259 requests
- Live electron-mcp probe of the renderer showed 39 entries from `static-cdn.jtvnw.net` in the resource-timing buffer (capped at 250), 16 `<img>` elements pointing directly at `files.kick.com/emotes/…`, and 60 `<img>` elements routed through the existing `kick-image://` proxy (those weren't the problem)
- The existing strip filter at `main.ts:227-272` fired correctly for `gql.twitch.tv` and `*.ttvnw.net` but never for `static-cdn.jtvnw.net`, `files.kick.com`, or the emote CDNs

## What Didn't Work

1. **Assuming the existing filter covered everything.** The comment on `main.ts:253` claimed it stripped Set-Cookie "to prevent 'Reading cookie in cross-site context' console spam." Reading further: the outer `onHeadersReceived` URL filter was scoped to `*://*.twitch.tv/*` and `*://*.ttvnw.net/*` only. `static-cdn.jtvnw.net` is `*.jtvnw.net`, not `*.twitch.tv` — the filter never fired for it. `files.kick.com` and the emote CDNs weren't covered at all.

2. **Looking at the CSP in `apps/desktop/index.html`.** The CSP allows the renderer to load images and connect to those origins; tightening it would break the app's actual functionality (chat emotes, avatars, thumbnails). CSP isn't the layer where this warning is produced — the warning fires when Chromium stores or reads a `SameSite=None; Secure; not-Partitioned` cookie in a cross-site context, irrespective of CSP.

3. **Considering `Partitioned` attribute injection.** We don't control the upstream `Set-Cookie` headers — Twitch and Kick decide whether to mark their cookies `Partitioned`. Rewriting their cookies on the response would add the `Partitioned` attribute, but we'd be silently mutating third-party state, and the warnings would still fire on whatever escaped the rewrite.

## Solution

1. **Widen the webRequest filter.** Extract the strip into its own helper at `apps/desktop/src/backend/services/third-party-cookie-stripper.ts`, exporting a URL-pattern list and a defense-in-depth host predicate. The pattern list covers `*.jtvnw.net`, `files.kick.com`, `*.files.kick.com`, `images.kick.com`, `*.images.kick.com`, `api.kick.com`, `cdn.7tv.app`, `cdn.betterttv.net`, `cdn.frankerfacez.com`, `cdn.kicktalk.app`, plus the original `gql.twitch.tv` / `api.twitch.tv` / `*.ttvnw.net` set.

2. **Purge already-stored cookies on `app.ready`.** The 8 cookies that accumulated before the stripper widened still sit in the cookie jar and re-fire the warning on every cross-site request. `purgeStoredThirdPartyCookies` iterates the strip-list domains, calls `cookies.remove`, and `flushStore`s. Fire-and-forget so a slow cookie store doesn't gate window creation.

3. **Carve out OAuth and Cloudflare WAF hosts.** `id.twitch.tv`, `id.kick.com`, and root `kick.com` are intentionally absent from both the URL filter and the host predicate. OAuth needs cookies during the authorize round-trip. Kick's hidden-window `persist:kick_public` partition needs `cf_clearance` and `__cf_bm` from `kick.com` (apex) to survive Cloudflare's WAF challenge.

```typescript
// apps/desktop/src/backend/services/third-party-cookie-stripper.ts
export const THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS: readonly string[] = [
  "*://*.jtvnw.net/*",
  "*://gql.twitch.tv/*",
  "*://api.twitch.tv/*",
  "*://*.ttvnw.net/*",
  "*://files.kick.com/*",
  "*://*.files.kick.com/*",
  "*://images.kick.com/*",
  "*://*.images.kick.com/*",
  "*://api.kick.com/*",
  "*://cdn.7tv.app/*",
  "*://cdn.betterttv.net/*",
  "*://cdn.frankerfacez.com/*",
  "*://cdn.kicktalk.app/*",
];

export function registerThirdPartyCookieStripper(session: Session): void {
  session.webRequest.onHeadersReceived(
    { urls: [...THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS] },
    (details, callback) => {
      if (!shouldStripSetCookieForUrl(details.url) || !details.responseHeaders) {
        callback({});
        return;
      }
      try {
        const responseHeaders = stripSetCookieFromHeaders(
          details.responseHeaders as HeaderMap
        );
        callback({ responseHeaders: responseHeaders as Record<string, string[]> });
      } catch {
        callback({});
      }
    }
  );
}
```

`callback({})` is Electron's "pass response through unmodified" contract. Use it for every non-mutating path — excluded hosts, missing `responseHeaders`, and any throw from the strip path. A malformed header shape must never hang the network stack.

## Why This Works

- **Strip at `onHeadersReceived`, not `onBeforeSendHeaders`.** Mutating the response headers before they reach the cookie jar means the cookie never enters storage; nothing to strip on outgoing requests, nothing to read on subsequent fetches, nothing for Chromium to warn about.
- **The predicate is defense-in-depth, not the gate.** Electron's URL pattern matcher decides which responses fire the listener; the predicate inside the listener is a second-layer denylist that catches mistakes when patterns broaden later. Locking carve-outs at both layers means a contributor who accidentally adds `*.kick.com` to the pattern list (matching root `kick.com`) won't strip `cf_clearance` because the predicate still excludes the apex.
- **Purge is one-shot, then idempotent.** First launch evicts the existing cookies; subsequent launches find an empty jar and no-op. The stripper prevents re-storage from that point forward.

## Prevention

1. **Lock carve-outs in tests at the URL-pattern layer, not just the predicate.** The predicate could be correct while a contributor naively adds a pattern that matches an OAuth or WAF host. The URL list is what Electron actually iterates against responses.

   ```typescript
   it.each([
     ["id.twitch.tv", "Twitch OAuth host"],
     ["id.kick.com", "Kick OAuth host"],
   ])("excludes %s from URL patterns", (host) => {
     for (const pattern of THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS) {
       expect(pattern).not.toContain(host);
     }
   });

   it("excludes the root kick.com host (Cloudflare WAF clearance)", () => {
     for (const pattern of THIRD_PARTY_COOKIE_STRIP_URL_PATTERNS) {
       expect(pattern).not.toBe("*://kick.com/*");
       expect(pattern).not.toBe("*://*.kick.com/*");
     }
   });
   ```

2. **Test multi-valued `Set-Cookie` arrays explicitly.** Cloudflare and Twitch routinely return 2-3 cookies on a single response. Electron exposes those as `string[]` under one header key; stripping means dropping the whole array, not just `[0]`.

3. **Model Chromium's parent-domain cookie matching in any fake session.** Real Electron returns cookies whose `Domain=.kick.com` on `cookies.get({domain: "files.kick.com"})`. A naive exact-string fake will let an over-purge regression land silently.

4. **Default to `callback({})` for every path the listener can't safely mutate.** Excluded host, missing `responseHeaders`, unexpected throw — all of them must pass the response through, not hang. Wrap the strip in try/catch with a passthrough fallback.

5. **Live-probe DevTools assumptions.** "The strip filter is registered, so cookies should be gone" is theory. The fix here came from probing the running renderer via electron-mcp and counting `document.images` per host — `static-cdn.jtvnw.net` (16) and `files.kick.com` (16) were rendering directly while 60 were routed through `kick-image://`. Without the live probe, the wrong layer would have absorbed the investigation.

## Related Issues

- The 60 `kick-image://`-routed images at runtime are the right pattern — those go through `apps/desktop/src/backend/protocols/kick-image-protocol.ts` to the main process and bypass renderer cookie jars entirely. If the strip-list ever drifts, that proxy still protects most Kick traffic.
- `apps/desktop/src/backend/api/platforms/kick/endpoints/channel-endpoints.ts` and `chat-endpoints.ts` use a separate `persist:kick_public` partition specifically to keep `cf_clearance` for Cloudflare. That partition is intentionally NOT covered by the stripper. If you add a stripper there, the WAF will challenge every request.
