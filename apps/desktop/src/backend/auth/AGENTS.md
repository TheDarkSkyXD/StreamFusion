# Auth Module

OAuth 2.1 authentication system for Kick and Twitch. Kick uses a browser-window PKCE flow through the Cloudflare Worker; Twitch uses the direct public-client Device Code Grant. The module also handles token storage, refresh, and revocation.

## File Inventory

| File                       | Role                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth-config.ts`          | Platform configs (endpoints, scopes), PKCE helpers (`generatePkceChallenge`), URL builder, `PROTOCOL_SCHEME` constant                                               |
| `auth-window.ts`           | Electron `BrowserWindow` manager for OAuth popups; Kick-specific two-phase load (kick.com sign-in → id.kick.com OAuth)                                              |
| `oauth-callback-server.ts` | Ephemeral `http.createServer` on `localhost:8765` that captures `?code=&state=` from the redirect; serves a branded success/error page                              |
| `token-exchange.ts`        | Posts Kick code + PKCE verifier and refresh token to the Worker; refreshes Twitch directly as a public client; revokes and validates directly                       |
| `kick-auth.ts`             | `KickAuthService` — single-flight refresh, proactive startup/resume rotation, transient backoff, explicit logout, `fetchCurrentUser`                                |
| `twitch-auth.ts`           | `TwitchAuthService` — single-flight refresh guard, proactive timer (`scheduleProactiveRefresh`), exponential backoff on transient failures, `onSystemResume` re-arm |
| `device-code-flow.ts`      | Twitch Device Code Grant (TV-style): request device code → poll `/oauth2/token` with managed interval until authorized or expired                                   |
| `protocol-handler.ts`      | Registers `streamfusion://` with the OS; parses `streamfusion://auth/{platform}/callback?code=…`; fallback / future use only                                        |
| `index.ts`                 | Barrel re-export of every public type and singleton                                                                                                                 |

## Auth Flows

### Twitch — Device Code Grant (primary)

```
deviceCodeFlowService.requestDeviceCode(scopes)
  → POST https://id.twitch.tv/oauth2/device
  → returns { userCode, verificationUri, deviceCode, interval, expiresIn }

[user visits twitch.tv/activate on any device and enters userCode]

deviceCodeFlowService.pollForToken(deviceCode, interval, expiresIn)
  → polls id.twitch.tv/oauth2/token every `interval` seconds
  → handles authorization_pending (keep polling), slow_down (+5s), access_denied, expired_token
  → resolves with AuthToken on success
```

### Kick — Two-Phase Authorization Code + PKCE

Kick's followed-channels API (`/api/v2/channels/followed`) requires an active `kick_session` web cookie alongside the Bearer token. A Bearer token alone returns `{"message":"Unauthenticated."}`.

```
Phase 1 — kick.com web sign-in
  authWindowManager.openAuthWindow("kick")
  → BrowserWindow loads https://kick.com/
  → waitForWebContentsCondition: waits for header to render (avatar or Sign In button)
  → _isKickWebAuthenticated: inspects DOM — if already signed in, skip to Phase 2
  → otherwise: auto-clicks Sign In button via executeJavaScript
  → _waitForKickWebAuth: polls session.defaultSession.cookies for kick.com every 1.5s
    - captures baseline session_token on poll #2
    - detects login when session_token OR kick_session rotates (Laravel session regeneration)
    - timeout: 5 minutes

Phase 2 — id.kick.com OAuth handshake
  → window.loadURL(authUrl)  [authUrl = https://id.kick.com/oauth/authorize?…]
  → oauthCallbackServer.waitForCallback("kick", expectedState)
  → tokenExchangeService.exchangeCodeForToken → WORKER_BASE_URL/auth/kick/token
```

### Token Refresh

Kick refreshes through the Worker. Twitch refreshes directly against Twitch's token endpoint as a public client using only its client ID.

```
tokenExchangeService.refreshToken({ platform, refreshToken })
  → Kick: POST WORKER_BASE_URL/auth/kick/refresh { refresh_token }
  → Twitch: POST https://id.twitch.tv/oauth2/token with client_id, refresh_token, and grant_type
```

**Single-flight guard** — both `kickAuthService.refreshToken()` and `twitchAuthService.refreshToken()` deduplicate concurrent callers to one in-flight promise. This prevents Kick's OAuth 2.1 refresh-token rotation from being triggered twice simultaneously.

**Twitch backoff** — transient refresh failures back off at 30s → 2m → 10m → 45m → 1h (repeating). Only `invalid_grant` / `invalid_request` / `invalid_client` / `unauthorized_client` or non-408/429 4xx cause `invalidateAuth()` (clears token; preserves TwitchUser for "Reconnect &lt;name&gt;" UX).

**Kick rotation and backoff** — the backend refreshes before access-token expiry, re-arms on system resume, and retries transient failures at 30s → 2m → 10m → 45m → 1h (repeating). A confirmed permanent OAuth rejection clears only the OAuth envelope and emits `"session-expired"`; it preserves the Kick identity, website cookies, and encrypted website bearer. Only explicit logout clears both OAuth and website chat authentication.

## Contracts & Invariants

- **Client secrets never touch the renderer or Electron main.** Twitch Device Code Grant does not require a secret; the Worker holds Kick's secret.
- **PKCE is mandatory for Kick.** `generatePkceChallenge()` uses `crypto.randomBytes(32)` + SHA-256 S256; the challenge is sent in the auth URL and the verifier at exchange time.
- **State is validated twice:** `oauthCallbackServer` validates against `expectedState`, and `authWindowManager.validateState` checks the in-memory `AuthSession` (10-minute TTL).
- **One `AuthSession` per platform at a time.** `openAuthWindow` calls `closeAuthWindow` first — stale sessions cannot accumulate.
- **Kick sandbox: false.** Kick's BrowserWindow runs without Chromium sandbox to allow Kasada bot-detection challenges to execute. Twitch stays sandboxed.
- **Cloudflare cookies are preserved on Kick logout.** `clearKickSessionCookies` skips `cf_clearance` and `__cf_bm` so the next visit doesn't re-trigger a WAF challenge.
- **Kick OAuth and website chat auth are separate credential families.** Refresh failure may invalidate OAuth, but must not close the website chat sender or erase its cookies/bearer. Explicit logout clears both families.
- **Kick official API reads are direct and user-authenticated.** The main process sends the current user bearer to `api.kick.com`. Signed-out reads use named legacy/private fallbacks or return no data.
- **Twitch user authentication is direct and public-client safe.** Device Code Grant and refresh call Twitch directly with the client ID and never use a Worker auth endpoint or client secret.
- **Raw Twitch tokens remain in main except for IRC/Hermes.** The guarded `AUTH_GET_VALID_TWITCH_TOKEN` bridge exists only because those chat sockets are renderer-owned. Helix, EventSub, emotes, moderation, and account features must use main-owned capabilities and metadata responses.

## Patterns

**Kick opening auth and waiting for its callback are separate operations.** `authWindowManager.openAuthWindow` (sync, opens window) is paired with `oauthCallbackServer.waitForCallback` (async, returns code) in the Kick IPC flow. Twitch login uses Device Code Grant instead.

**Token storage lives in `storageService`, not here.** Auth services read/write tokens via `storageService.{get,save,clear}Token`; this module never accesses the file system directly.

**`TokenRefreshError` is the error boundary.** `token-exchange.ts` throws `TokenRefreshError(message, httpStatus, oauthCode)` on refresh failure. Callers use `.isPermanent()` to decide between backoff-retry and session invalidation.

**Protocol handler is a fallback.** `protocolHandler` registers `streamfusion://` but the primary path is `localhost:8765`. The protocol handler exists for cases where localhost is blocked or for future deep-link support.

## Anti-Patterns

- **Do not mint Kick app tokens.** The Worker is only for user-token exchange and refresh. Never add the Kick client secret or a client-credentials flow to the desktop.
- **Do not start a second `oauthCallbackServer` while one is already waiting** — the server is a singleton and will conflict on the port.
- **Do not call `kickAuthService.refreshToken` from multiple concurrent code paths** — the single-flight guard handles it, but the design relies on callers using the service methods rather than calling `tokenExchangeService.refreshToken` directly.
- **Do not cache the access token string outside `storageService`** — proactive refresh rotates it at any time; always read from the service (`getAccessToken()` / `getValidAccessToken()`).

## Related Context

- `apps/worker/src/index.ts` — Cloudflare Worker that holds Kick secrets and proxies Kick token exchange and refresh.
- `backend/services/storage-service.ts` — persistent token and user storage (electron-store or similar).
- `backend/services/web-contents-ready.ts` — `waitForWebContentsCondition` used by the Kick two-phase flow.
- `shared/auth-types.ts` — `Platform`, `AuthToken`, `KickUser`, `TwitchUser` type definitions.
- `backend/api/platforms/kick/kick-types.ts` — `KICK_API_BASE` constant.
- `backend/api/platforms/twitch/twitch-types.ts` — `TWITCH_API_BASE`, `TwitchApiUser`.
