Status: done
Type: AFK

# Start exactly one Stream Recording from the watch player

## Parent

`.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`

## What to build

Turn the existing entry point into an authoritative direct-to-file single-recording flow. A playable Stream moves through quality choice when needed, the system Save dialog, Preparing, and Recording. The privileged recording controller must atomically reject any simultaneous or second start. A blocked start shows View Recording and Cancel; it is never queued, added to Downloads, or used to replace the active recording.

## Acceptance criteria

- [x] A playable Stream starts through quality choice when needed, the system Save dialog, Preparing, and then Recording.
- [x] Canceling the Save dialog or failing before an output/session is created leaves Record available and creates no app history.
- [x] The privileged recording service atomically permits only one active Stream Recording, including simultaneous start attempts.
- [x] A second start is blocked with the active Stream identified and View Recording and Cancel actions; it is not queued or offered as one-step replacement.
- [x] Starting, preparing, recording, or canceling a Stream Recording never enqueues or mutates a Downloads job.
- [x] The watch-page entry point and blocked dialog are keyboard operable, have accessible names, and return focus predictably.
- [x] Tests cover successful start, canceled/pre-start failure, sequential second start, and simultaneous start races through public service/IPC/UI seams.
- [x] Electron MCP verifies the start flow and blocked-second-recording dialog in the running app.

## Blocked by

None - can start immediately.

## Comments

- Implemented a standalone direct-to-file Stream Recording contract, versioned one-time recovery journal, controller, IPC namespace, preload bridge, and renderer hook. Downloads remains Clip/Video-only and defensively sanitizes legacy recording rows without touching media files.
- Added atomic synchronous start reservation, Preparing to Recording snapshots, typed start outcomes, cancellation/pre-start cleanup, safe first-section identity, Interrupted hydration without auto-resume, and a narrow interrupted-session dismissal path.
- TDD coverage includes chosen non-first quality, quality/Save cancellation, recorder-spawn cleanup, simultaneous and sequential blocking, synchronous progress preservation, journal migration, transient-only notices, runtime IPC validation/state push, keyboard/focus behavior, and Downloads isolation.
- Verification: targeted issue suite passed (85 tests / 9 files); type-check, lint (486 files), production build, and `git diff --check` passed. Existing StreamPage `act(...)` warnings and build chunk-size advisory are unrelated.
- Electron MCP proof: native start flow invoked and canceled without session/history; hydrated active state normalized to Interrupted; blocked-second dialog showed Warframe with Cancel and View Recording only; Cancel returned focus to Record; View navigated to `#/stream/twitch/warframe`; Downloads showed no Stream Recording row. Screenshot: `.scratch/images/stream-recording-issue-01-final.png`.
