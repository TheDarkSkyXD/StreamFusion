---
date: 2026-05-22
status: active
type: feat
origin: docs/brainstorms/2026-05-22-account-follows-push-sync-requirements.md
---

# feat: Push-sync follows on Twitch + Kick

## Summary

When the signed-in user clicks Follow or Unfollow on a Twitch or Kick channel, fire the corresponding write to the platform on the same tick the local row toggles. Twitch goes through `FollowButton_FollowUser` / `FollowButton_UnfollowUser` GQL persisted-query mutations using the existing Android Client-Id integrity-bypass pattern from `twitch-gql-prediction-mutations.ts`. Kick tries `Authorization: Bearer` against `kick.com/api/v2/channels/{slug}/follow` first (matching `kick-prediction-mutations.ts` which uses the same `kick.com/api/v2` base — see `KICK_LEGACY_API_V2_BASE` in `kick-types.ts`); on 401/403 it falls back to a page-context fetch through the existing `_fetchViaBrowserWindow` surface. A new `pending_follow_writes` companion table tracks pushes that didn't confirm; the background sync (existing for Kick, newly added for Twitch) reconciles divergence and surfaces a per-platform Sonner banner the user can retry.

---

## Problem Frame

The Kick follow IMPORT direction landed 2026-05-21 (commit `4a1f64e` and the U1-U6 series). Twitch IMPORT has worked for longer via Helix `/channels/followed`. Both READ directions work; both WRITE directions don't. Clicking Follow on a new channel writes a `guest`-source local row the platform never sees; clicking Unfollow on an account-source row pops a "Manage on \[platform\]" redirect toast that exits the app.

The previous brainstorm (`docs/brainstorms/2026-05-21-kick-account-follows-import-requirements.md`) deliberately scoped both write directions OUT, primarily to avoid expanding the surface of internal-endpoint writes. The intervening day's findings overturn that calculation:

- **Twitch GQL writes are already proven in this codebase.** `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-prediction-mutations.ts` and `twitch-gql-pin-mutations.ts` POST persisted-query mutations to `gql.twitch.tv/gql` using the Android Client-Id (`kd1unb4b3q4t58fwlpcbzcbnm76a8fp`) to bypass Client-Integrity. The follow mutations are the same shape with different hashes.
- **Kick mutations don't need BrowserWindow if Bearer works.** `kick-prediction-mutations.ts` and `kick-pin-mutations.ts` use plain Bearer `fetch()` from the main process. Follow mutations should try the same path first; the BrowserWindow page-context fetch (already established by `follow-endpoints.ts:_fetchViaBrowserWindow`) is the fallback only when 401/403 indicates Bearer is rejected at this endpoint.
- **The reference implementation `Xtra`** (`reference/Xtra For-Twitch-Better-Functions-etc-master/app/src/main/java/com/github/andreyasadchy/xtra/repository/GraphQLRepository.kt:1170-1205`) confirms `FollowButton_FollowUser` is the same surface twitch.tv's own UI uses for its own follow button.

Neither platform requires a new OAuth scope, a new auth surface, or new auth infrastructure. The work is mostly new mutation modules + a companion table + reconciliation extensions to the existing sync.

---

## High-Level Technical Design

```
                  User clicks heart (signed in to that platform)
                                    │
                                    ▼
              ┌──────────────────────────────────────────────┐
              │ useFollowStore.toggleFollow                  │  inFlight gate
              │ Optimistic local row write/remove (T+0)      │  prevents races
              │ source = 'account' if signed in to platform  │  on same channel
              └──────────────────┬───────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────────┐
              │ IPC: FOLLOWS_PUSH_TO_PLATFORM                │
              │ Handler: storage-handlers.ts                 │
              └──────────────────┬───────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                                     │
              ▼                                     ▼
    ┌─────────────────────┐               ┌─────────────────────┐
    │ Twitch: GQL mutation│               │ Kick: Bearer first  │
    │ Android Client-Id   │               │ on 401/403 → BrowserW│
    │ Persisted + fallback│               │ acquireBrowserWindow │
    └──────────┬──────────┘               └──────────┬──────────┘
               │                                     │
       ┌───────┴───────┐                     ┌───────┴───────┐
       │               │                     │               │
   success          failure               success          failure
       │               │                     │               │
       ▼               ▼                     ▼               ▼
 ┌────────────┐ ┌──────────────────┐  ┌────────────┐ ┌──────────────────┐
 │ Remove any │ │ Insert into      │  │ Remove any │ │ Insert into      │
 │ pending    │ │ pending_follow_  │  │ pending    │ │ pending_follow_  │
 │ row (clean)│ │ writes(action)   │  │ row (clean)│ │ writes(action)   │
 └────────────┘ └──────────────────┘  └────────────┘ └──────────────────┘
                         │                                    │
                         └────────────────┬───────────────────┘
                                          │
                                          ▼
                       Next background sync (Kick: existing 15m/focus;
                                              Twitch: newly added 15m/focus):
                                          │
                                          ▼
        replaceAccountFollowsRespectingPending:
          - rows with pending follow are preserved even if absent from platform
          - rows absent locally with pending unfollow are NOT re-adopted
          - rows reconciled externally (pending follow now on platform, pending
            unfollow now absent) get pending_writes pruned
          - emit AUTH_FOLLOWS_SYNCED { platform, pendingCount }
                                          │
                                          ▼
                Renderer surfaces Sonner toast per platform:
                  "N follow(s) didn't sync to <platform> — retry?"
                  with retry action and dismiss
```

*This illustrates the intended approach and is directional guidance for review, not implementation specification.*

---

## Requirements Traceability

All thirteen origin requirements (R1-R13) are addressed across the implementation units:

| Origin | Carried by | Notes |
|---|---|---|
| R1 (Twitch follow push) | U3, U5, U6 | GQL mutation + client delegate + push-on-toggle path |
| R2 (Kick follow push) | U4, U5, U6 | Bearer-first mutation + client delegate + push-on-toggle path |
| R3 (Twitch unfollow push) | U3, U5, U6 | Same module, unfollow mutation |
| R4 (Kick unfollow push) | U4, U5, U6 | Same module, DELETE |
| R5 (optimistic local toggle, no spinner) | U6 | Store toggleFollow extension |
| R6 (failure → mark unconfirmed, no toast on click) | U6 | pending_writes row on failure |
| R7 (unfollow tombstone — don't re-adopt) | U7 | `replaceAccountFollowsRespectingPending` |
| R8 (sync honors pending markers) | U7 | Diff logic extension |
| R9 (per-row reconciliation banner, per-platform) | U7, U8 | Sync emits per-platform count; toast renders |
| R10 (retry re-fires original mutation) | U6, U8 | Retry calls FOLLOWS_PUSH_TO_PLATFORM |
| R11 (external follow/unfollow on platform still adopted) | U7 | Diff logic preserves existing import behavior when no pending marker exists |
| R12 (signed-out follow click → guest unchanged) | U6 | Source decision uses auth-store state |
| R13 (no guest-to-account promotion ever) | U6 | Source is decided at write time, never mutated post-write |

Acceptance examples AE1-AE10 from the origin map to U6, U7, and U8 test scenarios; see per-unit test scenario lists below.

---

## Implementation Units

### U1. Discovery: verify Twitch GQL viability + observe Kick write request shape

- **Goal:** Before writing mutation code, confirm the assumed persisted-query hashes work against the live Twitch GQL gateway with the project's OAuth + Android Client-Id pairing, and capture the exact Kick `/api/v2/channels/{slug}/follow` request shape (POST and DELETE) from a real kick.com session.
- **Requirements:** Foundational for R1-R4. Catches "Twitch has locked down follow on GQL too" or "Kick endpoint requires a body field we didn't expect" before downstream units assume otherwise.
- **Dependencies:** none.
- **Files:**
  - Modify (append observation block): `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-follow-mutations.ts` (created in U3 — observation goes in its header doc when U3 starts)
  - Optional: `docs/solutions/integration-issues/follow-push-discovery-2026-05-22.md` if findings surprise the plan
- **Approach:**
  - **Twitch:** Issue a one-shot `FollowButton_FollowUser` POST against `gql.twitch.tv/gql` with hash `800e7346bdf7e5278a3c1d3f21b2b56e2639928f86815677a7126b093b2fdd08`, `Authorization: OAuth <user-token>`, `Client-Id: kd1unb4b3q4t58fwlpcbzcbnm76a8fp`, body `{ input: { disableNotifications: false, targetID: "<test-channel-id>" } }`. Verify: response shape, presence of `errors[].extensions.code` for integrity rejection, whether the channel actually appears in the user's follows on twitch.tv. Repeat for unfollow.
  - **Kick:** Sign in to kick.com in a real browser, open DevTools Network tab, click Follow on a test channel. Capture: URL (confirm `kick.com/api/v2/channels/{slug}/follow` vs `kick.com/api/v2/follows` vs other), method (POST?), request headers (`X-XSRF-TOKEN`, `X-Requested-With`, `Content-Type`), body (empty? `{}`? `{ channel_id }`?). Repeat for unfollow (DELETE? POST to `/unfollow`?). Also: try the same request via Bearer + `kick.com/api/v2/...` from a curl/REST client with a real OAuth token — does it work, or does it return 403 like the read fallback observed at `/api/v2/channels/followed`?
  - **Pass / fail rubric for U1:**
    - **Twitch PASSES** if: response is 200 AND `data.followUser.follow.user.id === targetID` AND target channel appears at `https://twitch.tv/directory/following` within 60s.
    - **Twitch FAILS-VERIFIED** if: response includes `errors[].extensions.code` containing `INTEGRITY`, OR `data.followUser === null` with no errors, OR 401/403.
    - **Kick PASSES** if: POST returns 2xx (Bearer or BrowserWindow path) AND target appears at `https://kick.com/following/channels` within 60s.
    - **Kick FAILS-VERIFIED** if: 401/403 on both Bearer AND page-context fetch, OR Cloudflare HTML response, OR 200 with target NOT appearing on kick.com.
    - On any FAILS-VERIFIED, plan amendment trigger fires before U3/U4 implementation begins.
  - **Plan amendment trigger:** If Twitch returns persistent integrity rejection or "operation deprecated" or empty data on success-shaped response, U3 reduces to a stub that returns `{ ok: false, kind: 'unsupported' }` and the FollowButton's Twitch redirect-toast in U6 stays in place. If Kick's Bearer path returns 200, U4's BrowserWindow fallback becomes vestigial (still implemented for defense-in-depth but not the happy path).
- **Patterns to follow:** `docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md` for the integrity-rejection signal shape; `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts` for the existing observation that Bearer was rejected on the v2 read endpoint.
- **Test scenarios:**
  - Test expectation: none — this is a discovery unit. Observations get baked into U3 and U4's actual mutation files via header doc comments (analogous to how `follow-endpoints.ts:79-91` documents what was observed during the import discovery).
- **Verification:** Written observation captured; U3 and U4 start with the verified hashes / request shape, not the planned ones.

---

### U2. Schema: `pending_follow_writes` table + storage-service methods

- **Goal:** Add a companion table that tracks pending pushes. Reconciliation queries this table to distinguish "user intended unfollow, push failed (don't re-adopt)" from "user never followed this on platform (adopt as account)."
- **Requirements:** Supports R6, R7, R8, R9, R11.
- **Dependencies:** none.
- **Files:**
  - Modify: `apps/desktop/src/backend/services/database-service.ts` (table + inline migration in the existing `initSchema` flow)
  - Modify: `apps/desktop/src/backend/services/storage-service.ts` (new methods: `addPendingFollowWrite`, `removePendingFollowWrite`, `getPendingFollowWrites`, `getPendingByPlatform`)
  - Modify: `apps/desktop/tests/helpers/better-sqlite3-shim.ts` if any new API surface is needed (per `docs/solutions/tooling-decisions/better-sqlite3-node-sqlite-shim-for-vitest-2026-05-19.md` — extend the shim parity test FIRST in the same commit if a new API is touched)
  - Test: `apps/desktop/tests/backend/services/storage-service.test.ts` (extend existing file with pending_writes scenarios)
- **Approach:**
  - Table:
    ```
    pending_follow_writes(
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      platform    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      slug        TEXT NOT NULL,
      action      TEXT NOT NULL CHECK(action IN ('follow', 'unfollow')),
      attempted_at TEXT NOT NULL,
      last_error  TEXT,
      UNIQUE(platform, channel_id, action)
    )
    ```
  - **The `slug` column is essential** per `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md` — reconciliation matches via `channelsMatch (platform AND (id OR slug))`. Kick rows may have a stale `user_id` in `channel_id`; the slug column lets reconciliation find them via the slug bridge.
  - Storage methods (signatures only):
    - `addPendingFollowWrite({ platform, channelId, slug, action, lastError? }): void` — INSERT OR REPLACE semantics on the UNIQUE constraint; updates `attempted_at` on conflict
    - `removePendingFollowWrite({ platform, channelId, slug, action }): void` — DELETE matching `platform AND (channel_id = :channelId OR slug = :slug) AND action = :action`. Dual-id match per the `channelsMatch` primitive (`apps/desktop/src/lib/id-utils.ts:105-115`) — a row inserted with `channelId=numeric-user-id` must be findable for cleanup even when the retry call passes `channelId=slug` (and vice versa).
    - `getPendingFollowWrites(): PendingWrite[]`
    - `getPendingByPlatform(platform): PendingWrite[]`
  - Schema migration: follow the existing `database-service.ts:65-92` pragma-check + `CREATE TABLE IF NOT EXISTS` pattern. No `__migrations` versioning to introduce.
- **Patterns to follow:** `database-service.ts:54-115` (schema-init + inline-migration), `storage-service.ts:391-422` (transaction-wrapped writes).
- **Test scenarios:**
  - `addPendingFollowWrite` stores a follow-pending row with all fields populated
  - `addPendingFollowWrite` UPSERTs on duplicate `(platform, channelId, action)` — updates `attempted_at` and `last_error`, doesn't duplicate
  - A follow-pending and an unfollow-pending for the same channel can coexist (different action values, distinct rows)
  - `removePendingFollowWrite` deletes by composite key including action; doesn't affect rows with a different action
  - `getPendingByPlatform('kick')` returns only Kick rows; `getPendingByPlatform('twitch')` returns only Twitch rows
  - Table persists across `db.close()` + reopen (persistence guard)
  - Migration: opening an existing DB without the table creates it without dropping or altering `local_follows`
  - Slug-only match: `addPendingFollowWrite({ slug: 'foo', channelId: '' })` is allowed (empty channelId on a guest row — sentinel for "id unknown")
- **Verification:** Unit tests pass; manual: open the DB file with the SQLite CLI, confirm table presence + UNIQUE index on `(platform, channel_id, action)`.

---

### U3. Twitch follow mutations module (`twitch-gql-follow-mutations.ts`)

- **Goal:** Expose `followTwitchUser({ accessToken, targetUserId, disableNotifications? })` and `unfollowTwitchUser({ accessToken, targetUserId })` that POST persisted-query mutations to `gql.twitch.tv/gql`, with the same error-classification + persisted-to-doc-string fallback shape used by `twitch-gql-prediction-mutations.ts`.
- **Requirements:** R1, R3.
- **Dependencies:** U1 (hashes verified).
- **Files:**
  - Create: `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-follow-mutations.ts`
  - Test: `apps/desktop/tests/backend/api/platforms/twitch/twitch-gql-follow-mutations.test.ts`
- **Approach:**
  - Return type: `FollowResult = { ok: true } | { ok: false, kind: 'unauthenticated' | 'integrity' | 'network' | 'unsupported' | 'unknown', message: string }`. UnfollowResult identical.
  - POST to `https://gql.twitch.tv/gql` with `Authorization: OAuth ${accessToken}`, `Client-Id: kd1unb4b3q4t58fwlpcbzcbnm76a8fp`, `Content-Type: application/json`. Wrap with `AbortSignal.timeout(10_000)` per the existing GQL timeout convention.
  - Persisted hashes (per U1 verification): `FollowButton_FollowUser` = `800e7346bdf7e5278a3c1d3f21b2b56e2639928f86815677a7126b093b2fdd08`; `FollowButton_UnfollowUser` = `f7dae976ebf41c755ae2d758546bfd176b4eeb856656098bb40e0a672ca0d880`.
  - Variables: follow → `{ input: { disableNotifications: false, targetID } }`; unfollow → `{ input: { targetID } }`. Per `docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md`, persisted ops silently drop unlisted variables — keep the input shape minimal and exact.
  - **Persisted-to-doc-string fallback** on `PersistedQueryNotFound` (Twitch rotated hashes 2025-11-11 per `twitch-gql-prediction-mutations.ts` header comment): copy the pattern from `twitch-gql-prediction-mutations.ts:305-312` (`isPersistedQueryNotFound`) + `:364-406` (`makePrediction` orchestration). Document-string fallback:
    ```
    mutation FollowUser($input: FollowUserInput!) {
      followUser(input: $input) { follow { user { id } } error { code } }
    }
    ```
    (verify exact field shape from twitch.tv DevTools during U1 if it diverges)
  - **Integrity rejection detection**: copy `isIntegrityRejectionError` from `twitch-gql-prediction-mutations.ts:122-128`. Requires `'integrity'` + `'check'`|`'failed'`|`'rejected'` co-occurrence OR `extensions.code` containing `'INTEGRITY'`.
  - **Token hygiene**: copy `sanitizeMessage` from `twitch-gql-prediction-mutations.ts:136-147` (strips JWT-shaped + 40+ char alphanumeric runs from any echoed token).
- **Patterns to follow:** `twitch-gql-prediction-mutations.ts` in full (template). No shared helper extraction — per AGENTS.md anti-pattern (`backend/AGENTS.md`) and CLAUDE.md "no abstractions for single-use code" (2 instances now, threshold is 3+). When `twitch-gql-pin-mutations.ts` + `twitch-gql-prediction-mutations.ts` + `twitch-gql-follow-mutations.ts` all exist, extracting a shared GQL-mutation helper would be the right next refactor — but that's a follow-up.
- **What NOT to copy from the template:** the `generateTransactionId` helper and the `crypto.getRandomValues` PRNG-safety comment block (`twitch-gql-prediction-mutations.ts:100-113`). Those exist because `MakePredictionInput` requires a `transactionID` variable; `FollowUserInput` and `UnfollowUserInput` have NO transactionID equivalent, so the entire PRNG stanza is irrelevant. Skip it.
- **Test scenarios:**
  - Happy path follow: hash matches, response `{ data: { followUser: { follow: {...} } } }`, result `{ ok: true }`
  - Happy path unfollow: same shape with `unfollowUser`
  - 401 response → `{ ok: false, kind: 'unauthenticated' }`
  - `PersistedQueryNotFound` on persisted attempt → automatic fallback to document-string mutation; if doc-string succeeds → `{ ok: true }`
  - `PersistedQueryNotFound` on persisted + integrity rejection on doc-string fallback → `{ ok: false, kind: 'integrity' }`
  - Integrity rejection (matches `isIntegrityRejectionError`) → `{ ok: false, kind: 'integrity' }`; error message run through `sanitizeMessage`
  - Network timeout (AbortSignal expires) → `{ ok: false, kind: 'network' }`
  - Unknown error code → `{ ok: false, kind: 'unknown', message: <sanitized> }`
  - Concurrent calls don't share state (no module-scoped mutable that leaks)
  - Guards: `// Guards: NEVER log accessToken; sanitizeMessage applies to all surfaced strings`
- **Verification:** Unit tests pass with mocked `fetch`; manual: log in to Twitch via the app, invoke from a debug REPL, confirm the follow lands on twitch.tv (visible at `https://twitch.tv/directory/following`).

---

### U4. Kick follow mutations module (`kick-follow-mutations.ts`)

- **Goal:** Expose `followKickChannel({ accessToken, slug })` and `unfollowKickChannel({ accessToken, slug })` with Bearer-first via plain `fetch` from the main process; on 401/403, fall back to a page-context fetch through a hidden BrowserWindow (reusing the existing surface from `follow-endpoints.ts`).
- **Requirements:** R2, R4.
- **Dependencies:** U1 (request shape).
- **Files:**
  - Create: `apps/desktop/src/backend/api/platforms/kick/kick-follow-mutations.ts`
  - Modify (extend): `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts` — add an exported `pageContextWrite({ slug, method }): Promise<WriteResult>` that the new mutations module imports for the fallback path. Reuses `acquireBrowserWindowSlot`, the warm-visit dance, and the `executeJavaScript` infrastructure already there.
  - Test: `apps/desktop/tests/backend/api/platforms/kick/kick-follow-mutations.test.ts`
- **Approach:**
  - **Bearer path** (try first):
    - POST or DELETE `https://kick.com/api/v2/channels/{slug}/follow` with `Authorization: Bearer ${accessToken}`, `Accept: application/json`. (Header set and body shape: per U1 verification; the brainstorm assumed empty body but live observation may show otherwise.)
    - **Use the existing `KICK_LEGACY_API_V2_BASE` constant from `apps/desktop/src/backend/api/platforms/kick/kick-types.ts` — do NOT hardcode `api.kick.com`. That host serves only `/public/v1` and `/private/v1`; the internal v2 surface lives at `kick.com/api/v2` (no `api.` prefix), as confirmed by all existing Kick mutation modules.**
    - Wrap with `AbortSignal.timeout(10_000)`.
    - Result mapping: 200/204 → `{ ok: true }`; 401/403 → trigger BrowserWindow fallback; 5xx or timeout → `{ ok: false, kind: 'network' }`.
  - **BrowserWindow fallback** (on Bearer 401/403 only — NOT on network errors, which aren't an auth signal):
    - Acquire BrowserWindow slot via `acquireBrowserWindowSlot()`.
    - Warm-visit `https://kick.com/` (reuse the existing dance from `_fetchViaBrowserWindow`).
    - `executeJavaScript`: fetch `/api/v2/channels/{slug}/follow` with the SPA's Kasada-injected context, sourcing `X-XSRF-TOKEN` from `document.cookie` and including `X-Requested-With: 'XMLHttpRequest'` + `Accept: 'application/json'`.
    - Return parsed status code + body sample for classification. Cloudflare HTML challenge → `{ ok: false, kind: 'kasada' }`; 2xx → `{ ok: true }`; other → `{ ok: false, kind: 'unknown' }`.
    - Wrap the `executeJavaScript` call in `EXECUTE_JS_TIMEOUT_MS` (8000) per the existing convention in `follow-endpoints.ts:215`.
  - Result kinds: `'unauthenticated' | 'kasada' | 'network' | 'unknown'`. No `'unsupported'` kind — if the endpoint shape diverges from U1 expectations, U1 amends the plan first.
  - **No single-flight guard at this layer.** Per-channel race protection lives in `follow-store.ts:11-17` (`inFlight: Set<string>`); this module trusts callers to serialize per channel.
- **Patterns to follow:** `apps/desktop/src/backend/api/platforms/kick/kick-prediction-mutations.ts` (Bearer + plain fetch from main process, error classification taxonomy); `follow-endpoints.ts:_fetchViaBrowserWindow` (BrowserWindow + page-context fetch + mutex + warm-visit dance, lines 231-546). `docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md` for the two-auth-surface theory.
- **Test scenarios:**
  - Bearer happy path follow: response 200 → `{ ok: true }`; BrowserWindow constructor never called (spy)
  - Bearer happy path unfollow: same with DELETE
  - Bearer 403 → BrowserWindow fallback invoked → fallback succeeds → `{ ok: true }`
  - Bearer 401 → BrowserWindow fallback invoked → fallback returns 401 too → `{ ok: false, kind: 'unauthenticated' }`
  - BrowserWindow Cloudflare HTML response from `executeJavaScript` → `{ ok: false, kind: 'kasada' }`
  - Network timeout on Bearer (AbortSignal) → `{ ok: false, kind: 'network' }`, **no fallback** (network error isn't an auth signal)
  - Mutex serialization: two concurrent calls don't open two BrowserWindows simultaneously — second call waits for first to release
  - Window cleanup: `win.destroy()` is called in `finally` even when the fetch throws
  - Guards:
    - `// Guards: Bearer attempt MUST precede BrowserWindow fallback`
    - `// Guards: fallback engages ONLY on 401/403 — not on network errors`
- **Verification:** Unit tests with mocked `fetch` + `BrowserWindow`; manual: log into Kick, click Follow on a test channel, observe follow appears at `https://kick.com/following/channels`.

---

### U5. Wire mutation modules into platform clients

- **Goal:** Thin delegate methods on `twitchClient` and `kickClient` so renderer-side code talks to the client (which sources the token from storage), not the mutation modules directly.
- **Requirements:** Plumbing for R1-R4.
- **Dependencies:** U3, U4.
- **Files:**
  - Modify: `apps/desktop/src/backend/api/platforms/twitch/twitch-client.ts` (add `followUser`, `unfollowUser`)
  - Modify: `apps/desktop/src/backend/api/platforms/kick/kick-client.ts` (add `followChannel`, `unfollowChannel`)
- **Approach:**
  - Twitch: `followUser(targetUserId: string, opts?: { disableNotifications?: boolean }): Promise<FollowResult>` and `unfollowUser(targetUserId: string): Promise<UnfollowResult>` — both pull `accessToken` from `storageService.getToken('twitch')` and delegate to U3. Return `{ ok: false, kind: 'unauthenticated' }` immediately when no token.
  - Kick: `followChannel(slug: string): Promise<FollowResult>` and `unfollowChannel(slug: string): Promise<UnfollowResult>` — same shape, delegates to U4. Token sourced from `storageService.getToken('kick')`.
  - **Do not expand `kick-client.ts`'s already-mixed responsibilities** per `apps/desktop/src/backend/api/platforms/AGENTS.md` anti-pattern. New methods are thin delegates only.
- **Patterns to follow:** Existing delegate methods in both clients (predictions, pin, mod actions).
- **Test scenarios:**
  - `twitchClient.followUser('12345')` calls `followTwitchUser` with `{ accessToken: <from storage>, targetUserId: '12345' }`
  - `kickClient.followChannel('test-channel')` calls `followKickChannel` with `{ accessToken: <from storage>, slug: 'test-channel' }`
  - No-token case (storage returns undefined): returns `{ ok: false, kind: 'unauthenticated' }` without calling the mutation module
  - Token-with-undefined-accessToken edge case: same path as no-token
- **Verification:** Unit tests with mocked mutation modules + storage.

---

### U6. IPC handlers + store integration for push-on-toggle

- **Goal:** New IPC channel `FOLLOWS_PUSH_TO_PLATFORM` that the renderer fires when a signed-in user clicks Follow/Unfollow on a channel of that platform. Handler orchestrates local-write + platform-push + pending_writes recording. Store decides source attribution from auth state.
- **Requirements:** R1-R7, R12, R13.
- **Dependencies:** U2 (schema), U5 (client delegates).
- **Files:**
  - Modify: `apps/desktop/src/shared/ipc-channels.ts` (new channel `FOLLOWS_PUSH_TO_PLATFORM` + `IpcPayloads` entry: `{ platform, channelId, slug, channelName, displayName, profileImage, action: 'follow' | 'unfollow' }`)
  - Modify: `apps/desktop/src/preload/index.ts` (expose `follows.pushToPlatform(payload)`)
  - Modify: `apps/desktop/src/backend/ipc/handlers/storage-handlers.ts` (new handler that orchestrates: write/remove local row in transaction → call platform client → write/remove pending_writes row based on outcome → return result)
  - Modify: `apps/desktop/src/store/follow-store.ts` (extend `followChannel` / `unfollowChannel` to route through `follows.pushToPlatform` when signed in to the channel's platform; keep existing `follows.add` / `follows.remove` paths for the signed-out case)
  - Modify: `apps/desktop/src/components/ui/follow-button.tsx` (remove the `isManagedByTwitch` and `isManagedByKick` early-return branches for account-source rows AND remove both checks from the `title` ternary at the same site — after the change, the title for an account-source row should be `"Unfollow"` / `"Follow"`, not `"Followed via your Twitch account — click to manage on twitch.tv"`. Account-source clicks now flow through the normal `toggleFollow` path; the `LuHeartCrack` hover state at lines ~119-120 now correctly applies to account-source rows too — that is the intended new affordance, do NOT add a guard.)
  - Test: `apps/desktop/tests/backend/ipc/handlers/storage-handlers-push.test.ts`
  - Test: `apps/desktop/tests/store/follow-store-push.test.ts`
  - Test: extend `apps/desktop/tests/components/ui/follow-button.test.tsx`
- **Approach:**
  - **Source decision**: store's `followChannel` checks `useAuthStore.getState().tokens[platform]` before deciding which IPC to fire. Token present → `follows.pushToPlatform({ action: 'follow', ... })`; token absent → existing `follows.add(...)` (which writes source='guest'). This honors R12 (guest unchanged when signed out) and R13 (no promotion path).
  - **Handler orchestration** (follow):
    1. Begin DB transaction.
    2. `addLocalFollow(payload, source='account')`.
    3. Commit transaction.
    4. Call `twitchClient.followUser(channelId)` or `kickClient.followChannel(slug)`.
    5. On `{ ok: true }`: `removePendingFollowWrite({ platform, channelId, slug, action: 'follow' })` (idempotent — clears any prior pending row from a previous failed attempt on this channel; pass both channelId and slug so the dual-id match catches rows inserted with either as the key).
    6. On `{ ok: false }`: `addPendingFollowWrite({ platform, channelId, slug, action: 'follow', lastError: result.message })`.
    7. Return `{ ok, result }` to the renderer (renderer doesn't surface anything per R6 — no toast on the click).
  - **Handler orchestration** (unfollow):
    1. Begin DB transaction.
    2. Find existing rows matching `(platform, channelId)` AND `(platform, slug)` via the dual-id pattern. Remove all matching rows. (Per `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md`: filter + loop, not find.)
    3. Commit transaction.
    4. Call platform unfollow.
    5. On `{ ok: true }`: `removePendingFollowWrite({ platform, channelId, slug, action: 'unfollow' })` (pass both channelId and slug; dual-id match for cleanup).
    6. On `{ ok: false }`: `addPendingFollowWrite({ platform, channelId, slug, action: 'unfollow', lastError: result.message })`.
    7. Return result.
  - **Race gate**: the existing `inFlight: Set<string>` in `follow-store.ts:11-17` already serializes per-channel toggles. Push path inherits this — no new race primitive.
  - **No-token-on-push edge**: If the push handler is invoked but the token is missing (race: user signed out between click and handler), still write the local row as account-source (the user thought they were signed in) and record a pending_follow_write so reconciliation surfaces it on next sign-in.
- **Patterns to follow:** existing `FOLLOWS_ADD` / `FOLLOWS_REMOVE` handler structure in `storage-handlers.ts:38-65`; existing `inFlight` race gate in `follow-store.ts:11-17`; dual-id filter + loop in `follow-store.ts:78-125` (existing unfollowChannel implementation).
- **Test scenarios:**
  - **Covers AE1.** Signed-in Twitch user clicks Follow on a new channel → IPC `FOLLOWS_PUSH_TO_PLATFORM` fires with `action: 'follow'`; local row written as `source='account'`; `twitchClient.followUser` called with the correct targetUserId; on `{ ok: true }`, no `pending_follow_writes` row exists for this channel
  - **Covers AE2.** Same flow for Kick — `kickClient.followChannel` called with slug; row source='account'; no pending row on success
  - **Covers AE3.** Signed-in Twitch user clicks heart on an account-source row → row removed locally; `twitchClient.unfollowUser` called; redirect-to-twitch.tv toast does NOT appear (regression guard against old `isManagedByTwitch` branch)
  - **Covers AE4.** Same for Kick; redirect-to-kick.com toast does NOT appear
  - **Covers AE5.** Signed-in Twitch user clicks Follow + `twitchClient.followUser` returns `{ ok: false, kind: 'integrity' }` → local row remains as `source='account'`; `pending_follow_writes` row exists with `action='follow'`, `last_error` populated; no toast surfaces on the click
  - **Covers AE6.** Same for Kick with `kind: 'kasada'`
  - **Covers AE7.** Signed-in unfollow on Kick + unfollow push fails → local row stays removed; `pending_follow_writes` row exists with `action='unfollow'`
  - **Covers AE10.** Signed-out user clicks Follow → routes through original `FOLLOWS_ADD` (source='guest'); platform client never called; no `pending_follow_writes` interaction
  - Guest row click while signed in for the same channel doesn't promote: the row's existing `source='guest'` value is preserved (R13)
  - Race: rapid follow → unfollow → follow on the same channel within 200ms — `inFlight` gate ensures the second push doesn't fire until the first resolves; final state is consistent (channel is followed OR not, no orphan pending rows from interleaved writes)
  - Push handler called with no token in storage (user signed out between click and handler) → local row still written as `source='account'`; `pending_follow_writes` row exists; return value indicates unauthenticated
  - Guards:
    - `// Guards: source='account' written ONLY when signed in to the platform at click time`
    - `// Guards: unfollow uses filter+loop on (platform, channelId) AND (platform, slug) — not find — for dual-id safety`
    - `// Guards: redirect-to-platform.com toast for account-source rows is REMOVED — regression test asserts toast is never called for the (platform, account) combination`
- **Verification:** Integration tests with mocked platform clients; manual: log into both platforms, click Follow on test channels, observe LocalFollow rows with `source='account'` and channels appearing on platform-side followed lists.

---

### U7. Background sync awareness + Twitch periodic sync

- **Goal:** (a) Extend reconciliation to honor `pending_follow_writes` markers (preserve rows with pending follow that are absent from platform; don't re-adopt rows absent locally with pending unfollow). (b) Add a 15-min interval + on-focus periodic Twitch refresh mirroring Kick's existing `maybeRefreshKickFollows` pattern.
- **Requirements:** R8, R9, R11.
- **Dependencies:** U2 (pending_writes table).
- **Files:**
  - Modify: `apps/desktop/src/backend/ipc/handlers/auth-handlers.ts` — refactor `maybeRefreshKickFollows` into `maybeRefreshFollows(platform)` to handle both platforms; register a Twitch interval + focus listener; extend `syncFollowsOnLogin` for both platforms to use the pending-aware reconciliation
  - Modify: `apps/desktop/src/backend/services/storage-service.ts` — add `replaceAccountFollowsRespectingPending(platform, fetchedFollows, pendingWrites)`: a variant of `replaceAccountFollows` that consults pending_writes during the diff
  - Test: `apps/desktop/tests/backend/services/storage-service-pending-reconcile.test.ts`
  - Test: extend `apps/desktop/tests/backend/ipc/handlers/auth-handlers.test.ts`
- **Approach:**
  - **Reconciliation diff logic** (per origin F3):
    1. Read pending_writes for `platform`.
    2. Read existing local `account`-source rows for `platform`.
    3. For each row in `fetchedFollows` (from platform):
       - Has matching pending unfollow → **do not adopt** (tombstone honored); leave pending row in place; add to reconciliation list with `action: 'unfollow'`.
       - Otherwise → adopt as `account` source (existing import behavior).
    4. For each existing local `account` row NOT in `fetchedFollows`:
       - Has matching pending follow → **keep the local row** (push hasn't confirmed yet); leave pending row in place; add to reconciliation list with `action: 'follow'`.
       - Otherwise → remove (existing external-unfollow behavior).
    5. Externally-confirmed reconciliations (pending follow now in fetched list; pending unfollow now absent from fetched list) → remove the pending_writes row, since the platform has caught up.
    6. Wrap all writes in a single transaction (per `storage-service.ts:416-422` pattern).
    7. Emit `AUTH_FOLLOWS_SYNCED { platform, count, pendingCount }` — `count` is the new active follow count, `pendingCount` is the reconciliation list size for that platform.
  - **Twitch periodic sync**:
    - Refactor `maybeRefreshKickFollows` (`auth-handlers.ts:150-180`) into a platform-parameterized `maybeRefreshFollows(platform)`. Per-platform cooldown state (separate Map keyed by platform) so platforms don't share cooldown timestamps.
    - Register **unconditionally** at app start, mirroring the existing Kick wiring exactly (`auth-handlers.ts:181-182`): `setInterval(() => maybeRefreshFollows('twitch'), KICK_REFRESH_INTERVAL_MS)` and `mainWindow.on('focus', () => maybeRefreshFollows('twitch'))`. Do NOT gate the registration on token presence — that introduces teardown complexity and diverges from the Kick pattern.
    - **No-token guard lives INSIDE `maybeRefreshFollows`**, matching `auth-handlers.ts:169`: `if (!storageService.hasToken(platform)) return;`. Refresh fires only when the token exists for the platform; the interval ticks harmlessly otherwise.
- **Patterns to follow:** existing `maybeRefreshKickFollows` (`auth-handlers.ts:150-180`), `replaceAccountFollows` atomic helper (`storage-service.ts:416-422`), `channelsMatch` primitive (`apps/desktop/src/lib/id-utils.ts:105-115`) for matching pending rows to fetched rows via id OR slug.
- **Test scenarios:**
  - **Covers AE5 (continuation).** Sync with one pending follow row + that channel absent from platform list → local row preserved as `source='account'`; pending row preserved; emitted `pendingCount` = 1
  - **Covers AE6 (continuation).** Same for Kick
  - **Covers AE7.** Sync with one pending unfollow + that channel still in platform list → local row stays absent (NOT re-adopted); pending row preserved; emitted `pendingCount` = 1
  - **Covers AE9.** Sync with no pending markers + a row absent from platform list → row removed (existing import behavior preserved); `pendingCount` = 0
  - **Reconciliation success path**: sync with one pending follow + that channel now IN platform list → local row preserved (existing source unchanged); pending row REMOVED (push landed externally); `pendingCount` = 0
  - **Reconciliation success path**: sync with one pending unfollow + that channel now ABSENT from platform list → local row stays absent; pending row removed
  - Twitch periodic: with Twitch token present, `setInterval` fires after `KICK_REFRESH_INTERVAL_MS`; cooldown gate (60s) prevents rapid re-fire on focus storm
  - Twitch periodic: with no Twitch token, `setInterval` does not call the sync (early return)
  - Kick periodic regression: existing Kick behavior unchanged by the refactor (`maybeRefreshKickFollows` → `maybeRefreshFollows('kick')` should be a no-op-equivalent in observable behavior)
  - **Race (origin Deferred-to-Planning #4):** push fires during a sync — the sync queries pending_writes mid-diff, sees the row, preserves it. Test ordering: start sync → push completes → sync's diff step runs → row is preserved
  - Guards:
    - `// Guards: replaceAccountFollowsRespectingPending wraps the entire diff in a single transaction`
    - `// Guards: per-platform cooldown state is platform-keyed — Kick cooldown does not gate Twitch refresh`
- **Verification:** Integration tests; manual: log into both platforms, click Follow on a channel, kill the network during the push, wait 15min (or trigger focus event), observe the reconciliation banner appear.

---

### U8. Reconciliation banner via Sonner toast

- **Goal:** When `AUTH_FOLLOWS_SYNCED` arrives with `pendingCount > 0`, surface a per-platform persistent Sonner toast: "N follow(s) didn't sync to \[platform\] — retry?". Retry action re-fires the pending pushes; dismiss removes the toast for the session.
- **Requirements:** R9, R10.
- **Dependencies:** U6 (push path), U7 (sync emits per-platform pendingCount).
- **Files:**
  - Modify: `apps/desktop/src/store/auth-store.ts` (extend the existing `AUTH_FOLLOWS_SYNCED` handler at `:234-239` to surface the banner)
  - Modify: `apps/desktop/src/store/follow-store.ts` (add `retryPendingForPlatform(platform): Promise<void>` — queries pending rows, calls `follows.pushToPlatform` for each, returns when all settle)
  - Test: `apps/desktop/tests/store/follow-reconciliation-banner.test.tsx`
- **Approach:**
  - On `AUTH_FOLLOWS_SYNCED { platform, pendingCount }`:
    - If `pendingCount === 0`: `toast.dismiss(\`pending-sync-${platform}\`)` (clears any prior toast for this platform).
    - If `pendingCount > 0`:
      ```
      toast.error(`${pendingCount} follow${pendingCount === 1 ? '' : 's'} didn't sync to ${platformName} — retry?`, {
        id: `pending-sync-${platform}`,
        duration: Infinity,
        action: { label: 'Retry', onClick: () => retryPendingForPlatform(platform) },
        cancel: { label: 'Dismiss' },
      });
      ```
    - The `id` ensures Sonner updates the existing toast (per platform) rather than stacking multiple toasts for repeated syncs.
  - **One toast per platform** (per AE8): Twitch and Kick failures appear as separate toast instances, never combined.
  - **`retryPendingForPlatform(platform)`**:
    1. Query pending_writes for `platform` via IPC (`follows.getPendingByPlatform(platform)`).
    2. For each pending row: call `follows.pushToPlatform({ ...row, action: row.action })`.
    3. After all settle, do NOT manually dismiss the toast — wait for the next `AUTH_FOLLOWS_SYNCED` to fire from the next periodic sync (which will reflect the new pendingCount and either update the toast or dismiss it).
  - **Dismiss behavior**: dismissing the toast removes it from the screen for the session, but does NOT touch pending_writes. The next periodic sync will re-emit `AUTH_FOLLOWS_SYNCED` and the toast re-appears with the still-pending count. (Dismiss is "stop bothering me right now" not "I give up on this push.")
  - **Platform name display**: hardcode `"Twitch"` and `"Kick"` strings rather than capitalizing the platform key (`'twitch'` → `'Twitch'`). Add `PLATFORM_DISPLAY_NAMES: Record<Platform, string> = { twitch: "Twitch", kick: "Kick" }` to `apps/desktop/src/shared/auth-types.ts` adjacent to the existing `Platform` type definition (if it isn't already there — search first). Do not re-derive from the platform key at the call site.
- **Patterns to follow:** existing `toast(...)` shape with `action: { label, onClick }` in `follow-button.tsx:59-77` (Sonner is the lib); existing `AUTH_FOLLOWS_SYNCED` handler in `auth-store.ts:234-239`; `inFlight` pattern in `follow-store.ts` for any per-channel race protection during retry batch.
- **Test scenarios:**
  - **Covers AE8.** `AUTH_FOLLOWS_SYNCED` payload `{ platform: 'twitch', pendingCount: 1 }` followed by `{ platform: 'kick', pendingCount: 2 }` → two separate Sonner toasts appear with ids `pending-sync-twitch` and `pending-sync-kick`, copy `"1 follow didn't sync to Twitch — retry?"` and `"2 follows didn't sync to Kick — retry?"`. They do NOT combine into a single toast.
  - **Covers AE8 (singular/plural).** Singular case: `pendingCount: 1` → `"1 follow didn't sync"`; plural case: `pendingCount: 2` → `"2 follows didn't sync"`
  - Retry click → `retryPendingForPlatform('kick')` queries `getPendingByPlatform('kick')` → fires `follows.pushToPlatform` for each row → on full success, next sync's `AUTH_FOLLOWS_SYNCED { pendingCount: 0 }` dismisses the toast
  - Partial retry success: 2 pending → retry succeeds for 1, fails for 1 → next sync emits `pendingCount: 1` → toast updates in-place (same id) with `"1 follow didn't sync"`
  - Dismiss action removes the toast for the session but does NOT prevent the next sync from re-surfacing it
  - `AUTH_FOLLOWS_SYNCED` with `pendingCount: 0` for a platform → `toast.dismiss('pending-sync-${platform}')` is called (clears any prior toast)
  - Repeated `AUTH_FOLLOWS_SYNCED` with same `pendingCount` → existing toast updates (via id), does not duplicate
  - Twitch pending toast appearance does not affect Kick pending toast (independent ids)
- **Verification:** RTL render tests; manual: kill network mid-push, wait for sync, observe banner; click retry, observe push attempt; dismiss, observe banner clears; wait for next sync, observe banner returns if still pending.

---

## Key Technical Decisions

- **Bearer-first for Kick writes, BrowserWindow fallback only on 401/403.** Reason: existing Kick mutations (predictions, pin, mod) use plain Bearer `fetch` from the main process with no BrowserWindow involvement (`kick-prediction-mutations.ts`). Bearer is the cheap happy path — no mutex contention, no 6s page-render wait, no DOM mutation. The BrowserWindow fallback exists for the case where Bearer is rejected at the v2 follow endpoint specifically (as the read-side discovery on 2026-05-21 found for `/api/v2/channels/followed`). Network errors do NOT engage the fallback — only auth failures (401/403) do, because a network error isn't a signal that we need a different auth surface.
- **Twitch periodic sync added (15-min interval + on-focus), mirroring Kick.** Reason: origin R8 assumed both platforms have a background sync; today only Kick has one. Without a Twitch periodic sync, **R8 is undeliverable for Twitch** — a Twitch push failure goes unnoticed until next sign-in (potentially days later), making the reconciliation banner practically invisible. The addition is a compliance precondition for R8, not a scope creep — symmetric refresh keeps the reconciliation guarantee uniform across both platforms.
- **Reconciliation surface = Sonner toast with `duration: Infinity` + retry action.** Reason: no app-wide banner infrastructure exists outside chat in this codebase. Building a new banner widget for a feature that may rarely fire (most pushes succeed) is speculative infrastructure. The existing Sonner surface handles persistent toasts with action buttons natively; Sonner's `id` parameter makes per-platform toast updates idempotent.
- **`pending_follow_writes` as a separate companion table, not new columns on `local_follows`.** Reason: unfollow-pending semantics require a marker that exists when the LocalFollow row does NOT — a tombstone. A separate table fits this naturally; a column on LocalFollow would require keeping LocalFollow rows for "removed" follows in a soft-delete state, which contradicts the existing "rows present iff user follows" semantic. The separate table also keeps the LocalFollow row shape (already touched by the dual-id learning) unchanged.
- **No shared GQL-mutation helper extracted.** Reason: per AGENTS.md anti-pattern + CLAUDE.md "no abstractions for single-use code," and the third existing Twitch GQL mutation file (pin + prediction + follow) only reaches the typical "rule of three" threshold once U3 lands. The right time to extract a shared helper is in a follow-up refactor after all three exist; pre-extracting it during this plan would slow down U3 and risk getting the shared interface wrong.
- **`slug` carried alongside `channel_id` in `pending_follow_writes`.** Reason: `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md` documents that Kick rows may carry a stale `user_id` in `channel_id` and the slug is the stable identifier. Reconciliation needs to match pending rows to fetched rows via `channelsMatch (platform AND (id OR slug))`; storing slug in pending_writes makes this match work without re-querying LocalFollow.
- **Android Client-Id used for Twitch GQL writes.** Reason: per `twitch-gql-prediction-mutations.ts:35` and `twitch-gql-client.ts:60-64`, the Android Client-Id (`kd1unb4b3q4t58fwlpcbzcbnm76a8fp`) is the codebase's established pattern for GQL mutations because it bypasses the Client-Integrity pairing requirement the web Client-Id enforces. Re-using it for follow mutations is consistency, not novelty. If Twitch ever closes that bypass, it's a codebase-wide change, not a follow-specific one.
- **Discovery unit (U1) precedes mutation modules (U3/U4).** Reason: the brainstorm's plan assumes specific Twitch hashes and a specific Kick request shape. The U1 verification is cheap (one HTTP call each) and catches "Twitch locked GQL follow down too" or "Kick request shape differs from assumption" before U3 / U4 write code against bad assumptions.

---

## System-Wide Impact

- **`local_follows` table is unchanged.** All schema additions go to the new `pending_follow_writes` table. Existing rows, indexes, and queries are unaffected. The dual-id learning's `channelsMatch` primitive continues to work as-is.
- **OAuth scope sets on both platforms are unchanged.** Per origin Key Decision + research finding, neither platform requires a new scope for follow writes. No reconnect-rollout pain like the 2026-05-21 chat:write rollout.
- **Twitch periodic sync is new behavior.** Previously Twitch only synced on login. After this ships, the app will hit Helix `/channels/followed` every 15 minutes + on focus while signed in. Negligible load (once per 15min per user), no rate-limit concern.
- **FollowButton behavior changes for `account`-source rows on BOTH platforms.** Previously: redirect-to-platform.com toast. After this ships: instant local toggle + background push. Users who relied on the redirect-toast as a confirmation prompt before unfollowing will experience an unfamiliar one-click unfollow (mitigated by: unfollow is reversible by clicking again, and the reconciliation banner surfaces real failures).
- **Renderer-side `useFollowStore.toggleFollow` gains a branch.** Token-present-for-platform → push path; otherwise → existing guest path. The renderer subscribes to one additional IPC channel (`FOLLOWS_PUSH_TO_PLATFORM` response).
- **No IPC contract changes beyond the new `FOLLOWS_PUSH_TO_PLATFORM` channel.** Existing `FOLLOWS_ADD`, `FOLLOWS_REMOVE`, `AUTH_FOLLOWS_SYNCED` channels keep their shapes — `AUTH_FOLLOWS_SYNCED` gains a `pendingCount` field, additive, optional for backward compatibility during deploy.
- **No renderer-side store contract changes.** `useFollowStore.hydrate()` continues to read `account`-source rows via `getActiveFollowsByPlatform` (existing path). The new push path slots in between user click and IPC, not in the hydration flow.

---

## Scope Boundaries

Carried from origin's scope boundaries; this plan adds no scope beyond them.

- Migration of existing `guest`-source rows to `account`-source on either platform — explicitly rejected. Guest stays guest forever.
- Promotion UX for guest rows ("sync this local follow to the platform") — rejected.
- Bulk push of multiple follows in a single user action — out.
- Global "Push sync to \[platform\] is offline" indicator beyond the per-row toast — out.
- DOM-fallback for failed pushes on Kick — out (no rendered button surface to "click" programmatically).
- Switching Twitch to a session-cookie auth surface — out (OAuth Bearer through GQL `OAuth` scheme is sufficient).
- Switching Twitch to web Client-Id with integrity-token solver — out (Android Client-Id bypass is sufficient).
- Proactive session-cookie / OAuth-token health check before allowing a click — out.
- Circuit breaker / kill-switch after N consecutive failures in a session — deferred (see follow-up below).
- Settings UI for managing pending pushes — out.
- Additional click surfaces beyond `FollowButton` — out unless those surfaces already wrap `FollowButton`.
- Read-direction sync changes — out (existing Twitch Helix-based and Kick BrowserWindow / DOM-scrape import paths are untouched by this feature, except for the addition of the pending-aware reconciliation diff in U7).

### Deferred to Follow-Up Work

- **Shared GQL-mutation helper extraction.** After U3 lands, three Twitch GQL mutation files exist with substantial structural overlap (header construction, error classification, persisted-to-doc-string fallback, sanitizeMessage, isIntegrityRejectionError):
  - `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-pin-mutations.ts`
  - `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-prediction-mutations.ts`
  - `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-follow-mutations.ts` (new in this plan)

  Extracting a shared `postGqlMutation` helper that takes a typed config object is the right next refactor. Defer to a focused follow-up plan after all three are in production and the right shared interface is clearer.
- **`pending_follow_writes` row pruning.** If a user repeatedly hits failed pushes (e.g., persistent Kasada block on Kick) and never retries, pending rows accumulate. Pruning policy (e.g., delete rows older than 30 days, delete rows after N retry attempts) is out for v1 — defer until observed usage shows it matters. Until then, manual cleanup via SQLite CLI is acceptable.
- **Circuit breaker / kill-switch.** Origin Scope Boundaries punts on whether persistent failure (Kasada / integrity tightening) warrants suspending push attempts for the rest of the session. Defer to follow-up once real failure rates are observed.
- **Global "push sync offline" banner.** Origin Key Decision rejected this for v1. If users accumulate large pending lists in practice, a top-line indicator may be warranted. Defer.
- **Notifications-enabled toggle on follow.** The Twitch `FollowButton_FollowUser` mutation accepts `disableNotifications`, and Xtra exposes a notification-toggle via the `LiveNotificationsToggle_ToggleNotifications` mutation. Out of scope here (heart click is binary follow/unfollow), but a follow-up could add a per-channel notification preference UI.

---

## Risks and Mitigations

- **Risk: Twitch has restricted GQL follow mutations since Xtra's implementation was written.** Xtra is a working reference, but Twitch could have tightened the surface (similar to how Helix follow was removed in 2023). Mitigation: U1's discovery step catches this BEFORE U3 writes code. If verified-broken, U3 reduces to a stub returning `{ ok: false, kind: 'unsupported' }` and the FollowButton's Twitch redirect-toast in U6 stays in place for Twitch only — plan reduces to Kick-only push-sync without a structural rewrite.
- **Risk: Persisted-query hashes rotate during the development cycle.** Twitch rotated GQL hashes on 2025-11-11 per `twitch-gql-prediction-mutations.ts` header. Mitigation: U3's document-string fallback handles this transparently. If the persisted hash returns `PersistedQueryNotFound`, the doc-string path executes the same mutation with the same variables; the user never sees the rotation. Re-verify hashes at ship time and update.
- **Risk: Kasada policy tightens on Kick writes.** Kasada has tightened before (read path needed DOM-scrape fallback). Mitigation: BrowserWindow fallback already in U4 provides a second auth path; if BOTH Bearer AND BrowserWindow fail, the row stays in `pending_follow_writes` and surfaces via banner — user can retry. No silent data loss. If the failure rate becomes structural (Kasada blocks BrowserWindow page-context fetch too), the feature degrades to "push never works for Kick" but no data is lost — local rows are preserved, banner is honest about the state.
- **Risk: Race between push and background sync wipes a just-pushed row.** Mitigation: U7's `replaceAccountFollowsRespectingPending` reads pending_writes inside the same transaction as the diff, so a row added to pending_writes before the sync's diff step is honored. Test scenarios in U7 verify this ordering. Edge case: row added to pending_writes mid-transaction (after diff read, before commit) is unreachable in practice because both writes are main-process-serialized.
- **Risk: `pending_follow_writes` table grows unbounded.** Mitigation: rows are removed on success (U6 + U7). Persistent failures leave rows in place, but the count is bounded by user click rate. If observed usage shows large accumulation, pruning policy is queued for follow-up (see Deferred to Follow-Up Work).
- **Risk: Sonner toast `duration: Infinity` interacts poorly with screen readers or accessibility tooling.** Mitigation: existing chat-area banners and other Sonner toasts in the app use similar persistent patterns without incident; the retry + dismiss action buttons provide standard interactive controls.
- **Risk: Twitch periodic sync surfaces a stale `pendingCount` that doesn't match what the user just did.** Mitigation: `AUTH_FOLLOWS_SYNCED` always carries the freshest count from the just-finished sync; the toast uses `id` to update in-place rather than stacking. Brief inconsistency is bounded by the sync duration (<2s typically).
- **Risk: Removing the redirect-to-platform.com toast surprises users who relied on the redirect as a confirmation prompt.** Mitigation: unfollow is reversible (just click again). Users who really want a confirmation step can opt for the "Manage on \[platform\]" right-click menu (out of scope for v1; trivial follow-up if requested). For v1, accept that the symmetric optimistic UX is the intended UX.

---

## Deferred Implementation Notes

- **Exact Kick `/api/v2/channels/{slug}/follow` request body shape** — U1 captures this from live observation. Plan assumes empty body for POST and DELETE; if observation shows a `{ channel_id }` body or specific Content-Type, U4's mutation implementation adjusts before code lands.
- **Exact Twitch document-string fallback mutation field shape** — U1 verifies via persisted query first; doc-string is the fallback only if persisted fails. If U1 finds persisted works, the doc-string field-shape ambiguity doesn't need to be resolved until/unless rotation forces fallback.
- **Whether the Twitch `FollowButton_FollowUser` response includes a `follow.user.id` field** (used in `mapErrorCode`-style classification) — verify in U1 and adjust U3's parsing accordingly.
- **Renderer-side toast placement** — Sonner toasts mount via `apps/desktop/src/components/ToastRoot.tsx`. Confirm that ToastRoot is mounted at the app shell level (not inside a route that unmounts on navigation) so reconciliation toasts persist across page changes. If not, mount-level adjustment is part of U8.
- **`PendingWrite` TypeScript type location** — should it live in `apps/desktop/src/shared/auth-types.ts` (since it's IPC-bridge-relevant), `apps/desktop/src/backend/services/storage-service.ts` (file-local export), or a new shared types file? Decide during U2 based on which existing pattern fits cleanest.
- **The `maybeRefreshFollows(platform)` refactor scope** — refactoring the existing `maybeRefreshKickFollows` into a parameterized version vs. adding a parallel `maybeRefreshTwitchFollows` and deduping later. Decide during U7 based on how cleanly the cooldown state generalizes.

---

## Verification

Per-unit verification is listed under each Implementation Unit above. End-to-end manual verification after all units land:

1. Fresh install or clear session. Sign in to both Twitch and Kick.
2. **Happy-path follow (Twitch):** click Follow on a Twitch channel you don't follow → heart fills instantly, no toast appears on click. Within a few seconds, the channel appears on `https://twitch.tv/directory/following`.
3. **Happy-path follow (Kick):** same on a Kick channel. Channel appears on `https://kick.com/following/channels`.
4. **Happy-path unfollow (both platforms):** click heart on an account-source row you follow → heart empties instantly, no redirect-to-platform.com toast appears. Within a few seconds, the channel is gone from the platform's followed list.
5. **Failure simulation (Twitch):** mock-block `gql.twitch.tv/gql` in DevTools, click Follow → heart fills, no toast on click. Wait for next periodic sync (or trigger via focus event); reconciliation banner appears with copy `"1 follow didn't sync to Twitch — retry?"`. Click retry; if the block is removed, the banner clears on the next sync.
6. **Failure simulation (Kick):** mock-block `kick.com/api/v2/channels/*/follow` → same flow with `"1 follow didn't sync to Kick — retry?"`.
7. **Tombstone behavior:** unfollow an account-source Kick row → heart empties; mock-block the DELETE → row stays absent locally. On next sync, the row is NOT re-adopted from kick.com's followed list (which still shows the channel as followed because the DELETE didn't land); reconciliation banner surfaces the pending unfollow.
8. **External adoption preserved:** follow a channel on twitch.tv directly (not in the app) → on next periodic sync, the channel appears in the StreamFusion sidebar as an `account`-source follow. No banner (external adoption is not a divergence).
9. **Guest tier unchanged:** sign out of Kick. Click Follow on a Kick channel → heart fills, row written as `guest`-source. Heart click again unfollows locally. Sign back in to Kick. The guest row remains as `guest`-source (NOT promoted to account); the channel is NOT pushed to kick.com. Confirm `local_follows` shows `source='guest'` for the row.
10. **Two-tier coexistence:** while signed OUT of Kick, follow channel X locally (writes `guest` row). Sign in to Kick. Follow X on kick.com directly (NOT via the app's heart). Wait for next sync. Confirm BOTH a `guest` row and an `account` row exist for X. Unfollow on the heart while signed in → both rows removed; DELETE fires for the account row. (Note: per R12+R13, clicking Follow in the app while signed in always writes `source='account'` via the push path — the coexistence scenario requires the guest row to predate sign-in.)
