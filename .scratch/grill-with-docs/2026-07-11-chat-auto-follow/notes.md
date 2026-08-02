# Chat Auto-Follow: Grilling Session Notes
Date: 2026-07-11 · Goal: make auto-follow reliably show the newest chat message in full at both slow and high message rates.

## Summary / key decisions

- Working definition to verify: while auto-follow is active, the newest rendered message must be completely visible; intentional user scroll-up must remain respected.
- Electron reproduction on GiantWaffle shows the newest row partially clipped at the bottom while no paused/scroll-up state is visible.
- The current worktree removed the append and late-height correction paths that exist in `HEAD`; it now relies on Virtuoso `followOutput` alone, and the current tests explicitly require no corrective scroll after appends.
- Confirmed root cause: a long/wrapping row is placed using an initial height estimate, then grows after Virtuoso measures it; the resulting `atBottom=false` is intentionally ignored because there was no user wheel-up, but no correction path remained.
- Virtuoso's `autoscrollToBottom()` was ruled out at the real library seam: it waits for a future size-increase event, so invoking it from `totalListHeightChanged` is too late.
- Final correction: after Virtuoso reports the new total height, align `LAST` to `end` immediately and retain the direct scroller fallback for any residual gap. Both paths are gated by bottom-follow intent.
- Validation: 26 focused tests pass; lint, type-check, and production build pass. Electron screenshots show complete newest rows in GiantWaffle chat across later short and wrapped messages.

## PRD

- [prd.md](prd.md)

## Q&A log

### Q1 — Auto-follow correction behavior
- Asked: When a followed row grows after rendering, should StreamFusion instantly keep its bottom edge visible, or animate the catch-up?
- Captured: User asked what is best. Decision: instant correction while follow intent is active; never correct after intentional user scroll-up. Animation can visibly chase or backlog in fast chat.
- Doc updates: none.
- Flags: none.

### Q2 — Regression scope
- Asked: Approve the test-first behavior set: full newest row visible after append/late remeasure, rapid chat remains pinned without smooth-scroll backlog, wheel-up prevents any snap-back, and return-to-latest restores following.
- Captured: User approved and explicitly asked to test all four behaviors.
- Doc updates: none.
- Flags: none.

## Open flags (pending input)

- None.
