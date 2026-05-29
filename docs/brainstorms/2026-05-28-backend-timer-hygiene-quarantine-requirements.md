---
date: 2026-05-28
topic: backend-timer-hygiene-quarantine
status: ready for plan
---

# Backend Timer-Hygiene Quarantine — `AbortSignal.timeout` + `sleep` + `createManagedInterval`

## Summary

**SP3** of the 4-part timer-hygiene program. Quarantine the legitimate elapsed-time
backend timers behind a small set of sanctioned primitives, exactly as SP2 did for the
frontend:

- **Reuse `sleep(ms)`** (already shipped in SP2 at `apps/desktop/src/lib/sleep.ts`) for
  backoff / rate-limit waits.
- **`AbortSignal.timeout(ms)`** (native) for the abort-guard pattern.
- **New `createManagedInterval(callback, ms): { stop }`** in `apps/desktop/src/lib/` —
  the backend equivalent of `useInterval`, ~5 lines of code; lets SP4 ban raw
  `setInterval` with one sanctioned helper instead of ~20 per-file allowlists.

Roughly 76 raw `setTimeout`/`setInterval` grep matches across ~30 backend files; after
filtering grep noise (the 2 sanctioned timers in `web-contents-ready.ts`, type imports)
and the intentional out-of-scope sites (WS keepalive watchdogs, shutdown grace
deadlines, `Promise.race` navigation timeouts), the actual migration target is roughly
**24 abort-guards + ~5–8 backoff/rate-limit waits + ~20 `setInterval`s ≈ 50 sites** plus
the 2 borderline SP1 cookie waits folded in here. Behavior preserved exactly; no manual
verification needed (backend behavior is unit-testable, unlike player chrome).

> This is **not** an `async/await` task — it is timer-ownership cleanup. The frontend
> equivalent SP2 just shipped on `main` (commit `9876673`). SP4 (lint enforcement) is
> the capstone and is unblocked once SP3 lands.

---

## Primitives

1. **`sleep(ms: number): Promise<void>`** — already exists at `apps/desktop/src/lib/sleep.ts`
   (SP2). Pure JS; backend imports via `@/lib/sleep` or a relative path. Reuse as-is.
2. **`AbortSignal.timeout(ms)`** — native; no new code. Combine with another abort source
   via `AbortSignal.any([userSignal, AbortSignal.timeout(ms)])` when needed.
3. **`createManagedInterval(callback: () => void, ms: number): { stop: () => void }`** —
   NEW at `apps/desktop/src/lib/managed-interval.ts`. Implementation is a thin wrapper:

   ```ts
   export function createManagedInterval(
     callback: () => void,
     ms: number,
   ): { stop: () => void } {
     const id = setInterval(callback, ms);
     return { stop: () => clearInterval(id) };
   }
   ```

   Backend services start intervals imperatively at known cadences and stop them on
   shutdown/teardown, so the hook-like `null`-pause shape from `useInterval` is not
   needed here. The single sanctioned `setInterval` lives in this file; SP4's lint rule
   bans `setInterval` elsewhere.

---

## Phased Migration

> Line numbers below are a 2026-05-28 snapshot — **verify before editing**. The SP1
> backend-readiness audit established the inventory; see
> [`2026-05-26-backend-readiness-settimeout-fixes-requirements.md`](./2026-05-26-backend-readiness-settimeout-fixes-requirements.md)
> for context. Each phase ends green on `tsc` + full `vitest` before the next.

### Phase 0 — `createManagedInterval` + tests
Create `src/lib/managed-interval.ts` and `tests/lib/managed-interval.test.ts` (fake-timer
unit tests: fires every `ms`, `stop()` cancels, no fire after stop). No call-site
migrations yet.

### Phase 1 — Abort guards → `AbortSignal.timeout` (~24 sites; Pattern D)
```ts
// BEFORE
const controller = new AbortController();
const t = setTimeout(() => controller.abort(), MS);
try { await fetch(url, { signal: controller.signal }); } finally { clearTimeout(t); }
// AFTER
await fetch(url, { signal: AbortSignal.timeout(MS) });
```
If the original controller is ALSO aborted from another source (user cancel, parent
signal), don't drop that path — combine: `AbortSignal.any([existingSignal, AbortSignal.timeout(MS)])`.
Sites (snapshot — re-grep at plan time):
- `backend/services/http-client.ts` (request-deadline guard)
- `backend/services/vaft-pattern-service.ts` (fetch timeout)
- `backend/services/twitch-manifest-proxy.ts` (fetch timeout)
- `backend/services/chat/twitch-chat.ts` (`CONNECTION_TIMEOUT_MS` guard — keep watchdog
  behavior; only convert if it's a pure abort guard, else leave for the out-of-scope
  watchdog group)
- `backend/api/platforms/kick/kick-client.ts` (request timeouts, ×2)
- `backend/api/platforms/kick/kick-stream-resolver.ts` (URL validation + playback fetch)
- `backend/api/platforms/kick/endpoints/category-endpoints.ts` (category fetch)
- `backend/api/platforms/kick/endpoints/channel-endpoints.ts` (page-load timeout)
- `backend/api/platforms/kick/endpoints/chat-endpoints.ts` (page-load timeout)
- `backend/api/platforms/kick/endpoints/clip-endpoints.ts` (request timeout)
- `backend/api/platforms/kick/endpoints/follow-endpoints.ts` (fetch + warm-visit + page-load + executeJS timeouts)
- `backend/api/platforms/kick/endpoints/search-endpoints.ts` (request timeout)
- `backend/api/platforms/kick/endpoints/stream-endpoints.ts` (multiple request/load timeouts)
- `backend/api/platforms/kick/endpoints/video-endpoints.ts` (request timeout)
- `backend/api/platforms/twitch/twitch-requestor.ts` (request timeout)
- `backend/api/platforms/twitch/endpoints/chat-endpoints.ts` (request timeout)
- `backend/auth/oauth-callback-server.ts` (callback timeout — verify abort-vs-watchdog)

### Phase 2 — Backoff / rate-limit / settle → `sleep` (Pattern E)
`await new Promise((r) => setTimeout(r, ms))` → `await sleep(ms)` (`import { sleep } from "@/lib/sleep";`).
Sites (snapshot):
- `backend/services/chat/twitch-chat.ts` reconnect backoff (~837)
- `backend/services/chat/twitch-hermes-client.ts` reconnect backoff (~138)
- `backend/services/chat/kick-chat.ts` reconnect backoff (~1021)
- `backend/services/twitch-manifest-proxy.ts` exponential backoff
- `backend/api/platforms/twitch/twitch-requestor.ts` exponential backoff (server + network errors)
- `backend/api/platforms/kick/kick-client.ts` exponential backoff
- `backend/api/platforms/kick/kick-stream-resolver.ts` exponential backoff
- `backend/api/platforms/kick/endpoints/stream-endpoints.ts` exponential backoff w/ jitter + batch spacing
- `backend/api/platforms/kick/endpoints/category-endpoints.ts` rate-limit spacing delay
- `backend/api/platforms/twitch/twitch-eventsub-client.ts` reconnect backoff (~341)
- **SP1 borderline: `backend/api/platforms/kick/endpoints/follow-endpoints.ts:267`** —
  the 2.5 s warm-visit settle → `await sleep(2500)` (cleaner call site; behavior identical).

### Phase 3 — Backend `setInterval` → `createManagedInterval` (Pattern A-backend)
```ts
// BEFORE
const id = setInterval(() => doTick(), ms);
// ...later
clearInterval(id);
// AFTER
const tick = createManagedInterval(() => doTick(), ms);
// ...later
tick.stop();
```
Sites (snapshot — pollers / heartbeats / cache cleanups in singleton services):
- `backend/services/vaft-pattern-service.ts` (daily check + any others)
- `backend/services/update-service.ts` (hourly update check)
- `backend/services/emotes/emote-manager.ts` (cache cleanup)
- `backend/services/chat/twitch-pin-poller.ts` (10 s pin poll)
- `backend/services/chat/twitch-prediction-poller.ts` (5 s prediction poll)
- `backend/auth/device-code-flow.ts` (device-code polling interval)
- `backend/auth/twitch-auth.ts` (proactive token refresh schedule — if it uses
  `setInterval`; if it's a one-shot `setTimeout` chain, leave or convert with judgment)
- `backend/auth/auth-handlers.ts` (Kick + Twitch follow refresh intervals, ×2)
- `backend/api/platforms/kick/kick-client.ts` (rate-limit spacing interval, if present)
- `backend/api/platforms/kick/endpoints/channel-endpoints.ts` (5-min cache TTL eviction)
- `backend/api/platforms/kick/endpoints/stream-endpoints.ts` (60-min cache TTL eviction)
- **SP1 borderline: `backend/auth/auth-window.ts:310`** — the 1.5 s cookie-poll
  cadence inside `_waitForKickWebAuth` → `createManagedInterval(cb, 1500)`. (Keep the
  loop-style structure or refactor to start/stop semantics — implementer's call; behavior
  must be preserved.)

---

## Out of Scope (intentional; → SP4 allowlist)

- **WS keepalive watchdog `setTimeout`s** (~4 sites):
  - `backend/services/chat/twitch-hermes-client.ts:157` (server-ping deadline)
  - `backend/api/platforms/twitch/twitch-eventsub-client.ts:366` (EventSub message deadline)
  - `backend/services/chat/kick-chat.ts:291,317` (Pusher connect deadlines)
  - `backend/services/chat/twitch-chat.ts:179` (IRC connection-timeout watchdog inside
    `_doConnect`)
  Restart-on-event timeouts driven by EventEmitter listeners; reset on heartbeat/connect
  received and cleared correctly today. Restructuring to `AbortSignal`/promise-race would
  invert control flow inside delicate WS code — high cost, low benefit. Allowlist them
  in SP4.
- **Shutdown one-shot `setTimeout`s**:
  - `backend/window-manager.ts:169` (force-quit grace if renderer unresponsive)
  - `backend/main.ts` force-quit deadline (if present)
  Intentional fire-and-forget deadlines in shutdown flows. Leave + comment + allowlist.
- **`Promise.race([thing, setTimeout-reject])` navigation/load timeouts** in
  `follow-endpoints` and similar (~5–8 sites). The `withTimeout(promise, ms, label?)`
  util that would collapse these was deliberately scoped out — these stay raw + SP4
  allowlist.
- **The SP1 helper's own poll timer** (`backend/services/web-contents-ready.ts`'s
  internal `setTimeout` for the DOM-condition poll). It IS the sanctioned wrapper —
  SP4 allowlists this file.
- **`auth-window.ts:155`** (the 1.5 s success-page dwell before closing) and
  **`auth-window.ts:205`** (the in-page 100 ms click-poll injected via `executeJavaScript`).
  Already classified out of scope in SP1; remain so. The dwell is a deliberate UX pause;
  the in-page poll runs inside Kick's DOM, not Node.

---

## Verification

1. **Phase 0 helper:** unit tests in `apps/desktop/tests/lib/managed-interval.test.ts`
   with `vi.useFakeTimers()` — fires every `ms`, `stop()` cancels, no fire after stop.
2. **Phase 1–3 migrations:** the backend already has fake-timer-driven test suites for
   the most timing-sensitive services — `tests/backend/services/chat/twitch-chat.test.ts`,
   `kick-chat.test.ts`, `twitch-hermes-client.test.ts`, `twitch-prediction-poller.test.ts`,
   `twitch-pin-poller.test.ts`, `tests/backend/api/platforms/twitch/twitch-eventsub-client.test.ts`,
   `tests/backend/api/platforms/kick/kick-client-image-fetch.test.ts`,
   `tests/backend/api/platforms/kick/stream-endpoints.test.ts`,
   `tests/backend/services/update-service.test.ts`, etc. **These must stay green for
   every migrated service.**
3. **Per-phase gate:** `npm --prefix "apps/desktop" run typecheck` clean + `npm --prefix "apps/desktop" test`
   matches its pre-SP3 baseline (currently 201 files / 1654 tests passing). See
   [`reference: vitest-run-from-apps-desktop`] — running vitest from the repo root has
   no `@/` alias and yields false mass-failures; the correct command is the project
   `test` script.
4. **No manual matrix needed.** Backend behavior is unit-testable; the WS-reconnect /
   heartbeat / rate-limit cadences are exactly what the existing fake-timer tests cover.

---

## Risks & Assumptions

- **R1 — `AbortController` with other uses.** Some abort-guard sites combine the timeout
  with another signal (user cancel, parent abort). Per-site read; use
  `AbortSignal.any([existingSignal, AbortSignal.timeout(MS)])` rather than dropping the
  non-timeout path. Same caution that worked in SP2 Phase 4 (the adblock migrations).
- **R2 — WS-client tests are the canary.** Reconnect-backoff and rate-limit cadences in
  `twitch-chat`/`kick-chat`/`twitch-hermes-client`/`twitch-eventsub-client` are the
  highest-stakes timing changes; the existing fake-timer tests for these services MUST
  stay green through Phase 2 and Phase 3.
- **R3 — Behavior preservation.** `await sleep(ms)` and `clearInterval(id)` vs. `tick.stop()`
  must not change observable cadence or completion semantics. No batched commits; one
  commit per file so any regression is bisectable.
- **A1 — Singleton lifetime.** Backend services that own intervals are long-lived
  singletons; the absence of React-style mount/unmount churn is what makes the simple
  `{ stop }` API (vs. the frontend's `useInterval` ref-callback machinery) sufficient.
- **A2 — Zero raw timers is enforced only after SP4.** Without the lint rule the count
  can regress; SP3's "done" is the migrated areas being clean, not a permanent guarantee.
