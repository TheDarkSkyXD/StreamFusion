---
title: Harden safeStorage Token Path — Remove Base64 Fallback
type: fix
status: active
date: 2026-05-22
origin: docs/brainstorms/2026-05-22-safestorage-fallback-hardening-requirements.md
---

# Harden safeStorage Token Path — Remove Base64 Fallback

## Summary

Rewrite `StorageService` so the only on-disk write path for OAuth tokens is `safeStorage.encryptString`. Packaged builds fail closed at init when no OS keychain is available; unpackaged dev builds warn loudly and skip persistence (in-memory token cache still works). A single imperative purge at `initialize()` removes any legacy base64-stored entries and any entry that fails to round-trip through `safeStorage`, keeping `hasToken()` and `getToken()` in agreement so the auth-refresh interval and guest-follows fallback continue to behave correctly.

---

## Problem Frame

The current `encryptToken` / `decryptToken` pair (`apps/desktop/src/backend/services/storage-service.ts:86-109`) silently base64-encodes OAuth tokens when `safeStorage.isEncryptionAvailable()` returns false — i.e. Linux without a running keyring service, some unpackaged dev builds, or a locked macOS Keychain. The only signal is a `console.warn` line that never reaches an end user. Tokens written under that branch land in `streamfusion-storage.json` as base64 — effectively plaintext — and include long-lived OAuth refresh tokens scoped to chat, mod, and channel-management permissions (see origin: `docs/brainstorms/2026-05-22-safestorage-fallback-hardening-requirements.md`).

This plan is the first of two sequenced items from the 2026-05-22 Cloudflare-key security audit. The Worker-auth follow-up (`docs/brainstorms/2026-05-22-worker-auth-and-proxy-removal-requirements.md`) introduces a per-install secret that is stored via the same `safeStorage` path; this fix must land before that work begins or the install secret inherits today's plaintext-fallback risk.

---

## Requirements

- R1. `encryptToken` MUST throw when `safeStorage.isEncryptionAvailable() === false`. There is no other code path through `encryptToken`.
- R2. `decryptToken` MUST throw when the stored payload's `mode` field is missing or not `"safeStorage"`.
- R3. `saveToken` and `saveAppToken` MUST catch the throw from `encryptToken`, clear the in-memory `tokenCache` entry for that platform, and propagate a typed error. They MUST NOT write to electron-store when encryption is unavailable.
- R4. `tokenCache` continues to hold a decrypted token for the lifetime of the process in dev environments where persistence has failed, preserving the dev workflow.
- R5. On `initialize()` with `!safeStorage.isEncryptionAvailable()` AND (`app.isPackaged === true` OR `process.env.NODE_ENV === "production"`), show a fatal `dialog.showErrorBox` modal explaining the OS-keychain requirement with platform-specific setup links, then `app.exit(1)`.
- R6. On `initialize()` with `!safeStorage.isEncryptionAvailable()` AND unpackaged AND `NODE_ENV` is `development`/`test`, emit a single high-visibility `console.error` line and continue startup.
- R7. The `EncryptedToken` interface in `apps/desktop/src/shared/auth-types.ts` gains a `mode: "safeStorage"` discriminator. The currently-unused `iv` field is removed in the same change (verified never set anywhere in the codebase).
- R8. On `initialize()`, after the encryption-available checks, scan both `authTokens` and `appTokens` and purge any entry that (a) lacks the `mode: "safeStorage"` field, OR (b) fails a try-decrypt round-trip via `safeStorage.decryptString`. This extends the brainstorm's literal R8 wording to also catch undecryptable-but-mode-present entries so `hasToken()` and `getToken()` remain consistent (rationale: see Key Technical Decisions).
- R9. No attempt is made to re-encrypt legacy entries in place. Purge-and-force-re-OAuth is the only migration path; the existing 401-retry / re-auth flow picks up naturally on the next API call.
- R10. The test suite at `apps/desktop/tests/backend/services/storage-service.test.ts` covers both branches: encryption available (new default mock) and encryption unavailable (per-test override). All R1–R8 behaviors have explicit test scenarios.
- R11. The existing `vi.mock("electron", …)` setup is restructured to (a) default `isEncryptionAvailable: () => true`, (b) include `app: { isPackaged: false }`, (c) include `dialog: { showErrorBox: vi.fn() }`, all with per-test overrides.
- R12. A short `docs/solutions/architecture-patterns/safestorage-failsafe-rule-2026-05-22.md` entry captures the rule for future contributors.

---

## Scope Boundaries

- No new encryption layer. TLS, `safeStorage`, and Wrangler secrets already cover every key-in-transit and key-at-rest path. Adding a second symmetric layer would be theater (see origin).
- No changes to non-credential storage. Preferences, follows, window bounds, and other `StorageSchema` fields stay unencrypted.
- No mid-session "keychain vanished" UI. If `safeStorage` stops being available after init, the next `saveToken` throws (R3), in-memory cache stays valid, and the existing 401-retry / re-auth path handles the eventual session re-bootstrap.
- No bundled keyring. The Linux requirement (install gnome-keyring / KWallet / libsecret) is documented; not shipped.
- No Worker-side changes. That's the sequenced follow-up plan.

### Deferred to Follow-Up Work

- The Worker authentication and proxy removal plan (target: `docs/brainstorms/2026-05-22-worker-auth-and-proxy-removal-requirements.md`) lands as a separate PR after this one is merged. The per-install secret it introduces depends on the failsafe path established here.

---

## Context & Research

### Relevant Code and Patterns

- `apps/desktop/src/backend/services/storage-service.ts:10` — single production consumer of `safeStorage` (confirmed via repo scan; blast radius is contained to this file).
- `apps/desktop/src/backend/services/storage-service.ts:86-109` — the current `encryptToken` / `decryptToken` pair with the base64 fallback that R1–R2 replace.
- `apps/desktop/src/backend/services/storage-service.ts:114-124, 202-211` — `saveToken` / `saveAppToken` that gain error handling per R3.
- `apps/desktop/src/backend/services/storage-service.ts:54-72` — `Store` initialization and `isEncryptionAvailable` capture; the init-time policy in R5/R6 lives here.
- `apps/desktop/src/backend/services/storage-service.ts:447-452` — `getPreferences` "shallow merge with defaults" is the closest analogue to a migration pattern in the codebase. The R8 purge does NOT use electron-store's `migrations` block (no precedent — see Key Technical Decisions).
- `apps/desktop/src/shared/auth-types.ts:13-23` — `AuthToken` and `EncryptedToken` definitions; lines 173-205 hold `StorageSchema`.
- `apps/desktop/src/main.ts:237` — the single call site of `storageService.initialize()`. No try/catch today; if `initialize()` throws, the unhandled rejection crashes startup with no user-facing dialog. The R5 fatal-dialog path is owned by `initialize()` itself rather than `main.ts` (see Key Technical Decisions).
- `apps/desktop/tests/backend/services/storage-service.test.ts:5-11` — current `electron` mock surface that R11 restructures.

### Institutional Learnings

- `docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md` — load-bearing constraint: `hasToken()` must remain a synchronous, trustworthy boolean. `auth-handlers.ts:150-182` (15-minute refresh interval + focus refresh) and `storage-service.ts:327-335` (`getActiveFollowsByPlatform`) both poll it. Any decrypt failure must resolve to "no token" — never throw — and `hasToken` must agree with `getToken`. This is the direct rationale for R8's purge extension beyond the brainstorm's literal wording.
- No prior `docs/solutions/` entries on `safeStorage`, DPAPI, Keychain, libsecret, or electron-store migrations. This is greenfield knowledge for the repo; capture via `/ce-compound` after merge.

### External References

- None required. Electron `safeStorage` and `dialog.showErrorBox` APIs are well-known; the design space is fully covered by the origin brainstorm and the local research.

---

## Key Technical Decisions

- **Fatal dialog uses `dialog.showErrorBox`, called from inside `initialize()`.** No existing `dialog.*` pattern exists in the codebase to mirror. `showErrorBox` works pre-window (relevant because `initialize()` runs at `main.ts:237`, before `windowManager.createMainWindow()` at line 265). Colocating the policy with the service that owns it (option 2 from research) keeps `main.ts` clean. Rejected: throwing from `initialize()` and wrapping the call in `main.ts` — splits the policy across two files.
- **Purge runs imperatively inside `initialize()`, not via electron-store's `migrations` option.** No `migrations:` block exists anywhere in the codebase (verified across all three `new Store(...)` call sites). The purge is one-pass and self-contained; introducing a migration framework for a single change is unjustified.
- **R8 purge extended beyond the brainstorm's literal wording.** The brainstorm's R8 said "purge entries missing a `mode` field." The learnings researcher surfaced that an entry can fail to decrypt for reasons other than missing-mode (corrupted keychain state, key rotation between OS upgrades), and if `hasToken()` returns true while `getToken()` returns null, the guest-follows fallback in `getActiveFollowsByPlatform` fails to fire and the user sees a stale identity. The extended purge does a try-decrypt round-trip on every entry that survives the mode check, removing any that fail.
- **`iv` field removed from `EncryptedToken`.** Currently declared but never assigned anywhere in the codebase (verified). Since we're already touching the type to add `mode`, this is a one-line cleanup with zero migration cost (never read either).
- **Double-gating policy: `app.isPackaged === true` OR `NODE_ENV === "production"`.** Belt-and-suspenders against a future packaging regression that misreports `isPackaged`. Two signals are cheap; a single source of truth is one config bug away from regressing the safety property. Per origin's R5.
- **Typed error from `saveToken` on encryption failure.** Define an `EncryptionUnavailableError` (extends `Error`) so callers can match on `instanceof` rather than parsing a message string. Used by R3 and exposed for future callers that may want bespoke handling.

---

## Open Questions

### Resolved During Planning

- **Where does the fatal dialog live?** Inside `initialize()`. See Key Technical Decisions.
- **Use electron-store's `migrations` block or imperative purge?** Imperative. See Key Technical Decisions.
- **Remove the unused `iv` field?** Yes. See Key Technical Decisions.
- **Extend R8 purge beyond mode-field check?** Yes — also purge undecryptable entries. See Key Technical Decisions.

### Deferred to Implementation

- Exact dialog copy and platform-link URLs. Get the wording right at implementation time when the writing context is fresh; the requirement is "explains the OS-keychain need with setup links," not specific URLs that may go stale.
- The `EncryptionUnavailableError` class location — `storage-service.ts` (local) vs `shared/auth-types.ts` (shared) vs a new errors module. Decide based on whether any other consumer ends up wanting to import it; default to colocated in `storage-service.ts` and re-export from there if needed.

---

## Implementation Units

### U1. EncryptedToken schema and the typed error

**Goal:** Update the type system so the rest of the work has a stable target. Add the `mode` discriminator, remove the unused `iv` field, and define `EncryptionUnavailableError`.

**Requirements:** R7

**Dependencies:** None

**Files:**
- Modify: `apps/desktop/src/shared/auth-types.ts`
- Modify: `apps/desktop/src/backend/services/storage-service.ts` (declare the error class; no behavior changes in this unit)

**Approach:**
- `EncryptedToken` becomes `{ encrypted: string; mode: "safeStorage" }`. The `iv` field is dropped (grep confirms zero readers / writers anywhere in the codebase). Removing it from the type is safe because U4's purge rewrites every stored entry on the next init, so any pre-existing on-disk `iv` value is dropped by that pass — the in-memory type and the on-disk shape converge atomically at init.
- `EncryptionUnavailableError extends Error` defined in `storage-service.ts`. Message-only. No extra properties — no current consumer iterates platforms, and the platform is always known from the call site (`saveToken("twitch", ...)`).
- U1 and U2 ship in the same atomic commit / same PR. No intermediate state exists where the type requires `mode` but `encryptToken` still produces values without it.

**Patterns to follow:**
- Existing typed errors aren't used in this repo for storage; this is the first. Keep it minimal — no error subclass hierarchy.

**Test scenarios:**
- Happy path: `new EncryptionUnavailableError("test")` is an `instanceof Error` and carries the message.
- Type-only: confirm `EncryptedToken` no longer admits the `iv` field (compile-time check via the existing `vitest --typecheck` if enabled, else a deliberate type-assertion test).
- Type-only: confirm `EncryptedToken` REQUIRES the `mode: "safeStorage"` field — an object literal `{ encrypted: "abc" }` without `mode` fails to satisfy the type, and `{ encrypted: "abc", mode: "wrong" }` also fails. This guards R7's positive requirement (mode is now mandatory), not just its negative half (iv is gone).

**Verification:**
- `npm run typecheck` passes on the modified files with no callers referencing `EncryptedToken.iv`.

---

### U2. Strict `encryptToken` and `decryptToken`

**Goal:** Remove the base64 fallback entirely from both functions. Every value written by `encryptToken` carries the `mode: "safeStorage"` discriminator; every value read by `decryptToken` is verified to match.

**Requirements:** R1, R2

**Dependencies:** U1

**Files:**
- Modify: `apps/desktop/src/backend/services/storage-service.ts` (lines 86-109)
- Test: `apps/desktop/tests/backend/services/storage-service.test.ts`

**Approach:**
- `encryptToken` becomes a single path: if `!this.isEncryptionAvailable` → throw `EncryptionUnavailableError`. Otherwise call `safeStorage.encryptString`, base64-encode the resulting buffer, return `{ encrypted, mode: "safeStorage" }`.
- `decryptToken` becomes a single path: if the input lacks `mode === "safeStorage"` → throw. Otherwise base64-decode and call `safeStorage.decryptString`. Existing `getToken` already catches errors from `decryptToken` and returns null, which is the correct downstream behavior for `hasToken`/`getToken` consistency (the learnings constraint).
- Remove the `console.warn("⚠️ safeStorage not available, using base64 fallback")` line — no longer reachable.

**Patterns to follow:**
- The throw + caller-catches pattern matches `getToken`'s existing error-handling shape.

**Test scenarios:**
- Happy path: `encryptToken("hello")` returns an object with `mode: "safeStorage"` and a non-empty `encrypted` string when the keychain mock returns available.
- Error path: `encryptToken("hello")` throws `EncryptionUnavailableError` when the keychain mock returns unavailable.
- Happy path: `decryptToken({ encrypted, mode: "safeStorage" })` returns the original plaintext.
- Error path: `decryptToken({ encrypted: "abc" } as any)` (no mode) throws.
- Error path: `decryptToken({ encrypted: "abc", mode: "wrong" } as any)` throws.

**Verification:**
- All scenarios above pass; no existing test exercises a base64 fallback path (it no longer exists).

---

### U3. `saveToken` / `saveAppToken` error handling

**Goal:** Make sure encryption failures don't write anything to disk and don't leave the in-memory cache holding a token that won't survive a restart.

**Requirements:** R3, R4

**Dependencies:** U2

**Files:**
- Modify: `apps/desktop/src/backend/services/storage-service.ts` (lines 114-124, 202-211)
- Test: `apps/desktop/tests/backend/services/storage-service.test.ts`

**Approach:**
- Wrap the `encryptToken` call in both `saveToken` and `saveAppToken` with try/catch on `EncryptionUnavailableError`.
- On catch: clear the relevant `tokenCache` / app-token-cache entry for the platform, do not write to `this.storeInstance`, re-throw the typed error so the caller knows the save didn't persist.
- The dev-mode behavior (R4: in-memory cache works for the session) is preserved by NOT clearing the cache *before* the catch — set the cache after a successful write, not before.
- Document the new throw in a single-line comment above each function so a future reader knows the contract.

**Patterns to follow:**
- The existing `try/catch` in `getToken` (`storage-service.ts:140-148`) is the closest analogue.

**Test scenarios:**
- Happy path: `saveToken("twitch", token)` with encryption available writes a `mode: "safeStorage"` entry and updates the cache.
- Error path: `saveToken("twitch", token)` with encryption unavailable throws `EncryptionUnavailableError`, does NOT write to the underlying store, and clears the cache entry for that platform (assert via `getToken("twitch")` returning null afterwards from the underlying store mock).
- Integration: `saveToken` after a prior successful save, then encryption becomes unavailable, then another `saveToken` — the previous on-disk entry is unchanged (we don't delete on failure, we just don't write), but the cache is cleared.
- Same three scenarios mirrored for `saveAppToken` / `getAppToken`.

**Verification:**
- All scenarios pass. No code path through `saveToken` or `saveAppToken` produces a write to electron-store when encryption is unavailable.

---

### U4. Init-time policy and legacy purge

**Goal:** Enforce the failsafe at startup. Production refuses without a keychain; dev warns. Purge any legacy or undecryptable entries that survive from previous versions.

**Requirements:** R5, R6, R8, R9

**Dependencies:** U2, U3

**Files:**
- Modify: `apps/desktop/src/backend/services/storage-service.ts` (`initialize` method, lines 51-72)
- Test: `apps/desktop/tests/backend/services/storage-service.test.ts`

**Approach:**
- After `this.store = new Store(...)`, capture `this.isEncryptionAvailable = safeStorage.isEncryptionAvailable()`.
- If `!this.isEncryptionAvailable`:
  - If `app.isPackaged || process.env.NODE_ENV === "production"` → call `dialog.showErrorBox(title, message)` with the keychain-required copy, then `app.exit(1)`. Do not return from `initialize()` in this branch.
  - Else (dev) → emit one `console.error` line with a clear, non-eye-glazing message naming the consequence ("⛔ OS keychain unavailable. Token persistence is DISABLED for this run; you will need to re-login on every restart. See docs/solutions/architecture-patterns/safestorage-failsafe-rule-2026-05-22.md."). Continue.
- If `this.isEncryptionAvailable === true`: run the legacy purge. Read `authTokens` and `appTokens` maps. For each entry: if `mode !== "safeStorage"` OR a try-decrypt of `encrypted` throws → remove the entry from the map. Write the cleaned maps back. Log a single summary line if any purges happened.
- The purge runs even when no migration is needed (every entry has `mode: "safeStorage"`); the cost is one `decryptString` per stored platform per init, which is negligible.

**Execution note:** Add the test for the legacy-purge scan first; it's the unit's load-bearing behavior and the easiest place to get an off-by-one wrong.

**Patterns to follow:**
- The `getPreferences` shallow-merge-with-defaults pattern at `storage-service.ts:447-452` is the closest analogue for "rehydrate on init"; the purge is structurally similar (read, transform, write back) without the merge.

**Test scenarios:**
- Happy path: `initialize()` with encryption available + no stored tokens → completes silently.
- Happy path: `initialize()` with encryption available + all entries carrying `mode: "safeStorage"` and decrypting cleanly → no purge happens, entries survive.
- Error path: `initialize()` with encryption unavailable + `app.isPackaged: true` → `dialog.showErrorBox` is called with non-empty arguments and `app.exit(1)` is called. (Mock `app.exit` to assert without actually exiting the test process.)
- Error path: `initialize()` with encryption unavailable + `app.isPackaged: false` + `NODE_ENV: "development"` → no dialog, one `console.error`, function returns normally.
- Edge case: `initialize()` with encryption available + a stored entry lacking `mode` → entry is purged from the store.
- Edge case: `initialize()` with encryption available + a stored entry with `mode: "safeStorage"` that fails to decrypt (mock `decryptString` to throw for one platform) → entry is purged.
- Integration: after a successful purge, `getToken("twitch")` returns null and `hasToken("twitch")` returns false — they agree.
- Edge case: `NODE_ENV === "test"` is treated like `development` (allowed, warns, no exit). Confirms vitest can exercise the dev path without `app.exit` firing.

**Verification:**
- Every scenario above passes. The four test environments (`packaged + has keychain`, `packaged + no keychain`, `dev + has keychain`, `dev + no keychain`) all produce the right behavior.

---

### U5. Test infrastructure restructure

**Goal:** Update the shared `electron` mock so both keychain branches and the new dialog/app surfaces are exercisable.

**Requirements:** R10, R11

**Dependencies:** U2, U3, U4 (the tests reference behaviors defined in those units; this unit ensures the mock harness can express them)

**Files:**
- Modify: `apps/desktop/tests/backend/services/storage-service.test.ts`

**Approach:**
- Replace the current `vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false, ... } }))` block with a factory-style mock that returns `vi.fn()` spies so per-test overrides work cleanly. Default: `isEncryptionAvailable: vi.fn(() => true)` — **must** be `vi.fn(...)` not a plain arrow function, otherwise `vi.mocked(...).mockReturnValue(false)` is a no-op and the per-test override appears to work but doesn't. Same wrapping applies to `app.isPackaged` (getter or method) and `app.exit`.
- Add `app: { get isPackaged() { return false; }, exit: vi.fn() }` to the mock — `isPackaged` is read as a property in main.ts, so use a getter the tests can stub via `vi.spyOn(app, "isPackaged", "get").mockReturnValue(true)`.
- Add `dialog: { showErrorBox: vi.fn() }` to the mock.
- Each U2/U3/U4 test that needs a non-default branch calls `vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)` (or equivalent for `app.isPackaged` via the getter spy) in its own `beforeEach` / inline setup.
- The existing follow-related tests (lines 57-106) keep working since they don't touch token paths — the default `isEncryptionAvailable: vi.fn(() => true)` doesn't affect them, but they DO run through `initialize()` which now runs the legacy purge against an empty store; verify the purge against an empty `authTokens`/`appTokens` map is a no-op and doesn't blow up.

**Patterns to follow:**
- `vi.mocked(...).mockReturnValue(...)` is the standard vitest pattern for per-test mock overrides. No new helper module needed.

**Test scenarios:**
- Test expectation: this unit is test-infrastructure work and is verified by the U2/U3/U4 tests passing. No standalone test scenarios.

**Verification:**
- All test scenarios from U2, U3, and U4 pass against the restructured mock surface. Existing follow-related tests at lines 57-106 continue to pass unchanged.

---

### U6. Docs note

**Goal:** Record the failsafe rule somewhere a future contributor will find before re-introducing a fallback.

**Requirements:** R12

**Dependencies:** None (can be written in parallel with the implementation units)

**Files:**
- Create: `docs/solutions/architecture-patterns/safestorage-failsafe-rule-2026-05-22.md`

**Approach:**
- Short note (≈100 lines max), follows the existing `docs/solutions/architecture-patterns/` frontmatter convention.
- Sections: the rule (no plaintext code path through `encryptToken`), the production-refuse + dev-warn policy, the legacy purge migration, the linked OAuth-tokens / Kick-auth-surface learnings that drove the `hasToken` consistency requirement.
- Frontmatter: `module: backend/services`, `tags: [security, auth, electron, safestorage]`, `problem_type: architecture_pattern`.

**Patterns to follow:**
- The existing `docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md` is a recent example; mirror its frontmatter shape and section structure.

**Test scenarios:**
- Test expectation: none — docs-only unit.

**Verification:**
- File exists at the path with valid frontmatter and links to the plan + brainstorm.

---

## System-Wide Impact

- **Interaction graph:** `auth-handlers.ts:150-182` (15-min refresh interval + on-focus refresh) and `storage-service.ts:327-335` (`getActiveFollowsByPlatform`) both poll `hasToken()`. The R8 purge keeps `hasToken()` and `getToken()` in agreement so neither caller sees a stale-identity / partial-decrypt state.
- **Error propagation:** `EncryptionUnavailableError` propagates up from `saveToken` / `saveAppToken` to callers in `auth-handlers.ts` and the OAuth flow code. Callers don't need to change — the existing OAuth re-flow on 401 picks up after an init-time refusal or a mid-session encryption failure. If a future caller wants to handle the error explicitly, they import the class.
- **State lifecycle risks:** A token that fails to write to disk but lives in `tokenCache` will not survive a process restart. Acceptable in dev (R4); impossible in production (R5 kills the process before any token is written).
- **API surface parity:** The `appTokens` path and the `authTokens` path are both covered (R3, R8). Both `saveToken` / `saveAppToken` and `getToken` / `getAppToken` see the same behavior.
- **Integration coverage:** `initialize()` is the single integration point at startup; tests cover the four environment combinations (`packaged × has-keychain × dev × NODE_ENV`).
- **Unchanged invariants:** Non-token storage paths (preferences, follows, window bounds) are untouched. `hasToken` remains synchronous. `getToken` continues to return null on any decrypt failure rather than throwing. The `tokenCache` semantics (process-lifetime, invalidated by save/clear) are unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Linux user on minimal install hits the fatal dialog and can't proceed. | Dialog copy includes platform-specific install instructions (gnome-keyring / seahorse / kwallet / Keychain Access). Documented in the new `docs/solutions/` entry. Accepted: a clear "install gnome-keyring" message is better than silently shipping refresh tokens in plaintext. |
| Dev workflow degrades to "re-login per `npm start`" when the dev machine lacks a keyring. | Acceptable per R4. The in-memory `tokenCache` works for the session; the warning at init makes the consequence visible. Devs who want persistence install libsecret locally. |
| Test mock restructure breaks unrelated tests. | The default mock flip (`true` instead of `false`) only affects tests that touch token paths. Follow-related tests (lines 57-106) don't touch `encryptToken`. U5's verification is "all existing tests still pass." |
| `dialog.showErrorBox` blocking semantics interact poorly with `app.exit(1)`. | `showErrorBox` is synchronous and returns after the user dismisses (or in headless environments returns immediately). `app.exit(1)` after the call works. Verified via Electron docs; no test environment runs the real dialog (mocked everywhere). |
| Future packaging bug makes `app.isPackaged` misreport as false in production. | Double-gated on `NODE_ENV === "production"` per R5. Two signals are cheap; the only way both lie simultaneously is a deliberate misconfiguration. |
| The R8 purge silently removes a working token because the keychain is in a temporarily-bad state at init. | Acceptable. User experiences a forced re-OAuth; tokens are short-lived (Twitch ~4h, Kick ~1h). The alternative — leaving an undecryptable entry to confuse `hasToken`/`getToken` mid-session — is strictly worse. |

---

## Documentation / Operational Notes

- The U6 `docs/solutions/` entry is the only documentation write target. No README or AGENTS.md edits are part of this plan.
- No rollout flags needed. The change is shipped in a single binary release.
- No monitoring changes. The dialog firing in production is itself the signal — it's user-visible and self-reporting.
- Post-merge follow-up: kick off the Worker auth plan (origin: `docs/brainstorms/2026-05-22-worker-auth-and-proxy-removal-requirements.md`) once this lands.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-22-safestorage-fallback-hardening-requirements.md](../brainstorms/2026-05-22-safestorage-fallback-hardening-requirements.md)
- **Sequenced follow-up brainstorm:** [docs/brainstorms/2026-05-22-worker-auth-and-proxy-removal-requirements.md](../brainstorms/2026-05-22-worker-auth-and-proxy-removal-requirements.md)
- **Load-bearing learning:** [docs/solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md](../solutions/architecture-patterns/kick-auth-surface-oauth-vs-session-cookies-2026-05-22.md)
- Related code: `apps/desktop/src/backend/services/storage-service.ts`, `apps/desktop/src/shared/auth-types.ts`, `apps/desktop/src/main.ts`
- Related tests: `apps/desktop/tests/backend/services/storage-service.test.ts`
