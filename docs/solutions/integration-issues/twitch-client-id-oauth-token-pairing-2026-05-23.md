---
title: Twitch Client-Id header must match the OAuth token's client_id on Helix AND GQL
module: apps/desktop/backend/api/platforms/twitch
date: 2026-05-23
category: integration-issues
problem_type: integration_issue
component: authentication
severity: high
symptoms:
  - "Persistent HTTP 401 on POST https://gql.twitch.tv/gql when an OAuth token is attached"
  - "Persistent HTTP 401 on /helix/* when an OAuth token is attached"
  - "Token refresh does not fix the 401 (the token is genuinely valid; refresh returns the same string)"
  - "Standalone module hardcodes Client-Id 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp' (the Android anonymous id) and attaches Authorization on top"
root_cause: config_error
resolution_type: code_fix
related_components: [chat, predictions, oauth]
tags: [twitch, oauth, client-id, 401, gql, helix]
---

# Twitch Client-Id header must match the OAuth token's client_id on Helix AND GQL

## Problem

Twitch's API (both `api.twitch.tv/helix/*` and `gql.twitch.tv/gql`) rejects authenticated requests with HTTP 401 when the `Client-Id` header doesn't match the `client_id` that minted the OAuth access token in the `Authorization` header. This pattern has been re-introduced twice in this codebase by standalone modules that hardcoded the Android-app anonymous Client-Id `kd1unb4b3q4t58fwlpcbzcbnm76a8fp` (correct for guest reads) and then attached a user-OAuth token on top.

## Symptoms

- DevTools console fills with `POST https://gql.twitch.tv/gql 401 (Unauthorized)` or `... /helix/<endpoint> 401`.
- The 401 fires on every poll tick / mod action / settings sync for any signed-in user.
- The token validates successfully against `https://id.twitch.tv/oauth2/validate` — refresh-and-retry loops indefinitely because the token IS valid; the pairing with the wrong Client-Id is what Twitch rejects.
- The bug is invisible to anonymous users (no Authorization header sent → no pairing check).
- TwitchRequestor-routed Helix calls don't show this because the Cloudflare Worker proxy injects the correct app client_id server-side (`twitch-requestor.ts:179`). Only **standalone modules that bypass the Worker** trip the invariant.

## What Didn't Work

- **Looking at the 401-retry logic.** The poller's `pendingRefresh` flag and `withTwitchHelixRetry`'s 401 → refresh-and-retry path both fired correctly. The issue isn't refresh; the new token has the same client_id mismatch as the original.
- **Suspecting auth scheme drift (`OAuth` vs `Bearer`).** Both schemes 401 with the wrong Client-Id. Switching scheme alone doesn't fix the call.
- **Suspecting integrity / persisted-query gating.** Integrity rejections come back as 200 with `errors[].message` containing "integrity check" or similar (see `twitch-gql-client.ts` integrity-error classifier) — not 401. 401 specifically means the auth header was rejected.

## Solution

Pair the `Client-Id` header with the OAuth token's owning client_id whenever Authorization is attached. The Vite renderer reads `import.meta.env.VITE_TWITCH_CLIENT_ID`; main-process code reads `process.env.TWITCH_CLIENT_ID`. The anonymous Android Client-Id is correct ONLY for unauthenticated reads.

**The fix-pattern that landed for six Helix modules in commit `5fc5a23` and for the GQL prediction read in commit `b4f3a91`:**

1. Add `clientId` to the module's request options (required at the type level when feasible — failing closed on the type system beats failing open at runtime with a 401).
2. Drop the hardcoded anonymous Client-Id constant for authenticated paths. Rename any retained constant to something like `ANONYMOUS_CLIENT_ID` so future readers don't reach for it by default.
3. Attach `Authorization` only when BOTH `accessToken` AND `clientId` are supplied; otherwise degrade to anonymous (no Authorization header) rather than sending a known-bad pair. Empty-string env (forgotten build var) should collapse to "no clientId" too.
4. At every renderer call site, read `import.meta.env.VITE_TWITCH_CLIENT_ID` and thread it through — same pattern as `TwitchChat.tsx:269` and `useChatSettingsSync.ts`.
5. Pin tests to the exact caller-supplied Client-Id value (e.g. `expect(...).toBe("my-app-client-id")`), not `toBeTruthy()`. Truthy-only assertions let the next regression to a hardcoded value slip through.

Concrete shape for a GQL helper:

```typescript
const ANONYMOUS_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp"; // unauthenticated reads only

interface FetchOptions {
  accessToken?: string;
  clientId?: string; // required to attach Authorization
}

async function gqlFetch(login: string, opts: FetchOptions = {}) {
  const isAuthenticated = Boolean(opts.accessToken && opts.clientId);
  const headers: Record<string, string> = {
    "Client-Id": opts.clientId ?? ANONYMOUS_CLIENT_ID,
    "Content-Type": "application/json",
  };
  if (isAuthenticated) {
    headers.Authorization = `OAuth ${opts.accessToken}`;
  }
  // ...
}
```

## Why This Works

Twitch's auth backend checks three things on every authenticated call:

1. Token validity (signature, not expired, not revoked).
2. Token scopes vs the operation's scope requirements.
3. **Token's owning client_id vs the `Client-Id` header**. This is the invariant that fails silently — a valid token paired with a foreign Client-Id is rejected with the same generic 401 that an expired token produces, but no refresh can fix it.

The codebase's own canonical reference: `docs/api/twitch/authentication.md:62` — "Don't substitute our own." The Worker-routed path is safe because the Worker overwrites the Client-Id header with the correct app client_id before forwarding to Twitch.

## Prevention

- **Diagnostic tell**: persistent 401 where token refresh doesn't break the loop → check the Client-Id header before looking anywhere else. If the call goes direct to `api.twitch.tv` / `gql.twitch.tv` (not through the Worker proxy), the Client-Id header is the prime suspect.
- **Audit checklist for new standalone modules** (anything not routed through `TwitchRequestor`):
  - [ ] If the module attaches `Authorization`, does it also accept `clientId` as a required arg?
  - [ ] If `clientId` is optional, does the module fail closed (drop Authorization) when it's missing/empty?
  - [ ] Does every call site read `import.meta.env.VITE_TWITCH_CLIENT_ID` (renderer) or `process.env.TWITCH_CLIENT_ID` (main)?
  - [ ] Does the test suite pin the Client-Id header to a specific caller value, not `toBeTruthy()`?
- **Search guard**: before adding a new standalone Twitch module, grep for `"kd1unb4b3q4t58fwlpcbzcbnm76a8fp"`. Every occurrence should be (a) an anonymous-only read, or (b) renamed to `ANONYMOUS_CLIENT_ID` with the clear caveat that Authorization must not be attached.
- **Polling-loop guard**: any poller that hits a Twitch endpoint with an OAuth token should also cap consecutive 401s across ticks (not just within a tick). The per-tick refresh-retry doesn't bound a cross-tick loop on a sustained config error. Pattern: see `twitch-prediction-poller.ts`'s `auth401Streak` field (introduced in `b4f3a91`).

## Related

- Commit `5fc5a23` (2026-05-19): fixed for six Helix modules — chat-settings, moderation-mutations, polls, predictions, moderators-vips, unban-requests.
- Commit `b4f3a91` (2026-05-23): fixed the GQL recurrence in `twitch-gql-predictions.ts`.
- `docs/api/twitch/authentication.md:62` — canonical "Don't substitute our own" reference.
- `docs/solutions/integration-issues/twitch-irc-missing-chat-scopes-2026-05-19.md` — different Twitch auth class (missing scopes on IRC, not Client-Id pairing on REST/GQL); both reach for an OAuth token but fail at different layers.
- **Outstanding latent occurrence**: `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-pin-mutations.ts:33-35` carries the same Android-Client-Id + user-OAuth-Bearer pairing. Hasn't been exercised at scale yet. Worth fixing in the same pattern when that file is next touched.
