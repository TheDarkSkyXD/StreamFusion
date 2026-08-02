Status: done
Type: AFK

# Show truthful active recording status on-page and off-page

## Parent

`.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`

## What to build

Expose the direct-to-file Stream Recording lifecycle through player-attached status and a global app-chrome pill driven by one typed lifecycle contract. The player shows selected quality and captured duration. The global pill survives route changes and opens a compact popover with View. Reserve shared control slots for the safe Pause/Resume and confirmed Stop behaviors delivered by issues 03 and 04; do not expose those controls before their behavior exists. Normal, theater, and fullscreen modes keep status visible without creating a recording/history page.

## Acceptance criteria

- [x] Shared recording state represents Preparing, Recording, Reconnecting, Paused, Finalizing, Completed, Failed/Partial, and Interrupted/Partial without relying on free-form status text as the state machine.
- [x] The player shows lifecycle status, selected quality, and captured playable duration for the active Stream Recording.
- [x] The global pill remains available across route changes while a recording is Preparing, Recording, Reconnecting, Paused, or Finalizing.
- [x] The pill popover identifies the Stream and provides View; it has no Downloads action. Shared control slots can accept Pause/Resume and confirmed Stop when issues 03 and 04 supply their behavior, but unsafe placeholder controls are not shown.
- [x] Normal, theater, and fullscreen modes keep status visible; player controls follow hover and keyboard-focus visibility behavior.
- [x] Status changes are announced accessibly, controls have accessible names, and motion respects reduced-motion preferences.
- [x] Renderer tests cover recording lifecycle events, route changes, popover actions, player modes, focus behavior, and captured-duration presentation without a Downloads dependency.
- [x] Electron MCP verifies player status, global pill persistence, theater/fullscreen behavior, and off-page navigation.

## Blocked by

- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/01-single-recording-start.md`

## Comments

- Scope sequencing clarification: issue 02 owns truthful shared status and View navigation. Issue 03 owns safe Pause/Resume behavior, and issue 04 owns confirmed Stop/finalization. This avoids exposing controls whose required safety semantics are not implemented yet.
- Implementation evidence: 74 focused renderer tests passed across nine files; typecheck, targeted Biome, production build, and `git diff --check` passed. The full lint gate passed before an unrelated concurrent `ContextualEmoteRow.tsx` change introduced separate diagnostics.
- Electron MCP proof used a memory-only snapshot in the real mounted provider. It verified the global pill and keyboard focus return, persistence on Downloads with no recording job row, View navigation, player status with duration/quality, and visible status in normal, theater, and fullscreen modes. Proof images: `.scratch/images/stream-recording-issue-02-global-pill.png`, `.scratch/images/stream-recording-issue-02-global-details.png`, `.scratch/images/stream-recording-issue-02-downloads-persistence.png`, `.scratch/images/stream-recording-issue-02-player-normal.png`, `.scratch/images/stream-recording-issue-02-theater.png`, and `.scratch/images/stream-recording-issue-02-fullscreen.png`.
