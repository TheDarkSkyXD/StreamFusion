# Kick OAuth Worker contract and desktop blast radius

This reference records the contract at commit `5381886`. It covers the Cloudflare Worker, the Electron main-process callers, token lifecycle, tests, configuration, and migration dependencies.

The Worker has one product responsibility. It adds the confidential Kick client credentials to authorization-code exchange and refresh requests. It also validates requests and limits abuse. The Worker does not store tokens or proxy Kick product APIs.

## Runtime flow

```text
Renderer login action
  -> electronAPI.auth.openKickLogin
  -> AUTH_OPEN_KICK IPC handler
  -> loopback callback listener on localhost:8765..8864
  -> one BrowserWindow for kick.com sign-in and id.kick.com authorization
  -> callback code and state
  -> desktop POST /auth/kick/token with code, redirect_uri, and code_verifier
  -> hosted service adds KICK_CLIENT_ID and KICK_CLIENT_SECRET
  -> hosted service POST https://id.kick.com/oauth/token
  -> desktop stores access and refresh tokens

Proactive or on-demand refresh
  -> KickAuthService single-flight refresh
  -> desktop POST /auth/kick/refresh with refresh_token
  -> hosted service adds KICK_CLIENT_ID and KICK_CLIENT_SECRET
  -> hosted service POST https://id.kick.com/oauth/token
  -> desktop replaces the rotated token envelope
```

The renderer starts login through the allowlisted preload bridge. The Electron main process owns the popup, callback listener, PKCE verifier, state, token requests, and token storage.

## Worker HTTP contract

[The Worker entry point](../../../apps/worker/src/index.ts) exposes two routes.

### `POST /auth/kick/token`

The desktop sends JSON with these fields:

| Field | Validation |
| --- | --- |
| `code` | Non-empty string, at most 4,096 characters |
| `redirect_uri` | HTTP URL on `localhost`, explicit port 8765 through 8864, exact path `/auth/kick/callback`, no credentials, query, or fragment, and at most 2,048 characters |
| `code_verifier` | RFC 7636 unreserved characters, 43 through 128 characters |

After validation and rate limiting, the Worker sends a form-encoded request to `https://id.kick.com/oauth/token`. The form contains `client_id`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri`, and `code_verifier`.

### `POST /auth/kick/refresh`

The desktop sends JSON with one `refresh_token`. The token must be a non-empty string with at most 8,192 characters.

After validation and rate limiting, the Worker sends a form-encoded request to the same Kick token endpoint. The form contains `client_id`, `client_secret`, `refresh_token`, and `grant_type=refresh_token`.

### Responses

The Worker returns Kick's parsed JSON response with Kick's HTTP status. The Worker does not validate or normalize a successful token response before it reaches the desktop.

The Worker creates these local errors:

| Condition | Status | JSON | Headers |
| --- | ---: | --- | --- |
| Invalid JSON or invalid fields | 400 | `{"error":"invalid_request"}` | `Cache-Control: no-store` |
| Rate limit denied | 429 | `{"error":"rate_limited"}` | `Retry-After: 60`, `Cache-Control: no-store` |
| Rate limiter missing or failed | 503 | `{"error":"rate_limit_unavailable"}` | `Cache-Control: no-store` |
| Upstream request, JSON parsing, or local handler throws | 500 | `{"error":"<message>"}` | No explicit cache policy |
| Unknown route or unsupported method | 404 | Plain text `Not Found` | Auth CORS headers |

The two auth routes answer `OPTIONS` without consuming rate-limit counters. Their CORS response permits every origin, the `POST` and `OPTIONS` methods, and the `Content-Type` header. The Electron main process does not need browser CORS permission, so the replacement contract can reconsider this behavior.

The Worker does not set an explicit upstream timeout. It also assumes that every Kick token response contains JSON.

## Abuse controls

[The Wrangler configuration](../../../apps/worker/wrangler.jsonc) defines two shared Cloudflare rate-limit bindings.

| Limit | Key | Budget |
| --- | --- | ---: |
| Source address | `kick-auth:ip:<CF-Connecting-IP>` | 30 requests per 60 seconds |
| OAuth subject | SHA-256 of the authorization code or refresh token | 6 requests per 60 seconds |

Both token operations share each budget. A request without `CF-Connecting-IP` uses the literal `missing` source key. The Worker checks the source-address budget before parsing JSON. It checks the subject budget only after input validation.

The Worker fails closed when either rate-limit binding is missing or throws. Subject keys never contain the authorization code or refresh token in plaintext.

The public endpoint does not authenticate the StreamFusion installation. A caller needs a valid authorization code or refresh token to obtain a token, but any caller can spend the shared rate-limit budgets.

## Secret and token custody

Cloudflare holds `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` as Worker environment values. The repository contains neither value in [the Wrangler configuration](../../../apps/worker/wrangler.jsonc).

The Electron main build contains `KICK_CLIENT_ID` and `STREAMFUSION_WORKER_BASE_URL`. It does not contain `KICK_CLIENT_SECRET`. [The Electron Vite configuration](../../../apps/desktop/electron.vite.config.ts) exposes these values only to the main-process bundle.

The Worker handles authorization codes and refresh tokens in memory for one request. It does not persist them. Wrangler observability is enabled, but [the Worker source](../../../apps/worker/src/index.ts) does not log request bodies or token values.

The desktop stores the resulting token envelope through [StorageService](../../../apps/desktop/src/backend/services/storage-service.ts). `safeStorage` encrypts the serialized token when the operating system supports it. Development environments without `safeStorage` use a marked base64 fallback.

## Desktop caller contract

[OAuth configuration](../../../apps/desktop/src/backend/auth/oauth-config.ts) defaults to `https://streamfusion.leveluptogetherbiz.workers.dev`. `STREAMFUSION_WORKER_BASE_URL` can replace the origin at build time. The Kick token endpoint is `<base>/auth/kick/token`.

[TokenExchangeService](../../../apps/desktop/src/backend/auth/token-exchange.ts) derives the refresh URL by replacing `/token` with `/refresh`. This string replacement couples both route names to the token endpoint value.

The code-exchange caller:

- Sends JSON with `code`, `redirect_uri`, and `code_verifier`.
- Parses the returned access token, refresh token, expiry, and scope.
- Uses the requested canonical Kick scope set when Kick omits `scope`.
- Throws a plain `Error` for a failed exchange and preserves only the returned error message.

The refresh caller:

- Sends JSON with `refresh_token`.
- Converts non-success responses into `TokenRefreshError` with an HTTP status and OAuth error code.
- Treats HTTP 408, HTTP 429, HTTP 5xx, network failures, and unknown failures as transient.
- Treats known permanent OAuth errors and other HTTP 4xx responses as permanent.

Neither desktop request has an explicit timeout or cancellation signal.

## Popup and callback contract

[The auth IPC handler](../../../apps/desktop/src/backend/ipc/handlers/auth-handlers.ts) starts the loopback listener before it opens the popup. The listener tries ports 8765 through 8864 and allows ten minutes for the complete login and authorization flow.

[AuthWindowManager](../../../apps/desktop/src/backend/auth/auth-window.ts) creates one 500 by 750 `BrowserWindow`. Kick uses Electron's default persistent session and disables the Chromium sandbox because the Kick sign-in flow depends on its bot-detection scripts. The same window first opens `kick.com`, confirms a signed-in website identity, persists required website cookies, and then opens `id.kick.com`.

[The callback server](../../../apps/desktop/src/backend/auth/oauth-callback-server.ts) validates the returned `state` against the expected in-memory value. It returns a local success or error page. AuthWindowManager closes the popup 1.5 seconds after the callback page loads.

`AuthWindowManager.validateState` also implements a ten-minute state check, but production Kick login does not call that method. Current production code performs the callback server's equality check only. The auth module instructions currently describe two state validations, so the instructions and production call graph disagree.

Starting a new Kick login cancels the previous flow, stops its callback listener, and closes its popup. The handler closes the popup and listener after success, failure, or cancellation.

## Token lifecycle after exchange

[KickAuthService](../../../apps/desktop/src/backend/auth/kick-auth.ts) owns token refresh after the initial exchange.

- One in-flight promise deduplicates concurrent refresh calls. This prevents parallel use of a rotating refresh token.
- Proactive refresh runs five minutes before access-token expiry.
- System resume recomputes the refresh schedule.
- Transient failures retry after 30 seconds, 2 minutes, 10 minutes, 45 minutes, and then 60 minutes for later failures.
- A successful refresh preserves the previous refresh token or scope when Kick omits either field.
- An explicitly incomplete scope set fails before storage.
- A permanent OAuth rejection clears only the OAuth token and emits `session-expired`.
- Explicit logout clears OAuth tokens, the saved Kick identity, the saved website bearer, and Kick website session cookies. Logout preserves `cf_clearance` and `__cf_bm`.

The replacement service must not create a second refresh coordinator. The desktop remains the owner of scheduling, single-flight rotation, persistence, session invalidation, and user notification.

## Source and test blast radius

### Direct replacement files

| Area | Files | Dependency |
| --- | --- | --- |
| Hosted implementation | [`apps/worker/src/index.ts`](../../../apps/worker/src/index.ts), [`wrangler.jsonc`](../../../apps/worker/wrangler.jsonc) | Cloudflare runtime, secrets, rate-limit bindings, and token routes |
| Hosted package | [`apps/worker/package.json`](../../../apps/worker/package.json), worker TypeScript and Vitest configuration | Wrangler development, type generation, dry run, test, and deploy commands |
| Hosted verification | [`apps/worker/tests/index.test.ts`](../../../apps/worker/tests/index.test.ts), [`apps/worker/scripts/smoke.mjs`](../../../apps/worker/scripts/smoke.mjs) | Route validation, abuse controls, removed-route checks, and deployed smoke checks |
| Desktop endpoint configuration | [`oauth-config.ts`](../../../apps/desktop/src/backend/auth/oauth-config.ts), [`electron.vite.config.ts`](../../../apps/desktop/electron.vite.config.ts) | Worker URL name, default origin, build-time override, and Kick client ID |
| Desktop transport | [`token-exchange.ts`](../../../apps/desktop/src/backend/auth/token-exchange.ts) | JSON request shapes, refresh URL derivation, response parsing, and error classification |
| Desktop orchestration | [`auth-handlers.ts`](../../../apps/desktop/src/backend/ipc/handlers/auth-handlers.ts), [`kick-auth.ts`](../../../apps/desktop/src/backend/auth/kick-auth.ts) | Initial exchange, storage, proactive refresh, backoff, and auth-loss behavior |

### Contract tests

The closest tests are:

- [`apps/worker/tests/index.test.ts`](../../../apps/worker/tests/index.test.ts) for route, validation, CORS, rate-limit, and fail-closed behavior.
- [`token-exchange.test.ts`](../../../apps/desktop/tests/backend/auth/token-exchange.test.ts) for desktop request and response behavior.
- [`kick-auth.test.ts`](../../../apps/desktop/tests/backend/auth/kick-auth.test.ts) for refresh rotation, backoff, scope handling, and credential-family separation.
- [`oauth-config.test.ts`](../../../apps/desktop/tests/backend/auth/oauth-config.test.ts) for the default endpoint and build-time override.
- [`oauth-callback-server.test.ts`](../../../apps/desktop/tests/backend/auth/oauth-callback-server.test.ts) for callback validation, timeout, and fallback ports.
- [`auth-window.test.ts`](../../../apps/desktop/tests/backend/auth/auth-window.test.ts) for the two-phase popup, website session persistence, state helper, and popup lifecycle.
- [`electron-vite-environment.test.ts`](../../../apps/desktop/tests/config/electron-vite-environment.test.ts) for main-only Worker URL injection.

### Repository and release coupling

The root npm workspace includes `apps/worker`. Root `test` and `typecheck` commands run the Worker suites. Both [the build workflow](../../../.github/workflows/build.yml) and [the release workflow](../../../.github/workflows/release.yml) run Worker type checking, tests, or a Wrangler deployment dry run.

Removing `apps/worker` affects the root `package.json`, `package-lock.json`, CI workflows, Worker context documentation, the StreamFusion feature map, auth instructions, environment examples, and API documentation that names the current Worker origin.

The existing StreamFusion Mobile Wayfinder documents reuse of the Kick OAuth Worker. A replacement must update those research artifacts or add a superseding decision so Android planning does not retain a dead Cloudflare assumption.

Cloudflare deployment appears to be manual through `npm run --workspace streamfusion-worker deploy`. CI verifies a Wrangler dry run but does not deploy the Worker. Secret rotation, traffic review, DNS or endpoint retirement, and Cloudflare resource deletion are external operational steps.

## Contract for the next decision

The next architecture decision needs a hosted service with these minimum responsibilities:

- Hold `KICK_CLIENT_SECRET` outside every distributed application artifact.
- Accept only the required code-exchange and refresh operations.
- Validate the authorization code, the PKCE verifier, the refresh token, and an explicit redirect allowlist before contacting Kick.
- Add the Kick client credentials only in the hosted process.
- Preserve Kick's HTTP status and OAuth error code well enough for desktop transient and permanent failure classification.
- Limit abuse by both a network or installation dimension and a hashed OAuth-subject dimension.
- Fail closed when required abuse controls are unavailable.
- Avoid token, code, verifier, and secret values in logs, traces, metrics, error reporting, and durable storage.
- Add explicit upstream timeouts and safe handling for non-JSON upstream responses.
- Keep Kick product API traffic outside the hosted service.

The replacement does not need to own the popup, PKCE generation, callback listener, token persistence, refresh scheduling, website cookies, Kick API calls, or renderer state. Those responsibilities remain in the Electron application.
