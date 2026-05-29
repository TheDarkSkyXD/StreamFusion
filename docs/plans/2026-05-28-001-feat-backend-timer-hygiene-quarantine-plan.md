# Backend Timer-Hygiene Quarantine (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quarantine the legitimate elapsed-time backend timers behind three primitives — `sleep` (reused from SP2), native `AbortSignal.timeout`, and a new `createManagedInterval(cb, ms) → {stop}` — so SP4's lint rule can ban raw `setTimeout`/`setInterval` with a small explicit allowlist instead of per-file noise.

**Architecture:** Phase 0 builds the one new util (`createManagedInterval`, ~5 lines, in `src/lib/`) with fake-timer unit tests. Phases 1–3 then migrate ~50 backend call sites via three documented patterns: abort guards → `AbortSignal.timeout` (Pattern D from SP2), backoff/rate-limit waits → `await sleep` (Pattern E from SP2), and `setInterval` → `createManagedInterval` (new Pattern F). Behavior preserved exactly; the existing fake-timer-driven WS-client tests are the canary.

**Tech Stack:** TypeScript, Vitest (`vi.useFakeTimers()`, jsdom default env, `@/` alias).

**Spec:** [`docs/brainstorms/2026-05-28-backend-timer-hygiene-quarantine-requirements.md`](../brainstorms/2026-05-28-backend-timer-hygiene-quarantine-requirements.md)

> **Commands (use EXACTLY — the `@/` alias only resolves with `apps/desktop`'s vitest config):**
> - Typecheck: `npm --prefix "apps/desktop" run typecheck` (run from repo root)
> - Full suite: `npm --prefix "apps/desktop" test` (run from repo root). Do **NOT** run `npx vitest` or `npm exec vitest` from the repo root — that picks up a different vitest with no alias config and makes every `@/`-importing test falsely fail (a subagent misdiagnosed this during SP2; the project has a memory entry for it).
> - Single test file: in your Bash tool, `cd "apps/desktop"` first, then `npx vitest run tests/<path>`.
> - Git commands run from repo root. Stage ONLY each task's files — there is unrelated uncommitted WIP in the tree; NEVER `git add -A`/`.`.

> **Baseline going in:** `main` is at `9876673` (SP2 merged + pushed). Full suite = 201 files / 1654 tests passing. Branch `refactor/backend-timer-hygiene` off `main` before starting.

> **Line numbers in the migration phases are a 2026-05-28 snapshot — re-grep each site before editing.**

---

## File Structure

**Create (Phase 0):**
- `apps/desktop/src/lib/managed-interval.ts` — `createManagedInterval(cb, ms): { stop }` util (~5 lines).
- `apps/desktop/tests/lib/managed-interval.test.ts` — fake-timer unit tests.

**Modify (Phases 1–3):** ~30 backend files under `apps/desktop/src/backend/**` — enumerated per phase.

---

# PHASE 0 — `createManagedInterval` util (full TDD)

## Task 1: Build the util

**Files:**
- Create: `apps/desktop/src/lib/managed-interval.ts`
- Test: `apps/desktop/tests/lib/managed-interval.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/lib/managed-interval.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createManagedInterval } from "@/lib/managed-interval";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createManagedInterval", () => {
  it("calls the callback every `ms`", () => {
    const cb = vi.fn();
    createManagedInterval(cb, 1000);
    expect(cb).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("stop() cancels: no further calls after stop", () => {
    const cb = vi.fn();
    const handle = createManagedInterval(cb, 1000);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
    handle.stop();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("stop() is idempotent (calling it twice does not throw)", () => {
    const cb = vi.fn();
    const handle = createManagedInterval(cb, 1000);
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("returns a stable `stop` handle (no re-arming on subsequent calls)", () => {
    const cb = vi.fn();
    const handle = createManagedInterval(cb, 1000);
    const stopRef1 = handle.stop;
    // (no semantic guarantee beyond "stop is a function" — just sanity)
    expect(typeof stopRef1).toBe("function");
    handle.stop();
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run (from `apps/desktop/`): `npx vitest run tests/lib/managed-interval.test.ts`
Expected: FAIL — cannot resolve `@/lib/managed-interval`.

- [ ] **Step 3: Implement the util**

Create `apps/desktop/src/lib/managed-interval.ts`:

```ts
/**
 * Wrapper around setInterval providing a single sanctioned cancel-safe API for
 * backend (Node/Electron-main) recurring timers. Returns a stable `{ stop }`
 * handle; `stop()` calls clearInterval and is idempotent. There is no
 * `null`-pause shape (unlike the React `useInterval`) because backend services
 * start intervals imperatively at known cadences and stop them on teardown.
 *
 * NOTE: the internal `setInterval` is the single sanctioned recurring timer —
 * SP4's lint rule allowlists this file and bans raw `setInterval` elsewhere.
 */
export function createManagedInterval(
  callback: () => void,
  ms: number,
): { stop: () => void } {
  const id = setInterval(callback, ms);
  return { stop: () => clearInterval(id) };
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run tests/lib/managed-interval.test.ts` → 4 passed.

- [ ] **Step 5: Typecheck + commit**

Run `npx tsc --noEmit` from `apps/desktop/` → clean.

```bash
git add apps/desktop/src/lib/managed-interval.ts apps/desktop/tests/lib/managed-interval.test.ts
git commit -m "feat(lib): add createManagedInterval cancel-safe recurring-timer util"
```

---

# PHASES 1–3 — Migration Playbook

Phases 1–3 are mechanical applications of the three patterns below. Per-site workflow
(**one task = one file**, since each file's commit is independently bisectable):

1. **Re-grep** the file for `setTimeout`/`setInterval` (line numbers below are a 2026-05-28 snapshot).
2. **Match** each timer to a pattern (D / E / F) and apply the transformation verbatim.
3. **Remove** orphaned `setTimeout`/`setInterval` handles, manual `clearTimeout`/`clearInterval`, and any `try/finally` that existed only to clear them (CLAUDE.md §3 — clean up what your change orphaned). Keep all non-timer logic.
4. **Test:** if the file has an existing fake-timer test suite (most of `tests/backend/services/chat/*`, `twitch-eventsub-client.test.ts`, `kick-client-image-fetch.test.ts`, `stream-endpoints.test.ts`, `update-service.test.ts`, the various poller tests), run it and confirm it stays green. Do not invent heavy new test harnesses for untested files.
5. **Verify:** `npx tsc --noEmit` clean.
6. **Commit** (stage only the touched file(s)): `git commit -m "refactor(<area>): <site> -> <hook/util>"`.

After each phase, run the **full** suite (`npm --prefix "apps/desktop" test`) and confirm 1654/1654 green before starting the next phase.

## Transformation Patterns

**Pattern D — abort guard → `AbortSignal.timeout` / `AbortSignal.any`** (from SP2 Phase 4):

```ts
// BEFORE
const controller = new AbortController();
const t = setTimeout(() => controller.abort(), MS);
try { await fetch(url, { signal: controller.signal }); } finally { clearTimeout(t); }

// AFTER (no other abort source)
await fetch(url, { signal: AbortSignal.timeout(MS) });

// AFTER (combined with an existing abort source — do not drop it)
await fetch(url, { signal: AbortSignal.any([existingSignal, AbortSignal.timeout(MS)]) });
```

**Pattern E — backoff / rate-limit / settle → `sleep`** (from SP2):

```ts
// BEFORE
await new Promise((resolve) => setTimeout(resolve, backoffMs));
// AFTER
await sleep(backoffMs);   // import { sleep } from "@/lib/sleep";
```

**Pattern F — backend `setInterval` → `createManagedInterval`** (NEW for SP3):

```ts
// BEFORE
const intervalId = setInterval(() => doTick(), MS);
// ...later (teardown / stop):
clearInterval(intervalId);

// AFTER
const tick = createManagedInterval(() => doTick(), MS);   // import { createManagedInterval } from "@/lib/managed-interval";
// ...later (teardown / stop):
tick.stop();
```

Store the `{stop}` handle in the same field/closure that previously held the interval id (rename the field e.g. `pollIntervalId` → `pollTimer`). Remove the orphan `intervalId` declaration.

---

## Phase 1 — Abort guards → `AbortSignal.timeout` (Pattern D)
One task per file. **Critical:** before simplifying, read the `AbortController`'s OTHER uses in the same function — if it's also aborted from another source (user cancel, parent signal, an unrelated condition), use `AbortSignal.any([existingSignal, AbortSignal.timeout(MS)])` rather than dropping the non-timeout path. When in doubt, leave the controller and just link in `AbortSignal.timeout` via `AbortSignal.any`.

- [ ] `backend/services/http-client.ts` (request-deadline guard ~line 276)
- [ ] `backend/services/vaft-pattern-service.ts` (fetch timeout ~line 184)
- [ ] `backend/services/twitch-manifest-proxy.ts` (fetch timeout ~line 109)
- [ ] `backend/api/platforms/kick/kick-client.ts` (request timeouts ~lines 162, 305)
- [ ] `backend/api/platforms/kick/kick-stream-resolver.ts` (URL-validation ~33, playback fetch ~99)
- [ ] `backend/api/platforms/kick/endpoints/category-endpoints.ts` (category fetch ~line 74)
- [ ] `backend/api/platforms/kick/endpoints/channel-endpoints.ts` (page-load timeout ~line 331)
- [ ] `backend/api/platforms/kick/endpoints/chat-endpoints.ts` (page-load timeout ~line 91)
- [ ] `backend/api/platforms/kick/endpoints/clip-endpoints.ts` (request timeout ~line 41)
- [ ] `backend/api/platforms/kick/endpoints/follow-endpoints.ts` (fetch ~116, warm-visit ~259, page-load ~320, executeJS ~451)
- [ ] `backend/api/platforms/kick/endpoints/search-endpoints.ts` (request timeout ~line 134)
- [ ] `backend/api/platforms/kick/endpoints/stream-endpoints.ts` (multiple request/load timeouts ~140, 389, 738, 882)
- [ ] `backend/api/platforms/kick/endpoints/video-endpoints.ts` (request timeout ~line 43)
- [ ] `backend/api/platforms/twitch/twitch-requestor.ts` (request timeout ~line 106)
- [ ] `backend/api/platforms/twitch/endpoints/chat-endpoints.ts` (request timeout ~line 70)
- [ ] `backend/auth/oauth-callback-server.ts` (callback timeout ~line 239 — **verify it's a pure abort/reject guard, NOT a watchdog reset on callback received**; if watchdog-shaped, LEAVE for SP4 allowlist)

**EXPLICITLY NOT in Phase 1** (these are watchdog timeouts, out of scope per the spec):
- `backend/services/chat/twitch-chat.ts:179` (`CONNECTION_TIMEOUT_MS` watchdog inside `_doConnect`'s `new Promise` waiting for the IRC `'connected'` event)
- `backend/services/chat/kick-chat.ts:291, 317` (Pusher connect deadlines)
- `backend/services/chat/twitch-hermes-client.ts:157` (server-ping watchdog)
- `backend/api/platforms/twitch/twitch-eventsub-client.ts:366` (EventSub message watchdog)

**Phase 1 gate:** full suite (`npm --prefix "apps/desktop" test`) still green at 201 files / 1654 tests.

---

## Phase 2 — Backoff / rate-limit / settle → `sleep` (Pattern E)
One task per file (combine multiple sites in the same file into one commit). Add `import { sleep } from "@/lib/sleep";`.

- [ ] `backend/services/chat/twitch-chat.ts` reconnect backoff (~line 837)
- [ ] `backend/services/chat/twitch-hermes-client.ts` reconnect backoff (~line 138)
- [ ] `backend/services/chat/kick-chat.ts` reconnect backoff (~line 1021)
- [ ] `backend/services/twitch-manifest-proxy.ts` exponential backoff (~line 135)
- [ ] `backend/api/platforms/twitch/twitch-requestor.ts` exponential backoff (server + network errors, ~lines 224, 250)
- [ ] `backend/api/platforms/twitch/twitch-eventsub-client.ts` reconnect backoff (~line 341)
- [ ] `backend/api/platforms/kick/kick-client.ts` exponential backoff (~lines 522, 541)
- [ ] `backend/api/platforms/kick/kick-stream-resolver.ts` exponential backoff (~line 221)
- [ ] `backend/api/platforms/kick/endpoints/stream-endpoints.ts` backoff w/ jitter (~521), batch spacing (~1137), sleep helper (~257 — if it's a literal `await new Promise(...setTimeout)`, switch to `sleep`; if it already wraps it for use with a signal, leave or refactor minimally)
- [ ] `backend/api/platforms/kick/endpoints/category-endpoints.ts` rate-limit spacing delay (~line 314)
- [ ] `backend/api/platforms/kick/kick-client.ts` rate-limit spacing (~line 85) — if it's `await new Promise(setTimeout)` form, → `sleep`; if it's an interval, that's Phase 3
- [ ] **`backend/api/platforms/kick/endpoints/follow-endpoints.ts:267`** (the SP1 borderline) — `await new Promise(r => setTimeout(r, 2500))` → `await sleep(2500)` — same behavior, cleaner call site.

**Phase 2 canaries:** the WS-client fake-timer tests are the highest-stakes check here (reconnect backoff cadence). Confirm green after touching each chat client:
- `cd "apps/desktop"; npx vitest run tests/backend/services/chat/twitch-chat.test.ts`
- `cd "apps/desktop"; npx vitest run tests/backend/services/chat/kick-chat.test.ts`
- `cd "apps/desktop"; npx vitest run tests/backend/services/chat/twitch-hermes-client.test.ts`
- `cd "apps/desktop"; npx vitest run tests/backend/api/platforms/twitch/twitch-eventsub-client.test.ts`

**Phase 2 gate:** full suite green at 1654/1654.

---

## Phase 3 — Backend `setInterval` → `createManagedInterval` (Pattern F)
One task per file. Add `import { createManagedInterval } from "@/lib/managed-interval";`. Rename the stored field (e.g. `pollIntervalId: NodeJS.Timeout` → `pollTimer: { stop: () => void } | null`); the teardown path calls `pollTimer.stop()` instead of `clearInterval(pollIntervalId)`.

- [ ] `backend/services/vaft-pattern-service.ts` (daily check, ~line 107)
- [ ] `backend/services/update-service.ts` (hourly update check, ~line 281)
- [ ] `backend/services/emotes/emote-manager.ts` (cache cleanup, ~line 81)
- [ ] `backend/services/chat/twitch-pin-poller.ts` (10 s pin poll, ~line 141)
- [ ] `backend/services/chat/twitch-prediction-poller.ts` (5 s prediction poll, ~line 98)
- [ ] `backend/auth/device-code-flow.ts` (device-code poll interval, ~line 214)
- [ ] `backend/ipc/handlers/auth-handlers.ts` (Twitch + Kick follow-refresh intervals, ~lines 203, 204)
- [ ] `backend/auth/twitch-auth.ts` (proactive token refresh — read first: if it's `setTimeout`-chain rather than `setInterval`, this is NOT Pattern F; instead either keep as scheduled `setTimeout` + `sleep`, or leave and report)
- [ ] `backend/api/platforms/kick/endpoints/channel-endpoints.ts` (5-min cache TTL eviction, ~line 60)
- [ ] `backend/api/platforms/kick/endpoints/stream-endpoints.ts` (60-min cache TTL eviction, ~line 70)
- [ ] **`backend/auth/auth-window.ts:310`** (the SP1 borderline) — the 1.5 s cookie-poll cadence inside `_waitForKickWebAuth`. This is a `while`-loop with an `await new Promise(setTimeout 1500)` at the bottom, NOT a `setInterval`. Two options: (a) replace the `await new Promise(...)` with `await sleep(1500)` (Pattern E — simpler, structurally unchanged); (b) restructure to use `createManagedInterval` with a stop-when-cookie-rotated condition (more invasive). **Choose option (a) for SP3** — it's a Pattern-E migration, not Pattern F; the `while` polling structure is preserved exactly. Re-classify on the day and put it in Phase 2's commit list if cleaner.

**Phase 3 canaries (poller tests):**
- `cd "apps/desktop"; npx vitest run tests/backend/services/chat/twitch-pin-poller.test.ts`
- `cd "apps/desktop"; npx vitest run tests/backend/services/chat/twitch-prediction-poller.test.ts`
- `cd "apps/desktop"; npx vitest run tests/backend/services/update-service.test.ts`

**Phase 3 gate:** full suite green at 1654/1654.

---

## Final gate (after Phase 3)
- `npm --prefix "apps/desktop" run typecheck` → clean.
- `npm --prefix "apps/desktop" test` → 201 files / 1654 tests passing.
- `git log --oneline 9876673..HEAD` shows one commit for the helper plus per-file migration commits, all stage-scoped (no WIP swept in).

The branch is then ready for the same finishing options as SP1/SP2 (merge to main + push, PR, or keep for review).

---

## Self-Review

**Spec coverage:**
- Spec § Primitives → Task 1 (`createManagedInterval`), reused `sleep`, native `AbortSignal.timeout`. ✓
- Spec § Phase 0 (helper + tests) → Task 1 with 4 test cases incl. idempotent `stop()`. ✓
- Spec § Phase 1 (abort guards) → Phase 1 checklist, all 17 site files listed; watchdog exclusions explicit. ✓
- Spec § Phase 2 (backoff/rate-limit + SP1 `follow-endpoints:267`) → Phase 2 checklist with SP1 borderline included. ✓
- Spec § Phase 3 (intervals + SP1 `auth-window:310`) → Phase 3 checklist; SP1 borderline reclassified to Pattern E since the cadence is `await new Promise`, not `setInterval`. ✓
- Spec § Out of scope (WS watchdogs, shutdown grace, Promise.race timeouts, web-contents-ready, auth-window:155/:205) → NOT in any phase checklist; explicit "NOT in Phase 1" callout for the WS watchdogs. ✓
- Spec § Verification (fake-timer suites as canaries, no manual matrix) → per-phase canary commands listed. ✓
- Spec § Risk R1 (combined abort sources) → Pattern D rule about `AbortSignal.any`. ✓ R2 (WS-client tests are canary) → Phase-2 canary list. ✓ R3 (one commit per file) → per-site workflow + checklists. ✓

**Placeholder scan:** Phase 0 has complete code + commands. Phases 1–3 use concrete pattern blocks + exact per-site file paths + the per-site workflow. The few hedges ("if a setTimeout-chain rather than setInterval" for `twitch-auth`; "verify it's a pure abort/reject guard" for `oauth-callback-server`; option (a) for `auth-window:310`) are intentional plan-time decisions, with the decision pre-made or fallback specified — not "implement later."

**Type/name consistency:** `createManagedInterval(cb, ms)` returns `{ stop: () => void }` — identical in Task 1, Pattern F, and the per-site rename rule. `sleep(ms): Promise<void>` from `@/lib/sleep`. `AbortSignal.timeout(MS)` and `AbortSignal.any([...])` — native, names fixed.
