# Complete responsive replay states and resilience

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Finish Chat Replay as a production surface using the approved layout: a collapsible right rail on desktop, a drawer at narrow widths, and distinct loading, retryable failure, supported-empty, unsupported, and capability-loss behavior.

## Acceptance criteria

- [ ] Desktop uses a collapsible right rail matching the approved mockup and `DESIGN.md`.
- [ ] Narrow windows use an accessible drawer without covering essential Video controls.
- [ ] Loading shows a skeleton, transient failure offers inline Retry, and supported-empty shows an empty state.
- [ ] Unsupported or lost capability removes the rail cleanly without shifting into a generic error panel.
- [ ] Responsive and state transitions are covered by component tests and Electron verification.

## Blocked by

- [05-first-platform-chat-replay.md](./05-first-platform-chat-replay.md)

## Comments

- Added a collapsible desktop rail, accessible in-flow narrow drawer, loading skeleton, inline Retry, supported-empty state, and clean unsupported/capability-loss removal.
- Adjacent tests passed 33/33; full lint, type-check, build, targeted Biome, React Doctor, and deslop gates passed for the slice.
- Electron proof confirmed the desktop rail and a visible non-modal drawer after resizing to a narrow window. Evidence: `.scratch/images/chat-replay-proof.png` and `.scratch/images/chat-replay-drawer-proof.png`.
