---
date: 2026-05-24
topic: ui-timer-hygiene-migration
status: SUPERSEDED by 2026-05-26-frontend-timer-hygiene-migration-requirements.md (open decisions finalized there)
---

# UI Timer-Hygiene Migration — No Raw `setTimeout`/`setInterval` in the UI Layer

## Summary

Follow-on to the [anti-pattern fixes](./2026-05-24-ui-settimeout-render-wait-fixes-requirements.md). After those 5 fake-`await` sites are removed, ~43 legitimate timers remain in `apps/desktop/src/{pages,components,hooks}`. These genuinely need elapsed-time behavior, so they **cannot** become `async/await` — but they can be moved off **raw, in-component** `setTimeout`/`setInterval` and behind a small set of cancel-safe abstractions: `useTimeout`/`useInterval` hooks, TanStack Query `refetchInterval` for true polling, and `AbortSignal.timeout` for fetch timeouts. The timer primitives stay (they must — the platform offers no async/await equivalent for "later in wall-clock time"), but they get **quarantined** into a handful of tested utilities, exactly like the existing `useDebounce` hook already does.

Goal: zero raw `setTimeout`/`setInterval` in components/pages/hooks (outside the sanctioned utility hooks), behavior unchanged, fewer unmount-cleanup/leak bugs.

> This is **not** an `async/await` task. It is a timer-ownership cleanup. It is also large and player-heavy, so it is scoped, phased, and kept separate from the anti-pattern fixes.

---

## Problem Frame

Raw `setTimeout`/`setInterval` scattered across components is a recurring source of bugs: each call site must remember to store the handle in a ref and clear it on unmount / dependency change, and many don't, or do it inconsistently. The codebase already has the right instinct in one place — `useDebounce` wraps the timer in a hook with `useEffect` cleanup. Generalizing that (`useTimeout`, `useInterval`) and routing true polling through TanStack Query removes the per-site cleanup burden and makes "is this timer cancelled correctly?" answerable in one place.

This is worth doing *carefully* and *in phases* because the densest cluster is the player (control auto-hide, stream heartbeats, memory-cleanup intervals) where timing changes are immediately user-visible. A big-bang rewrite risks regressions that are hard to catch in automated tests.

---

## Relationship to the Anti-Pattern Spec

- The **5 anti-patterns** (ChatInput ×3 caret, EmoteDialog focus, VideoCard scroll) are handled by the sibling spec with `flushSync` / layout-effect / `await navigate`. They are explicitly **out of scope here**.
- The **4 ambiguous HLS cases** (`hls-player.tsx` / `twitch-hls-player.tsx`: 50ms `safePlay` settle, 1000ms `backBufferLength` restore) remain **out of scope** for this migration too — HLS.js exposes no completion event to await, so they need a separate, evidence-based investigation, not a mechanical hook swap.

---

## Proposed Target Abstractions (to be confirmed in this project's brainstorm)

1. **`useTimeout(callback, delay)` / `useInterval(callback, delay)`** — ref-stable callback, auto-clear on unmount and on delay change; `delay = null` pauses. Either hand-rolled (small, ~15 lines each, matches existing `useDebounce` style) or adopted from a vetted library. **Open decision.**
2. **TanStack Query `refetchInterval`** — for sites that poll a *server query* on an interval. The app already runs TanStack Query, so these become a query option instead of a manual `setInterval` + `refetch()`.
3. **`AbortSignal.timeout(ms)`** — for `setTimeout(() => controller.abort(), ms)` fetch-timeout guards.
4. **`sleep(ms)` util (single quarantined `setTimeout`)** — only for genuinely-imperative one-off delays inside async flows (e.g., backoff before a retry). Used sparingly; not a license to `await sleep()` in place of real signals.

---

## Inventory — ~43 sites grouped by target abstraction

(Line numbers are a 2026-05-24 snapshot; verify before editing.)

### → `useInterval` (local UI tickers / non-query intervals)
- `components/stream/stream-info.tsx:27` — 1s uptime counter
- `components/player/kick/uptime-readout.tsx:86` — 1s uptime/progress tick
- `components/chat/PredictionBanner.tsx:631` — 500ms voting-countdown bar
- `components/player/hooks/use-background-throttle.ts:296` — 1s "time since hidden" counter
- `components/player/twitch/video-stats-overlay.tsx:99` — 1s stats refresh (reads media element, not a query)
- `components/player/hooks/use-resume-playback.ts:100` — 30s periodic position save
- `components/player/hooks/use-adaptive-quality.ts:366` — buffer-health poll
- `components/player/hls-player.tsx:566` + `twitch-hls-player.tsx:530` — fragment-arrival heartbeat
- `components/player/hls-player.tsx:637` + `twitch-hls-player.tsx:551` — 30-min memory-cleanup interval
- `components/dev/PerfTool.tsx:59,244` — dev stress/sampling loops (dev-only; low priority)

### → TanStack Query `refetchInterval` (true server-query polling)
- `pages/Mod/channel/ChannelEngagement.tsx:73` — polls prediction/poll engagement → fold into the query
- `hooks/useHelixPoll.ts:85` — visibility-gated Helix poll. **Caveat:** this is a deliberate generic poller; converting may mean migrating its consumers to queries — assess per consumer, may stay as a hook that simply uses `useInterval` internally.

### → `useTimeout` (one-shot component timers; auto-cleanup)
- Player control auto-hide + mouse-leave (the largest cluster): `player-controls.tsx:137,153`; `kick/kick-player-controls.tsx:126,148`; `kick/kick-live-player-controls.tsx:153,169`; `kick/kick-vod-player-controls.tsx:101,123`; `twitch/twitch-player-controls.tsx:137,153`; `twitch/twitch-live-player-controls.tsx:138,154`; `twitch/twitch-vod-player-controls.tsx:101,123`; `stream/related-content/ClipPlayer.tsx:241`
- Single-vs-double-click window: `player-controls.tsx:199`
- Toast/banner/status auto-dismiss: `pages/Settings/index.tsx:380`; `chat/PredictionBanner.tsx:66`; `chat/PinnedMessageBanner.tsx:211`; `chat/kick/KickChat.tsx:623`; `stream/related-content/index.tsx:351`
- Scroll/seek debounce-style: `chat/ChatMessageList.tsx:210` (autoscroll pause); `player/hooks/use-seek-preview.ts:149` (seek-hover debounce)
- Hover-intent prefetch: `discovery/category-card.tsx:33`; `stream/stream-card.tsx:34`
- Mount/stagger + TTL eviction: `multistream/stream-slot.tsx:68`; `hooks/useStreamPlayback.ts:126` (eviction), `:250` (fetch stagger)
- HLS-init guard window: `player/hooks/use-volume.ts:37`
- Memory-pressure scheduling (rIC fallbacks): `player/hooks/use-video-lifecycle.ts:197,222,232`
- Emote prefetch drip (rIC fallback): `chat/EmoteDialog.tsx:667,671`

### → `AbortSignal.timeout`
- `components/player/twitch/twitch-adblock-service.ts:532,742` — fetch-abort timeout guards

### → `sleep(ms)` util inside async retry (or keep as `useTimeout`)
- `components/player/twitch/twitch-live-player.tsx:307` + `kick/kick-live-player.tsx:356` — exponential-backoff retry before `onRefresh()`

### Already correct (model to follow) / leave
- `hooks/useDebounce.ts:7` — canonical debounce hook; its internal `setTimeout` is the pattern we're generalizing, not removing.
- `components/dev/interval-tracker.ts:21` — dev shim that intentionally wraps `setInterval` to count live timers.

---

## Proposed Phasing

- **Phase 1** — Add `useTimeout`/`useInterval` (+ unit tests with fake timers). Migrate low-risk one-shots: toast/banner/status dismiss, hover-prefetch, stagger, TTL eviction, autoscroll-pause, seek debounce.
- **Phase 2** — Player-heavy: all control auto-hide + mouse-leave, ClipPlayer, single/double-click, HLS heartbeats + memory intervals, video-lifecycle memory checks. Requires a manual player regression matrix (Twitch+Kick, live+VOD).
- **Phase 3** — Polling: ChannelEngagement → Query `refetchInterval`; assess `useHelixPoll`; local tickers (uptime/countdown/stats/throttle counter) → `useInterval`.
- **Phase 4** — `AbortSignal.timeout` for the adblock fetch guards; backoff retries → `sleep()` util.
- **Enforcement** — Once a subsystem is clean, add a lint rule (`no-restricted-syntax`/`no-restricted-globals`) banning raw `setTimeout`/`setInterval` outside the sanctioned hooks/utils, so it stays at zero. (Note: biome lint is baseline-red in this repo — see project memory — so the enforcement mechanism and where it runs need to be decided deliberately.)

---

## Open Decisions (resolve in this project's brainstorm, before any plan)

- O1. Hand-roll `useTimeout`/`useInterval` vs adopt a small dependency? (Lean hand-rolled to match `useDebounce` and avoid a dep.)
- O2. Which `setInterval` sites are genuine Query refetches vs local tickers? (Determines Phase-3 split; needs per-site read.)
- O3. Player regression-testing strategy — manual matrix vs Electron debug tooling vs Playwright. (Player auto-hide/heartbeat changes are user-visible and timing-sensitive.)
- O4. Lint enforcement: which linter, which paths, and how to introduce it given the red baseline.
- O5. Are dev-only timers (`PerfTool`, `interval-tracker`) in scope or explicitly exempt?

---

## Risks & Assumptions

- **R1.** Player chrome auto-hide and stream heartbeats are the highest-risk surface — visible to users and timing-sensitive. Phase 2 must not change observed delays.
- **R2.** "Zero `setTimeout`" is only meaningful with lint enforcement; without it, the count regresses. Enforcement is itself a (small) sub-task.
- **R3.** No behavior change is intended anywhere. `useTimeout`/`useInterval` must reproduce current delays exactly; Query `refetchInterval` must match current poll cadence and visibility-gating.
- **R4.** `await sleep(ms)` is explicitly **not** a goal in itself — it only relocates `setTimeout`. It is used only where an imperative delay genuinely belongs in an async flow (backoff).
