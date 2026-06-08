## Problem Statement

When running StreamFusion, four distinct noise classes pollute the renderer DevTools console and the main session log, eroding the signal-to-noise ratio that developers and support agents rely on:

1. **SSL handshake -202 storms.** Chromium's native net stack logs `ssl_client_socket_impl handshake failed; returned -1, SSL error code 1, net_error -202` (`ERR_CERT_AUTHORITY_INVALID`) tens of times per minute in tight bursts. The hostname is recoverable via the existing `cert-verify-diagnostics` proc (tag `[CertVerify] [cert-debug-r8a2]`) but the bursts make real cert failures impossible to spot.
2. **7TV `/v3/users/KICK/{id}` 404s** for Kick channels that have not linked a 7TV account. The current `ApiClient` `afterResponse` hook logs every non-2xx at `[error]`, AND the request runs in the renderer so Chromium's DevTools Network panel surfaces a red `Failed to load resource: ... 404`. The 7TV provider already handles the 404 correctly (returns `[]` and logs at `info`); the noise is purely log/console pollution.
3. **Pusher `WebSocket is already in CLOSING or CLOSED state`** warnings from `pusher-js`. Triggered on Kick chat teardown because `disconnect()` / `forceShutdown()` in `kick-chat.ts` call per-channel `pusher.unsubscribe()` immediately before `pusher.disconnect()`, racing the socket close. `leaveChannel()` has the same race when a parallel disconnect runs.
4. **7TV CDN `net::ERR_CONNECTION_RESET 200 (OK)`** on emote image GETs. The `EmoteDialog` prefetch `pump()` bursts 16 parallel `new Image()` requests per `requestIdleCallback` tick to `cdn.7tv.app`. The CDN sends headers (200) then RSTs the connection mid-body under burst, leaving Chromium to log the partial-fetch failure.

Separately, `EmoteDialog.tsx` is misnamed: its own header comment calls it an "anchored-popover" and it has no modal behaviour (no backdrop, no focus trap, anchored to a button ref). The `role="dialog"` ARIA value is also incorrect for a non-modal popover.

## Solution

Each noise class gets a targeted, minimal-risk fix that removes the symptom without weakening real-error signal:

- **SSL**: deferred until the failing host is identified from `[CertVerify]` log lines. Not in scope for this PRD's implementation, but the open flag is documented so the diagnosis is not lost.
- **7TV API 404**: move the 7TV REST calls from the renderer (ky over browser `fetch`) into the main process behind new IPC channels, using Electron's `net.request`. Node-side requests do not appear in Chromium DevTools, so the 404 becomes invisible to the renderer console, matching the pattern KickTalk uses. The existing `ApiClient` `[error]` line also disappears for this call because the renderer no longer issues the request.
- **Pusher race**: drop the per-channel `pusher.unsubscribe()` calls from `disconnect()` and `forceShutdown()` (the Pusher server cleans up channel subscriptions on socket close), keep `unbind_all()` for local memory hygiene, and guard `leaveChannel()`'s `pusher.unsubscribe()` calls with `pusher.connection.state === 'connected'`.
- **CDN burst**: reduce the prefetch batch from 16 to a small constant (target 4 to 6 concurrent), add a one-shot `img.onerror` retry with jittered backoff, and silently give up on the second failure.
- **Rename**: `EmoteDialog` to `EmotePickerPopover` across the file, exports, importers, test file, `data-testid`, and ARIA role. Pure refactor + accessibility correctness bundled with the CDN burst fix because both touch the same file.

## User Stories

1. As a StreamFusion developer reviewing logs, I want the session log to be free of the SSL -202 burst noise when I am looking for real errors, so that the diagnostic signal I get from `[CertVerify]` warn lines is the surfaced one rather than buried under raw Chromium error lines. (Deferred; host identification pending.)
2. As a StreamFusion developer reading DevTools, I want the 7TV `/v3/users/KICK/{id}` 404 to NOT appear as a red `Failed to load resource` console line, so that the only red entries are real bugs.
3. As a StreamFusion developer reading session logs, I want the `Lib:ApiClient request failed` `[error]` line to NOT fire for the 7TV-Kick missing-emote-set case, so that the log's `[error]` filter shows only actionable failures.
4. As a Kick chat user, I want my chat session teardown to be silent in the console, so that the `WebSocket is already in CLOSING or CLOSED state` pusher-js warning does not appear when I close a stream slot or switch channels.
5. As a Kick chat user with multiview, I want `release()` and `leaveChannel()` to be safe when called from multiple paths simultaneously (React Strict Mode double-cleanup, multiview slot release, app shutdown), so that no race condition produces a spurious warning.
6. As a user opening the emote picker for a Kick stream with many third-party emotes, I want the prefetch to not flood the 7TV CDN with parallel requests, so that fewer images fail with `ERR_CONNECTION_RESET` mid-body and re-loads on scroll are smoother.
7. As a user whose first prefetch image fails due to a CDN RST, I want the prefetch loop to retry once silently, so that a transient CDN hiccup does not leave a broken image in the picker.
8. As a developer reading the component tree, I want the emote picker component to be named `EmotePickerPopover`, so that its name matches its actual UX role (anchored, non-modal popover) and the next reader does not have to study the source to learn it is not a true modal dialog.
9. As an accessibility-aware user using a screen reader, I want the emote picker to expose a non-modal ARIA role (region or no role, with `aria-label`), so that the screen reader does not announce it as a modal dialog and trap focus expectations.
10. As a developer running the test suite, I want the new `EmotePickerPopover.test.tsx` to assert the prefetch never opens more than `PREFETCH_BATCH_SIZE` concurrent image requests, so that any future regression that bumps the batch size is caught by CI.
11. As a developer running the test suite, I want `kick-chat.test.ts` to cover the guarded unsubscribe paths (connection state `disconnected`, in-flight disconnect) so that the Pusher race fix does not silently regress.
12. As a developer running the test suite, I want a new test file for the main-process 7TV service that asserts URL composition, status forwarding, and JSON error handling, so that the new transport's contract is locked in.
13. As a developer running the test suite, I want the existing renderer-side `7tv-emotes.test.ts` to be migrated from ky/nock mocks to `electronAPI.emotes` mocks, so that the test exercises the actual transport the production code uses.
14. As an architect reading `docs/adr/`, I want an ADR documenting why 7TV REST calls run in the main process (rather than the renderer or preload), so that the next person tempted to move them back has the rationale at hand.
15. As a future maintainer migrating BTTV and FFZ to the same pattern, I want a follow-up issue referenced from this PRD, so that the work is not lost between PRs.
16. As a developer changing the EmoteDialog file, I want the file rename and the CDN burst fix to ship together in one commit on that file, so that the git history shows one logical touch for that change-set rather than two adjacent renames of the same lines.

## Implementation Decisions

### A. 7TV REST in the main process (single biggest change)

- **New main-side service** in the emote-provider area. Owns the HTTP work for 7TV using `electron.net.request` (no new dependency, respects Electron session config / proxy settings). Exposes two functions: "get user by platform connection" and "get global emote set".
- **Two new IPC channels** added to the shared channels constant: `EMOTES_7TV_GET_USER_BY_CONNECTION` and `EMOTES_7TV_GET_GLOBAL_EMOTE_SET`. Naming follows the existing `AUTH_GET_*`, `STORE_GET`, etc. convention.
- **Main handlers** registered alongside other emote-related handlers; if no such bootstrap exists yet, add a small `registerEmoteHandlers()` module called from main bootstrap.
- **Preload surface**: `electronAPI.emotes.get7TVUserByConnection(platform, identifier)` and `electronAPI.emotes.get7TVGlobalEmoteSet()`. Add types to `shared/electron-api-types.ts`.
- **Renderer rewrite**: the existing `7tv-emotes.ts` (which carries the misleading `backend/services/` folder path despite running in the renderer) replaces `api.get(...).json()` with `electronAPI.emotes.*`. The 404 path returns a `null` sentinel (not a thrown error) so the renderer can log `info` and return `[]` without any `[error]` line. Transform logic (shape mapping from 7TV JSON to internal `Emote`) stays in the renderer for now; the main-side service returns parsed JSON only.
- **ADR**: write `docs/adr/0004-7tv-rest-in-main-process.md`. Decision drivers: (i) DevTools shows every renderer fetch failure; main-process Electron `net` does not appear in DevTools, (ii) the codebase already has a strong IPC pattern that preload+contextBridge does not, (iii) preload should stay thin for security and bundle size, (iv) KickTalk validates this exact pattern in production.

### B. Pusher race in `kick-chat.ts`

- `disconnect()`: stop calling `pusher.unsubscribe(v2)` / `pusher.unsubscribe(base)` per channel. Keep `unbind_all()` on each channel (drops 14 local event handler closures per channel; local memory hygiene). Then `pusher.disconnect()`. The Pusher server unsubscribes the client from its subscribed channels automatically on socket close.
- `forceShutdown()`: same pattern.
- `leaveChannel()` (single-channel teardown while the socket stays open): guard each `pusher.unsubscribe()` call with `this.pusher?.connection.state === 'connected'`. If the socket is in `connecting | unavailable | failed | disconnected`, the unsubscribe is a no-op locally; the channel is dropped from the local map regardless.

### C. EmoteDialog prefetch burst

- Module-private constant `PREFETCH_BATCH_SIZE` (initial value 4). Used by `pump()` to bound the per-tick `new Image()` count.
- `img.onerror` handler with one-shot retry: tracks attempted URLs in a `Set<string>` so a URL is retried at most once; second failure is silent. Retry delay: roughly 200ms plus jitter to avoid lockstep retries.
- `img.onload` clears the URL from the retry-tracking set so the Set does not grow unbounded across long sessions.

### D. EmoteDialog to EmotePickerPopover rename

- File: `EmoteDialog.tsx` to `EmotePickerPopover.tsx`. Test file: `EmoteDialog.test.tsx` to `EmotePickerPopover.test.tsx`.
- Renames inside the file: `EmoteDialog` (component), `EmoteDialogProps`, `EmoteDialogScope`, `EmoteDialogPlatform`, `EmoteDialogItem`, `EmoteDialogItemProps`. Public exports stay named exports (not default) for grep-friendliness.
- Importer updates: `NativeEmoteButton.tsx`, `ThirdPartyEmoteButton.tsx`, `ChatInput.tsx` (mock + comments), the existing test files that mock the module path.
- `data-testid="emote-dialog"` to `data-testid="emote-picker-popover"`.
- ARIA: `role="dialog"` is removed (a non-modal popover should not claim the `dialog` role). The existing `aria-label` is preserved. If a role is required for screen reader announcement, `role="region"` is the closest non-modal fit; if the picker can also be modelled as a listbox the team may choose that, open as a sub-decision during implementation. Default plan: drop the role, keep `aria-label`.

## Testing Decisions

A good test in this codebase asserts external behaviour visible at the seam, not internal helper invocations. Tests should drive against the same surfaces the production code uses: IPC handlers, exported functions, rendered output. They must NOT couple to specific log messages, internal Set membership, or implementation-private helper names.

- **`apps/desktop/tests/backend/services/chat/kick-chat.test.ts`** (existing). Add cases:
  - `leaveChannel(c)` when `pusher.connection.state === 'disconnected'` does not invoke `pusher.unsubscribe()` (assertion on the spied Pusher mock).
  - `disconnect()` and `forceShutdown()` do NOT call `pusher.unsubscribe()` per channel; they do call `unbind_all()` on each channel and `pusher.disconnect()` exactly once.
  - Prior art: the file already mocks `pusher-js` and asserts on its surface; new tests follow that pattern.
- **New `apps/desktop/tests/backend/services/emotes/7tv-emotes-service.test.ts`** (main-side). Mock `electron.net.request`. Cover URL composition (`v3/users/KICK/{id}` and the global emote set endpoint), 200 JSON parse, 404 returns the agreed sentinel, 5xx surfaces as an error to the IPC handler. Prior art: existing handler tests under `apps/desktop/tests/backend/ipc/handlers/`.
- **`apps/desktop/tests/backend/services/emotes/7tv-emotes.test.ts`** (existing, renderer-side). Replace ky/nock mocks with `electronAPI.emotes.*` mocks. Cover the same observable behaviour: 200 returns transformed emotes, 404 returns `[]` with no error log, network error returns `[]` and logs at `warn`.
- **`apps/desktop/tests/backend/ipc/handlers/`**: add a small test for the new IPC handlers that asserts the handler forwards to the service correctly. Prior art: existing handler tests in the same directory.
- **`apps/desktop/tests/components/chat/EmotePickerPopover.test.tsx`** (renamed). Add a new case that drives the prefetch effect and asserts the number of in-flight `new Image()` instances never exceeds `PREFETCH_BATCH_SIZE`. Counted via a `new Image()` mock that records constructions and resolves load synchronously. The test does NOT couple to retry timing; only batch bound and observable retry-on-error (one retry per URL).
- **Manual verification** for the full picture: open the app, load a Kick channel with no 7TV linked, open the third-party emote picker, watch DevTools Network. Expect zero red `404` lines for the 7TV user endpoint, and a sharp drop in `ERR_CONNECTION_RESET` lines for `cdn.7tv.app`. Watch the session log: no `Lib:ApiClient request failed` for 7TV Kick lookups, no `WebSocket is already in CLOSING or CLOSED state` on slot close / channel switch.

## Out of Scope

- **SSL handshake -202 root-cause fix.** Deferred until the failing host is identified from the `[CertVerify] [cert-debug-r8a2]` warn lines. Once the host is known, a follow-up issue will decide whether the fix is host-targeted (e.g. Pusher reconnect handling) or a noise filter for transient external failures.
- **BTTV and FFZ migration to the main process.** They share the same renderer-fetch DevTools-noise problem but were not in the user-reported logs. A follow-up issue will mirror the 7TV migration for those providers once 7TV is proven in production.
- **EmoteDialog component architecture rework.** Only the rename + ARIA correctness + prefetch tuning are in scope. Larger refactors (extracting the pump into a reusable hook, replacing `new Image()` with `<img loading="lazy">`, restructuring the sub-section state machine) are not addressed here.
- **Reworking `ApiClient`'s `afterResponse` hook globally.** The opt-out pattern was considered (`expectedStatuses: number[]`) but superseded by the structural move to the main process for 7TV. Other providers that still use the renderer-side ApiClient retain the current behaviour.
- **Replacing pusher-js or moving Kick chat to a different transport.** Out of scope; the race fix is the minimum change.

## Further Notes

- Grilling session notes (decision audit trail) live at `.scratch/grill-with-docs/2026-06-08-ssl-7tv-pusher-errors/notes.md` in the repo. Each grill question, the user's answer, and the rationale are captured there for traceability.
- The 7TV main-process migration warrants a new ADR (`docs/adr/0004-7tv-rest-in-main-process.md`) following the format established by ADR-0001 through ADR-0003. The ADR captures the architectural trade-off (main + IPC vs preload) that is not obvious from the diff alone.
- The two scope boundaries inside this PRD (Pusher fix vs 7TV migration vs CDN burst + rename) lend themselves to three logically-separable commits on the same branch. Implementation order suggested: Pusher race first (smallest, lowest risk, easiest to verify), then 7TV migration (largest, includes ADR), then CDN burst + rename (touches the same UI file, smaller blast radius).
- Sources consulted: KickTalk source at github.com/KickTalkOrg/KickTalk (`src/preload/index.js`, `utils/services/seventv/stvAPI.js`) which uses the same axios + preload pattern; SevenTV API source (route `users.by-connection.go`) confirming no 200-empty alternative endpoint exists; Electron issue tracker (#17946) confirming preload Node HTTP traffic does not appear in DevTools.
