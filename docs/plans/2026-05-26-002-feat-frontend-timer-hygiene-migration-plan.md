# Frontend Timer-Hygiene Migration (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the ~40–50 legitimate UI elapsed-time timers off raw in-component `setTimeout`/`setInterval` and behind four cancel-safe, unmount-safe primitives — behavior unchanged.

**Architecture:** Phase 0 builds and unit-tests the four primitives (`useInterval`, `useTimeout`, `useManagedTimeout`, `sleep`), all hand-rolled to mirror the existing `useDebounce` (timer in `useEffect` with cleanup; callback held in a ref so the latest closure runs without re-arming). Phases 1–4 then migrate call sites in risk order (low-risk one-shots → pollers/tickers → the player-control cluster last → async edges), each a mechanical application of the documented transformation patterns, gated by `tsc` + `vitest` (and a manual player matrix for Phase 3).

**Tech Stack:** React, TypeScript, Vitest + `@testing-library/react` (`renderHook`/`act`, jsdom default env, `vi.useFakeTimers()`), TanStack Query.

**Spec:** [`docs/brainstorms/2026-05-26-frontend-timer-hygiene-migration-requirements.md`](../brainstorms/2026-05-26-frontend-timer-hygiene-migration-requirements.md)

> **Commands** run from `apps/desktop/`: `npx vitest run <path>` (single file), `npx vitest run` (full), `npx tsc --noEmit`. Git from repo root. Gates are `tsc` + Vitest — **not** biome (baseline-red). Unrelated UI WIP is uncommitted in the tree; every commit stages ONLY its own files (never `git add -A`/`.`).

> **Line numbers in the migration phases are a 2026-05-26 snapshot — re-grep each site before editing.** `pages/Settings/index.tsx` is in active WIP; confirm its line.

---

## File Structure

**Create (Phase 0):**
- `apps/desktop/src/hooks/useInterval.ts` — declarative recurring timer.
- `apps/desktop/src/hooks/useTimeout.ts` — declarative one-shot timer.
- `apps/desktop/src/hooks/useManagedTimeout.ts` — imperative `{ start(ms), clear() }` one-shot.
- `apps/desktop/src/lib/sleep.ts` — `sleep(ms): Promise<void>` for async backoff.
- Tests: `apps/desktop/tests/hooks/useInterval.test.tsx`, `useTimeout.test.tsx`, `useManagedTimeout.test.tsx`; `apps/desktop/tests/lib/sleep.test.ts`.

**Modify (Phases 1–4):** ~30 files under `apps/desktop/src/{pages,components,hooks}` — enumerated per phase below.

Each hook is one file, one responsibility, mirroring `apps/desktop/src/hooks/useDebounce.ts`.

---

# PHASE 0 — Primitives (full TDD)

## Task 1: `useInterval`

**Files:** Create `apps/desktop/src/hooks/useInterval.ts`; Test `apps/desktop/tests/hooks/useInterval.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/desktop/tests/hooks/useInterval.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterval } from "@/hooks/useInterval";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useInterval", () => {
  it("calls the callback every `delay` ms", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("does not schedule anything when delay is null", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, null));
    act(() => vi.advanceTimersByTime(10000));
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("calls the latest callback without re-arming the interval", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useInterval(cb, 1000), {
      initialProps: { cb: cb1 },
    });
    rerender({ cb: cb2 });
    act(() => vi.advanceTimersByTime(1000));
    expect(cb1).toHaveBeenCalledTimes(0);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("stops firing after unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useInterval(cb, 1000));
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(0);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run (from `apps/desktop/`): `npx vitest run tests/hooks/useInterval.test.tsx`
Expected: FAIL — cannot resolve `@/hooks/useInterval`.

- [ ] **Step 3: Implement**

`apps/desktop/src/hooks/useInterval.ts`:

```ts
import { useEffect, useRef } from "react";

/**
 * Declarative recurring timer. Invokes the latest `callback` every `delay` ms.
 * `delay = null` pauses (nothing scheduled). The interval re-arms only when
 * `delay` changes — not on every render — because the callback is read through a
 * ref. Clears on unmount. Generalizes the timer-in-useEffect-with-cleanup pattern
 * already used by `useDebounce`.
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run tests/hooks/useInterval.test.tsx` → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useInterval.ts apps/desktop/tests/hooks/useInterval.test.tsx
git commit -m "feat(hooks): add useInterval cancel-safe recurring-timer hook"
```

## Task 2: `useTimeout`

**Files:** Create `apps/desktop/src/hooks/useTimeout.ts`; Test `apps/desktop/tests/hooks/useTimeout.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/desktop/tests/hooks/useTimeout.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTimeout } from "@/hooks/useTimeout";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTimeout", () => {
  it("fires the callback once after `delay` ms", () => {
    const cb = vi.fn();
    renderHook(() => useTimeout(cb, 500));
    act(() => vi.advanceTimersByTime(499));
    expect(cb).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(1); // one-shot
  });

  it("never fires when delay is null", () => {
    const cb = vi.fn();
    renderHook(() => useTimeout(cb, null));
    act(() => vi.advanceTimersByTime(10000));
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("re-arms with the new delay (cancelling the old timer) when delay changes", () => {
    const cb = vi.fn();
    const { rerender } = renderHook(({ d }) => useTimeout(cb, d), {
      initialProps: { d: 1000 as number | null },
    });
    act(() => vi.advanceTimersByTime(500)); // t=500; old timer would fire at t=1000
    rerender({ d: 2000 }); // delay changed: cancel old, arm new (fires at t=2500)
    act(() => vi.advanceTimersByTime(700)); // t=1200, past the old timer's fire time
    expect(cb).toHaveBeenCalledTimes(0); // old timer was cancelled
    act(() => vi.advanceTimersByTime(1300)); // t=2500
    expect(cb).toHaveBeenCalledTimes(1); // new timer fired
  });

  it("does not fire after unmount", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useTimeout(cb, 1000));
    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(cb).toHaveBeenCalledTimes(0);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run tests/hooks/useTimeout.test.tsx` → FAIL (unresolved import).

- [ ] **Step 3: Implement**

`apps/desktop/src/hooks/useTimeout.ts`:

```ts
import { useEffect, useRef } from "react";

/**
 * Declarative one-shot timer. Fires the latest `callback` once, `delay` ms after
 * `delay` becomes (or is) a number. `delay = null` cancels / never fires. Re-arms
 * when `delay` changes. Clears on unmount.
 */
export function useTimeout(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setTimeout(() => savedCallback.current(), delay);
    return () => clearTimeout(id);
  }, [delay]);
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run tests/hooks/useTimeout.test.tsx` → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useTimeout.ts apps/desktop/tests/hooks/useTimeout.test.tsx
git commit -m "feat(hooks): add useTimeout cancel-safe one-shot-timer hook"
```

## Task 3: `useManagedTimeout`

**Files:** Create `apps/desktop/src/hooks/useManagedTimeout.ts`; Test `apps/desktop/tests/hooks/useManagedTimeout.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/desktop/tests/hooks/useManagedTimeout.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useManagedTimeout } from "@/hooks/useManagedTimeout";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useManagedTimeout", () => {
  it("fires `ms` after start()", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useManagedTimeout(cb));
    act(() => result.current.start(1000));
    act(() => vi.advanceTimersByTime(999));
    expect(cb).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("clear() cancels a pending timer", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useManagedTimeout(cb));
    act(() => result.current.start(1000));
    act(() => result.current.clear());
    act(() => vi.advanceTimersByTime(5000));
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("start() restarts without stacking (only the latest timer fires)", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useManagedTimeout(cb));
    act(() => result.current.start(1000));
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.start(1000)); // re-arm before the first fires
    act(() => vi.advanceTimersByTime(999));
    expect(cb).toHaveBeenCalledTimes(0);
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledTimes(1); // exactly one fire, not two
  });

  it("uses the latest callback", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useManagedTimeout(cb), {
      initialProps: { cb: cb1 },
    });
    act(() => result.current.start(1000));
    rerender({ cb: cb2 });
    act(() => vi.advanceTimersByTime(1000));
    expect(cb1).toHaveBeenCalledTimes(0);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("does not fire after unmount", () => {
    const cb = vi.fn();
    const { result, unmount } = renderHook(() => useManagedTimeout(cb));
    act(() => result.current.start(1000));
    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(cb).toHaveBeenCalledTimes(0);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run tests/hooks/useManagedTimeout.test.tsx` → FAIL (unresolved import).

- [ ] **Step 3: Implement**

`apps/desktop/src/hooks/useManagedTimeout.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Imperative, self-cancelling, unmount-safe one-shot timer.
 *
 * `start(ms)` clears any pending timer and schedules the latest `callback` to run
 * after `ms`; `clear()` cancels it. The delay is passed at call time, so dynamic
 * delays and restart-on-event work (e.g. player-control auto-hide re-arming with
 * 1000/3000/200 ms on each mouse event). Clears on unmount.
 */
export function useManagedTimeout(callback: () => void): {
  start: (ms: number) => void;
  clear: () => void;
} {
  const savedCallback = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const start = useCallback(
    (ms: number) => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        savedCallback.current();
      }, ms);
    },
    [],
  );

  // Clear any pending timer when the consuming component unmounts.
  useEffect(() => clear, [clear]);

  // Stable object so consumers can safely list it in effect/callback deps.
  return useMemo(() => ({ start, clear }), [start, clear]);
}
```

(Add a test asserting the returned object is referentially stable across re-renders — `result.current` identical after `rerender()` — so consumers can list it in dependency arrays.)

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run tests/hooks/useManagedTimeout.test.tsx` → 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useManagedTimeout.ts apps/desktop/tests/hooks/useManagedTimeout.test.tsx
git commit -m "feat(hooks): add useManagedTimeout imperative cancel-safe timeout hook"
```

## Task 4: `sleep`

**Files:** Create `apps/desktop/src/lib/sleep.ts`; Test `apps/desktop/tests/lib/sleep.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/desktop/tests/lib/sleep.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sleep } from "@/lib/sleep";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    const onResolve = vi.fn();
    const p = sleep(1000).then(onResolve);
    await vi.advanceTimersByTimeAsync(999);
    expect(onResolve).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(onResolve).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npx vitest run tests/lib/sleep.test.ts` → FAIL (unresolved import).

- [ ] **Step 3: Implement**

`apps/desktop/src/lib/sleep.ts`:

```ts
/**
 * Resolve after `ms` milliseconds. The single sanctioned `setTimeout` for genuinely
 * imperative async delays (e.g. exponential backoff before a retry). Do NOT use it
 * to fake-await a signal that is actually observable — await that signal instead.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npx vitest run tests/lib/sleep.test.ts` → 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/sleep.ts apps/desktop/tests/lib/sleep.test.ts
git commit -m "feat(lib): add sleep(ms) util for async backoff delays"
```

---

# PHASES 1–4 — Migration Playbook

Phases 1–4 are mechanical applications of the four transformation patterns below. Each
migration is small and self-contained. **Per-site workflow (one task = one file, or one
tightly-related cluster):**

1. **Re-grep** the file for `setTimeout`/`setInterval` (line numbers below are a snapshot).
2. **Match** each raw timer to a pattern (A–E) and apply the transformation verbatim.
3. **Remove** the now-orphaned `useRef` timer handles, manual `clearTimeout`/`clearInterval`,
   and any `useEffect` that existed only to manage the timer (CLAUDE.md §3 — clean up what
   your change orphaned). Keep any non-timer logic those effects also did.
4. **Test:** if the behavior is fake-timer-assertable in the existing component/hook suite,
   add or extend a test (model: `tests/components/chat/PinnedMessageBanner.test.tsx`,
   `tests/hooks/useHelixPoll.test.tsx`). If the site has no test harness and the behavior is
   purely visual/timing (most player-chrome), rely on `tsc` + the Phase-3 manual matrix.
5. **Verify:** `npx tsc --noEmit` and `npx vitest run <affected test(s)>` green.
6. **Commit** (stage only the touched src + test files): `git commit -m "refactor(<area>): <site> → use<Primitive>"`.

After each phase, run the **full** `npx vitest run` + `npx tsc --noEmit` and confirm green
before starting the next phase.

## Transformation Patterns

**Pattern A — declarative recurring (`setInterval` in a `useEffect`) → `useInterval`.**
Worked example, `components/stream/stream-info.tsx` (`UptimeCounter`):

```tsx
// BEFORE
useEffect(() => {
  setUptime(formatUptime(startedAt));               // immediate update
  const interval = setInterval(() => setUptime(formatUptime(startedAt)), 1000);
  return () => clearInterval(interval);
}, [startedAt]);

// AFTER
// Keep the immediate update (useInterval does not fire at t=0):
useEffect(() => { setUptime(formatUptime(startedAt)); }, [startedAt]);
useInterval(() => setUptime(formatUptime(startedAt)), 1000);
```
(Import `useInterval` from `@/hooks/useInterval`. If a site has no "immediate update" line, just drop in `useInterval`.)

**Pattern B — declarative conditional one-shot (`setTimeout` armed by a condition in a
`useEffect` with cleanup) → `useTimeout`.** Worked example,
`components/chat/PinnedMessageBanner.tsx`:

```tsx
// BEFORE
const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
useEffect(() => {
  if (!unpinArmed) return;
  armTimeoutRef.current = setTimeout(() => setUnpinArmed(false), UNPIN_CONFIRM_WINDOW_MS);
  return () => { if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current); };
}, [unpinArmed]);

// AFTER (delete armTimeoutRef and the useEffect)
useTimeout(() => setUnpinArmed(false), unpinArmed ? UNPIN_CONFIRM_WINDOW_MS : null);
```

**Pattern C — imperative restart-on-event (`ref` + `clearTimeout`/`setTimeout` re-armed in
handlers, possibly with dynamic delays) → `useManagedTimeout`.** Worked example,
`components/player/player-controls.tsx`:

```tsx
// BEFORE
const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const clearHideTimeout = useCallback(() => {
  if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null; }
}, []);
const startIdleTimeout = useCallback(() => {
  clearHideTimeout();
  if (isPlaying && !isSettingsOpen) {
    const ms = isHoveringControlsRef.current ? 3000 : 1000;
    hideTimeoutRef.current = setTimeout(() => setIsVisible(false), ms);
  }
}, [isPlaying, clearHideTimeout, isSettingsOpen]);

// AFTER
const hideTimer = useManagedTimeout(() => setIsVisible(false));
const startIdleTimeout = useCallback(() => {
  if (isPlaying && !isSettingsOpen) hideTimer.start(isHoveringControlsRef.current ? 3000 : 1000);
  else hideTimer.clear();
}, [isPlaying, isSettingsOpen, hideTimer]);
// replace clearHideTimeout() calls with hideTimer.clear();
// the 200ms mouse-leave timer: hideTimer.start(200);
```
(`hideTimer.start`/`.clear` are stable, so they're safe in dependency arrays. Delete
`hideTimeoutRef`, `clearHideTimeout`, and the manual clears. The separate single/double-click
`clickTimeoutRef` becomes its own `const clickTimer = useManagedTimeout(...)` — note the
double-click handler calls `clickTimer.clear()`.)

**Pattern D — fetch-abort guard (`setTimeout(() => controller.abort(), ms)`) →
`AbortSignal.timeout(ms)`.**

```ts
// BEFORE
const controller = new AbortController();
const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
try { await fetch(url, { signal: controller.signal }); } finally { clearTimeout(t); }

// AFTER
await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
```
(If the site combines the timeout with another abort source, use `AbortSignal.any([userSignal, AbortSignal.timeout(ms)])` instead.)

**Pattern E — async backoff (`await new Promise(r => setTimeout(r, ms))`) → `sleep(ms)`.**

```ts
// BEFORE
await new Promise((resolve) => setTimeout(resolve, backoffMs));
// AFTER
await sleep(backoffMs);  // import { sleep } from "@/lib/sleep"
```

## Phase 1 — Low-risk one-shots
One task per file. Apply Pattern B (auto-dismiss) or C (imperative) per site.
- [ ] `pages/Settings/index.tsx:380` (status auto-dismiss → B). **Re-confirm line — file is in WIP.**
- [ ] `components/chat/PredictionBanner.tsx:66` (auto-dismiss → B)
- [ ] `components/chat/PinnedMessageBanner.tsx:211` (arm window → B; the worked example)
- [ ] `components/chat/kick/KickChat.tsx:623` (poll restart-on-event → **C** / `useManagedTimeout` — verified imperative, NOT declarative auto-dismiss)
- [ ] `components/stream/related-content/index.tsx:351` (auto-dismiss → B)
- [ ] `components/discovery/category-card.tsx:33` (hover-intent prefetch → C)
- [ ] `components/stream/stream-card.tsx:34` (hover-intent prefetch → C)
- [ ] `components/multistream/stream-slot.tsx:68` (mount stagger → B with delay set on mount)
- [ ] `hooks/useStreamPlayback.ts:250` (fetch stagger → B), `:126` (TTL eviction → C)
- [ ] `components/chat/ChatMessageList.tsx:210` (autoscroll-pause → C)
- [ ] `components/player/hooks/use-seek-preview.ts:149` (seek-hover debounce → C)
- [ ] `components/chat/EmoteDialog.tsx:667,671` (prefetch drip, requestIdleCallback fallback → C)

Add/extend fake-timer tests where a suite exists (PinnedMessageBanner, PredictionBanner already do). **Gate:** full `vitest` + `tsc` green.

## Phase 2 — Pollers + tickers
- [ ] `pages/Mod/channel/ChannelEngagement.tsx:73` → TanStack Query `refetchInterval`. Read the surrounding query; move the manual `setInterval(refetch, ms)` into the query's `refetchInterval: ms` option and **preserve visibility-gating** (only poll when visible — keep the existing gate via `refetchIntervalInBackground: false`, which is the default, or an `enabled` flag). Verify against the existing engagement test if present.
- [ ] `hooks/useHelixPoll.ts:85` → replace the internal `setInterval` with `useInterval` (keep the hook's public API and visibility-gating). `tests/hooks/useHelixPoll.test.tsx` must still pass unchanged.
- [ ] Local tickers → Pattern A: `components/stream/stream-info.tsx:27` (worked example); `components/player/kick/uptime-readout.tsx:86`; `components/chat/PredictionBanner.tsx:631` (500ms countdown); `components/player/hooks/use-background-throttle.ts:296`; `components/player/twitch/video-stats-overlay.tsx:99`; `components/player/hooks/use-resume-playback.ts:100` (30s save); `components/player/hooks/use-adaptive-quality.ts:366` (buffer poll).

**Gate:** full `vitest` + `tsc` green.

## Phase 3 — Player cluster (HIGH RISK — last)
Apply Pattern C (control timers) and A (HLS intervals). One task per file; do NOT batch across players.
- [ ] `components/player/player-controls.tsx:137,153,199` (worked example: auto-hide + mouse-leave + click-race → C)
- [ ] `components/player/kick/kick-player-controls.tsx:126,148`
- [ ] `components/player/kick/kick-live-player-controls.tsx:153,169`
- [ ] `components/player/kick/kick-vod-player-controls.tsx:101,123`
- [ ] `components/player/twitch/twitch-player-controls.tsx:137,153`
- [ ] `components/player/twitch/twitch-live-player-controls.tsx:138,154`
- [ ] `components/player/twitch/twitch-vod-player-controls.tsx:101,123`
- [ ] `components/stream/related-content/ClipPlayer.tsx:241`
- [ ] `components/player/hls-player.tsx:566` (heartbeat → A), `:637` (30-min memory → A)
- [ ] `components/player/twitch/twitch-hls-player.tsx:530` (heartbeat → A), `:551` (30-min memory → A)
- [ ] `components/player/hooks/use-video-lifecycle.ts:197,222,232` (memory checks → A/C per site)
- [ ] `components/player/hooks/use-volume.ts:37` (HLS-init guard → C)

> **Do NOT touch the 4 ambiguous HLS settle/restore `setTimeout`s** (the ~50 ms `safePlay` and
> ~1000 ms `backBufferLength` restore in `hls-player.tsx`/`twitch-hls-player.tsx`) — out of
> scope per the spec.

**Gate — manual player-regression matrix** (in addition to `tsc` + full `vitest`). With `npm --prefix apps/desktop run dev`, for **each** of Twitch+Kick × live+VOD:
- Controls show on pointer activity and auto-hide after the same delays as today (~1 s idle, ~3 s while hovering the control bar, ~200 ms on mouse-leave).
- Single-click toggles play/pause; double-click toggles fullscreen (no accidental double-fire).
- Stream stays healthy over several minutes (heartbeat intact); leave a stream open >30 min once to confirm the memory-cleanup interval still runs (or verify via logs).

## Phase 4 — Async edges
- [ ] `components/player/twitch/twitch-adblock-service.ts:532,742` → Pattern D (`AbortSignal.timeout`).
- [ ] `components/player/twitch/twitch-live-player.tsx:307` and `components/player/kick/kick-live-player.tsx:356` → Pattern E (`sleep`).

**Gate:** full `vitest` + `tsc` green. Quick manual check that ad-block playback and the live-player reconnect/backoff still recover.

---

## Self-Review

**Spec coverage:**
- Primitives `useInterval`/`useTimeout`/`useManagedTimeout`/`sleep` → Phase 0 Tasks 1–4 (full TDD). ✓
- `AbortSignal.timeout` (native) → Pattern D / Phase 4. ✓
- O1 hand-roll → Phase 0 (no dep). ✓ O2 (`ChannelEngagement`→Query, `useHelixPoll` keeps hook) → Phase 2. ✓ O3 (fake-timer units + manual matrix) → Phase 0 tests + per-site workflow + Phase 3 gate. ✓ O4 (lint→SP4) → not in this plan, by design. ✓ O5 (dev timers exempt) → `PerfTool`/`interval-tracker` absent from all phase checklists. ✓
- Every inventory site in the spec appears in a Phase 1–4 checklist item. ✓
- Out-of-scope 4 HLS settle/restore timers → explicit "do NOT touch" callout in Phase 3. ✓
- Risk R3 (restart must clear first / no stacking) → asserted by Task 3's "restarts without stacking" test. ✓ R2 (visibility-gating preserved) → called out in the Phase-2 `ChannelEngagement`/`useHelixPoll` items. ✓

**Placeholder scan:** Phase 0 has complete code + commands. Phases 1–4 use concrete, worked transformation patterns (A–E) plus exact per-site line references and a fixed per-site workflow — not "implement later." The deliberately deferred per-site exact code is read-fresh at execution time because line numbers drift and WIP is touching files; the patterns make each transformation mechanical.

**Type/name consistency:** Hook names/signatures (`useInterval(cb, delay|null)`, `useTimeout(cb, delay|null)`, `useManagedTimeout(cb): {start(ms), clear()}`, `sleep(ms)`) are identical between Phase 0 definitions, the patterns, and the phase items. Imports use the `@/` alias throughout (`@/hooks/...`, `@/lib/sleep`).
