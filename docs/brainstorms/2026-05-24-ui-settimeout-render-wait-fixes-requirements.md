---
date: 2026-05-24
topic: ui-settimeout-render-wait-fixes
---

# UI `setTimeout` Render-Wait Fixes — Replace Timing Guesses With Real Sequencing

## Summary

Five `setTimeout` call sites in the UI layer (`pages/`, `components/`, `hooks/`) use a guessed delay to wait for something that is actually observable — a React commit, a positioned dialog, or a completed navigation. Replace each with the primitive that waits on the real signal: `flushSync` for the controlled-textarea caret (ChatInput ×3), a position-gated layout effect for the emote-picker focus (EmoteDialog), and `await navigate()` for the post-navigation scroll (VideoCard). No behavior change is intended; the delays simply become deterministic.

This is a surgical code-quality change across 3 files. The other 47 timer call sites in the UI layer are **out of scope** (see below) — they are legitimate elapsed-time timers (debounce, auto-hide, polling, toasts, backoff) or ambiguous HLS cases with no awaitable completion signal.

---

## Problem Frame

A `setTimeout(fn, n)` whose purpose is "wait until X has happened" is a latent bug: if the machine is slow, `n` is too short and the code runs before X; if fast, it wastes `n` ms. The fix is to wait on X directly. An inventory of `apps/desktop/src/{pages,components,hooks}` found 52 timer sites; exactly 5 are this anti-pattern, and all 5 wait on a signal the platform already exposes:

- **React commit** (ChatInput): the textarea is controlled by `message` state, so the new value reaches the DOM only after React commits. The caret reposition was deferred with `setTimeout(0)`. `flushSync` makes the commit synchronous, so the caret can be set on the next line.
- **Positioned dialog** (EmoteDialog): the picker renders at `top/left: -9999` until a positioning layout effect computes a real spot via `setPosition` (state → follow-up commit). The 100 ms `setTimeout` simply waited for "on-screen." The real signal is `position` becoming set.
- **Completed navigation** (VideoCard): TanStack Router navigation returns a promise; the 50 ms `setTimeout` guessed its duration before scrolling the shell to top. `await navigate(...)` waits on the actual completion.

Note that "use async/await" only maps literally to the third case. The first two have no promise to await — the correct React primitives are `flushSync` and layout-effect ordering. The shared goal is *deterministic sequencing*, not a uniform syntax.

---

## Affected Behaviors (must remain identical after the change)

- B1. Inserting an emote from the autocomplete or the picker leaves the caret immediately after the inserted emote (+ trailing space), with the textarea focused.
- B2. Inserting a mention from autocomplete leaves the caret after `@username ` with the textarea focused.
- B3. Mentioning a user from a chat message (`mentionUser`) prepends `@username ` and leaves the caret at the end, textarea focused.
- B4. Opening the emote picker focuses its search input, and the picker is visible at its computed position with no flash from off-screen.
- B5. Clicking a LIVE (non-VOD) related-content card navigates to the channel and scrolls `#main-content-scroll-area` to the top.

---

## Requirements

### R1 — ChatInput: `flushSync` + synchronous caret (3 sites)
`apps/desktop/src/components/chat/ChatInput.tsx`

Replace the three `setTimeout(() => { inputRef.current?.focus(); setSelectionRange(...) }, 0)` blocks with a synchronous caret set after a flushed commit:

- `handleEmoteSelect` (≈381): `flushSync(() => { setEmoteSlots(...); setMessage(newMessage); setCursorPosition(newCursorPos); })`, then `inputRef.current?.focus()` + `setSelectionRange(newCursorPos, newCursorPos)`.
- `handleMentionSelect` (≈405): `flushSync(() => { setMessage(newMessage); setCursorPosition(newCursorPos); })`, then focus + `setSelectionRange(newCursorPos, newCursorPos)`.
- `mentionUser` (≈434): `flushSync(() => setMessage(updater))`, then focus + `setSelectionRange(el.value.length, el.value.length)` (the DOM value is current post-flush).
- Add `import { flushSync } from "react-dom"`.
- `useCallback` dependency arrays are unchanged (refs and `flushSync` are stable).
- Only the `setTimeout` wrapper is replaced: the trailing `emoteAutocomplete.deactivate()` / `mentionAutocomplete.deactivate()` / `setActiveDialog(null)` calls keep their existing position and order after the focus/caret line.

**Acceptance:** B1–B3 verified by running the app; `tsc` passes.

### R2 — EmoteDialog: focus when positioned, not after 100 ms (1 site)
`apps/desktop/src/components/chat/EmoteDialog.tsx`

Replace the `useEffect` + `setTimeout(() => searchInputRef.current?.focus(), 100)` (≈485–490) with focus gated on the dialog being on-screen:

- A `hasFocusedRef` (ref) that resets to `false` whenever `isOpen` becomes `false`.
- A `useLayoutEffect` keyed on `[isOpen, position]` that, when `isOpen && position && !hasFocusedRef.current`, sets `hasFocusedRef.current = true` and focuses `searchInputRef.current`.
- This fires exactly once per open, on the first commit where `position` is set (i.e., the picker is no longer at `-9999`), eliminating both the delay and any off-screen-focus jump.

**Acceptance:** B4 verified by running (search input focused on open; no visible position flash); `tsc` passes.

### R3 — VideoCard: await navigation, then scroll (1 site)
`apps/desktop/src/components/stream/related-content/VideoCard.tsx`

Keep `<Link>` (preserves `href`, hover-prefetch, link a11y). Add `const navigate = useNavigate()`. Capture the navigation target in a local so the `onClick` can await the same destination without self-referencing the object literal — e.g. hoist `const destination = { to, params, search }` and spread it into `linkProps` — then make the channel-only `onClick`:

```ts
onClick: async (e) => {
  if (!routeAsVod) {
    e.preventDefault();
    await navigate(destination);
    document
      .getElementById("main-content-scroll-area")
      ?.scrollTo({ top: 0, behavior: "smooth" });
  }
},
```

Remove the `setTimeout`. (VOD clicks keep `<Link>`'s default navigation untouched.)

**Acceptance:** B5 verified by running (LIVE card → channel route, content scrolled to top); `tsc` passes. Confirm during implementation that TanStack `<Link>` honors `event.defaultPrevented`; if a build double-navigates, the second navigation to the same location is a router no-op, so the outcome is unaffected.

---

## Verification

1. **One focused red→green test per fix**, extending the existing component suites (`tests/components/chat/ChatInput.test.tsx`, `EmoteDialog.test.tsx`, `tests/components/stream/related-content/VideoCard.test.tsx`). jsdom supports `focus`/`document.activeElement`/`selectionStart`/portals and the component test harness already exists, so these are cheap and genuinely fail on the old timer-based code. (Supersedes an earlier draft note claiming tests would be flaky — inaccurate; the harness exists.)
2. `tsc` typecheck across the desktop app — catches the `flushSync` / `useNavigate` wiring and types.
3. Launch the app and walk B1–B5 by hand (or via the registered Electron debug tooling) — integration backstop, especially the EmoteDialog on-screen flash and the VideoCard smooth-scroll feel.

---

## Out of Scope

- The **43 legitimate timers** in the UI layer — debounce (`useDebounce`, seek/scroll debounces), player-control auto-hide, polling `setInterval`s, toast/banner auto-dismiss, exponential backoff retries, `AbortController` fetch timeouts, mount-stagger, single-vs-double-click windows, uptime/countdown ticks. These depend on elapsed wall-clock time; `async/await` cannot replace them.
- The **4 ambiguous HLS cases** (`hls-player.tsx` / `twitch-hls-player.tsx`: the 50 ms `safePlay` settle and the 1000 ms `backBufferLength` restore) — HLS.js exposes no completion event to await; changing them risks playback regressions and needs separate, careful investigation.
- All **backend / main-process timers** (retry/backoff, pollers, auth windows) — outside "pages and components" and largely legitimate.

---

## Risks & Assumptions

- **A1.** `flushSync` is called only from discrete user-event handlers (emote/mention selection, `mentionUser` via `useImperativeHandle`), never during render — the supported usage. Forcing a synchronous commit on these infrequent, user-initiated events has no meaningful perf cost.
- **A2.** EmoteDialog's `position` is the reliable "on-screen" signal; the focus flag resets on close, so a stale non-null `position` on reopen at worst focuses at a valid prior on-screen spot (never `-9999`) before the positioning effect corrects it.
- **A3.** VideoCard keeps `<Link>` rather than converting to an imperative button, so hover-prefetch and accessibility are preserved; only the channel-routing click is intercepted to await navigation before scrolling.
- **A4.** No behavioral change is intended at any site; this is a determinism/correctness refactor. Any observable difference during verification is a regression to fix, not an accepted trade-off.
