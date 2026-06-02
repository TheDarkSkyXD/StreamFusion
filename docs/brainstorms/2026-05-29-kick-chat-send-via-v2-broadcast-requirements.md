---
date: 2026-05-29
topic: kick-chat-send-via-v2-broadcast
---

# Kick Chat Send — Switch to v2 page-context endpoint so messages actually broadcast

## Summary

The current Kick chat-send path posts to `https://api.kick.com/public/v1/chat` (`apps/desktop/src/backend/services/chat/kick-chat.ts:634`). That endpoint accepts our OAuth Bearer token, returns `200 { is_sent: true, message_id }`, and **does not broadcast the message to other viewers** unless the OAuth app has been verified by Kick (i.e., Kick has whitelisted our developer account after manual review at `developers@kick.com`). For un-verified apps — which is our current state — every send silently no-ops on Kick's side; the user sees only their own optimistic local echo and no other viewer in the channel ever receives the message. The symptom was reproduced live on 2026-05-29 against `kick.com/anonsociety`.

This spec replaces the OAuth send path with the same path Kick's own web client uses: `POST https://kick.com/api/v2/messages/send/{chatroomId}` fired from inside a kick.com page-context `fetch` in a hidden `BrowserWindow`, with the kick.com session cookies (`credentials: 'include'`) **and** the Laravel Sanctum bearer token (`Authorization: Bearer {id}|{token}`) that kick.com's own send code attaches. The Sanctum bearer is captured opportunistically via `session.webRequest.onBeforeSendHeaders` on the BrowserWindow's session, since the bearer is encrypted in localStorage and not safely readable from outside the page. The window is a single, app-global, ref-counted hidden BrowserWindow loaded on `https://kick.com/`, spawned on the first `joinChannel` and destroyed when the last Kick chat is left. The `/public/v1/chat` path and its `chat:write` OAuth scope handling are removed in the same change — no fallback.

The auth model below was verified live on 2026-05-29 in a logged-in kick.com Playwright session: page-context `fetch` to `/api/v2/messages/send/{chatroomId}` with cookies + `XSRF-TOKEN` + `X-Requested-With` but **no** `Authorization` header returns `403 {"message": "User is not authenticated."}`. The same fetch with `Authorization: Bearer 369328786|PnWu1AkLBf6XzxexXX4LoCUJ52f56wti8xBolgg4` succeeds and the message broadcasts on kick.com — confirmed via a second anonymous viewer on `kick.com/anonsociety/chat`.

---

## Problem Frame

Two architecturally disjoint auth surfaces exist on Kick (documented at `docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md`):

1. **OAuth `api.kick.com/public/v1/*`** — Bearer token from `id.kick.com`. Documented at `docs.kick.com`. Used for `chat:write`, but the chat-send endpoint on this surface is gated behind app verification and silently drops un-verified sends.
2. **SPA `kick.com/api/v2/*`** — Laravel session cookies (`session_token`, `XSRF-TOKEN`) + Kasada bot-detection tokens + a per-session Laravel Sanctum **personal-access-token-style bearer** (format `{numericTokenId}|{base64ishSecret}`, e.g. `369328786|PnWu1Ak…`). The bearer is minted by `/mobile/login` (or refreshed on session boot) and stored encrypted in the page's localStorage under an obfuscated key (`BnKK836sP5WVpbRY` as of 2026-05-29). The kick.com web app's chat-send code reads it, decrypts it, and explicitly attaches it as `Authorization: Bearer …` on each outgoing chat request. This is the surface our send must use.

The kick.com apex cookies (`session_token`, `XSRF-TOKEN`) are deposited into the default Electron session by the existing SSO bridge: after the OAuth window completes against `id.kick.com`, any subsequent warm visit to `kick.com` apex triggers `/api/v1/user/session` which sets the apex cookies (see `follow-endpoints.ts:267-292`). The Sanctum bearer is minted server-side at the same point. Live testing on 2026-05-22 confirmed direct main-process `fetch` to `kick.com/api/v2/*` fails with 401/403 even with full cookies + XSRF + `X-Requested-With` headers: Kasada injects runtime state into kick.com pages that we cannot replicate from main. The fetch MUST originate from inside a kick.com page context, and it MUST carry the Sanctum bearer.

Existing infrastructure that this spec piggybacks on:

- `acquireBrowserWindowSlot()` (`channel-endpoints.ts:249`) — global FIFO mutex serialising all hidden BrowserWindow spawns to one renderer at a time (GPU pressure guard).
- `waitForWebContentsCondition` (`services/web-contents-ready.ts`) — page-readiness polling with a timeout.
- `KickChatService.acquire()`/`release()` ref counting (`kick-chat.ts:367`) — already tracks how many UI components are using the service.

What does NOT yet exist and is in scope here:

- A persistent send-BrowserWindow that lives beyond a single page-context call (the follow-endpoints pattern is spawn-per-call).
- A page-context `fetch` helper that returns the v2 send result back to the main process.
- A `session.webRequest.onBeforeSendHeaders` interceptor on the send window's session that opportunistically captures the Sanctum bearer from kick.com's own outgoing requests.
- Removal of the OAuth `/public/v1/chat` send path and its `chat:write` scope advertising.

---

## Requirements

### Endpoint and auth surface

- **R1.** `KickChatService.sendMessage` SHALL stop calling `POST https://api.kick.com/public/v1/chat`. The OAuth Bearer send path SHALL be removed entirely; no fallback, no feature flag.
- **R2.** Chat sends SHALL be issued as `POST https://kick.com/api/v2/messages/send/{chatroomId}` from inside a kick.com page-context `fetch` call running in a hidden `BrowserWindow`.
- **R3.** The request body SHALL be `{"content": "<text>", "type": "message", "message_ref": "<Date.now() as string>"}`, matching the shape kick.com's own web SPA uses (live capture 2026-05-29). The `message_ref` is the kick.com web client's client-side correlation id; it's a string of milliseconds-since-epoch and is echoed back on the Pusher delivery so the page can dedup its optimistic echo against the broadcast. We adopt the same field shape so the wire request is indistinguishable from a normal kick.com web POST.
- **R4.** The request SHALL include the following headers, exactly matching the live-captured kick.com web request:
  - `Authorization: Bearer {capturedSanctumBearer}` — see "Bearer capture" requirements below
  - `Content-Type: application/json`
  - `Accept: application/json`
  - `Referer: https://kick.com`
  - `X-App-Platform: web`
  - `credentials: 'include'` on the `fetch` init so the page's `session_token` cookie attaches automatically.
  - The request SHALL NOT manually set `X-XSRF-TOKEN` or `X-Requested-With` — they are not part of the chat-send wire request kick.com fires (verified by intercepting `window.fetch` 2026-05-29). The endpoint authenticates via the Authorization Bearer + session_token cookie pair; XSRF protection does not apply.
- **R5.** The `chat:write` OAuth scope SHALL be removed from `KICK_OAUTH_CONFIG.scopes`. The scope test in `apps/desktop/tests/backend/auth/oauth-config.test.ts` SHALL be updated to assert absence. `docs/api/kick/authentication.md` SHALL be updated to drop the `chat:write` row.

### Bearer capture

- **R6.** The send window SHALL register a `session.webRequest.onBeforeSendHeaders` filter on its session at window construction time, with URL filter `["https://*.kick.com/*"]`. The handler SHALL inspect `details.requestHeaders.Authorization` and, on any value matching the regex `/^Bearer \d+\|[A-Za-z0-9]+$/`, cache that value in a main-process module-level variable (e.g. `latestKickWebBearer: string | null`). The handler SHALL pass `details.requestHeaders` through unmodified — capture is read-only.
- **R7.** The bearer cache SHALL be a single global string slot, scoped to the lifetime of the send-window owner module. There SHALL NOT be a per-channel cache: the bearer is account-wide, not chatroom-scoped.
- **R8.** The send window SHALL be considered "bearer-ready" once `latestKickWebBearer !== null`. The warmup predicate (R19 below) SHALL include this as a condition alongside the cookie check, so `ensureSendWindowReady` does not resolve until both apex cookies and the bearer have been observed at least once.
- **R9.** The bearer SHALL be re-captured on every matching outgoing request. If kick.com rotates the bearer mid-session, the next captured request overwrites the cache, and subsequent sends use the fresh value automatically.
- **R10.** The bearer cache SHALL be cleared by `disposeSendWindow()` (defined in R18) and by the explicit `clearKickSessionCookies()` path in `auth-handlers.ts` (per R43) so a logout-then-login cycle does not reuse a stale bearer.

### BrowserWindow scope, lifecycle, and isolation

- **R11.** A single application-global hidden `BrowserWindow` ("the send window") SHALL serve every Kick chat the user is in. There SHALL NOT be one BrowserWindow per channel.
- **R12.** The send window SHALL be created in the **default Electron session** (no `partition` override), matching the follow-endpoints precedent (`follow-endpoints.ts:255-265`) so it inherits the OAuth window's id.kick.com cookies and triggers the SSO bridge on warm visit.
- **R13.** The send window SHALL load `https://kick.com/` (apex homepage). The window SHALL NOT navigate per-channel; the v2 endpoint carries the `chatroomId` in the URL path and the page origin is sufficient for Kasada token validity.
- **R14.** The send window SHALL be spawned lazily on the first `KickChatService.joinChannel` call after the service is acquired. The spawn SHALL be single-flight: concurrent `joinChannel`s share one warmup promise.
- **R15.** The send window SHALL be destroyed when the last active Kick chat is left (`KickChatService.leaveChannel` brings active channel count to zero) OR when the service is force-shutdown (`forceShutdown()`).
- **R16.** Spawn SHALL acquire `acquireBrowserWindowSlot()` for the duration of `new BrowserWindow(...)` + `loadURL(...)` + readiness wait, then release the slot. The window itself SHALL live independently of the slot mutex so subsequent send operations do not contend with follow-sync or channel-resolve calls.
- **R17.** The send window SHALL be hidden (`show: false`) and SHALL NOT be focusable or visible in the OS window list. The `width`/`height` SHALL be `800`/`600`, matching the follow-endpoints precedent — Electron's renderer needs realistic dimensions for some SPA layout code paths, and a 1×1 window has caused render-process exits in adjacent precedents.

### Page-context send protocol

- **R18.** A helper module `apps/desktop/src/backend/api/platforms/kick/kick-send-window.ts` SHALL own the send window and the bearer cache. It SHALL export at minimum:
  - `ensureSendWindowReady(): Promise<void>` — idempotent spawn + warmup, single-flight.
  - `sendKickChatMessage(chatroomId: number, content: string): Promise<KickSendResult>` — issues one page-context send.
  - `disposeSendWindow(): Promise<void>` — tears down the window and clears the bearer cache, used by `leaveChannel` ref-count-zero, `forceShutdown`, and explicit logout.
- **R19.** `ensureSendWindowReady` SHALL wait via `waitForWebContentsCondition` for a boolean-returning IIFE predicate equivalent to `(() => document.cookie.indexOf('session_token=') >= 0)()`. The boolean-IIFE shape matches the existing `GRID_READY_PREDICATE` precedent at `follow-endpoints.ts:42`. In addition, `ensureSendWindowReady` SHALL await `latestKickWebBearer !== null` (R8) before resolving — typically the bearer is captured during the same `loadURL` because kick.com's homepage fires authenticated XHRs on bootstrap. If both conditions have not resolved within 10 seconds of `loadURL` completing, the warmup SHALL reject with an error message containing the substring `"send-window-warmup-timeout"`.
- **R20.** Each `sendKickChatMessage` call SHALL run `win.webContents.executeJavaScript(<IIFE>)` where the IIFE:
  - issues `POST /api/v2/messages/send/${chatroomId}` from page context,
  - sets the headers from R4, with the `Authorization` value interpolated from the captured bearer (passed in as part of the IIFE source — see R21),
  - sends the R3 body with `message_ref` set to `String(Date.now())` evaluated INSIDE the page (Date.now is sandboxed away in some workflow harnesses but available in Electron's renderer; we want the timestamp to reflect when the request actually fires, not when the IIFE source was built),
  - returns `JSON.stringify({ ok: response.ok, status: response.status, body: await response.text(), retryAfter: response.headers.get('Retry-After') })`,
  - wraps the entire body in `try/catch` and on catch returns `JSON.stringify({ ok: false, status: 0, body: String(err), retryAfter: null })`. The IIFE SHALL NOT throw out of the executeJavaScript boundary.
- **R21.** The IIFE source SHALL be a self-contained string built by interpolating `chatroomId`, `content`, and the captured `bearer` via `JSON.stringify(...)` to neutralise quote/newline injection from message content or bearer rotation. No template literals shall interpolate raw user input or the bearer into the IIFE source — only `JSON.stringify`-quoted forms.
- **R22.** The main-process side of `sendKickChatMessage` SHALL `JSON.parse` the returned string and classify the result per R23-R28 below.

### Result classification

- **R23.** `KickSendResult` SHALL be a tagged union: `{ ok: true; messageId: string | undefined }` or `{ ok: false; kind: "auth-expired" | "rate-limited" | "forbidden" | "network" | "unknown"; message: string; retryAfterSeconds?: number }`.
- **R24.** `200`-class responses SHALL produce `{ ok: true, messageId }` where `messageId` is sourced from `body.data.id` (or `body.data.message_id`) when present, undefined otherwise.
- **R25.** `401`, `403` "User is not authenticated.", or `419` responses SHALL trigger ONE reload of the send window page (`win.loadURL('https://kick.com/')` + re-await the readiness predicate, which now includes bearer re-capture) and ONE retry of the same send. The reload SHALL be single-flight: if two concurrent sends both auth-fail in the same window, only one reload runs and both retries share its result. If the retry also returns an auth failure, the result SHALL be `{ ok: false, kind: "auth-expired", message: "Kick session expired — reconnect Kick in Settings." }`. The retry SHALL NOT recurse — a second auth failure on the retry surfaces directly without a second reload.
- **R26.** `429` responses SHALL produce `{ ok: false, kind: "rate-limited", message: "Slow down — Kick rate limit.", retryAfterSeconds }` where `retryAfterSeconds` is `parseInt(retryAfter, 10)` from the IIFE's `retryAfter` field (R20) if numeric, undefined otherwise.
- **R27.** `403` responses with a body NOT containing `"User is not authenticated."` SHALL produce `{ ok: false, kind: "forbidden", message: "You are banned or timed out in this channel." }`. Distinguishing this 403 from the auth-failure 403 (R25) by body content is necessary because Kick uses 403 for both classes of error.
- **R28.** `status: 0` (IIFE catch path) SHALL produce `{ ok: false, kind: "network", message: "Network error sending message, please try again." }`.
- **R29.** Any other non-2xx status SHALL produce `{ ok: false, kind: "unknown", message: \`Send failed (\${status}).\` }`.

### Crash recovery and refresh

- **R30.** The send window SHALL bind `webContents.on('render-process-gone', ...)` and on any non-clean exit mark itself as invalidated AND clear `latestKickWebBearer`. The next `sendKickChatMessage` after invalidation SHALL re-run the full spawn + warmup path, which re-captures a fresh bearer.
- **R31.** Any `sendKickChatMessage` promise pending at the moment of a render-process-gone event SHALL reject with `{ ok: false, kind: "network", message: "Send window crashed, please try again." }`.
- **R32.** No proactive Kasada-token or Sanctum-bearer refresh timer SHALL be implemented. The R25 reactive reload path is the only refresh mechanism; rotated bearers get picked up by R9 the next time kick.com fires any authenticated request.

### Single-flight warmup queueing

- **R33.** Multiple `sendKickChatMessage` calls issued while the warmup promise is still pending SHALL share that single promise; only one warmup runs at a time.
- **R34.** The chat input UI SHALL NOT be disabled during warmup. A message typed and submitted during warmup SHALL be sent as soon as warmup resolves; the user-visible delay on a fast send is the warmup latency (typical 1-3s when warmup began at `joinChannel`).
- **R35.** If warmup has not resolved within 10s, all sends awaiting the warmup promise SHALL reject with `{ ok: false, kind: "network", message: "Send window failed to initialize." }` (R19 already enforces the 10s warmup deadline; this requirement specifies how that surfaces to pending sends).

### Integration with KickChatService

- **R36.** `KickChatService.sendMessage` SHALL keep its current signature (`channel`, `message`, optional `sender`) and SHALL keep its current rate-limit guard and optimistic-local-echo emission. Only the HTTP layer changes. The `broadcasterUserId` presence guard SHALL be replaced with a `chatroomId` presence guard since the v2 endpoint addresses by chatroom, not broadcaster.
- **R37.** The `accessToken` field on `KickChatService` and the `accessToken` option on `connect()` SHALL be removed. The new send path uses the kick.com session cookies + Sanctum bearer inside the send window — neither is sourced from the OAuth access token. Tests that set `accessToken` SHALL be updated.
- **R38.** When `joinChannel` is called, the service SHALL call `ensureSendWindowReady()` (no `await`) to begin warmup in parallel with the Pusher subscription. The promise SHALL be retained on the service so `sendMessage` can `await` it before each send.
- **R39.** When `leaveChannel` brings the active channel count to zero, the service SHALL call `disposeSendWindow()`. `forceShutdown()` SHALL also call `disposeSendWindow()`.

### Migration

- **R40.** The OAuth chat-send code at `kick-chat.ts:597-721` (the `try { const response = await fetch("https://api.kick.com/public/v1/chat", …) }` block) SHALL be deleted, not commented out. The IIFE-based send replaces it.
- **R41.** The doc row in `docs/api/kick/authentication.md:31` claiming `chat:write` is "currently unused — chat sending goes through internal POST /api/v2/messages/send/{chatroomId}" SHALL be replaced with a row that accurately reflects the new state: `chat:write` is no longer requested, and chat send is implemented via the page-context v2 path described in this spec.
- **R42.** Dropping `chat:write` from the requested-scope set SHALL NOT trigger a re-authentication flow for existing signed-in users. Existing OAuth tokens that include `chat:write` are not invalidated by removing the scope from our request — Kick's OAuth server does not revoke tokens server-side when the client stops requesting a scope. The scope simply becomes unused on the next refresh.
- **R43.** The explicit logout path in `auth-handlers.ts` that calls `clearKickSessionCookies()` SHALL also call `disposeSendWindow()` and explicitly null the bearer cache. This collapses the user's two Kick sub-credentials (OAuth tokens and kick.com web session) into a single visible "Disconnect Kick" action — they're conceptually one connection.

### Testing

- **R44.** A unit test SHALL cover the result-classification logic for each tagged-union variant in R23 — status 200/201, 401, 403 with auth-failure body, 403 with banned body, 419, 429 (with and without Retry-After), 5xx, status: 0. The IIFE source SHALL itself be testable as a string template; the `executeJavaScript` call SHALL be mocked.
- **R45.** A unit test SHALL cover bearer capture: the `webRequest.onBeforeSendHeaders` handler SHALL update the cache when given a request whose `Authorization` matches `^Bearer \d+\|[A-Za-z0-9]+$`, ignore non-matching values (e.g. `Bearer eyJhbGc...` JWT-shaped tokens), and never mutate `details.requestHeaders`.
- **R46.** A unit test SHALL cover single-flight warmup behavior: two concurrent `sendKickChatMessage` calls issued during warmup SHALL share one warmup invocation; a third call issued after warmup completes SHALL not re-run it.
- **R47.** A unit test SHALL cover render-process-gone behavior: a pending send SHALL reject with the R31 shape; the bearer cache SHALL be cleared; the next send SHALL re-spawn and re-capture.
- **R48.** Manual verification (gated on the user being signed into Kick in dev): launch dev build, open `/stream/kick/anonsociety`, send a chat message, confirm the message appears in the kick.com chat for another viewer of the channel (a second browser tab on kick.com works). The local-echo render SHALL also be observed but is NOT the success criterion — the success criterion is third-party visibility on kick.com.
- **R49.** Manual verification: with a Kick token that has been revoked (or after manually clearing `kick_session` and `XSRF-TOKEN` cookies in the default Electron session), send a message and confirm the result surfaces as the auth-expired user-facing message from R25 rather than a silent failure.

### No regressions

- **R50.** Receive-only chat (the Pusher subscription, message rendering, emote loading, badge rendering, pinned messages, polls, room-state) SHALL be unaffected by this change. The Pusher path is untouched.
- **R51.** Mod-mutation endpoints (`kick-mod-mutations.ts`) SHALL be unaffected. They currently use the OAuth Bearer path against `kick.com/api/v2/*` and either continue to work or are out of scope for this spec.
- **R52.** Follow-import (`follow-endpoints.ts`) SHALL be unaffected. Its BrowserWindow lifecycle is independent and its mutex usage is unchanged.

---

## Out of Scope

- The white-username + missing-broadcaster-badge defect in the optimistic local echo (`kick-chat.ts:711` falls back to `"#FFFFFF"` because `ChatInput` does not pass `sender.color` and `KickUser` does not carry a color field — Kick's `GET /public/v1/users` does not return one). The right fix is to fetch `/api/v2/channels/{slug}/me` on channel join and source the optimistic echo's color + badges from that response (this is exactly what kick.com web does). It is a separate caller-side cleanup that does not block the broadcast fix and SHALL be addressed in its own spec.
- Switching mod-mutation calls (`kick-mod-mutations.ts`) to the page-context path. Mod actions may or may not need this switch; investigate separately if reports come in that bans/timeouts silently no-op for un-verified-app users.
- Applying for Kick OAuth app verification with `developers@kick.com`. That is an organizational action with an indefinite turnaround and is not blocking this code change. If verification is granted later, a separate spec can evaluate switching back to `/public/v1/chat` for its simpler request path.
- A persistent BrowserWindow pool for other Kick page-context operations (channel resolve, follow-list, history fetch). Each of those uses its own spawn-per-call BW today and has different latency requirements. Consolidating into a shared persistent pool is a larger refactor outside this spec.
- Kasada-token or Sanctum-bearer proactive refresh, periodic page reload, or any session-keepalive ping. R25's reactive-on-auth-failure reload is the only refresh mechanism, and R9's capture-on-every-outgoing-request handles rotation transparently.
- Decrypting the localStorage-stored bearer (`BnKK836sP5WVpbRY`) ourselves. The encryption is a private kick.com app concern and can change at any release; bearer capture via webRequest is impl-stable.

---

## Files Expected to Change

- `apps/desktop/src/backend/api/platforms/kick/kick-send-window.ts` — **new**. Owns the persistent send BrowserWindow, the `webRequest.onBeforeSendHeaders` bearer interceptor, and the bearer cache. Exposes `ensureSendWindowReady`, `sendKickChatMessage`, `disposeSendWindow`. Implements R6-R39.
- `apps/desktop/src/backend/services/chat/kick-chat.ts` — delete the `/public/v1/chat` `fetch` block at lines 597-721, replace with a call to `sendKickChatMessage`. Wire `ensureSendWindowReady` into `joinChannel`. Wire `disposeSendWindow` into `leaveChannel` ref-count-zero and `forceShutdown`. Remove `accessToken` field and `KickChatOptions.accessToken`. Replace the `broadcasterUserId` guard with a `chatroomId` guard. R36-R39.
- `apps/desktop/src/backend/auth/oauth-config.ts` — remove `chat:write` from `KICK_OAUTH_CONFIG.scopes`. R5.
- `apps/desktop/src/backend/ipc/handlers/auth-handlers.ts` — extend the explicit logout path that calls `clearKickSessionCookies()` to also call `disposeSendWindow()`. R43.
- `apps/desktop/tests/backend/auth/oauth-config.test.ts` — update the scope-set assertion to no longer require `chat:write`. R5.
- `apps/desktop/tests/backend/api/platforms/kick/kick-send-window.test.ts` — **new**. Covers R44-R47. Mocks `BrowserWindow`, `executeJavaScript`, and `session.webRequest.onBeforeSendHeaders`.
- `apps/desktop/tests/backend/services/chat/kick-chat.test.ts` — update existing send-path tests to mock `sendKickChatMessage` instead of `fetch`.
- `docs/api/kick/authentication.md` — update the `chat:write` row per R41.
- Any caller passing `accessToken` to `kickChatService.connect()` — find via grep, drop the argument. R37.
