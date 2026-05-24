---
date: 2026-05-22
topic: safestorage-fallback-hardening
---

# safeStorage Fallback Hardening — Remove Plaintext Token Path

## Summary

Eliminate the base64 plaintext fallback in `StorageService.encryptToken`/`decryptToken` (`apps/desktop/src/backend/services/storage-service.ts:86-109`) so OAuth access and refresh tokens can never land on disk in cleartext. Packaged builds fail closed on first run when the OS keychain is unavailable; unpackaged dev builds warn loudly and persist nothing. A one-time forced re-OAuth on upgrade purges any legacy base64-stored tokens that already exist on users' disks.

---

## Problem Frame

`StorageService.encryptToken` checks `safeStorage.isEncryptionAvailable()` and, when it returns false, silently base64-encodes the token and writes it to `streamfusion-storage.json` with the same `EncryptedToken.encrypted` field shape as a real ciphertext. The only signal is a `console.warn` line that no end user will ever see. The same fallback path covers `appTokens` (`storage-service.ts:202-211`), so platform App Access Tokens land in cleartext under the same conditions.

`safeStorage.isEncryptionAvailable()` returns false in three realistic scenarios:

1. Linux installs without an active keyring service (no GNOME Keyring, KWallet, or libsecret provider running).
2. Some unpackaged dev builds where Electron can't bind to the OS credential store.
3. macOS Keychain Access locked or otherwise unreachable.

In any of those, a user who logs into Twitch or Kick stores an OAuth **refresh token** — long-lived, scoped to broad chat/mod/channel-management permissions per `oauth-config.ts:74-105` — as base64 in a JSON file readable by any process running as that user. The current design has no failsafe: the only thing keeping tokens encrypted is a runtime branch that is allowed to silently take the unsafe path.

The encryption itself is not the gap. TLS already protects transport in both directions (desktop → CF Worker → IdP), Wrangler secrets cover client secrets at rest on Cloudflare, and `safeStorage` covers the happy-path desktop-at-rest surface. The fix is to remove the only remaining code path where plaintext can be written, not to add a new encryption layer.

---

## Requirements

**Strict-mode encryption (no plaintext code path)**

- R1. `StorageService.encryptToken` SHALL throw if `safeStorage.isEncryptionAvailable()` returns false. There SHALL be no code path through `encryptToken` that writes a value not produced by `safeStorage.encryptString`. The current `if (!this.isEncryptionAvailable) { ... base64 ... }` branch is removed entirely.
- R2. `StorageService.decryptToken` SHALL throw on any payload whose `mode` field (see R7) is not `"safeStorage"`. Legacy payloads without a `mode` field are treated as untrusted per R8.
- R3. `StorageService.saveToken` and `StorageService.saveAppToken` SHALL catch the throw from `encryptToken` (R1), clear the in-memory `tokenCache` entry for that platform, and surface a typed error to the caller. They SHALL NOT write any value to the underlying `electron-store` when encryption is unavailable.
- R4. The `tokenCache` (`storage-service.ts:49`) MAY still hold a decrypted token in process memory for the lifetime of the session in dev environments where persistence has failed. This preserves the dev workflow (one OAuth per `npm start`) without compromising on-disk safety.

**Init-time policy: refuse in production, warn in dev**

- R5. On `StorageService.initialize()`, if `safeStorage.isEncryptionAvailable() === false` AND (`app.isPackaged === true` OR `process.env.NODE_ENV === "production"`), the app SHALL show a fatal modal dialog and exit. The dialog content explains: "StreamFusion couldn't access your operating system's secure credential store. Tokens cannot be stored safely without it." with platform-specific setup links (gnome-keyring/seahorse on Linux GNOME, kwallet on KDE, Keychain Access on macOS). The dialog uses Electron's `dialog.showErrorBox` or a `BrowserWindow` modal — not just a console message.
- R6. On `StorageService.initialize()`, if `safeStorage.isEncryptionAvailable() === false` AND the app is unpackaged AND NODE_ENV is `development` or `test`, the app SHALL emit a single high-visibility `console.error` line (not `console.warn`) explaining persistence is disabled for this run, then continue startup. No fatal dialog in dev.

**Upgrade migration (one-time legacy purge)**

- R7. The `EncryptedToken` interface in `apps/desktop/src/shared/auth-types.ts` SHALL gain a `mode: "safeStorage"` discriminator field. New tokens written after this change always include `mode: "safeStorage"`.
- R8. On `StorageService.initialize()`, after the encryption-available checks (R5/R6), the service SHALL scan the persisted `authTokens` and `appTokens` maps. Any entry lacking a `mode` field (legacy base64 from before this change) SHALL be deleted from storage and logged. The user's next API call hits the existing 401-retry / re-OAuth path naturally — no special re-login UI is required.
- R9. No attempt SHALL be made to re-encrypt legacy base64-stored tokens in place. The token might have been written by a process running on a system that still can't access the keychain; forcing re-OAuth is the only safe move and tokens are short-lived (Twitch ~4h, Kick ~1h).

**Tests**

- R10. Unit tests in `apps/desktop/tests/backend/services/storage-service.test.ts` SHALL cover:
  - `encryptToken` throws when `safeStorage.isEncryptionAvailable()` returns false (replaces any test that currently asserts the base64 fallback writes a value).
  - `saveToken` does not write to the store when encryption is unavailable.
  - `initialize()` with encryption unavailable + `app.isPackaged === true` throws / triggers the fatal-dialog path (mock `app.isPackaged` and the dialog module).
  - `initialize()` with encryption unavailable + `app.isPackaged === false` logs an error but completes successfully.
  - A persisted token written by the old code path (no `mode` field) is detected and removed on init.
  - A persisted token with `mode: "safeStorage"` survives init and decrypts normally.
- R11. The existing test mock at `tests/backend/services/storage-service.test.ts:6-9` (which always returns `isEncryptionAvailable: () => true`) SHALL be extended with a second test setup that returns false, so both branches are exercised.

**Docs**

- R12. A short note SHALL be added to `apps/desktop/documentation/features/completed/phase-1-authentication-spec.md` (or a new `docs/solutions/architecture-patterns/` entry, per repo convention) recording: the failsafe rule, why the base64 path was removed, and the Linux keyring prerequisite. This makes the constraint discoverable to a future contributor before they re-introduce the fallback.

---

## Non-Goals

- **No new encryption layer.** TLS + `safeStorage` + Wrangler secrets already cover every "key in transit" and "key at rest" path. Adding application-layer crypto on top of TLS for the desktop↔Worker channel is theater — Cloudflare terminates TLS at the edge regardless, and any "end-to-end" key the desktop holds is shipped in an open-source binary.
- **No changes to non-credential storage.** Preferences, follows, window bounds, etc. stay unencrypted as they are today. Only token paths are tightened.
- **No Worker-side changes.** That work is the separate Brainstorm #2 (Worker auth / abuse prevention).
- **No mid-session keychain-failure UI.** If the keychain becomes unavailable while the app is running, the next save attempt throws (R1), the in-memory cache stays valid for the current session, and the existing 401-retry path picks up after restart. A dedicated "your keychain vanished" notification is deferred.
- **No bundled keyring.** We document the dependency on a system credential store; we do not ship one. Users on minimal Linux installs install gnome-keyring or kwallet themselves.

---

## Risks and Open Questions

- **Linux minimal-install users hit the fatal dialog.** Trade-off accepted: a clear "install gnome-keyring then restart" message is better than silently shipping their refresh tokens in plaintext. Linux is a small slice of the user base for a Twitch/Kick viewer client, and the affected sub-slice (Linux + no keyring) is smaller still.
- **Dev workflow on Linux without a keyring degrades to "re-login per `npm start`."** Acceptable, mirrors how a packaged production user would behave. Devs who want persistence install libsecret locally.
- **Double-gating via `app.isPackaged` AND `NODE_ENV` (R5).** Belt-and-suspenders against a future packaging regression that misreports `app.isPackaged`. Two signals are cheap; the alternative (a single source of truth) is one config bug away from a regression in the safety property.
- **Behavior under test runner.** Vitest sets `NODE_ENV === "test"` by default; tests run unpackaged. R6's branch covers this. No special-case logic needed.
- **`dialog.showErrorBox` vs custom BrowserWindow.** showErrorBox is simpler and runs pre-window. A custom dialog can render setup-link content and copy more cleanly. Planning-time decision; both meet R5.

---

## Verification

- Manual: on a Linux test VM without gnome-keyring installed, launch a packaged build → expect the fatal dialog. Install gnome-keyring, unlock it, relaunch → expect normal startup and successful Twitch login.
- Manual: from a packaged build with working keychain, sign in to Twitch and Kick, quit, locate `streamfusion-storage.json` on disk, confirm the stored `authTokens.twitch.encrypted` is binary-looking base64 (safeStorage ciphertext) and `mode === "safeStorage"`.
- Automated: vitest covers the policy branches per R10/R11.
- Regression: a smoke test that monkey-patches `safeStorage.isEncryptionAvailable` to false mid-session and asserts the next `saveToken` call throws + does not mutate `electron-store`.

---

## Handoff

Ready for `/ce-plan` to design the implementation. Plan should sequence: (1) `EncryptedToken.mode` schema + migration purge (R7/R8) first so subsequent code can depend on the discriminator, (2) strict `encryptToken`/`decryptToken` (R1/R2), (3) init-time policy + fatal dialog (R5/R6), (4) test rewrites (R10/R11), (5) docs (R12). Single PR — the surface area is small and the changes are interlocked.
