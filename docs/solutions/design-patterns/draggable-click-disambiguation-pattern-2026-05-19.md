---
title: Click-preserving draggable UI with pointer events
date: 2026-05-19
category: docs/solutions/design-patterns/
module: providers/draggable-ui
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "A UI element must be both draggable (pointer-driven repositioning) and clickable (activate on tap/click)"
  - "Drag interactions use setPointerCapture and React synthetic pointer events"
  - "Persisted position is loaded from localStorage or any JSON store on mount"
  - "The element renders inside an Electron BrowserWindow where HMR reloads are common"
  - "A dev-tool overlay (e.g. React Query devtools) wraps a vendor-owned trigger button"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - tooling
tags:
  - drag-and-drop
  - pointer-events
  - click-suppression
  - pointer-capture
  - react-hooks
  - electron
  - devtools
  - local-storage
---

# Click-preserving draggable UI with pointer events

## Context

In dev mode, clicking a stream tile or the chat send button would silently do nothing — the click event disappeared. Root cause: `apps/desktop/src/providers/query-provider.tsx` attached a `once: true, capture: true` click listener to `window` after every drag of the React Query devtools toggle button, intending to swallow the synthesized post-drag click that would otherwise toggle the devtools panel open. Chromium frequently suppresses that synthesized click itself when the pointer travelled past its internal "click slop" threshold. When that happened, the `once: true` listener never fired — it sat on `window` indefinitely, waiting to consume the next click anywhere in the application. The victim click could be anything: a stream tile, a follow button, a chat send.

A parallel defect: `pointermove` and `pointerup` were attached to `window` imperatively inside `onPointerDown` with no cleanup path, no `pointercancel` handler, and no `setPointerCapture`. In StrictMode (active in this repo at `apps/desktop/src/renderer.tsx:26`), double-mount left orphaned listeners. A touch interrupt or Alt+Tab also orphaned them. Moving the cursor outside the Electron BrowserWindow stopped event delivery entirely.

A third defect: saved devtools button position loaded from localStorage without clamping, so a position saved at 1920×1080 rendered off-screen when the app opened at 1366×768, and `Infinity`/`NaN` both pass `typeof x === "number"` checks.

All three defects share a structural pattern: insufficient hygiene around events and data that cross a component boundary (window listeners, pointer capture, serialized state). The three sub-patterns below are the fix.

## Guidance

The recipe has three interlocking parts. Apply all three whenever a draggable element also carries a meaningful click handler.

**Sub-pattern A — Wrapper-scoped drag-vs-click disambiguation**

Never attach a one-shot click listener to `window` to suppress a post-drag click. Instead, keep a `wasDraggingRef` and handle the swallow at capture phase on the wrapper element itself:

```tsx
const wasDraggingRef = useRef(false);

const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
  const d = dragRef.current;
  if (!d || d.pointerId !== e.pointerId) return;
  if (d.dragging) {
    wasDraggingRef.current = true;
    // setTimeout(0) is the load-bearing piece: if Chromium already suppressed
    // the synthesized click (pointer moved past slop threshold), the flag must
    // still clear so the next real click is not eaten.
    setTimeout(() => { wasDraggingRef.current = false; }, 0);
  }
  dragRef.current = null;
};

const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
  if (wasDraggingRef.current) {
    wasDraggingRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  }
};

// On the wrapper:
// <div ... onPointerUp={onPointerUp} onClickCapture={onClickCapture}>
```

`onClickCapture` fires during the capture phase (parent → child), before the inner toggle's `onClick`, so `stopPropagation` prevents the child from ever seeing the event. The `setTimeout(0)` backstop ensures the flag always clears in the next macrotask whether or not the synthesized click arrived.

**Sub-pattern B — Pointer lifecycle hygiene**

Attach all pointer handlers as React props on the wrapper element, not imperatively to `window`. Use `setPointerCapture` and filter by `pointerId`. `pos` / `setPos` come from Sub-pattern C below; `BTN_SIZE` is the rendered element footprint.

```tsx
const dragRef = useRef<{
  pointerId: number;
  startX: number;
  startY: number;
  posX: number;
  posY: number;
  dragging: boolean;
} | null>(null);

const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
  if (dragRef.current) return; // block second drag while one is in flight
  e.currentTarget.setPointerCapture(e.pointerId);
  dragRef.current = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    posX: pos.x,
    posY: pos.y,
    dragging: false,
  };
};

const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
  const d = dragRef.current;
  if (!d || d.pointerId !== e.pointerId) return;
  const dx = e.clientX - d.startX;
  const dy = e.clientY - d.startY;
  if (!d.dragging && Math.hypot(dx, dy) > 5) d.dragging = true;
  if (!d.dragging) return;
  setPos({
    x: Math.max(0, Math.min(window.innerWidth - BTN_SIZE, d.posX + dx)),
    y: Math.max(0, Math.min(window.innerHeight - BTN_SIZE, d.posY + dy)),
  });
};

const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
  if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
  dragRef.current = null; // no click suppression — cancel does not synthesize a click
};

return (
  <div
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerCancel}
    onClickCapture={onClickCapture}
  >
    ...
  </div>
);
```

React removes element-attached handlers automatically on unmount, eliminating all manual teardown. `setPointerCapture` keeps events flowing even when the cursor leaves the window. The `pointerId` filter correctly drops events from secondary pointers (multi-touch, pen + mouse combinations). The `if (dragRef.current) return` guard prevents a second `pointerdown` from overwriting an active drag state mid-gesture.

**Sub-pattern C — Persisted-position parsing hygiene**

When loading geometry from localStorage, use `Number.isFinite`, clamp on load, and reconstruct the return object explicitly:

```tsx
const BTN_SIZE = 60; // the element's rendered footprint, including any padding
const KEY = "draggable-pos";

const [pos, setPos] = useState<{ x: number; y: number }>(() => {
  const maxX = Math.max(0, window.innerWidth - BTN_SIZE);
  const maxY = Math.max(0, window.innerHeight - BTN_SIZE);
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
        return {
          x: Math.max(0, Math.min(maxX, parsed.x)),
          y: Math.max(0, Math.min(maxY, parsed.y)),
        };
      }
    }
  } catch {
    // corrupt / truncated storage entry — fall through to default
  }
  return { x: Math.max(0, maxX - 16), y: Math.max(0, maxY - 16) };
});
```

Three things happen together. `Number.isFinite` rejects `Infinity` and `NaN` at runtime — both pass `typeof x === "number"`. Clamping at load covers the viewport-shrink case (a resize-only effect cannot help — no resize event fires on launch). And the return is typed `{ x: number; y: number }` because `Math.max`/`Math.min` return `number` and absorb the still-`any` `parsed.x`/`parsed.y` into typed arithmetic.

A precision note: neither `parsed?.x` nor `Number.isFinite(...)` actually narrows `any` to `number` at the type level — both are runtime defense (`?.` against a literal `null` JSON payload, `isFinite` against `Infinity`/`NaN`). The load-bearing type safety is the explicit `useState<{ x: number; y: number }>` generic, which would reject a raw `return parsed`. The reconstructed object literal is what lets the typed return path survive that generic — the arithmetic on each field happens to produce a `number`, satisfying the slot.

## Why This Matters

**Sub-pattern A prevents a cross-app click hole.** A window-scoped `once: true` listener is a global trap. Because Chromium suppresses the synthesized post-drag click whenever the pointer exceeds its click-slop threshold (typically a few CSS pixels), the trap frequently never fires. The next real click anywhere in the app — a different component, a different route — is eaten silently. This is one of the harder bugs to diagnose because the misbehaving component (the drag widget) is not the one that appears broken (the thing that didn't respond to the click). The `wasDraggingRef + onClickCapture + setTimeout(0)` approach is scoped to the wrapper element and self-healing regardless of whether the synthesized click arrives.

**Sub-pattern B prevents listener accumulation and gesture orphaning.** React StrictMode intentionally mounts and unmounts components twice in development — this is confirmed active in `apps/desktop/src/renderer.tsx:26`. Imperative `window.addEventListener` calls inside event handlers have no mount/unmount lifecycle hook, so every StrictMode cycle leaves a stale pair of `pointermove`/`pointerup` listeners behind. In production, a touch interrupt (`pointercancel`), Alt+Tab, or a stylus going out of range produces the same orphan. Without `setPointerCapture`, moving the pointer outside an Electron BrowserWindow silently drops events mid-drag. Without the `pointerId` guard, a second touch during a drag corrupts `dragRef` state. React-prop handlers eliminate all of these failure modes because React manages their lifetime.

**Sub-pattern C prevents invisible off-screen elements.** `typeof x === "number"` accepts `Infinity` and `NaN`, both of which are producible from malformed or corrupted JSON. A position like `{ x: Infinity, y: 0 }` passes the guard, gets written to `left`/`top` style, and renders the element off-screen with no error. The viewport-shrink case is equally silent: no exception is thrown, no warning appears, the element is simply unreachable. Clamping at save-time only does not help because the viewport at load time may differ from the viewport at save time.

## When to Apply

Apply all three sub-patterns together whenever:

- An element is draggable by pointer (mouse, touch, pen).
- The same element, or a child of it, has a meaningful click handler — a toggle, expand/collapse, open/close, or any action the user expects to fire on tap/click without drag intent.
- State that affects layout or visibility (position, size) is persisted across sessions.

The window-listener anti-pattern is especially tempting when the draggable widget wraps a third-party component whose `onClick` you cannot easily intercept. The wrapper-scoped `onClickCapture` approach handles exactly that case without modifying the inner component.

Do not apply sub-pattern A to pure-reorder drag widgets (e.g., sortable list rows) where there is no click affordance — the disambiguation logic is irrelevant and the `wasDraggingRef` just adds noise.

Do not apply sub-pattern C to in-memory-only geometry (e.g., a drag-to-resize panel that resets on reload). The clamping-on-load logic only matters when the position outlives the session.

## Examples

**Before — window-scoped trailing-click blocker (the bug):**

```tsx
const onPointerUp = () => {
  if (dragRef.current?.dragging) {
    // Intended to swallow the post-drag synthesized click.
    // BUG: if Chromium suppresses the synthesized click, this listener
    // sits on window and eats the next real click anywhere in the app.
    window.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    }, { once: true, capture: true });
  }
  dragRef.current = null;
};
```

**After — wrapper-scoped, self-healing:**

```tsx
const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
  const d = dragRef.current;
  if (!d || d.pointerId !== e.pointerId) return;
  if (d.dragging) {
    wasDraggingRef.current = true;
    setTimeout(() => { wasDraggingRef.current = false; }, 0);
  }
  dragRef.current = null;
};

const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
  if (wasDraggingRef.current) {
    wasDraggingRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  }
};
```

**Before — localStorage parse without adequate guards:**

```tsx
const [pos, setPos] = useState(() => {
  const saved = localStorage.getItem(KEY);
  if (saved) {
    const parsed = JSON.parse(saved); // returns any
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      // BUG: typeof accepts Infinity and NaN.
      // BUG: no clamping — off-screen if viewport shrank since last save.
      // BUG: returning parsed leaks `any` past the guard.
      return parsed;
    }
  }
  return { x: defaultX, y: defaultY };
});
```

**After — finite check, clamped on load, explicit return type:**

```tsx
const [pos, setPos] = useState<{ x: number; y: number }>(() => {
  const maxX = Math.max(0, window.innerWidth - BTN_SIZE);
  const maxY = Math.max(0, window.innerHeight - BTN_SIZE);
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
        return {
          x: Math.max(0, Math.min(maxX, parsed.x)),
          y: Math.max(0, Math.min(maxY, parsed.y)),
        };
      }
    }
  } catch {}
  return { x: Math.max(0, maxX - 16), y: Math.max(0, maxY - 16) };
});
```

## Related

- The concrete implementation that motivated this pattern lives at `apps/desktop/src/providers/query-provider.tsx` (commits `170a169` and `706dc1c`). The pre-fix version is the "before" code shown above.
- TanStack Query devtools `buttonPosition="relative"` is the API that lets the devtools button render inline so a wrapper can position it; without it the devtools render with their own `position: fixed` and the wrapper's `left`/`top` are ignored.
- No prior internal docs cover drag, pointer-event lifecycle, or click-vs-drag disambiguation as of the date above — this is the first entry in `docs/solutions/design-patterns/`.
