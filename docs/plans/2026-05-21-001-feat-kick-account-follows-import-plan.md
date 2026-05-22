---
date: 2026-05-21
status: active
type: feat
origin: docs/brainstorms/2026-05-21-kick-account-follows-import-requirements.md
---

# feat: Import Kick account follows on login

## Summary

After a user completes Kick OAuth login, the channels they follow on `kick.com` are imported into the local follow DB as `account`-source rows via the existing `syncFollowsOnLogin('kick')` path — matching the Twitch sync model. The fetch uses Kick's undocumented `kick.com/api/v2/channels/followed` endpoint through a hidden BrowserWindow that shares partition state with the OAuth login window.

---

## Problem Frame

`syncFollowsOnLogin('kick')` already fires on every Kick login, but `kickClient.getAllFollowedChannels()` in `apps/desktop/src/backend/api/platforms/kick/kick-client.ts:756-769` returns `[]` because Kick's official OAuth API has no follows-list endpoint (verified live against `docs.kick.com` on 2026-05-21). The user-visible result: Kick login completes, the app says "connected," and the user's actual Kick follow list never appears.

The only path to fetching the list is the undocumented internal `kick.com/api/v2/channels/followed` endpoint, which requires the user's `kick.com` apex session cookies (cookie auth) plus a Cloudflare clearance cookie. The existing `getPublicChannel` BrowserWindow pattern in `apps/desktop/src/backend/api/platforms/kick/endpoints/channel-endpoints.ts:224` does anonymous fetches via the `persist:kick_public` partition, which carries Cloudflare clearance but not user-session cookies. The Kick OAuth login window (`apps/desktop/src/backend/auth/auth-window.ts:76-91`) currently uses Electron's default session — so the user's `kick.com` session cookies, if they exist anywhere, are in the default partition and unreachable from `persist:kick_public`. Bridging that gap is the core architectural work.

---

## High-Level Technical Design

```
Existing today:
  ┌──────────────────────┐         ┌──────────────────────────┐
  │ Kick OAuth window    │ default │ Default Electron session │  ← session cookies (if any) land here
  │ auth-window.ts       │────────►│ (renderer + auth share)  │
  └──────────────────────┘ session └──────────────────────────┘
  ┌──────────────────────┐         ┌──────────────────────────┐
  │ getPublicChannel     │ persist:│ persist:kick_public      │  ← Cloudflare clearance from anon visits
  │ channel-endpoints.ts │ kick_   │                          │
  └──────────────────────┘ public  └──────────────────────────┘
                                          NO SHARED COOKIES

After this plan:
  ┌──────────────────────┐         ┌──────────────────────────┐
  │ Kick OAuth window    │         │                          │
  │ auth-window.ts       │────────►│                          │
  │  + post-OAuth navigate          │                          │
  │    kick.com once to    persist: │  persist:kick_public     │  ← Cloudflare clearance
  │    warm apex cookies   kick_    │  + apex kick.com         │    + user session cookies
  └──────────────────────┘ public   │  session cookies         │    (after OAuth + warm)
  ┌──────────────────────┐         │                          │
  │ getPublicChannel     │────────►│                          │
  │ NEW follow-endpoints │         │                          │
  └──────────────────────┘         └──────────────────────────┘

Sync flow:
  Login completes → auth-handlers.syncFollowsOnLogin('kick')
                  → kickClient.getAllFollowedChannels()
                  → FollowEndpoints.getAllFollowedChannels()
                       ├─ acquireBrowserWindowSlot()         (mutex)
                       ├─ check in-flight Promise guard
                       ├─ open hidden BrowserWindow @ persist:kick_public
                       ├─ load https://kick.com/api/v2/channels/followed
                       ├─ classify outcome: ok | empty | 401/403 | 5xx | parse | network
                       └─ release slot + destroy window
                  → storageService.clearAccountFollows('kick')
                  → storageService.addLocalFollow(..., 'account') ×N
                  → AUTH_FOLLOWS_SYNCED { platform: 'kick' }
                  → renderer hydrates useFollowStore, invalidates RQ caches
```

*This illustrates the intended approach and is directional guidance for review, not implementation specification.*

---

## Requirements Traceability

All eight origin requirements (R1-R8) are addressed across the implementation units:

| Origin | Carried by | Notes |
|---|---|---|
| R1 (import on login) | U4 | Wires `getAllFollowedChannels()` to FollowEndpoints — `syncFollowsOnLogin` unchanged |
| R2 (v2 endpoint, BrowserWindow) | U3 | Mirrors `getPublicChannel` BrowserWindow pattern |
| R3 (prune + reinsert on each sync) | U4 | Existing `storageService.clearAccountFollows('kick')` path preserved |
| R4 (`AUTH_FOLLOWS_SYNCED` notification) | unchanged | Already wired; verified by integration test in U3 |
| R5 (FollowButton redirect on Kick `account` rows) | U5 | Mirrors `isManagedByTwitch` branch |
| R6 (guest-row unfollow unchanged) | U5 | Regression guard test |
| R7 (silent fallback on fetch failure, no DB mutation) | U3 | Refined: empty=silent, auth/parse=warn-once, network=debug |
| R8 (no UI toast on failure) | U3 | Unchanged — refinement is log-channel only |

Acceptance examples AE1-AE5 from the origin map directly to U3 and U5 test scenarios; see per-unit test scenario lists below.

**Plan-time refinement of R7/R8.** The brainstorm specified "silent fallback" as a blanket rule. Plan-time research (`docs/solutions/conventions/polled-stub-empty-return-no-warn-2026-05-21.md`) refines this into per-cause behavior, distinguishing two senses of "empty":

- **Empty JSON array** (response body parses as `[]` or `{ data: [] }`) — user genuinely follows zero channels. Expected outcome, silent.
- **Empty HTTP body** (no content / network drop / Cloudflare HTML interstitial) — failure case, debug-log.

Auth and parse failures warn-once-per-session via a module-scoped Set so future maintainers can spot endpoint drift without a toast spamming on every login. No UI surface change from R8 — refinement is log-channel only.

---

## Implementation Units

### U1. Route Kick OAuth window through `persist:kick_public` and warm apex cookies on success

- **Goal:** Move the Kick OAuth login window into the same partition as `getPublicChannel`, then deposit the user's `kick.com` apex session cookies in that partition by navigating to `https://kick.com/` once after OAuth completes successfully.
- **Requirements:** Enables R2; foundational for U3.
- **Dependencies:** none.
- **Files:**
  - Modify: `apps/desktop/src/backend/auth/auth-window.ts`
  - Modify: `apps/desktop/src/backend/auth/kick-auth.ts` (or wherever the OAuth window's lifecycle is owned — Phase 1 research did not enumerate this file; verify during implementation)
  - Test: `apps/desktop/tests/backend/auth/auth-window.test.ts` (the `tests/backend/auth/` directory already exists with sibling tests for `oauth-config` and `twitch-auth-refresh` — do NOT flatten)
- **Approach:**
  - Pass `partition: 'persist:kick_public'` only on the Kick branch of `auth-window.ts`. Twitch OAuth path remains on its existing partition. The branch must be unambiguous — keyed off the `platform: 'kick'` argument, not URL pattern matching.
  - After OAuth completes successfully (token captured, before `win.close()`): trigger a navigation to `https://kick.com/`. Wait for `did-finish-load` or a short timeout (`~3s`) before closing the window. This visit causes Kick's app server to set the `kick_session` + `XSRF-TOKEN` cookies in `persist:kick_public` because the user is now authenticated.
  - On Cloudflare challenge during the kick.com warm visit, swallow the timeout and close the window — the user can still use the app; the subsequent `getAllFollowedChannels` call will fail gracefully via U3's error path.
  - The cookie-stripper at `apps/desktop/src/backend/services/third-party-cookie-stripper.ts` already carves out apex `kick.com` (per `docs/solutions/integration-issues/electron-third-party-cookie-cross-site-warnings-2026-05-19.md`). Verify the carve-out covers the OAuth partition's traffic; do NOT add `*://kick.com/*` to the stripper.
- **Patterns to follow:** Existing `webPreferences` shape in `auth-window.ts:76-91`. The `persist:` partition syntax used in `apps/desktop/src/backend/api/platforms/kick/endpoints/channel-endpoints.ts:317-326`.
- **Test scenarios:**
  - Happy path: Kick OAuth completes → BrowserWindow with `partition: 'persist:kick_public'` was opened (mock `BrowserWindow` constructor and assert `webPreferences.partition`).
  - Twitch login still uses its existing partition (regression — protect against accidental cross-platform partition change).
  - Post-OAuth warm: after token capture, the window navigates to `https://kick.com/` exactly once before close (mock `webContents.loadURL`).
  - Warm timeout: simulate `did-finish-load` never firing; window still closes within timeout budget; OAuth result is still returned to caller.
  - Cookie-stripper carve-out: `apps/desktop/tests/backend/services/third-party-cookie-stripper.test.ts` (if present) — assert apex `kick.com` is not in the stripper pattern list (per existing convention).
- **Verification:** Manual: log into Kick fresh, then open DevTools on the OAuth window before close → cookies for `kick.com` are visible in the partition. Automated tests for the partition assignment + warm navigation.

---

### U2. Add transformer for the v2 legacy followed-channel shape

- **Goal:** Map the `kick.com/api/v2/channels/followed` response shape (Laravel-style, nested under `user.*`) to `UnifiedChannel`.
- **Requirements:** Supports R1, R3.
- **Dependencies:** none.
- **Files:**
  - Modify: `apps/desktop/src/backend/api/platforms/kick/kick-transformers.ts` (add `transformKickFollowedChannelLegacy`)
  - Modify: `apps/desktop/src/backend/api/platforms/kick/kick-types.ts` (add interface for the v2 followed-channel JSON shape, e.g., `KickApiLegacyFollowedChannel`)
  - Test: `apps/desktop/tests/backend/api/platforms/kick/kick-transformers.test.ts` (create if missing)
- **Approach:**
  - The exact response shape is not in `docs.kick.com`. Community endpoint maps (`fb-sean/kick-website-endpoints`, `cibere/kick.py`) confirm the URL exists but don't document the JSON. Plan-time placeholder shape based on the `getPublicChannel` v2 response convention: `{ id, slug, user: { username, profile_pic }, ... }`. The transformer should defensively read each field with optional chaining and tolerate missing fields rather than throwing.
  - Use the existing `transformKickFollow(channel, followedAt)` in `kick-transformers.ts:135` as a structural reference (different source shape — that one is the official-API channel) but write the new transformer separately rather than overloading the existing one.
  - Output is `UnifiedChannel` with `id: channel.id?.toString()`, `username: channel.slug`, `displayName: channel.user?.username ?? channel.slug`, `avatarUrl: channel.user?.profile_pic ?? ''`, `platform: 'kick'`, `isLive: false` (live status is not authoritative from this endpoint — let the followed-streams poll determine liveness).
  - **Identity contract:** Always assign `id` from the response's channel id field (matches the dual-id rule from `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md` — `channel.id`, NOT `user_id`).
- **Patterns to follow:** `transformKickChannel` and `transformKickFollow` in the same file. Optional-chaining defensive pattern used throughout `kick-transformers.ts`.
- **Test scenarios:**
  - Happy path: well-formed response with all expected fields → returns expected `UnifiedChannel`.
  - Missing `user.profile_pic` → `avatarUrl` is empty string, no throw.
  - Missing `user` entirely → `displayName` falls back to `slug`, no throw.
  - Numeric `id` → coerced to string.
  - Guards: assert `id` is sourced from `channel.id` (regression for the `user_id` vs `channel.id` bug; cite SHA `99d3dd0` if available, otherwise reference the solution doc).
- **Verification:** Unit tests pass; transformer covers the defensive paths documented above.

---

### U3. New `follow-endpoints` module — fetch `/api/v2/channels/followed` via BrowserWindow with per-cause error classification

- **Goal:** Implement the actual HTTP fetch (via hidden BrowserWindow @ `persist:kick_public`) of the user's followed channels, parse with U2's transformer, and classify outcomes (success / empty / auth failure / network failure / parse failure) with per-cause logging.
- **Requirements:** R2, R7, R8.
- **Dependencies:** U1 (partition + warm), U2 (transformer).
- **Files:**
  - Create: `apps/desktop/src/backend/api/platforms/kick/endpoints/follow-endpoints.ts`
  - Test: `apps/desktop/tests/backend/api/platforms/kick/follow-endpoints.test.ts`
- **Approach:**
  - Export `getAllFollowedChannels(): Promise<UnifiedChannel[]>`. No `KickRequestor` arg — the call is BrowserWindow-driven, not `electron.net`-driven, so it follows `getPublicChannel`'s function signature, not the `KickRequestor`-taking endpoints.
  - **No `isNetworkLikelyDown()` gate.** Per `docs/solutions/integration-issues/kick-image-protocol-network-gate-latches-broken-images-2026-05-20.md`, the gate is for retry-loop callers; this is a one-shot triggered by login, where a latched gate would silently never sync.
  - Acquire `acquireBrowserWindowSlot()` (exported from `apps/desktop/src/backend/api/platforms/kick/endpoints/channel-endpoints.ts:246-255`). Wrap entire body in `try/finally { release(); win?.destroy(); }`.
  - **Single-flight Promise guard.** Module-scoped `let _inFlight: Promise<UnifiedChannel[]> | null = null`. If a second caller arrives while in flight, return the same Promise rather than opening a second window. Critical for the rapid-reconnect case (user closes Kick OAuth window quickly and retriggers). This guard layers on top of `acquireBrowserWindowSlot` — the slot mutex serializes window creation across all callers (including `getPublicChannel`), the in-flight guard prevents redundant fetches *within* this endpoint.
  - **AbortController per-call (optional safety).** If a new login retrigger arrives, abort the prior fetch and start fresh. Per `docs/solutions/architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md` filter `AbortError` out of the warn path so user retries don't pollute logs.
  - Open `BrowserWindow({ show: false, partition: 'persist:kick_public', webPreferences: { ... } })`. Load `https://kick.com/api/v2/channels/followed`. Read the response body via `webContents.executeJavaScript('document.body.innerText')` (same pattern as `getPublicChannel`).
  - **Outcome classification:**
    - JSON parses + array present, length > 0 → return mapped channels (silent).
    - JSON parses + empty array → return `[]` (silent — user follows zero channels is a valid outcome).
    - HTTP status 401 / 403 or response body indicates auth challenge → warn-once-per-session keyed on `'auth-failed'`, return `[]`.
    - JSON parse error or unexpected shape → warn-once-per-session keyed on `'parse-error'`, return `[]`.
    - Network error / Cloudflare HTML response → debug-log, return `[]`.
  - **Warn-once primitive:** Module-scoped `const _warned = new Set<string>()`. `if (!_warned.has(class)) { _warned.add(class); console.warn(...) }`. Same shape as `_publicChannelWarnedSlugs` in `channel-endpoints.ts`.
  - Do NOT throw to the caller. `syncFollowsOnLogin` already swallows errors at `auth-handlers.ts:104`, but the contract returning `[]` keeps the failure path explicit.
- **Patterns to follow:**
  - `getPublicChannel` in `channel-endpoints.ts:224-440` — the canonical BrowserWindow template (window construction, mutex, body extraction, JSON parse).
  - `_publicChannelWarnedSlugs` for the warn-once primitive.
  - `KICK_LEGACY_API_V2_BASE` from `kick-types.ts:343-346` (URL constant).
- **Test scenarios:**
  - **Covers AE1.** Happy path: 12 channels in response → returns 12 `UnifiedChannel` items in the same order. Spy on the transformer to confirm each was called once.
  - Empty list path: response `{ data: [] }` (or whatever the shape is) → returns `[]`. **No warn fired** (silent — architecturally valid outcome).
  - **Covers AE5.** Auth-failure path: response status 403 → returns `[]`, `console.warn` fired exactly once on first call. Second call same session → no warn fired (warn-once dedup).
  - Parse-error path: response body is invalid JSON or Cloudflare HTML → returns `[]`, warn fired exactly once with class `'parse-error'`.
  - Network-error path: window load fails → returns `[]`, debug-log only, no warn.
  - In-flight dedup: two concurrent callers within the same tick get the same Promise back; only one BrowserWindow constructor call (spy on the constructor).
  - Window cleanup: `win.destroy()` is called even when fetch throws.
  - **Guards:** `// Guards: regression — must NOT call isNetworkLikelyDown (per kick-image gate-latch learning)`. `// Guards: must call acquireBrowserWindowSlot before window open (mutex)`.
- **Verification:** Mock `BrowserWindow` + `webContents.executeJavaScript`; assert outcomes per scenario. Manual: log into Kick, watch console — exactly one of the four outcome classes fires.

---

### U4. Wire `kickClient.getAllFollowedChannels()` to FollowEndpoints

- **Goal:** Replace the stub at `kick-client.ts:756-769` with a delegation to the new endpoint module so `syncFollowsOnLogin('kick')` starts producing real data.
- **Requirements:** R1, R3, R4.
- **Dependencies:** U3.
- **Files:**
  - Modify: `apps/desktop/src/backend/api/platforms/kick/kick-client.ts` (replace both `getFollowedChannels` and `getAllFollowedChannels` bodies; the `_options` parameter on `getFollowedChannels` is currently unused — keep underscored or drop entirely since the v2 endpoint has no documented pagination args)
- **Approach:**
  - Add `import * as FollowEndpoints from "./endpoints/follow-endpoints"` near the other endpoint imports (line ~22-28 area).
  - `getAllFollowedChannels()` → `return FollowEndpoints.getAllFollowedChannels()`.
  - `getFollowedChannels(_options)` → wrap the all-follows result as `{ data: allFollows }` to honor the existing `PaginatedResult` shape. No real pagination — the v2 endpoint returns the full list (or at least, no community endpoint maps document a cursor for it). Document this in a comment so a future maintainer doesn't try to wire pagination through.
  - Remove the existing `console.warn` line in `getFollowedChannels` (it was the stub's contract; with U3 the warn lives in the endpoint module's per-cause logic).
- **Patterns to follow:** Existing delegation pattern at `kick-client.ts:597-799` (forwarder methods that simply call into endpoint modules).
- **Test scenarios:**
  - Method now returns transformer output rather than `[]` (smoke test with `FollowEndpoints` mocked).
  - `getFollowedChannels` returns `{ data }` shape with the list — preserves the `PaginatedResult` contract.
- **Verification:** Unit-level wiring test; integration is exercised via U3's tests.

---

### U5. FollowButton — add Kick account-row redirect branch

- **Goal:** When a user clicks the heart on a Kick channel whose `followSource === 'account'`, redirect to `kick.com` instead of mutating the local DB — mirroring the existing Twitch branch so the next sync doesn't re-add the row and bounce the heart.
- **Requirements:** R5, R6.
- **Dependencies:** none (independent of the import flow — protective even when import isn't shipped, but lands at the same time so the feature reads as complete).
- **Files:**
  - Modify: `apps/desktop/src/components/ui/follow-button.tsx`
  - Test: `apps/desktop/tests/components/ui/follow-button.test.tsx`
- **Approach:**
  - Add `buildKickChannelUrl(username)` near the existing `buildTwitchChannelUrl`: `https://kick.com/${encodeURIComponent(username.toLowerCase())}`. Kick usernames are case-insensitive and ASCII-only (same constraint Twitch uses); lowercasing matches kick.com's canonical URL form.
  - Add `isManagedByKick = platform === "kick" && followSource === "account"`. **The rationale comment differs from Twitch's:** Twitch's comment cites the 2023 endpoint removal as a hard constraint; Kick's comment should cite the brainstorm's product decision ("import-only by design — see `docs/brainstorms/2026-05-21-kick-account-follows-import-requirements.md`") so a future engineer reading the code doesn't conflate the two reasons.
  - Branch in `handleClick`: when `isManagedByKick && channel.username`, show the toast with title `"Manage this follow on Kick"`, description ``Open ${channel.displayName || channel.username} on kick.com to unfollow.``, and an `"Open Kick"` action that opens `buildKickChannelUrl(username)` via `openExternal`. Mirror Twitch's toast structure exactly so the UX reads as a parallel pattern, not a one-off — including the `description` field with the `displayName || username` interpolation.
  - Update the `title` attribute to include the Kick case: `"Followed via your Kick account — click to manage on kick.com"`.
- **Patterns to follow:** Existing `isManagedByTwitch` branch at `follow-button.tsx:36-56`. Existing toast structure (label + action callback).
- **Test scenarios:**
  - **Covers AE3.** Kick channel + `followSource: 'account'` + click → toast appears with "Open Kick" action; `toggleFollow` is NOT called; local DB unchanged.
  - **Covers AE3.** Clicking the toast's "Open Kick" action calls `openExternal` with `https://kick.com/{username}`.
  - **Covers AE4.** Kick channel + `followSource: 'guest'` + click → `toggleFollow` IS called (no redirect). Regression guard.
  - Twitch channel + `followSource: 'account'` + click → existing twitch.tv redirect still fires (regression guard).
  - Username with mixed case → URL is lowercase.
- **Verification:** RTL render tests; manual click-through on a real Kick-followed channel after U3 lands.

---

### U6. Clear `persist:kick_public` cookies on Kick logout

- **Goal:** When the user logs out of Kick, clear the session cookies in `persist:kick_public` so the next user (or the same user logging in fresh) doesn't inherit stale session state.
- **Requirements:** Closes a security gap introduced by U1. Brainstorm did not explicitly call this out — it's a plan-time addition required by U1's partition shift.
- **Dependencies:** U1. Note: U6 also depends on U1's file-location resolution — confirm the Kick logout handler's exact file (likely `auth-handlers.ts`, possibly also touches `kick-auth.ts`) at the same time U1 finalizes its file list.
- **Files:**
  - Modify: `apps/desktop/src/backend/ipc/handlers/auth-handlers.ts` (the `clearToken('kick')` / `clearKickUser` handler path, or wherever `logoutKick` is centralized in the main process — verify file ownership during implementation)
- **Approach:**
  - On Kick logout, after clearing the OAuth token and user data: clear all cookies for `kick.com` and `id.kick.com` from `persist:kick_public` via `session.fromPartition('persist:kick_public').clearStorageData({ storages: ['cookies'], origin: ... })` (or the per-cookie removal API if more surgical control is wanted).
  - Do NOT clear the Cloudflare clearance cookie (`cf_clearance`) — that's anonymous WAF state, reusable across sessions. Use cookie-name filtering: clear `kick_session`, `XSRF-TOKEN`, and any other Laravel/auth cookies, but preserve `cf_clearance` and `__cf_bm`.
  - Existing logout path also fires `kickAuthService.clearStorage()` etc — leave those untouched; add the partition cookie clear as an additional step.
- **Patterns to follow:** `session.fromPartition(...)` access pattern used elsewhere in the main process. The cookie-stripper at `apps/desktop/src/backend/services/third-party-cookie-stripper.ts` shows how cookie state on `persist:kick_public` is reasoned about elsewhere.
- **Test scenarios:**
  - Logout flow: assert `session.fromPartition('persist:kick_public').cookies.remove` (or equivalent) is called for `kick_session` and `XSRF-TOKEN`.
  - `cf_clearance` and `__cf_bm` are NOT removed (regression — preserve anonymous WAF state).
  - Logout with no prior cookies present: no throw, no error logged.
- **Verification:** Unit test on the logout handler. Manual: log in, log out, log in as a different Kick account → second login's imported follows match the second account, not the first.

---

## Key Technical Decisions

- **Partition strategy: route Kick OAuth through `persist:kick_public` and warm apex cookies post-OAuth.** Alternatives considered: (a) introduce a new dedicated `persist:kick_authed` partition — cleaner isolation but doubles the partition surface and requires re-tooling the cookie-stripper carve-outs; (b) use Electron's default session for both OAuth and the v2 fetch — inherits cookies easily but exposes kick.com state to the renderer's default session and mixes anonymous + authenticated state in a single jar. Chose `persist:kick_public` because the partition is already carved out of the cookie stripper, already carries Cloudflare clearance from anonymous pre-visits, and centralizes all kick.com main-process state in one place.
- **Failure-mode refinement: per-cause logging, no UI toast.** Refines origin R7/R8. Empty-list response stays silent (architecturally expected outcome). Auth (401/403) and parse failures warn-once-per-session via a module-scoped `Set<string>` keyed by failure class — preserves visibility for the future maintainer who needs to diagnose endpoint drift, without spamming the user. Network errors log at debug level only. The R8 commitment ("no user-visible toast") stands unchanged.
- **No `isNetworkLikelyDown()` gate on the v2 fetch.** Per `docs/solutions/integration-issues/kick-image-protocol-network-gate-latches-broken-images-2026-05-20.md`, the network-health gate is appropriate for retry-loop callers and harmful for one-shot callers like `syncFollowsOnLogin`. A latched gate during the brief post-OAuth window — likely, since OAuth itself produces ERR_FAILED bursts — would silently never sync.
- **Single-flight Promise guard + optional AbortController.** Module-scoped in-flight `Promise` makes concurrent callers share the same fetch instead of opening a second BrowserWindow. AbortController per-call provides a clean retrigger path if the user closes-and-reopens OAuth rapidly. Aligns with `docs/solutions/architecture-patterns/poll-fan-out-cache-stagger-pattern-2026-05-19.md`.
- **Defensive transformer.** Optional-chaining throughout, falls back to slug/empty-string rather than throwing on missing fields. The v2 response shape is undocumented; defensive parsing makes shape drift survive as a silent degradation rather than a sync failure.
- **No persistent client-side cache or TTL for the imported list.** Login is the only refresh trigger. Carries from the brainstorm. Re-evaluating later is cheap if real users complain about staleness.
- **No bidirectional sync.** Carries from the brainstorm — user explicitly chose import-only. The unfollow-redirect in U5 is the cost of this decision.

---

## System-Wide Impact

- **OAuth window partition change (U1) is the largest blast radius.** Users with an existing Kick session stored in the default partition's cookies will need to log in once after this ships. Acceptable one-time migration. No data loss.
- **Cookie clearing on Kick logout (U6) is new behavior.** Previously, logout was a no-op on partition cookies (because OAuth used the default partition). This is a security improvement, not a regression.
- **FollowButton (U5) changes a previously-impossible code path.** Today there are no Kick `account`-source rows, so the Kick branch of `isManagedByKick` never fires. After this ships, it fires for any imported channel. UX is identical to the existing Twitch behavior.
- **No IPC contract changes.** `AUTH_FOLLOWS_SYNCED` is already wired end-to-end.
- **No DB schema changes.** `LocalFollow` table already has the `source` column with `'guest' | 'account'` values.
- **No renderer-side store changes.** `useFollowStore.hydrate()` already reads `account`-source rows correctly via `storageService.getActiveFollowsByPlatform`.

---

## Scope Boundaries

Carried from origin's scope boundaries; this plan adds no scope beyond them.

- Bidirectional sync (POST `/api/v2/channels/{slug}/follow` on Follow click) — out.
- Multi-account scoping (different Kick user ids = different follow lists) — out.
- Periodic background re-sync between logins — out.
- Importing subscriptions, mod channels, blocked users — out.
- Migrating pre-login guest follows up to kick.com — out.
- A "Refresh my Kick follows" UI affordance — out.
- A user-visible toast or banner on fetch failure — out.

### Deferred to Follow-Up Work

- If the v2 endpoint shape turns out to require pagination, add cursor handling to `FollowEndpoints.getAllFollowedChannels()`. Defer until the response shape is observed in ce-work.
- The `kick.com` apex warm-visit logic in U1 may need a Cloudflare-challenge solve. If the warm visit reliably stalls on the challenge, consider opening it in a visible window briefly (one-time per session) rather than a hidden one. Defer pending observed behavior.

---

## Risks and Mitigations

- **Risk: The v2 response shape is undocumented and may not match the planned transformer.** Mitigation: U2's defensive parsing returns `[]` on shape mismatch rather than throwing. U3's warn-once-per-session on `parse-error` makes the drift visible to maintainers. The first ce-work run should manually verify the observed shape and update the transformer if needed.
- **Risk: The kick.com warm-visit may not deposit session cookies (e.g., if Kick's app server requires a specific user-agent or extra navigation).** Mitigation: U1's tests verify the navigation fires; ce-work must verify the cookies actually land via DevTools. If they don't, fallback is to extend the warm flow with a second navigation to a known authenticated endpoint (e.g., `/api/v2/user`).
- **Risk: Moving OAuth window to `persist:kick_public` introduces cross-pollination if anonymous browsing in that partition causes auth-context leakage.** Mitigation: `persist:kick_public` is already main-process-only (renderer doesn't share it). Anonymous `getPublicChannel` calls + authenticated OAuth in the same partition is the same trust boundary the browser would have — single user, single browser profile.
- **Risk: Cloudflare may rate-limit BrowserWindow-based fetches.** Mitigation: existing `acquireBrowserWindowSlot()` mutex already serializes all hidden-window traffic. The sync runs once per login, not per-poll.
- **Risk: The `_warned` Set never resets within a session, so endpoint drift between releases won't re-fire after the first warn.** Acceptable: warn-once-per-session is the convention; main-process restart on app relaunch resets the Set.

---

## Deferred Implementation Notes

- The exact file path for the Kick OAuth window's partition assignment (U1) was not fully traced during Phase 1 research — `apps/desktop/src/backend/auth/kick-auth.ts` and `auth-window.ts` likely both touch it. ce-work should grep for `BrowserWindow` constructor calls in the auth/ directory before editing.
- The exact response shape of `kick.com/api/v2/channels/followed` needs runtime observation. U2's transformer is written defensively; the test data may need updating after the first real fetch.
- The Kick logout file in U6 was not located precisely during research. Likely centralized in `auth-handlers.ts` (around the `logoutKick`-equivalent handler) but may also live in `kick-auth.ts`. Confirm before editing.
- Whether the cookie-stripper's existing carve-out applies cleanly to the OAuth partition's traffic (U1) requires checking the stripper's URL/host filter; if not, add the same `kick.com` apex carve-out test referenced in `docs/solutions/integration-issues/electron-third-party-cookie-cross-site-warnings-2026-05-19.md`.

---

## Verification

Per-unit verification is listed under each Implementation Unit above. End-to-end manual verification after all units land:

1. Fresh install / clear session. Open StreamForge, click "Connect Kick," complete OAuth.
2. Wait ~2-3 seconds for `syncFollowsOnLogin('kick')` to complete in the background.
3. Open the Following page → all kick.com follows are visible.
4. Open the sidebar → followed channels appear with the correct avatars and display names.
5. Click the heart on one of the imported channels → toast "Manage this follow on Kick" with "Open Kick" action; clicking the action opens the user's default browser to `https://kick.com/{username}`.
6. Click the heart on a channel the user has NOT followed on kick.com (so it becomes a local guest follow) → heart toggles, no toast.
7. Logout of Kick → session cookies cleared from `persist:kick_public`. Imported follows disappear from the UI (because `account`-source rows for Kick are cleared by `clearAccountFollows('kick')` — confirm). Guest follows remain.
8. Login as a different Kick account → that account's follows appear, not the previous user's.
