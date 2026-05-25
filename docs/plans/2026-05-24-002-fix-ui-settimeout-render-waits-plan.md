---
title: "fix: Replace 5 UI render-wait setTimeouts with proper sequencing"
type: fix
status: planned
date: 2026-05-24
origin: docs/brainstorms/2026-05-24-ui-settimeout-render-wait-fixes-requirements.md
---

# fix: Replace 5 UI render-wait `setTimeout`s with proper sequencing

> **For agentic workers:** Implement this plan task-by-task with `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Each Implementation Unit is TDD: write the failing test, run it red, implement, run it green, typecheck, commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 5 UI `setTimeout` calls that fake-wait for a React commit / a positioned dialog / a completed navigation, replacing each with the primitive that waits on the real signal — with no change to observable behavior.

**Architecture:** Three independent component fixes. ChatInput uses `flushSync` so the controlled textarea's value is in the DOM before the caret is set. EmoteDialog focuses its search input in a `position`-gated layout effect instead of a 100ms timer. VideoCard `await`s the TanStack Router navigation before scrolling. Each is covered by one focused red→green test using the existing component test harness.

**Tech Stack:** React 19, `react-dom` `flushSync`, TanStack Router (`useNavigate`), Vitest + `@testing-library/react` (jsdom). Commands run from `apps/desktop/`.

---

## Summary

`apps/desktop/src/{pages,components,hooks}` contains 52 timer call sites; exactly 5 are an anti-pattern where `setTimeout(fn, n)` is used to wait for something observable. This plan fixes those 5. The remaining 47 are legitimate elapsed-time timers (debounce, auto-hide, polling, toasts, backoff) and are tracked separately in `docs/brainstorms/2026-05-24-ui-timer-hygiene-migration-requirements.md` — **out of scope here**.

---

## Requirements (from origin spec)

- **R1 — ChatInput** (`ChatInput.tsx` 3 sites): replace `setTimeout(0)` caret repositioning with `flushSync` + synchronous `focus()`/`setSelectionRange()`. Preserves behaviors B1 (emote insert), B2 (mention insert), B3 (`mentionUser`).
- **R2 — EmoteDialog** (`EmoteDialog.tsx` 1 site): replace the 100ms focus timer with focus gated on the dialog being positioned (on-screen). Preserves B4 (search input focused on open, no off-screen flash).
- **R3 — VideoCard** (`VideoCard.tsx` 1 site): replace the 50ms post-click scroll with `await navigate()` then scroll. Preserves B5 (LIVE card → channel route, content scrolled to top).

---

## Scope Boundaries

- **In:** the 5 sites above, plus one focused test per fix.
- **Out:** the 43 legitimate timers, the 4 ambiguous HLS player cases (`hls-player.tsx`/`twitch-hls-player.tsx` `safePlay`/`backBufferLength`), and all backend timers. No behavior change. No refactor of adjacent code beyond what each fix requires.

---

## Context & Research

### Files
- `apps/desktop/src/components/chat/ChatInput.tsx` — controlled `<textarea ref={inputRef} value={message}>` (line ~643). Caret sites in `handleEmoteSelect` (~381), `handleMentionSelect` (~405), `mentionUser` (~434, exposed via `useImperativeHandle`).
- `apps/desktop/src/components/chat/EmoteDialog.tsx` — portal dialog; `if (!isOpen) return null` (~705); container is `position: fixed` with `style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}` (~719); positioning `useLayoutEffect` calls `setPosition(...)` (~493–536); current focus timer at ~485–490; `searchInputRef` (~451), search `<input placeholder="Search emotes...">` (~726–733).
- `apps/desktop/src/components/stream/related-content/VideoCard.tsx` — `linkProps` object (~40–79) spread on the thumbnail Link (~90) **and** the title Link (~152); category Link (~160) does not use it.

### Test harness
- `apps/desktop/tests/components/chat/ChatInput.test.tsx` — mocks chat/emote stores, `InfoBanner`, `EmoteDialog`, `EmoteAutocomplete`, `MentionAutocomplete`; `renderInput()` helper; existing `mentionUser` test asserts value only.
- `apps/desktop/tests/components/chat/EmoteDialog.test.tsx` — selector-capable `emote-store` mock + `MockIntersectionObserver`; `renderDialog()` helper (creates a real anchor, `isOpen` default `true`).
- `apps/desktop/tests/components/stream/related-content/VideoCard.test.tsx` — mocks `@tanstack/react-router` (`Link` only — **must add `useNavigate`**), `card`, `proxied-image`, `platform-avatar`.

### Commands (run from `apps/desktop/`)
- Single test file: `npx vitest run <path>`
- Full suite: `npm run test`
- Typecheck: `npm run typecheck`
- **Do not** use `npm run lint` / `npm run check` as a gate — biome is baseline-red in this repo (CRLF + es5-comma config drift); `tsc` + `vitest` are the gates.

---

## Key Technical Decisions

- **`flushSync` for the textarea caret (not `async/await`).** A React commit is not awaitable. `flushSync(() => setState(...))` forces the controlled `value` into the DOM synchronously, so `setSelectionRange` on the next line targets the new value. This is the exact case React's docs cite for `flushSync`. Called only from discrete user-event/imperative handlers — the supported usage; the synchronous commit cost is negligible on these infrequent actions.
- **EmoteDialog: gate focus on `position`, not declaration order.** The dialog paints at `-9999` until `setPosition` commits (a follow-up render). Focusing before that scrolls the off-screen input into view. A `useLayoutEffect` keyed on `[isOpen, position]` with a `hasFocusedRef` (reset on close) focuses exactly once, on the first commit where `position` is set — i.e., on-screen. Robust whether `position` starts null or stale (the truthy gate never focuses at `-9999`).
- **VideoCard: keep `<Link>`, intercept the channel click.** Converting to an imperative button would lose hover-prefetch and link a11y. Instead the channel-only `onClick` calls `e.preventDefault()` then `await navigate(destination)` then scrolls. The navigation target is hoisted into a `destination` local so `onClick` awaits the same route without self-referencing the `linkProps` literal. If a TanStack build does not honor `defaultPrevented`, the duplicate same-location navigation is a router no-op — outcome unaffected.
- **TDD reverses the spec's "no new tests" note.** That note assumed jsdom flakiness; the harness already exists and jsdom supports `focus`/`selectionStart`/portals. One focused test per fix is cheap and is the red→green proof. ChatInput sites `handleEmoteSelect`/`handleMentionSelect` share the identical `flushSync` primitive proven by the `mentionUser` test and are additionally covered by the manual checklist (U4); they are not given separate unit tests because driving them requires elaborate mock-child wiring for marginal gain.

---

## Implementation Units

### U1. ChatInput — `flushSync` caret (R1)

**Goal:** The textarea caret/focus is set synchronously after the message-state commit; no `setTimeout`.

**Files:**
- Modify: `apps/desktop/src/components/chat/ChatInput.tsx`
- Test: `apps/desktop/tests/components/chat/ChatInput.test.tsx`

- [ ] **Step 1 — Write the failing test.** Add to the `describe('ChatInput — imperative handle', ...)` block:

```tsx
  it('mentionUser focuses the textarea and sets the caret at the end (synchronously)', () => {
    infoBannerImpl.mockReturnValue(null);
    const ref = createRef<ChatInputHandle>();
    render(
      <ChatInput ref={ref} channel="ninja" platform="twitch" channelId="12345" />,
    );
    act(() => ref.current?.mentionUser('alice'));
    const ta = screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement;
    expect(ta.value).toBe('@alice ');
    expect(document.activeElement).toBe(ta); // fails on old code: focus is deferred to setTimeout(0)
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(ta.selectionEnd).toBe(ta.value.length);
  });
```

- [ ] **Step 2 — Run it red.** `npx vitest run tests/components/chat/ChatInput.test.tsx -t "synchronously"` → FAIL on `document.activeElement` (focus not yet called).

- [ ] **Step 3 — Add the import.** At the top of `ChatInput.tsx`, alongside the React import:

```ts
import { flushSync } from "react-dom";
```

- [ ] **Step 4 — Fix `mentionUser` (~434).** Replace the `setTimeout` block:

```tsx
  const mentionUser = useCallback((username: string) => {
    flushSync(() => {
      setMessage((prev) => {
        const mention = `@${username} `;
        return prev.startsWith(mention) ? prev : `${mention}${prev}`;
      });
    });
    const el = inputRef.current;
    if (el) {
      el.focus();
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    }
  }, []);
```

- [ ] **Step 5 — Fix `handleEmoteSelect` (~381).** Hoist `newCursorPos`, wrap the state sets in `flushSync`, set the caret synchronously; leave the trailing `emoteAutocomplete.deactivate()` / `setActiveDialog(null)` exactly where they are:

```tsx
      const newCursorPos = insertAt + 1 + trailing.length;
      flushSync(() => {
        setEmoteSlots((prev) => [
          ...prev.slice(0, slotIndex),
          emote,
          ...prev.slice(slotIndex),
        ]);
        setMessage(newMessage);
        setCursorPosition(newCursorPos);
      });
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }

      emoteAutocomplete.deactivate();
      setActiveDialog(null);
```

- [ ] **Step 6 — Fix `handleMentionSelect` (~405).** Same shape:

```tsx
      const newCursorPos = startPos + username.length + 2;
      flushSync(() => {
        setMessage(newMessage);
        setCursorPosition(newCursorPos);
      });
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }

      mentionAutocomplete.deactivate();
```

- [ ] **Step 7 — Run it green.** `npx vitest run tests/components/chat/ChatInput.test.tsx` → all PASS (new test + existing). If React logs a benign `flushSync` act notice, it does not fail the run.

- [ ] **Step 8 — Typecheck.** `npm run typecheck` → no errors.

- [ ] **Step 9 — Commit.**

```bash
git add apps/desktop/src/components/chat/ChatInput.tsx apps/desktop/tests/components/chat/ChatInput.test.tsx
git commit -m "$(cat <<'EOF'
fix(chat): set ChatInput caret via flushSync instead of setTimeout(0)

Controlled textarea value reaches the DOM only after commit; flushSync makes
the commit synchronous so focus/setSelectionRange land on the new value.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### U2. EmoteDialog — position-gated focus (R2)

**Goal:** The search input is focused once the dialog is positioned on-screen; no 100ms timer.

**Files:**
- Modify: `apps/desktop/src/components/chat/EmoteDialog.tsx`
- Test: `apps/desktop/tests/components/chat/EmoteDialog.test.tsx`

- [ ] **Step 1 — Write the failing test.** Add inside `describe('EmoteDialog', ...)`:

```tsx
  it('focuses the search input when opened', () => {
    mockState.emotesByProvider = new Map<EmoteProvider, Emote[]>([
      ['kick', [makeEmote({ id: 'k1', name: 'kickHype', provider: 'kick' })]],
    ]);
    renderDialog({ scope: 'native', platform: 'kick' });
    const input = screen.getByPlaceholderText(/search emotes/i);
    expect(document.activeElement).toBe(input); // fails on old code: focus is on a 100ms timer
  });
```

- [ ] **Step 2 — Run it red.** `npx vitest run tests/components/chat/EmoteDialog.test.tsx -t "focuses the search input"` → FAIL (`document.activeElement` is `<body>`).

- [ ] **Step 3 — Replace the focus effect (~485–490).** Swap the `useEffect` + `setTimeout` for a reset effect plus a position-gated layout effect. (`useLayoutEffect`, `useRef`, `useEffect` are already imported.)

```tsx
  /* --------------------------- focus on open --------------------------- */
  // The dialog paints at top/left:-9999 until the positioning layout effect
  // sets `position`. Focus once it is on-screen (position set) — gating on
  // `position` (not a 100ms timer) avoids scrolling the off-screen input into
  // view. `hasFocusedRef` keeps it to one focus per open.
  const hasFocusedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) hasFocusedRef.current = false;
  }, [isOpen]);
  useLayoutEffect(() => {
    if (isOpen && position && !hasFocusedRef.current) {
      hasFocusedRef.current = true;
      searchInputRef.current?.focus();
    }
  }, [isOpen, position]);
```

- [ ] **Step 4 — Run it green.** `npx vitest run tests/components/chat/EmoteDialog.test.tsx` → all PASS (new test + existing 20).

- [ ] **Step 5 — Typecheck.** `npm run typecheck` → no errors.

- [ ] **Step 6 — Commit.**

```bash
git add apps/desktop/src/components/chat/EmoteDialog.tsx apps/desktop/tests/components/chat/EmoteDialog.test.tsx
git commit -m "$(cat <<'EOF'
fix(chat): focus EmoteDialog search input when positioned, not after 100ms

Dialog paints at -9999 until setPosition commits; gate focus on `position`
being set so it fires when the input is actually on-screen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### U3. VideoCard — await navigation then scroll (R3)

**Goal:** Scroll-to-top runs after the navigation promise resolves; no 50ms timer.

**Files:**
- Modify: `apps/desktop/src/components/stream/related-content/VideoCard.tsx`
- Test: `apps/desktop/tests/components/stream/related-content/VideoCard.test.tsx`

- [ ] **Step 1 — Update the router mock + imports** at the top of the test file. Replace the existing `@tanstack/react-router` mock and widen the testing-library import:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VideoCard } from '@/components/stream/related-content/VideoCard';
import { VideoOrClip } from '@/components/stream/related-content/types';

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className, onClick }: any) => (
    <a href={to} className={className} onClick={onClick}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));
```

- [ ] **Step 2 — Write the failing test.** Add inside `describe('VideoCard', ...)`:

```tsx
  it('awaits navigation then scrolls the content area to top for a LIVE (channel) card', async () => {
    const scrollTo = vi.fn();
    const scrollArea = document.createElement('div');
    scrollArea.id = 'main-content-scroll-area';
    (scrollArea as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    document.body.appendChild(scrollArea);
    mockNavigate.mockClear();

    const liveVideo = { ...mockVideo, isLive: true, source: undefined, duration: '0:00' };
    render(
      <VideoCard video={liveVideo} platform="twitch" channelName="Streamer" channelData={null} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByAltText('Test Video').closest('a')!);
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/stream/$platform/$channel' }),
    );
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    document.body.removeChild(scrollArea);
  });
```

- [ ] **Step 3 — Run it red.** `npx vitest run tests/components/stream/related-content/VideoCard.test.tsx -t "awaits navigation"` → FAIL (`mockNavigate` never called by old code).

- [ ] **Step 4 — Add the hook import** in `VideoCard.tsx`:

```tsx
import { Link, useNavigate } from "@tanstack/react-router";
import { memo, useState, type MouseEvent } from "react";
```

- [ ] **Step 5 — Use the hook + hoist destination + rewrite onClick.** Inside the component, before `linkProps`, add `const navigate = useNavigate();`. Then restructure (keep the existing `params`/`search` ternaries intact, just moved into `destination`):

```tsx
  const destination: any = {
    to: routeAsVod ? "/video/$platform/$videoId" : "/stream/$platform/$channel",
    params: routeAsVod
      ? { platform: platform || "twitch", videoId: video.id }
      : { platform: platform || "twitch", channel: channelName },
    search: routeAsVod
      ? {
          src: video.source || undefined,
          title: video.title,
          channelName: video.channelName || video.channelSlug || channelName,
          channelDisplayName: video.channelName || channelData?.displayName || channelName,
          channelAvatar: video.channelAvatar || channelData?.avatarUrl || undefined,
          views: video.views,
          date: video.created_at || video.date,
          category: video.category || video.gameName || undefined,
          duration: video.duration,
          isSubOnly: video.isSubOnly || undefined,
          tags: video.tags || undefined,
          language: video.language || undefined,
          isMature: video.isMature || undefined,
        }
      : undefined,
  };

  const linkProps: any = {
    ...destination,
    onClick: async (e: MouseEvent) => {
      if (!routeAsVod) {
        e.preventDefault();
        await navigate(destination);
        document
          .getElementById("main-content-scroll-area")
          ?.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
  };
```

- [ ] **Step 6 — Run it green.** `npx vitest run tests/components/stream/related-content/VideoCard.test.tsx` → all PASS (new test + existing 3).

- [ ] **Step 7 — Typecheck.** `npm run typecheck` → no errors.

- [ ] **Step 8 — Commit.**

```bash
git add apps/desktop/src/components/stream/related-content/VideoCard.tsx apps/desktop/tests/components/stream/related-content/VideoCard.test.tsx
git commit -m "$(cat <<'EOF'
fix(stream): await navigation before scroll-to-top in VideoCard

Navigation is a promise; await it (keeping <Link> via preventDefault) instead
of guessing 50ms before scrolling the content area to top.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### U4. Full verification (gates + manual runtime)

**Goal:** Confirm the whole suite and types are clean, and that observable behavior (B1–B5) is unchanged in the running app.

- [ ] **Step 1 — Full test suite.** `npm run test` → all pass (no regressions in other suites).

- [ ] **Step 2 — Typecheck.** `npm run typecheck` → no errors.

- [ ] **Step 3 — Manual runtime checklist.** `npm run dev`, then verify:
  - **B1** Open a chat, type `hello `, place the caret mid-text, insert an emote from the picker → emote inserted at the caret, caret sits just after it (+ trailing space), textarea stays focused.
  - **B2** Trigger emote autocomplete (`:` + query) and select → emote replaces the trigger span, caret after it, focused.
  - **B3** Click a username's "mention" action in a chat message → `@user ` prepended, caret at end, textarea focused.
  - **B4** Open the emote picker (both native and third-party buttons) → search input is focused immediately and the dialog appears at its anchored position with no flash from off-screen.
  - **B5** In a channel's related-content, click a **LIVE** (non-VOD) card → routes to the channel and the main content area is scrolled to top. Also click a **VOD** card → routes to the video normally (no scroll behavior change).

- [ ] **Step 4 — Confirm no stray `setTimeout`.** `git grep -n "setTimeout" -- apps/desktop/src/components/chat/ChatInput.tsx apps/desktop/src/components/chat/EmoteDialog.tsx apps/desktop/src/components/stream/related-content/VideoCard.tsx` → no matches.

---

## Self-Review

**Spec coverage:** R1 → U1 (3 sites). R2 → U2. R3 → U3. Behaviors B1–B5 → U4 manual checklist (+ U1/U2/U3 automated). No spec requirement is unmapped.

**Placeholder scan:** No TBD/TODO. Every code/test block is concrete; every command is exact with expected result.

**Type/name consistency:** `flushSync` imported in U1; `useNavigate`/`MouseEvent` imported in U3; `hasFocusedRef`/`position`/`searchInputRef` in U2 match the file's existing identifiers; `destination` is defined before use and spread into `linkProps`; `mockNavigate` created via `vi.hoisted` before the `vi.mock` factory references it.

**Scope:** Single, focused plan — 3 files + 3 tests. The hygiene migration is explicitly elsewhere.

---

## Execution Handoff

Per the writing-plans skill, choose an execution approach when ready:
1. **Subagent-Driven (recommended)** — a fresh subagent per Unit, reviewed between Units.
2. **Inline Execution** — execute Units in-session with checkpoints.
