Status: done
Type: AFK

# Pause and resume without losing captured sections

## Parent

`.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`

## What to build

Make Pause and Resume safe across the direct-to-file recording controller, one-time recovery journal, player, and global pill. Each resumed capture writes to a distinct safe section so earlier footage cannot be overwritten. Captured duration freezes during the pause, and player/global UI shows a current-session gap summary only.

## Acceptance criteria

- [x] Pause and Resume work from the player and global pill through the recording controller; Downloads is never read or mutated.
- [x] Pausing stops new capture, freezes captured duration, and opens a gap; resuming closes the gap and continues captured-duration accumulation.
- [x] Every resumed capture uses a distinct safe section and demonstrably preserves all earlier captured bytes.
- [x] Player/global UI shows a concise current-session gap summary; no durable gap history remains after the terminal notice clears.
- [x] The one-time recovery journal retains section identities, cumulative captured duration, and gaps only while the session is active or interrupted.
- [x] Pause/Resume controls are keyboard operable and restore focus after state changes.
- [x] Tests use public controller/IPC/UI seams to prove timer freezing, current-session gap state, multi-section preservation, both control surfaces, and no Downloads mutation.
- [x] Electron MCP verifies Pause/Resume, frozen captured duration, and player/global gap summaries.

## Blocked by

- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/02-recording-status-player-global.md`

## Comments

- Implementation evidence: 96 focused tests passed after independent-audit corrections. Typecheck, lint across 491 source files, production build, targeted Biome, diff/whitespace checks, and deslop passed.
- File-integrity evidence includes distinct section paths for every capture, sentinel-byte preservation across repeated Pause/Resume cycles, cumulative monotonic duration, late-callback rejection, truthful spawn-failure rollback, and serialized Pause/Resume transitions.
- Electron MCP used memory-only renderer snapshots while public controller/IPC tests supplied backend proof, avoiding a native Save dialog or fake user recording. It verified player/global controls, a frozen `0:42` paused duration, `1 gap · current gap open`, player Resume visibility through hover/focus controls, and resumed duration at `0:47`. Proof images: `.scratch/images/stream-recording-issue-03-global-paused.png`, `.scratch/images/stream-recording-issue-03-global-gap.png`, `.scratch/images/stream-recording-issue-03-player-resume.png`, and `.scratch/images/stream-recording-issue-03-resumed.png`.
- Stop-vs-Pause transition serialization remains explicitly owned by issue 04 and must be closed before the Stop control is exposed.
