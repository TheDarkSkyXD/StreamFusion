---
date: 2026-05-29
topic: kick-chat-send-via-v2-broadcast
---

# Kick Chat Send — Switch to v2 page-context endpoint so messages actually broadcast

## Summary

The current Kick chat-send path posts to `https://api.kick.com/public/v1/chat` (`apps/desktop/src/backend/services/chat/kick-chat.ts:634`). That endpoint accepts our OAuth Bearer token, returns `200 { is_sent: true, message_id }`, and **does not broadcast the message to other viewers** unless the OAuth app has been verified by Kick (i.e., Kick has whitelisted our developer account after manual review at `developers@kick.com`). For un-verified apps — which is our current state — every send silently no-ops on Kick's side; the user sees only their own optimistic local echo and no other viewer in the channel ever receives the message. The symptom was reproduced live on 2026-05-29 against `kick.com/anonsociety`.

This spec replaces the OAuth send path with the same path Kick's own web client, `kick-js`, and `KickTalk` all use: `POST https://kick.com/api/v2/messages/send/{chatroomId}` from inside a kick.com page-context fetch in a hidden `BrowserWindow`, with `credentials: 'include'` + `X-XSRF-TOKEN` + `X-Requested-With: XMLHttpRequest`. The window is a single, app-global, ref-counted hidden BrowserWindow loaded on `https://kick.com/`, spawned on the first `joinChannel` and destroyed when the last Kick chat is left. The `/public/v1/chat` path and its `chat:write` OAuth scope handling are removed in the same change — no fallback.

---

## Problem Frame

Two architecturally disjoint auth surfaces exist on Kick (documented at `docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md`):

1. **OAuth `api.kick.com/public/v1/*`** — Bearer token from `id.kick.com`. Documented at `docs.kick.com`. Used for `chat:write`, but the chat-send endpoint on this surface is gated behind app verification and silently drops un-verified sends.
2. **SPA `kick.com/api/v2/*`** — Laravel session cookies + Kasada bot-detection tokens. Validated by the kick.com apex. This is what kick.com itself uses for chat send (`POST /api/v2/messages/send/{chatroomId}`).

The kick.com session cookies are already present in the default Electron session after the user completes the Kick OAuth flow (the SSO bridge from `id.kick.com` to `kick.com` deposits `kick_session` and `XSRF-TOKEN` on first kick.com navigation). The follow-import path at `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts:247` already exercises this — it opens a hidden BrowserWindow in the default session, warm-visits `kick.com/`, and runs page-context `executeJavaScript`. Live testing on 2026-05-22 confirmed direct main-process `fetch` to `kick.com/api/v2/*` fails with 401 even with full cookies + XSRF + `X-Requested-With` headers: Kasada injects runtime state into kick.com pages that we cannot replicate from main. The fetch MUST originate from inside a kick.com page context.

Existing infrastructure that this spec piggybacks on:

- `acquireBrowserWindowSlot()` (`channel-endpoints.ts:249`) — global FIFO mutex serialising all hidden BrowserWindow spawns to one renderer at a time (GPU pressure guard).
- `waitForWebContentsCondition` (`services/web-contents-ready.ts`) — page-readiness polling with a timeout.
- `KickChatService.acquire()`/`release()` ref counting (`kick-chat.ts:367`) — already tracks how many UI components are using the service.

What does NOT yet exist and is in scope here:

- A persistent send-BrowserWindow that lives beyond a single page-context call (the follow-endpoints pattern is spawn-per-call).
- A page-context `fetch` helper that returns the v2 send result back to the main process.
- Removal of the OAuth `/public/v1/chat` send path and its `chat:write` scope advertising.

---

## Requirements

### Endpoint and auth surface

- **R1.** `KickChatService.sendMessage` SHALL stop calling `POST https://api.kick.com/public/v1/chat`. The OAuth Bearer send path SHALL be removed entirely; no fallback, no feature flag.
- **R2.** Chat sends SHALL be issued as `POST https://kick.com/api/v2/messages/send/{chatroomId}` from inside a kick.com page-context `fetch` call running in a hidden `BrowserWindow`.
- **R3.** The request body SHALL be `{"content": "<text>", "type": "message"}`, matching the shape Kick's own web SPA uses.
- **R4.** The request SHALL include `credentials: 'include'`, `Content-Type: application/json`, `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, and `X-XSRF-TOKEN: <decodeURIComponent(XSRF-TOKEN cookie)>`. No `Authorization` header.
- **R5.** The `chat:write` OAuth scope SHALL be removed from `KICK_OAUTH_CONFIG.scopes`. The scope test in `apps/desktop/tests/backend/auth/oauth-config.test.ts` SHALL be updated to assert absence. `docs/api/kick/authentication.md` SHALL be updated to drop the `chat:write` row.

### BrowserWindow scope, lifecycle, and isolation

- **R6.** A single application-global hidden `BrowserWindow` ("the send window") SHALL serve every Kick chat the user is in. There SHALL NOT be one BrowserWindow per channel.
- **R7.** The send window SHALL be created in the **default Electron session** (no `partition` override), matching the follow-endpoints precedent so it inherits the OAuth window's `kick.com` apex cookies.
- **R8.** The send window SHALL load `https://kick.com/` (apex homepage). The window SHALL NOT navigate per-channel; the v2 endpoint carries the `chatroomId` in the URL path and the page origin is sufficient for Kasada token validity.
- **R9.** The send window SHALL be spawned lazily on the first `KickChatService.joinChannel` call after the service is acquired. The spawn SHALL be single-flight: concurrent `joinChannel`s share one warmup promise.
- **R10.** The send window SHALL be destroyed when the last active Kick chat is left (`KickChatService.leaveChannel` brings active channel count to zero) OR when the service is force-shutdown (`forceShutdown()`).
- **R11.** Spawn SHALL acquire `acquireBrowserWindowSlot()` for the duration of `new BrowserWindow(...)` + `loadURL(...)` + readiness wait, then release the slot. The window itself SHALL live independently of the slot mutex so subsequent send operations do not contend with follow-sync or channel-resolve calls.
- **R12.** The send window SHALL be hidden (`show: false`) and SHALL NOT be focusable or visible in the OS window list. The `width`/`height` SHALL be `800`/`600`, matching the follow-endpoints precedent — Electron's renderer needs realistic dimensions for some SPA layout code paths, and a 1×1 window has caused render-process exits in adjacent precedents.

### Page-context send protocol

- **R13.** A helper module `apps/desktop/src/backend/api/platforms/kick/kick-send-window.ts` SHALL own the send window. It SHALL export at minimum:
  - `ensureSendWindowReady(): Promise<void>` — idempotent spawn + warmup, single-flight.
  - `sendKickChatMessage(chatroomId: number, content: string): Promise<KickSendResult>` — issues one page-context send.
  - `disposeSendWindow(): Promise<void>` — tears down the window, used by `leaveChannel` ref-count-zero and `forceShutdown`.
- **R14.** `ensureSendWindowReady` SHALL wait via `waitForWebContentsCondition` for a boolean-returning IIFE predicate equivalent to `(() => document.cookie.indexOf('XSRF-TOKEN=') >= 0)()`. The boolean-IIFE shape matches the existing `GRID_READY_PREDICATE` precedent at `follow-endpoints.ts:42`. If the predicate has not resolved within 10 seconds of `loadURL` completing, the warmup SHALL reject with an error message containing the substring `"send-window-warmup-timeout"`.
- **R15.** Each `sendKickChatMessage` call SHALL run `win.webContents.executeJavaScript(<IIFE>)` where the IIFE:
  - reads `XSRF-TOKEN` from `document.cookie` via a regex and `decodeURIComponent`s it,
  - issues the `POST /api/v2/messages/send/${chatroomId}` fetch with the headers and body specified in R3-R4,
  - returns `JSON.stringify({ ok: response.ok, status: response.status, body: await response.text(), retryAfter: response.headers.get('Retry-After') })`,
  - wraps the entire body in `try/catch` and on catch returns `JSON.stringify({ ok: false, status: 0, body: String(err), retryAfter: null })`. The IIFE SHALL NOT throw out of the executeJavaScript boundary.
- **R16.** The IIFE SHALL be a self-contained string built via `JSON.stringify` on `chatroomId` and `content` to interpolate into the source — no template literals that could leak quote-injection from message content into the IIFE source.
- **R17.** The main-process side of `sendKickChatMessage` SHALL `JSON.parse` the returned string and classify the result per R20-R24 below.

### Result classification

- **R18.** `KickSendResult` SHALL be a tagged union: `{ ok: true; messageId: string | undefined }` or `{ ok: false; kind: "auth-expired" | "rate-limited" | "forbidden" | "network" | "unknown"; message: string; retryAfterSeconds?: number }`.
- **R19.** `200`-class responses SHALL produce `{ ok: true, messageId }` where `messageId` is sourced from `body.data.id` (or `body.data.message_id`) when present, undefined otherwise.
- **R20.** `401` or `419` responses SHALL trigger ONE reload of the send window page (`win.loadURL('https://kick.com/')` + re-await the readiness predicate) and ONE retry of the same send. The reload SHALL be single-flight: if two concurrent sends both 401 in the same window, only one reload runs and both retries share its result. If the retry also returns 401/419, the result SHALL be `{ ok: false, kind: "auth-expired", message: "Kick session expired — reconnect Kick in Settings." }`. The retry SHALL NOT recurse — a 401 on the retry surfaces directly without a second reload.
- **R21.** `429` responses SHALL produce `{ ok: false, kind: "rate-limited", message: "Slow down — Kick rate limit.", retryAfterSeconds }` where `retryAfterSeconds` is `parseInt(retryAfter, 10)` from the IIFE's `retryAfter` field (R15) if numeric, undefined otherwise.
- **R22.** `403` responses SHALL produce `{ ok: false, kind: "forbidden", message: "You are banned or timed out in this channel." }`.
- **R23.** `status: 0` (IIFE catch path) SHALL produce `{ ok: false, kind: "network", message: "Network error sending message, please try again." }`.
- **R24.** Any other non-2xx status SHALL produce `{ ok: false, kind: "unknown", message: \`Send failed (\${status}).\` }`.

### Crash recovery and refresh

- **R25.** The send window SHALL bind `webContents.on('render-process-gone', ...)` and on any non-clean exit mark itself as invalidated. The next `sendKickChatMessage` after invalidation SHALL re-run the full spawn + warmup path.
- **R26.** Any `sendKickChatMessage` promise pending at the moment of a render-process-gone event SHALL reject with `{ ok: false, kind: "network", message: "Send window crashed, please try again." }`.
- **R27.** No proactive Kasada-token refresh timer SHALL be implemented. The R20 reactive reload path is the only refresh mechanism.

### Single-flight warmup queueing

- **R28.** Multiple `sendKickChatMessage` calls issued while the warmup promise is still pending SHALL share that single promise; only one warmup runs at a time.
- **R29.** The chat input UI SHALL NOT be disabled during warmup. A message typed and submitted during warmup SHALL be sent as soon as warmup resolves; the user-visible delay on a fast send is the warmup latency (typical 1-3s when warmup began at `joinChannel`).
- **R30.** If warmup has not resolved within 10s, all sends awaiting the warmup promise SHALL reject with `{ ok: false, kind: "network", message: "Send window failed to initialize." }` (R14 already enforces the 10s warmup deadline; this requirement specifies how that surfaces to pending sends).

### Integration with KickChatService

- **R31.** `KickChatService.sendMessage` SHALL keep its current signature (`channel`, `message`, optional `sender`) and SHALL keep its current rate-limit guard, `broadcasterUserId` presence guard, and optimistic-local-echo emission. Only the HTTP layer changes.
- **R32.** The `accessToken` field on `KickChatService` and the `accessToken` option on `connect()` SHALL be removed. Send no longer needs the OAuth token; the kick.com session cookies inside the BW carry auth. Tests that set `accessToken` SHALL be updated.
- **R33.** When `joinChannel` is called, the service SHALL call `ensureSendWindowReady()` (no `await`) to begin warmup in parallel with the Pusher subscription. The promise SHALL be retained on the service so `sendMessage` can `await` it before each send.
- **R34.** When `leaveChannel` brings the active channel count to zero, the service SHALL call `disposeSendWindow()`. `forceShutdown()` SHALL also call `disposeSendWindow()`.

### Migration

- **R35.** The OAuth chat-send code at `kick-chat.ts:597-721` (the `try { const response = await fetch("https://api.kick.com/public/v1/chat", …) }` block) SHALL be deleted, not commented out. The IIFE-based send replaces it.
- **R36.** The doc row in `docs/api/kick/authentication.md:31` claiming `chat:write` is "currently unused — chat sending goes through internal POST /api/v2/messages/send/{chatroomId}" SHALL be replaced with a row that accurately reflects the new state: `chat:write` is no longer requested, and chat send is implemented via the page-context v2 path described in this spec.
- **R37.** Dropping `chat:write` from the requested-scope set SHALL NOT trigger a re-authentication flow for existing signed-in users. Existing OAuth tokens that include `chat:write` are not invalidated by removing the scope from our request — Kick's OAuth server does not revoke tokens server-side when the client stops requesting a scope. The scope simply becomes unused on the next refresh.

### Testing

- **R38.** A unit test SHALL cover the result-classification logic for each tagged-union variant in R18 — status 200/201, 401, 419, 429 (with and without Retry-After), 403, 5xx, status: 0. The IIFE source SHALL itself be testable as a string template; the `executeJavaScript` call SHALL be mocked.
- **R39.** A unit test SHALL cover single-flight warmup behavior: two concurrent `sendKickChatMessage` calls issued during warmup SHALL share one warmup invocation; a third call issued after warmup completes SHALL not re-run it.
- **R40.** A unit test SHALL cover render-process-gone behavior: a pending send SHALL reject with the R26 shape; the next send SHALL re-spawn.
- **R41.** Manual verification (gated on the user being signed into Kick in dev): launch dev build, open `/stream/kick/anonsociety`, send a chat message, confirm the message appears in the kick.com chat for another viewer of the channel (a second browser tab on kick.com works). The local-echo render SHALL also be observed but is NOT the success criterion — the success criterion is third-party visibility on kick.com.
- **R42.** Manual verification: with a Kick token that has been revoked (or after manually clearing `kick_session` and `XSRF-TOKEN` cookies in the default Electron session), send a message and confirm the result surfaces as the auth-expired user-facing message from R20 rather than a silent failure.

### No regressions

- **R43.** Receive-only chat (the Pusher subscription, message rendering, emote loading, badge rendering, pinned messages, polls, room-state) SHALL be unaffected by this change. The Pusher path is untouched.
- **R44.** Mod-mutation endpoints (`kick-mod-mutations.ts`) SHALL be unaffected. They currently use the OAuth Bearer path against `kick.com/api/v2/*` and either continue to work or are out of scope for this spec.
- **R45.** Follow-import (`follow-endpoints.ts`) SHALL be unaffected. Its BrowserWindow lifecycle is independent and its mutex usage is unchanged.

---

## Out of Scope

- The white-username + missing-broadcaster-badge defect in the optimistic local echo (`kick-chat.ts:711` falls back to `"#FFFFFF"` because `ChatInput` does not pass `sender.color` and `sender.id`). This is a separate caller-side bug tracked in Task #9 of the brainstorm conversation and SHALL be addressed in its own spec.
- Switching mod-mutation calls (`kick-mod-mutations.ts`) to the page-context path. Mod actions may or may not need this switch; investigate separately if reports come in that bans/timeouts silently no-op for un-verified-app users.
- Applying for Kick OAuth app verification with `developers@kick.com`. That is an organizational action with an indefinite turnaround and is not blocking this code change. If verification is granted later, a separate spec can evaluate switching back to `/public/v1/chat` for its simpler request path.
- A persistent BrowserWindow pool for other Kick page-context operations (channel resolve, follow-list, history fetch). Each of those uses its own spawn-per-call BW today and has different latency requirements. Consolidating into a shared persistent pool is a larger refactor outside this spec.
- Kasada-token proactive refresh, periodic page reload, or any session-keepalive ping. R20's reactive-on-401/419 reload is the only refresh mechanism.

---

## Files Expected to Change

- `apps/desktop/src/backend/api/platforms/kick/kick-send-window.ts` — **new**. Owns the persistent send BrowserWindow, exposes `ensureSendWindowReady`, `sendKickChatMessage`, `disposeSendWindow`. Implements R6-R34.
- `apps/desktop/src/backend/services/chat/kick-chat.ts` — delete the `/public/v1/chat` `fetch` block at lines 597-721, replace with a call to `sendKickChatMessage`. Wire `ensureSendWindowReady` into `joinChannel`. Wire `disposeSendWindow` into `leaveChannel` ref-count-zero and `forceShutdown`. Remove `accessToken` field and `KickChatOptions.accessToken`. R31-R34.
- `apps/desktop/src/backend/auth/oauth-config.ts` — remove `chat:write` from `KICK_OAUTH_CONFIG.scopes`. R5.
- `apps/desktop/tests/backend/auth/oauth-config.test.ts` — update the scope-set assertion to no longer require `chat:write`. R5.
- `apps/desktop/tests/backend/api/platforms/kick/kick-send-window.test.ts` — **new**. Covers R38-R40. Mocks `BrowserWindow` and `executeJavaScript`.
- `apps/desktop/tests/backend/services/chat/kick-chat.test.ts` — update existing send-path tests to mock `sendKickChatMessage` instead of `fetch`.
- `docs/api/kick/authentication.md` — update the `chat:write` row per R36.
- Any caller passing `accessToken` to `kickChatService.connect()` — find via grep, drop the argument. R32.
