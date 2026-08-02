# Make captions resilient across PiP and track failures

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Keep captions usable at player boundaries. Hand the selected track to Chromium while native Picture-in-Picture is active, restore the StreamFusion overlay on exit, and make subtitle-track failures non-fatal with captions Off and an explicit Retry action.

## Acceptance criteria

- [x] Entering native PiP hides the custom overlay and shows the selected track through Chromium's native caption path.
- [x] Exiting PiP restores the selected track and custom overlay without duplicate or stale cues.
- [x] A track-load failure keeps media playing, turns captions Off, and exposes a non-blocking error with Retry.
- [x] Retry can restore the failed selection without remounting or restarting media.
- [x] Automated tests and Electron verification cover PiP entry/exit and failure/retry behavior.

## Blocked by

- [02-caption-selection-and-overlay.md](./02-caption-selection-and-overlay.md)

## Comments

- Completed with native PiP handoff/cleanup and non-fatal retry behavior. Automated resilience coverage is green; the normal Electron caption path was verified without renderer errors.
