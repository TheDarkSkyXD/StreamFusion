---
title: Kick prediction voting requires session cookies + CSRF — Bearer alone returns 401
date: 2026-05-22
discovered-during: docs/plans/2026-05-22-002-feat-predictions-backend-integration-plan.md U5 live-test
related: docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md
---

# Kick prediction voting requires session cookies + CSRF — Bearer alone returns 401

## What

`POST /api/v2/channels/{slug}/predictions/vote` requires Kick's session-cookie + X-XSRF-TOKEN auth surface, not the Bearer OAuth token that the OAuth flow at id.kick.com produces. From StreamFusion's renderer context (real Chromium but **not** a kick.com origin), a Bearer-only POST returns HTTP 401 even with a freshly issued OAuth token.

Verified 2026-05-22 against live predictions on `lordkebun` and `ramee`: user logged in via the app's normal Kick OAuth flow, opened a real prediction, clicked the in-app vote form. Network log shows `POST kick.com/api/v2/channels/lordkebun/predictions/vote → 401`.

Cross-checked via Playwright:
- **Real kick.com page context** (cookies attached): same POST → **419 "CSRF token mismatch"**. Route exists, auth handler reached, Laravel session middleware rejects on missing X-XSRF-TOKEN.
- **Cross-origin (about:blank) with Bearer**: same POST → **401 "Unauthenticated"**. Bearer doesn't authenticate the session-cookie surface.
- **Empty channelSlug** (`/channels//predictions/vote`): **405 "POST not supported, only GET/HEAD"** — Laravel collapses `//`, routes to a different endpoint. Separately fixed in `kick-prediction-mutations.ts`'s input validation.

## Why this is the same shape as the existing kick-auth-surface learning

`docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md` documented the same boundary for follow-channels: main-process direct fetch with Bearer or even full cookies returns 401/403, and the only working path is a hidden BrowserWindow in the default Electron session. The follow-endpoints fix uses DOM-scrape on `/following/channels`; the prediction-vote equivalent would use a page-context fetch (Laravel session middleware is satisfied when the request originates inside the kick.com page, which can read XSRF-TOKEN cookie and attach it as X-XSRF-TOKEN).

The earlier P0a verification (during U1's pre-flight) concluded Bearer works in renderer context — that was based on `kick-pin-mutations.ts` apparently working in production. The conclusion was wrong: pin endpoints may work because of an unrelated reason (different middleware, or pin has been silently broken too). For predictions, Bearer in renderer is definitively not enough.

## Current behavior (PredictionBanner)

`apps/desktop/src/components/chat/PredictionBanner.tsx` now gates the in-app vote form on `prediction.platform === "twitch" || KICK_IN_APP_VOTING_SUPPORTED` (constant `false`). Kick viewers always see the deeplink CTA (`Vote on kick.com ↗`) instead of the form. Read-only banner via the U1 Pusher subscription continues to work — guests, not-Kick-authed, and Kick-authed users all see live predictions; voting just happens on kick.com.

Twitch in-app voting (U4 `MakePrediction` GQL) is unaffected — Twitch's GQL accepts the OAuth token directly without requiring browser session context. Different auth surface, no Kasada/CSRF gate on writes.

## Fix path (not in this commit)

Mirror the `follow-endpoints.ts:231` pattern for predictions vote:

1. Move vote out of the renderer into the main process, behind an IPC handler.
2. Main process opens a hidden BrowserWindow at `https://kick.com` (default Electron session — inherits the OAuth window's id.kick.com cookies, then warm-visits kick.com apex to let cross-subdomain SSO set the `kick_session` cookie on `.kick.com`).
3. Inside the BrowserWindow's page context, `executeJavaScript` runs:
   ```js
   const xsrf = decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)[1]);
   const r = await fetch("/api/v2/channels/{slug}/predictions/vote", {
     method: "POST",
     credentials: "include",
     headers: {
       "Content-Type": "application/json",
       "Accept": "application/json",
       "X-XSRF-TOKEN": xsrf,
       "X-Requested-With": "XMLHttpRequest",
     },
     body: JSON.stringify({ outcomeId, amount }),
   });
   return { status: r.status, body: await r.text() };
   ```
4. Mutex-serialize via `acquireBrowserWindowSlot` so prediction vote doesn't contend with follow-channels for the GPU subprocess.
5. Wire back through IPC; flip `KICK_IN_APP_VOTING_SUPPORTED = true` in `PredictionBanner.tsx`.

Significant rework — own plan. Existing `kick-prediction-mutations.ts` (renderer Bearer fetch) becomes either deprecated or the test-only path. The `kick-predictions-service` (U1 Pusher + REST seed read-only) is unaffected — anonymous reads work fine from the renderer.

## Related

- `docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md` — original learning.
- `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts:231` — the BrowserWindow scrape pattern to mirror.
- `docs/plans/2026-05-22-002-feat-predictions-backend-integration-plan.md` — U2 (`voteOnPrediction`) and U5 (form) — both now disabled for Kick by `KICK_IN_APP_VOTING_SUPPORTED = false`.
- `docs/solutions/integration-issues/preload-auth-gettoken-no-sender-origin-check-2026-05-22.md` — separate inherited issue; the BrowserWindow path's main-process residency happens to mitigate it (token never reaches renderer).
