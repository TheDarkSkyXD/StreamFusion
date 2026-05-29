---
date: 2026-05-28
topic: lint-enforcement-no-raw-timers
status: ready for plan
---

# Lint Enforcement — Ban Raw `setTimeout` / `setInterval` Outside Sanctioned Helpers

## Summary

**SP4** of the 4-part timer-hygiene program, and the capstone. SP1–SP3 quarantined the
legitimate UI and backend timers behind sanctioned helpers (`@/lib/sleep`,
`@/lib/managed-interval`, `@/hooks/useInterval`/`useTimeout`/`useManagedTimeout`,
`@backend/services/web-contents-ready`). SP4 makes "zero raw `setTimeout`/`setInterval`"
*stick* — a regression of any new raw timer outside the sanctioned helpers becomes a test
failure.

The mechanism is **a single Vitest test** under `apps/desktop/tests/policy/`,
auto-gated by CI's existing `npm test` step (`.github/workflows/build.yml`). It scans
`apps/desktop/src/**/*.{ts,tsx}` for raw `setTimeout(` / `setInterval(` call
expressions, and fails on any match that isn't either (a) in a sanctioned file (file-path
wholesale allowlist) or (b) annotated with a `// timer-allowlist: <reason>` marker on the
same or previous line.

> **Why not biome / ESLint?** Biome has been baseline-red in this repo (see
> [[biome-baseline-red-autocrlf]]), so layering a new biome rule on top is fragile. ESLint
> would be a new tool added solely for this one rule. The Vitest test approach reuses the
> existing gate, requires no new tooling, and the inline `// timer-allowlist: <reason>`
> markers self-document each exception next to the code.

---

## Mechanism

### Test file
`apps/desktop/tests/policy/no-raw-timers.test.ts`. Plain `.ts` (no JSX), runs under
Vitest's default jsdom env (the env doesn't matter — the test reads files via `node:fs`).

### Detection
For each file under `apps/desktop/src/`:
1. Skip if the relative path is in the wholesale allowlist (see below).
2. Read the file as UTF-8; split into lines (handle CRLF + LF; the repo's `autocrlf`
   converts on Windows — strip `\r` from line ends).
3. Match each line against the regex `/\b(setTimeout|setInterval)\s*\(/`. This matches the
   call form and deliberately ignores type references like `ReturnType<typeof setTimeout>`
   (no `(` follows).
4. For each match, check if the same line OR the previous line contains the regex
   `/\/\/\s*timer-allowlist\b/`. If yes, the match is allowed. If no, it's a violation.

### Reporting
The test aggregates ALL violations (does not stop at the first) and fails with a single
multi-line message:
```
Raw setTimeout/setInterval without `// timer-allowlist: <reason>`:
  src/backend/services/chat/twitch-chat.ts:179:    const timeout = setTimeout(() => { ... });
  src/components/foo.tsx:42:    setInterval(() => bar(), 1000);

Fix: route the timer through one of the sanctioned helpers:
  - `@/lib/sleep`               for async backoff (await sleep(ms))
  - `@/lib/managed-interval`    for recurring backend intervals
  - `@/hooks/useInterval`       for React recurring intervals
  - `@/hooks/useTimeout`        for React declarative one-shots
  - `@/hooks/useManagedTimeout` for React imperative one-shots
  - `AbortSignal.timeout(ms)`   for fetch deadlines
OR if the raw timer is intentional, add a marker on the same or prior line:
  // timer-allowlist: <reason>
```

### Allowlist marker convention
`// timer-allowlist: <reason>` on the same or previous line as the call. The reason text
(everything after the colon) is REQUIRED. It documents *why* this raw timer is intentional
and links back to the SP1/2/3 decision when applicable. Example:
```ts
// timer-allowlist: pong watchdog reset on heartbeat; restructure-cost > benefit (SP3)
this.pongTimer = setTimeout(() => this.terminate("pong-timeout"), HEARTBEAT_MS);
```

---

## Wholesale-allowlist (file paths)

Files where ALL raw timers are sanctioned. These ARE the helpers or are dev-only tooling:

- `lib/sleep.ts` (Phase 0 of SP2; the sleep util)
- `lib/managed-interval.ts` (Phase 0 of SP3; the managed-interval util)
- `hooks/useDebounce.ts` (existing canonical model; never migrated)
- `hooks/useInterval.ts`, `hooks/useTimeout.ts`, `hooks/useManagedTimeout.ts` (SP2 primitives)
- `backend/services/web-contents-ready.ts` (SP1 sanctioned DOM-poll helper)
- `components/dev/PerfTool.tsx` (dev stress/sampling — out of scope per SP2 O5)
- `components/dev/interval-tracker.ts` (dev shim that intentionally wraps `setInterval` to
  count live timers; must use the raw API by definition — SP2 O5)

**Temporary:** `pages/Settings/index.tsx` with an explicit `// DEFERRED until WIP lands`
note in the allowlist constant. Once the user's uncommitted UI WIP on this file is
committed, a small follow-up tags the `:380` auto-dismiss setTimeout with an inline marker
(or migrates it to `useTimeout` since SP2's hook is now available) and removes the
wholesale exemption.

Test files (`apps/desktop/tests/**`) are excluded by the source glob — tests legitimately
use timers (and the lint test itself reads + writes regex-matchable strings).

---

## Phased Implementation

### Phase 0 — Build the lint test
Create `apps/desktop/tests/policy/no-raw-timers.test.ts` implementing the scan +
allowlist + reporting. Also write 2–3 self-tests using small string fixtures (not real
file I/O) to confirm:
- A fixture string with a raw `setTimeout(` and NO marker → flagged.
- A fixture string with the same call PLUS a `// timer-allowlist: reason` marker on the
  same line → not flagged.
- A fixture string with the marker on the PREVIOUS line → not flagged.
- (Optional) sanctioned-file path is skipped entirely.

Run the actual scan: at first commit of Phase 0, the test WILL fail with the full list of
remaining violations (every site listed in Phase 1's inventory). That's expected — the
failure IS the inventory. Phase 1 then drives it to green.

### Phase 1 — Tag every remaining individual exception
For each site in the inventory below, add a `// timer-allowlist: <reason>` marker on the
same or previous line. The reason text should be a one-line summary of WHY this raw timer
is intentional (link back to SP1/2/3 deliberate-exclusion decisions where applicable).
Re-grep each site at execution time (line numbers are a 2026-05-28 snapshot).

After Phase 1 the lint test passes; SP4 is done.

#### Inventory (~20 sites across ~14 files)

**WS keepalive watchdogs (4 sites):**
- `backend/services/chat/twitch-chat.ts:~179` — IRC connection-timeout watchdog inside
  `_doConnect`'s `connected`-event waiter. Reason: restart-on-event watchdog inside
  EventEmitter flow; restructure-cost > benefit (SP1/SP3).
- `backend/services/chat/twitch-hermes-client.ts:~151–157` — pong watchdog (server-ping
  deadline).
- `backend/api/platforms/twitch/twitch-eventsub-client.ts:~357` — EventSub keepalive
  watchdog.
- `backend/services/chat/kick-chat.ts:~291` and `~317` — Pusher connect deadlines.

**Promise.race navigation/load timeouts (~6 sites):**
- `backend/auth/oauth-callback-server.ts:~239` — raw `new Promise((_, reject) =>
  setTimeout(reject, ms))` constructor; not a fetch abort guard, so `AbortSignal.timeout`
  doesn't apply (SP3 P1-A — verified by subagent).
- `backend/api/platforms/kick/endpoints/channel-endpoints.ts:~331` — Promise.race timeout
  on `win.loadURL()`.
- `backend/api/platforms/kick/endpoints/chat-endpoints.ts:~91` — same shape.
- `backend/api/platforms/kick/endpoints/follow-endpoints.ts:~275`, `~336`, `~472` — three
  Promise.race timeouts (warm-visit, page-load, executeJS).

**Cancellable helper:**
- `backend/api/platforms/kick/endpoints/stream-endpoints.ts:~222` — `staggerDelay`
  cancellable stored-`setTimeout`+`clearTimeout` helper. Could be migrated later via a
  backend `createManagedTimeout` mirror of `useManagedTimeout`, but out of SP3 scope.

**Self-rescheduling chains / loops:**
- `backend/auth/twitch-auth.ts:~186` — `scheduleRefreshIn` self-rescheduling `setTimeout`
  chain for proactive token refresh.
- `components/chat/EmoteDialog.tsx:~667` and `~671` — emote prefetch `pump()` loop
  (rIC + setTimeout fallback that schedules itself).
- `components/player/hooks/use-video-lifecycle.ts:~197`, `~222`, `~232` — memory-pressure
  rIC + setTimeout loop (variable cadence; self-rescheduling).

**Shutdown / UX one-shots:**
- `backend/auth/auth-window.ts:155` — 1.5s success-page dwell before closing the OAuth
  window (deliberate UX pause).
- `backend/auth/auth-window.ts:~205` — 100 ms in-page click poll inside an
  `executeJavaScript` template string (runs in the page DOM, not Node — false-positive
  from the regex but exists as text in the file).
- `backend/window-manager.ts:~169` — force-quit grace if renderer is unresponsive
  (shutdown deadline).
- `backend/main.ts` force-quit deadline (verify exact line; if present).

**Non-React module-level cache eviction:**
- `hooks/useStreamPlayback.ts:~126` — TTL eviction inside `subscribePlayback`, a plain
  function outside React (can't use the React hooks; module-level interval).

---

## Verification

- The lint test itself includes self-tests (fixtures) so it's not just "trust the run."
- After Phase 1: full suite at the SP3 baseline (currently 202 files / 1658 tests
  passing) + the new lint test passing = the merged main + this lint test green.
- `npm --prefix "apps/desktop" run typecheck` clean (the test is plain TS).
- CI's existing `npm test` step in `.github/workflows/build.yml` gates the rule on every
  PR build without any new wiring.

---

## Out of Scope

- **Biome baseline-red repair.** The lint test deliberately does NOT depend on biome; SP4
  is unblocked regardless of biome's state. Fixing the biome baseline is a separate,
  unrelated cleanup that someone could do later.
- **New helpers / new migrations.** SP1–SP3 are the migration phases; SP4 only locks
  what's already migrated.
- **Other "must not regress" patterns.** SP4 is scoped to raw `setTimeout`/`setInterval`.
  Future patterns (`requestIdleCallback`, etc.) can follow the same pattern in their own
  spec.
- **Migrating the staggerDelay / twitch-auth chain / Settings:380 / EmoteDialog pump.**
  These remain raw with an allowlist marker; future SP-style sub-projects could revisit
  any of them with appropriate primitives (e.g., a backend `createManagedTimeout`).

---

## Risks & Assumptions

- **R1 — Regex false positives in strings/comments.** A `setTimeout(` literal inside a
  string or comment matches the regex (e.g., `auth-window.ts:~205`'s in-page click poll
  lives inside an `executeJavaScript` template string). Mitigated by per-line markers —
  any such case gets `// timer-allowlist: <reason>`. The test isn't trying to be a full
  parser; the marker convention closes the gap cheaply.
- **R2 — Marker drift.** If someone moves a `setTimeout` call away from its marker, the
  test catches it (the marker has to be on the same or previous line). Working as intended.
- **R3 — Settings/index.tsx WIP entanglement.** Wholesale-allowlisting it is temporary
  tech debt: when the user's WIP lands, a follow-up tags `:380` with an inline marker
  (or migrates to `useTimeout`) and removes the wholesale exemption. The allowlist entry
  carries a `// DEFERRED` comment so the follow-up is obvious.
- **R4 — `main.ts` line numbers may drift.** Re-grep at execution. If `main.ts` has no
  raw timers post-SP1/SP2/SP3, skip it.
- **A1 — Test environment.** The test reads files via `node:fs` — independent of Vitest's
  default jsdom env. No DOM needed.
