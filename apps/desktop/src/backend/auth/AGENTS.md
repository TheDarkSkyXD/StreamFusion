# Auth Module

OAuth 2.1 authentication system for Kick and Twitch. Handles the full lifecycle: browser-window flow, PKCE code exchange via a Cloudflare Worker proxy, token storage, refresh, and revocation.

## File Inventory

| File | Role |
|---|---|
| `oauth-config.ts` | Platform configs (endpoints, scopes), PKCE helpers (`generatePkceChallenge`), URL builder, `PROTOCOL_SCHEME` constant |
| `auth-window.ts` | Electron `BrowserWindow` manager for OAuth popups; Kick-specific two-phase load (kick.com sign-in → id.kick.com OAuth) |
| `oauth-callback-server.ts` | Ephemeral `http.createServer` on `localhost:8765` that captures `?code=&state=` from the redirect; serves a branded success/error page |
| `token-exchange.ts` | Posts code + PKCE verifier to the Worker; posts refresh token to Worker; revokes directly; validates via `/oauth2/validate` or `/token/introspect` |
| `kick-auth.ts` | `KickAuthService` — refresh with single-flight dedup, proactive `ensureValidToken`, logout (clears cookies + storage), `fetchCurrentUser` |
| `twitch-auth.ts` | `TwitchAuthService` — single-flight refresh guard, proactive timer (`scheduleProactiveRefresh`), exponential backoff on transient failures, `onSystemResume` re-arm |
| `device-code-flow.ts` | Twitch Device Code Grant (TV-style): request device code → poll `/oauth2/token` with managed interval until authorized or expired |
| `protocol-handler.ts` | Registers `streamfusion://` with the OS; parses `streamfusion://auth/{platform}/callback?code=…`; fallback / future use only |
| `index.ts` | Barrel re-export of every public type and singleton |

## Auth Flows

### Twitch — Authorization Code + PKCE (primary)

```
authWindowManager.openAuthWindow("twitch")
  → generates PKCE pair + state, stores in AuthSession
  → BrowserWindow loads id.twitch.tv/oauth2/authorize?…&code_challenge=…
  → user authenticates in popup

oauthCallbackServer.waitForCallback("twitch", expectedState)
  → localhost:8765 receives GET /auth/twitch/callback?code=&state=
  → validates state (CSRF guard), serves branded success page, resolves with { code, state }

tokenExchangeService.exchangeCodeForToken({ code, redirectUri, pkce })
  → POST WORKER_BASE_URL/auth/twitch/token  { code, redirect_uri, code_verifier }
  → Worker appends client_secret and forwards to id.twitch.tv/oauth2/token
  → returns AuthToken { accessToken, refreshToken, expiresAt, scope }

twitchAuthService.scheduleProactiveRefresh()
  → fires 5 min before expiry; re-arms after each success; re-arms on system resume
```

### Twitch — Device Code Grant (alternative)

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

Both platforms route refresh through the Worker to avoid embedding client secrets in the Electron bundle.

```
tokenExchangeService.refreshToken({ platform, refreshToken })
  → POST WORKER_BASE_URL/auth/{platform}/refresh  { refresh_token }
  → Worker appends secret, calls platform refresh endpoint
```

**Single-flight guard** — both `kickAuthService.refreshToken()` and `twitchAuthService.refreshToken()` deduplicate concurrent callers to one in-flight promise. This prevents Kick's OAuth 2.1 refresh-token rotation from being triggered twice simultaneously.

**Twitch backoff** — transient refresh failures back off at 30s → 2m → 10m → 45m → 1h (repeating). Only `invalid_grant` / `invalid_request` / `invalid_client` / `unauthorized_client` or non-408/429 4xx cause `invalidateAuth()` (clears token; preserves TwitchUser for "Reconnect &lt;name&gt;" UX).

**Kick session expiry** — any refresh failure clears the token, Kick user, and all kick.com session cookies (except Cloudflare `cf_clearance` / `__cf_bm`), then emits `"session-expired"`.

## Contracts & Invariants

- **Client secrets never touch the renderer or Electron main.** `TWITCH_CLIENT_SECRET` and `KICK_CLIENT_SECRET` are empty strings in `oauth-config.ts`; the Worker holds them.
- **PKCE is mandatory for both platforms.** `generatePkceChallenge()` uses `crypto.randomBytes(32)` + SHA-256 S256; challenge is sent in the auth URL, verifier is sent at exchange time.
- **State is validated twice:** `oauthCallbackServer` validates against `expectedState`, and `authWindowManager.validateState` checks the in-memory `AuthSession` (10-minute TTL).
- **One `AuthSession` per platform at a time.** `openAuthWindow` calls `closeAuthWindow` first — stale sessions cannot accumulate.
- **Kick sandbox: false.** Kick's BrowserWindow runs without Chromium sandbox to allow Kasada bot-detection challenges to execute. Twitch stays sandboxed.
- **Cloudflare cookies are preserved on Kick logout.** `clearKickSessionCookies` skips `cf_clearance` and `__cf_bm` so the next visit doesn't re-trigger a WAF challenge.
- **Kick app tokens stay inside the Worker.** Desktop code must never fetch or store a Kick app token; official Kick public reads go through the Worker `/kick/*` proxy, which mints/caches the app token server-side and injects `Authorization`.
- **Twitch app tokens are minted through the Worker.** Desktop code must never hold client secrets; Twitch can use `tokenExchangeService.getAppAccessToken("twitch")` when a Worker app-token route exists.

## Patterns

**Opening auth and waiting for callback are separate operations.** `authWindowManager.openAuthWindow` (sync, opens window) is always paired with `oauthCallbackServer.waitForCallback` (async, returns code) in the IPC handler — the window and server run concurrently.

**Token storage lives in `storageService`, not here.** Auth services read/write tokens via `storageService.{get,save,clear}Token`; this module never accesses the file system directly.

**`TokenRefreshError` is the error boundary.** `token-exchange.ts` throws `TokenRefreshError(message, httpStatus, oauthCode)` on refresh failure. Callers use `.isPermanent()` to decide between backoff-retry and session invalidation.

**Protocol handler is a fallback.** `protocolHandler` registers `streamfusion://` but the primary path is `localhost:8765`. The protocol handler exists for cases where localhost is blocked or for future deep-link support.

## Anti-Patterns

- **Do not mint app tokens in Electron.** For Kick, do not fetch app tokens into desktop at all; use the Worker-backed official API proxy. Never add client secrets to desktop config.
- **Do not start a second `oauthCallbackServer` while one is already waiting** — the server is a singleton and will conflict on the port.
- **Do not call `kickAuthService.refreshToken` from multiple concurrent code paths** — the single-flight guard handles it, but the design relies on callers using the service methods rather than calling `tokenExchangeService.refreshToken` directly.
- **Do not cache the access token string outside `storageService`** — proactive refresh rotates it at any time; always read from the service (`getAccessToken()` / `getValidAccessToken()`).

## Related Context

- `apps/worker/src/index.ts` — Cloudflare Worker that holds client secrets and proxies `/auth/{platform}/token` and `/auth/{platform}/refresh`.
- `backend/services/storage-service.ts` — persistent token and user storage (electron-store or similar).
- `backend/services/web-contents-ready.ts` — `waitForWebContentsCondition` used by the Kick two-phase flow.
- `shared/auth-types.ts` — `Platform`, `AuthToken`, `KickUser`, `TwitchUser` type definitions.
- `backend/api/platforms/kick/kick-types.ts` — `KICK_API_BASE` constant.
- `backend/api/platforms/twitch/twitch-types.ts` — `TWITCH_API_BASE`, `TwitchApiUser`.
