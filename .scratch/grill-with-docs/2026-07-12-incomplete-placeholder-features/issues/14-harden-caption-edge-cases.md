# Harden caption playback edge cases

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Close the caption correctness gaps found during final review so stale native cues, long backward seeks, valid WebVTT alignment, and disappearing failed tracks behave predictably in the custom overlay and Picture-in-Picture.

## Acceptance criteria

- [x] Disabling captions or removing/replacing the selected track clears stale native Picture-in-Picture cues.
- [x] A long VOD backward seek reparses and retains cues around the new playback position instead of preserving only later cues.
- [x] Valid percentage and snapped WebVTT line positioning honors start, center, and end line alignment.
- [x] Retry clears or replaces its error state when the failed track no longer exists instead of leaving a dead control.
- [x] Repeated Picture-in-Picture language switches use a bounded native-track strategy.
- [x] Focused regression tests cover every corrected behavior.

## Blocked by

None - can start immediately

## Comments

- Completed 2026-07-13. Caption cleanup now clears stale native Picture-in-Picture cues when captions are disabled, the selected track disappears, or its cue identity changes.
- The bounded cue timeline recenters around the current playback position, so reparsed cues after a long backward seek remain available without exceeding 512 retained cues.
- Percentage and snapped WebVTT lines apply start, center, and end line alignment without emitting invalid CSS.
- A failed track that disappears clears its error and Retry control; repeated Picture-in-Picture language switches reuse one native text track.
- Verification: 34 focused caption tests passed; lint checked 523 files; type-check and production build passed. Electron verification on the real Twitch stream `finamenon` showed live captions disappearing after Off and fresh live text returning after re-enabling English.
- A later type-check rerun was blocked only by missing `vi` imports in the concurrently added `local-audio-capture.test.ts`, outside this issue; the local-audio owner was notified.
