---
date: 2026-05-26
topic: frontend-timer-hygiene-migration
status: ready for plan
supersedes: 2026-05-24-ui-timer-hygiene-migration-requirements.md
---

# Frontend Timer-Hygiene Migration — Quarantine Raw `setTimeout`/`setInterval` Behind Cancel-Safe Hooks

## Summary

**SP2** of the 4-part timer-hygiene program. The legitimate elapsed-time timers (~40–50 raw
`setTimeout`/`setInterval` call sites; the 2026-05-24 inventory's "~43", with a few multi-timer
lines counted individually below) in
`apps/desktop/src/{pages,components,hooks,store,providers,lib}` genuinely need wall-clock
behavior, so they **cannot** become `async/await` — but they can move off **raw, in-component**
`setTimeout`/`setInterval` and behind a small set of cancel-safe, unmount-safe abstractions,
exactly as `useDebounce` already does for debouncing. Behavior is unchanged; the win is
removing the per-call-site "store the handle in a ref and clear it on unmount/dep-change"
burden that is a recurring leak/stale-timer source.

This finalizes the open decisions in the [2026-05-24 scoping
doc](./2026-05-24-ui-timer-hygiene-migration-requirements.md) (which this supersedes) and is
ready for a phased implementation plan.

> This is **not** an `async/await` task — it is timer-ownership cleanup. The SP1 backend
> readiness fixes (the genuine "stop faking a wait" work) already shipped; the 5 UI
> render-wait anti-patterns shipped before that. SP2 preserves behavior exactly.

---

## Primitives (new, hand-rolled)

Four units, each backing a real cluster in the inventory. Hooks live in
`apps/desktop/src/hooks/`; the `sleep` util in `apps/desktop/src/lib/`. All hand-rolled to
mirror the existing `useDebounce` (timer in `useEffect` with a cleanup return) — **no new
dependency** (O1).

1. **`useInterval(callback: () => void, delay: number | null): void`** — declarative
   recurring timer. `delay = null` pauses (no interval scheduled). The callback is held in a
   ref updated each render, so the latest closure runs without the interval resetting on
   every render; the interval re-arms only when `delay` changes. Clears on unmount.

2. **`useTimeout(callback: () => void, delay: number | null): void`** — declarative one-shot.
   Fires once `delay` ms after `delay` becomes non-null; `delay = null` cancels. Same
   ref-stable-callback shape; clears on unmount and on `delay` change.

3. **`useManagedTimeout(callback: () => void): { start: (ms: number) => void; clear: () => void }`**
   — *imperative*, self-cancelling, unmount-safe one-shot. `start(ms)` clears any pending
   timer and schedules a new one; `clear()` cancels. Delay is passed at `start()` time so
   **dynamic delays and restart-on-event** work (the player auto-hide uses 1000/3000/200 ms
   depending on hover state and re-arms on every mouse event — a declarative hook cannot
   express this). Callback held in a ref. Clears on unmount.

4. **`sleep(ms: number): Promise<void>`** — a single quarantined `setTimeout`, for genuinely
   imperative delays inside async flows (exponential backoff before a retry). Used sparingly;
   **not** a license to `await sleep()` in place of a real signal.

Plus **`AbortSignal.timeout(ms)`** (native, no new code) for `setTimeout(() => controller.abort(), ms)`
fetch-timeout guards.

---

## Resolved Decisions

- **O1 — hand-roll vs. dependency:** hand-roll. Each hook is ~15 lines, matches `useDebounce`,
  and avoids a new dep.
- **O2 — which `setInterval`s are Query refetches vs. local tickers:** `ChannelEngagement`
  polls a *server query* → fold into TanStack Query `refetchInterval`. `useHelixPoll` is a
  deliberate generic visibility-gated poller → **keep it as a hook** (don't push its consumers
  to queries) but reimplement its internal `setInterval` via `useInterval`. Every other
  interval is a local ticker → `useInterval`. (Confirm per-site at plan time.)
- **O3 — testing strategy:** fake-timer **unit tests** for the 4 primitives and for the
  Phase-1/2 migrated sites — there is established precedent (`PredictionBanner`,
  `PinnedMessageBanner`, `useHelixPoll` tests already use `vi.useFakeTimers()`). The player
  auto-hide/heartbeat timing is user-visible and not meaningfully unit-assertable, so Phase 3
  is gated by a **manual player-regression matrix** (Twitch + Kick × live + VOD), not flaky
  Playwright/electron-mcp timing assertions.
- **O4 — lint enforcement:** **deferred to SP4** (the capstone). SP2 drives migrated areas to
  zero raw timers but adds no lint rule (biome is baseline-red here; the enforcement mechanism
  is SP4's problem).
- **O5 — dev-only timers:** **exempt.** `components/dev/PerfTool.tsx` (dev stress/sampling)
  and `components/dev/interval-tracker.ts` (intentionally wraps `setInterval` to *count* live
  timers — it must use the raw API) are out of scope.

---

## Inventory by Phase

> Line numbers are a 2026-05-24/26 snapshot — **verify before editing**. `pages/Settings/index.tsx`
> is in active unrelated WIP at time of writing; re-confirm its line before touching it.

Each phase ends green on `tsc` + `vitest` before the next begins. Ordering is safest → riskiest.

### Phase 0 — Primitives + tests
Build `useInterval`, `useTimeout`, `useManagedTimeout` (`src/hooks/`) and `sleep` (`src/lib/`),
each with fake-timer unit tests (`tests/hooks/`, `tests/lib/`). No call sites migrated yet.

### Phase 1 — Low-risk one-shots (non-player, unit-testable)
- **Auto-dismiss → `useTimeout`:** `pages/Settings/index.tsx:380`; `components/chat/PredictionBanner.tsx:66`;
  `components/chat/PinnedMessageBanner.tsx:211`; `components/chat/kick/KickChat.tsx:623`;
  `components/stream/related-content/index.tsx:351`.
- **Hover-intent prefetch → `useManagedTimeout`:** `components/discovery/category-card.tsx:33`;
  `components/stream/stream-card.tsx:34`.
- **Mount-stagger / TTL eviction → `useTimeout` (stagger) / `useManagedTimeout`:**
  `components/multistream/stream-slot.tsx:68`; `hooks/useStreamPlayback.ts:250` (fetch stagger),
  `:126` (TTL eviction).
- **Autoscroll-pause / seek-hover debounce → `useManagedTimeout`:**
  `components/chat/ChatMessageList.tsx:210`; `components/player/hooks/use-seek-preview.ts:149`.
- **Emote prefetch drip (requestIdleCallback fallback) → `useManagedTimeout`:**
  `components/chat/EmoteDialog.tsx:667,671`.

### Phase 2 — Pollers + local tickers (testable)
- **Server-query poll → TanStack Query `refetchInterval`:** `pages/Mod/channel/ChannelEngagement.tsx:73`.
- **Generic poller → keep hook, internal `useInterval`:** `hooks/useHelixPoll.ts:85`.
- **Local tickers → `useInterval`:** `components/stream/stream-info.tsx:27` (1s uptime);
  `components/player/kick/uptime-readout.tsx:86`; `components/chat/PredictionBanner.tsx:631`
  (500 ms countdown bar); `components/player/hooks/use-background-throttle.ts:296` (1s);
  `components/player/twitch/video-stats-overlay.tsx:99` (1s stats);
  `components/player/hooks/use-resume-playback.ts:100` (30s position save);
  `components/player/hooks/use-adaptive-quality.ts:366` (buffer-health poll).

### Phase 3 — Player cluster (HIGH RISK — last; gated by the manual matrix)
- **Control auto-hide + mouse-leave + click-race → `useManagedTimeout`:**
  `components/player/player-controls.tsx:137,153,199`;
  `components/player/kick/kick-player-controls.tsx:126,148`;
  `components/player/kick/kick-live-player-controls.tsx:153,169`;
  `components/player/kick/kick-vod-player-controls.tsx:101,123`;
  `components/player/twitch/twitch-player-controls.tsx:137,153`;
  `components/player/twitch/twitch-live-player-controls.tsx:138,154`;
  `components/player/twitch/twitch-vod-player-controls.tsx:101,123`;
  `components/stream/related-content/ClipPlayer.tsx:241`.
- **HLS heartbeat + 30-min memory interval → `useInterval`:**
  `components/player/hls-player.tsx:566,637`; `components/player/twitch/twitch-hls-player.tsx:530,551`.
- **Video-lifecycle memory checks + HLS-init guard → `useInterval`/`useManagedTimeout`:**
  `components/player/hooks/use-video-lifecycle.ts:197,222,232`; `components/player/hooks/use-volume.ts:37`.

### Phase 4 — Async / fetch edges
- **Fetch-abort guard → `AbortSignal.timeout`:** `components/player/twitch/twitch-adblock-service.ts:532,742`.
- **Exponential-backoff retry → `sleep()`:** `components/player/twitch/twitch-live-player.tsx:307`;
  `components/player/kick/kick-live-player.tsx:356`.

---

## Verification

1. **Primitive unit tests (Phase 0):** fake-timer tests covering fire-after-delay, `delay=null`
   pause/cancel, restart-on-`start()`, `clear()`, callback-ref freshness (latest closure runs),
   and unmount cleanup (no fire after unmount).
2. **Per-site tests (Phases 1–2):** extend the existing component/hook suites with fake timers
   where a behavior is assertable (e.g. banner auto-dismiss fires after N ms; a poll calls its
   query on cadence). Reuse the established `vi.useFakeTimers()` pattern.
3. **`tsc` + full `vitest`** green at the end of every phase (the project gate; not biome).
4. **Phase 3 manual player-regression matrix** — for each of Twitch+Kick × live+VOD: controls
   show on activity and auto-hide after the same delays as today (idle 1s/3s, mouse-leave
   ~200 ms), single-click toggles play / double-click toggles fullscreen with no regression,
   stream heartbeats and the 30-min memory cleanup still fire. Observed timing must match
   current behavior (R3 below).

---

## Out of Scope

- **The 4 ambiguous HLS `setTimeout`s** — `hls-player.tsx` / `twitch-hls-player.tsx`: the ~50 ms
  `safePlay` settle and the ~1000 ms `backBufferLength` restore. HLS.js exposes no completion
  event to await; they need a separate evidence-based investigation, not a mechanical hook
  swap. (Note: the HLS heartbeat/memory **intervals** in Phase 3 ARE in scope — different timers.)
- **Dev-only timers** (`PerfTool`, `interval-tracker`) — exempt (O5).
- **Backend / main-process timers** — that is SP3.
- **Lint enforcement** banning raw timers — that is SP4.
- **`useDebounce`** itself — it is the model being generalized, not a migration target; leave it.

---

## Risks & Assumptions

- **R1 — Player chrome is the highest-risk surface.** Auto-hide and heartbeat timing are
  user-visible and timing-sensitive. Phase 3 must not change observed delays; it is isolated
  last and gated by the manual matrix.
- **R2 — Behavior preservation is the whole point.** `useTimeout`/`useInterval`/`useManagedTimeout`
  must reproduce current delays exactly; `refetchInterval` must match the current poll cadence
  AND visibility-gating (`ChannelEngagement`/`useHelixPoll` only poll when visible — the Query
  conversion must preserve that, e.g. via `refetchInterval` + an `enabled`/visibility guard).
- **R3 — Dynamic-delay correctness.** `useManagedTimeout`'s `start(ms)` must clear any pending
  timer first (the player re-arms on every mouse event); a missed clear would stack timers.
  Covered by a Phase-0 unit test.
- **R4 — `sleep()` is not a goal in itself.** It only relocates a `setTimeout`; used solely for
  the two genuine async-backoff sites, never as a substitute for awaiting a real signal.
- **A1 — Zero raw timers is only enforced once SP4 lands.** Without the lint rule the count can
  regress; SP2's "done" is the migrated areas being clean, not a permanent guarantee.
