---
date: 2026-05-22
topic: worker-auth-and-proxy-removal
---

# Worker Authentication and Proxy Removal — Lock Down `streamfusion.workers.dev`

## Summary

Cut the Helix / Kick-public-v1 proxy routes (`/twitch/*`, `/kick/*`) from the Cloudflare Worker entirely — they exist only as a free authenticated proxy that an attacker who finds the URL can abuse with their own bearer tokens. The Worker shrinks to four OAuth endpoints (`/auth/{twitch,kick}/{token,refresh}`) and one new `/install/register`. All four auth endpoints require a per-install HMAC signature whose secret is provisioned at first launch and stored in Workers KV; Workers Rate Limiting wraps every route. Result: the largest abuse surface (free authenticated API gateway) disappears, refresh-token replay requires also stealing the install secret, and every remaining endpoint is bounded.

This work depends on the safeStorage hardening from [2026-05-22-safestorage-fallback-hardening-requirements.md](2026-05-22-safestorage-fallback-hardening-requirements.md), which must ship first — the install secret is stored via the hardened `safeStorage` path.

---

## Problem Frame

The Cloudflare Worker at `https://streamfusion.leveluptogetherbiz.workers.dev` (defined in `apps/worker/src/index.ts`) currently exposes six routes with zero caller authentication and no rate limiting. The URL is published in the repo's own API docs (`docs/api/twitch/README.md:32`, `docs/api/kick/README.md:34`), so "obscurity" is not a defense; any attacker finds it in five seconds.

Three concrete abuse paths exist today:

1. **Free OAuth-exchange service.** `POST /auth/twitch/token` will exchange any `code` + `redirect_uri` an attacker supplies, using the project's `TWITCH_CLIENT_SECRET`. Twitch sees the activity as originating from this app's `client_id`. If the attacker triggers rate-limit suspension by abusing the exchange, the project's `client_id` is suspended — not the attacker's.

2. **Free authenticated Helix / Kick proxy.** `/twitch/*` and `/kick/*` forward any `Authorization`-bearing request to Twitch's Helix API and Kick's public API respectively. The Worker does no inspection of the bearer token: anyone with a Twitch user token (their own, harvested, whatever) can use this Worker as a free egress proxy. This consumes Workers free-tier requests, concentrates abuse traffic on a single egress IP, and looks like StreamFusion to the upstream APIs.

3. **Refresh-token replay.** `POST /auth/twitch/refresh` accepts any `refresh_token` and returns a new access token. An attacker who has stolen a refresh token from a user's machine — possible historically via the now-removed base64 fallback (see linked brainstorm), or via malware — does not need the `client_secret`. The Worker provides the secret on their behalf, and the attacker maintains access until the user revokes.

Adjacent observations:
- `Access-Control-Allow-Origin: *` (`index.ts:15`) is irrelevant to the threat model — CORS is a browser policy and attackers don't use browsers for this. Mentioned only so future readers don't think it's a defense.
- `observability.enabled: true` in `wrangler.jsonc` is fine today (no `console.log(body)` anywhere in the Worker), but is a foot-gun: any future logging that includes a request body would surface refresh tokens or auth codes in wrangler tail output. Worth a hardening note.
- The Helix proxy's stated benefit — "single egress IP makes rate-limit accounting simpler" (`docs/api/twitch/implementation-notes.md:33`) — is real but operational, not a security justification. Losing it costs slightly noisier rate-limit math; that trade is worth it.

This brainstorm assumes the safeStorage hardening (linked above) ships first. Without it, the install secret introduced here would inherit the same base64-plaintext risk that motivated the hardening work.

---

## Requirements

**Proxy removal**

- R1. The `/twitch/*` and `/kick/*` route handlers SHALL be removed from `apps/worker/src/index.ts`. The Worker SHALL return `404` for any request whose path does not match the OAuth or `/install/register` routes defined below.
- R2. The desktop Helix client (`apps/desktop/src/backend/api/platforms/twitch/twitch-requestor.ts` and any caller currently using a `WORKER_BASE_URL`-derived base for Helix) SHALL call `https://api.twitch.tv/helix` directly, attaching the user's bearer token in `Authorization` and `TWITCH_CLIENT_ID` in `Client-Id`. The renderer-side path already does this for some endpoints via `VITE_TWITCH_CLIENT_ID` (`apps/desktop/.env.example:23-24`); the main-process path is aligned to match.
- R3. The Kick public-API client SHALL call `https://api.kick.com/public/v1` directly using the user's bearer token. Any current Worker-proxied calls in `apps/desktop/src/backend/api/platforms/kick/` SHALL be repointed.
- R4. Before R1 lands, the planning step SHALL verify which existing Helix / Kick-public-v1 calls were using the Worker only for secret-hiding (now non-load-bearing — proceed direct) vs. any that were using it for Cloudflare anti-bot bypass (must be solved separately, likely via the existing hidden-BrowserWindow scrape path mentioned in `docs/api/kick/README.md:26`). This audit is a planning prerequisite, not a brainstorm decision.
- R5. The docs that publish the Worker URL as a Helix / Kick base (`docs/api/twitch/README.md`, `docs/api/kick/README.md`, `docs/api/twitch/helix-api.md`, `docs/api/twitch/implementation-notes.md`) SHALL be updated in the same PR that removes the routes. The Worker URL remains documented as the OAuth token-exchange endpoint only.

**Install registration**

- R6. A new `POST /install/register` endpoint SHALL be added to the Worker. It accepts no body, generates a random `install_id` (UUID v4) and `install_secret` (32 random bytes, base64url-encoded), stores `install_id → { secret, created_at }` in a new Workers KV namespace (`INSTALL_REGISTRY`), and returns `{ install_id, install_secret }` as JSON.
- R7. The desktop SHALL call `/install/register` on first launch (when no install credentials exist in storage) and persist the returned `install_id` + `install_secret` via the hardened `StorageService`. The install secret SHALL be encrypted via `safeStorage` exactly like OAuth tokens, with the same failsafe semantics (R1 / R7 of the safeStorage doc).
- R8. The KV entry for each install SHALL carry a 90-day TTL that is refreshed on every successful authenticated request. Installs that go quiet for 90 days are GC'd; the desktop client treats a `401 missing-install` response (R12) as a signal to re-register transparently.

**HMAC signing scheme**

- R9. Every request from the desktop to `/auth/twitch/token`, `/auth/twitch/refresh`, `/auth/kick/token`, and `/auth/kick/refresh` SHALL carry these headers:
  - `X-StreamFusion-Install-Id`: the install_id.
  - `X-StreamFusion-Timestamp`: Unix milliseconds at request time.
  - `X-StreamFusion-Nonce`: 16 random bytes, base64url-encoded.
  - `X-StreamFusion-Signature`: `HMAC-SHA256(install_secret, signing_string)`, base64url-encoded.
  - Where `signing_string = timestamp + "\n" + nonce + "\n" + method + "\n" + path + "\n" + sha256_base64url(body)`.
- R10. The Worker SHALL look up `install_id` in KV, recompute the HMAC with the stored `install_secret`, compare with `X-StreamFusion-Signature` using a constant-time comparison, and reject mismatches with `401 invalid-signature`.
- R11. The Worker SHALL reject requests whose `X-StreamFusion-Timestamp` is more than 300 seconds in the past or 60 seconds in the future with `401 stale-timestamp`. No server-side nonce cache; the timestamp window is the replay defense. Acceptable trade: within the 300s window a replay is possible if an attacker also captures the signature, but that requires either a TLS compromise (out of scope) or already having the install_secret (in which case they don't need to replay — they can sign new requests).
- R12. The Worker SHALL respond `401 missing-install` (distinct from `401 invalid-signature`) when `install_id` is not found in KV. Desktop treats this as "re-register and retry once."

**Rate limiting**

- R13. The Worker SHALL bind a Cloudflare Workers Rate Limiting policy to every route:
  - `/install/register`: 5 requests per hour, keyed by source IP.
  - `/auth/{twitch,kick}/token`: 10 requests per minute, keyed by `install_id` (or source IP if no install_id header present, before signature verification).
  - `/auth/{twitch,kick}/refresh`: 10 requests per minute, keyed by `install_id`.
- R14. The `/install/register` route SHALL reject requests with no `User-Agent` header or with a User-Agent matching common scraper patterns (configurable allowlist; conservative default). This is a defense-in-depth measure on top of the rate limit, not a primary defense.

**Logging discipline**

- R15. The Worker SHALL NOT `console.log`, `console.debug`, or otherwise emit any request body, response body, header, or URL query string that may contain a `code`, `refresh_token`, `access_token`, `install_secret`, or `X-StreamFusion-Signature`. A code-comment SHALL be added at the top of `index.ts` recording this constraint so a future change doesn't quietly violate it.
- R16. The wrangler observability config remains enabled (`wrangler.jsonc:9-11`); the constraint is on what gets logged, not on observability itself.

**Rollout sequencing**

- R17. The sequencing order SHALL be:
  1. Ship desktop client version N that calls Helix/Kick directly per R2/R3, AND can call the auth routes either signed (new) or unsigned (legacy). At this point, no Worker change is deployed.
  2. Deploy Worker version that adds `/install/register`, accepts both signed and unsigned auth requests (signed takes precedence; unsigned hits a deprecation warning header), and removes `/twitch/*` and `/kick/*`.
  3. Wait for desktop adoption (e.g., ≥95% of recent active installs on version N or later, tracked via App update telemetry if available, else 30 days).
  4. Deploy Worker version that requires signed auth requests, rejecting unsigned with `401 unsigned-deprecated`.
  5. Ship desktop client version N+1 that drops the unsigned code path.
- R18. The order in R17 SHALL NOT be inverted. Deploying the strict Worker before the signed-capable desktop client locks all existing users out of token refresh, breaking their sessions until they manually update.

**Pre-deploy hygiene**

- R19. The `TWITCH_CLIENT_SECRET` and `KICK_CLIENT_SECRET` Wrangler secrets SHOULD be rotated in step 2 of R17 (when the new Worker version deploys). Rationale: the secrets may have been used unwittingly through the open `/auth/*` endpoints prior to this work, and rotation is cheap. This is a recommendation, not a hard requirement — planning step decides based on observed traffic patterns.

**Tests**

- R20. Worker-side unit/integration tests SHALL cover:
  - `/install/register` returns a 200 with `install_id` + `install_secret` and writes to KV.
  - A signed auth request with a valid signature succeeds.
  - A signed auth request with an invalid signature returns 401 invalid-signature in constant time.
  - A signed auth request with a stale or future timestamp returns 401 stale-timestamp.
  - A request with an unknown install_id returns 401 missing-install.
  - Rate limits trigger 429 after exceeding the threshold.
  - The old `/twitch/*` and `/kick/*` routes return 404.
- R21. Desktop-side tests SHALL cover:
  - First-launch registration: no install creds → calls `/install/register` → persists creds.
  - Signed request construction: signing_string assembly matches Worker expectations (use a shared test fixture if practical).
  - 401 missing-install handling: clears local install creds, re-registers, retries the original request once.
  - 401 invalid-signature handling: does NOT auto-retry (would indicate a tampered local secret; surface the error).
  - Helix / Kick direct-call paths work without the Worker proxy.

---

## Non-Goals

- **Application-layer encryption beyond TLS on the desktop↔Worker channel.** TLS covers transit; HMAC covers authenticity. Adding a second symmetric encryption layer would be theater because Cloudflare terminates TLS at the edge regardless.
- **mTLS or Cloudflare Access service tokens.** Considered; operationally heavy for many ephemeral desktop clients. HMAC is the right tool.
- **Build-baked shared secret (HMAC key shipped in the binary).** Considered; rejected. Anyone who decompiles the binary extracts the secret and we're back to today.
- **Install attestation / proof that the install is the official binary.** Out of scope. We don't try to prove the install is genuine; we only try to ensure each install is rate-limited independently.
- **Replacing the Worker entirely.** The Worker is still the right home for the `client_secret`; we just shrink its responsibilities.
- **Migrating off the `streamfusion.leveluptogetherbiz.workers.dev` URL.** Possible cosmetic change later, not relevant here.
- **Adding a TOTP / proof-of-work step to `/install/register`** to make bulk registration costly. Deferred — the rate limit + UA filter is the bar.
- **Touching the CORS header.** Mostly irrelevant to the threat model. After HMAC is in place, an open CORS does no additional harm.

---

## Risks and Open Questions

- **Cloudflare anti-bot bypass for some Kick endpoints.** `docs/api/kick/README.md:26` references a hidden-BrowserWindow scrape path used when `electron.net` is blocked by Cloudflare. The Worker proxy did not have this benefit (it doesn't bypass anti-bot for Kick's own CF protections; it bypassed *secret hiding*). Direct calls from the desktop are no worse than they are today for those endpoints — but the planning step (R4) must verify.
- **Install secret revocation.** No revocation flow is specified. Adding one is straightforward (a DELETE on `/install/{id}` signed with the install secret) but unneeded for v1 — KV TTL handles GC. Planning may add this if a real revocation use case emerges.
- **Telemetry for the rollout (R17 step 3).** "≥95% on version N or later" assumes the app has a way to count active versions. Verify against the update service (`apps/desktop/src/backend/services/update-service.ts` if it exists) during planning; if not, use a 30-day calendar wait.
- **Existing Worker traffic auditing.** Before deploying the strict version, pull CF analytics for `streamfusion.leveluptogetherbiz.workers.dev` and look for traffic patterns that suggest abuse: high-volume callers, suspicious geos, calls that don't match the desktop app's traffic shape. If abuse is evident, R19 (secret rotation) becomes mandatory rather than recommended.
- **HMAC algorithm choice.** SHA-256 is the conservative default; SHA-512 offers no real benefit at this surface size; BLAKE3 is faster but adds a dep. Stay with SHA-256.
- **Timestamp window (R11).** 300s past / 60s future. Clock skew on user machines is the main consumer of the past window; 300s is generous but reasonable. Future window is tighter because there's no legitimate reason for a desktop to sign with a future timestamp.
- **What if Workers Rate Limiting is unavailable on the deployment's plan tier?** Workers Rate Limiting is GA and available on free tier with caveats (see CF docs). If a specific binding shape requires Workers Paid, plan-step decides whether to upgrade or implement rate limiting in-code via KV counters. Either works.

---

## Verification

- Manual: from a clean machine with no install creds, launch the app → expect a single `/install/register` call followed by a normal OAuth flow. Inspect Worker logs (after R15-compliant logging) to confirm only metadata is logged, never bodies.
- Manual: from an existing install on the previous version, allow the rolling Worker deploy to land → desktop client falls through to the legacy unsigned path until N+1 lands → no user-visible session breakage.
- Manual / abuse test: from a separate machine with no install creds, attempt `POST /auth/twitch/refresh` directly with a valid (lab-issued) refresh token but no signature → expect `401 missing-install` (no install_id) or `401 unsigned-deprecated` (post-R17 step 4). Confirm the refresh does not succeed.
- Manual: exceed the `/install/register` rate limit from a single IP → expect `429` responses, KV writes do not occur.
- Automated: per R20 and R21.
- Regression: full OAuth flow end-to-end for both Twitch and Kick (token exchange + first refresh) on a packaged build, post-deployment of each rollout step.

---

## Handoff

Ready for `/ce-plan` once the linked safeStorage hardening doc has been planned (the install secret depends on it). The plan should sequence:

1. R4 audit (which calls actually need the proxy vs. which were secret-hiding only). This is a 1–2 hour spike, output is a list.
2. Worker-side: `/install/register`, KV binding, HMAC verification helper, rate limit bindings, logging discipline comment.
3. Desktop-side: install-registration on first launch, signed-request wrapper around the Worker fetch calls, removal of proxy URLs from `oauth-config.ts` and the requestor clients.
4. Rollout-aware desktop client (signed + unsigned dual mode), then Worker dual-mode deploy, then strict Worker deploy, then desktop signed-only client.
5. Docs sweep per R5.
6. Pre-deploy secret rotation (R19) if traffic analytics warrants it.

Single Worker PR + single desktop PR is feasible if the dual-mode client lands in the same release window; otherwise split into the dual-mode landing first and the strict-Worker / signed-only-client follow-up after observation.
