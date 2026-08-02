# Direct-to-File Stream Recording UI PRD

## Problem Statement

StreamFusion can start a live Stream Recording, but the current implementation models it as a persistent Downloads job. That is the wrong product boundary: a Stream Recording is a temporary, direct-to-file capture session, not downloadable media and not durable app history.

Users need truthful recording status and safe controls while capture is active, including when they leave the Stream page. They also need captured footage preserved through pauses, reconnects, source loss, and an interrupted app session without creating a Downloads row or a recording/history page.

## Solution

Create an independent direct-to-file recording controller with exactly one active Stream Recording at a time. The attached player owns on-page status and controls; an app-wide recording pill and popover own off-page status and controls. Stream Recordings never enter Downloads and never create durable completed or failed history.

The start flow is quality selection when needed, the system Save dialog, Preparing, then Recording. Pause, reconnect, and restart recovery write to distinct safe sections. Finalizing combines preserved sections into one playable output. Terminal completion, partial, and failure states use transient player/global notices with Open and Show in Folder when a file exists, then clear the session UI.

The approved visual reference is `designs/recording-ui-consolidated-v2.html`, with any Downloads actions, Downloads ownership, and durable terminal-history treatment superseded by this PRD.

## User Stories

- As a viewer, I can record a currently playable Stream directly to a location I choose.
- As a viewer, I can see Preparing, Recording, Reconnecting, Paused, and Finalizing on the player and in global app chrome.
- As a viewer, I can Pause, Resume, or Stop from the player or global recording popover.
- As a viewer, I see selected quality, captured playable duration, and a current-session gap or quality-change summary.
- As a viewer, I am protected from an accidental Stop by a confirmation whose safe default is Keep Recording.
- As a viewer, I cannot silently queue or replace an active recording by starting another Stream.
- As a viewer, I receive a transient completion, partial, or failure notice with Open and Show in Folder when a file exists.
- As a viewer, after an interrupted app session I receive a one-time choice to Resume when the Stream is still playable or Finalize Partial, without a recording-history page.

## Implementation Decisions

- Stream Recording is independent from the Downloads queue. Downloads persists Clip Download and Video Download jobs only.
- Exactly one Stream Recording may be active. The privileged recording controller enforces this atomically, including simultaneous start attempts.
- A blocked second start identifies the active Stream and offers View Recording and Cancel only. It is not queued, replaced, or linked to Downloads.
- The start flow is quality selection when needed, system Save dialog, Preparing, then Recording. Cancellation or failure before an output/session is created leaves Record available and creates no history.
- Player-attached UI shows lifecycle state, selected quality, captured duration, Pause or Resume, and Stop. Theater and fullscreen keep status visible; controls follow player hover and keyboard-focus behavior.
- The global pill remains available across routes while Preparing, Recording, Reconnecting, Paused, or Finalizing. Its popover identifies the Stream and provides View, Pause or Resume, and Stop.
- Stop from either control surface uses the same confirmation. Keep Recording is the safe default and restores focus to the invoking surface.
- Captured duration measures playable footage and freezes while paused, reconnecting, or otherwise not writing media.
- Pause, reconnect, and restart recovery continue in distinct safe sections so earlier footage cannot be overwritten.
- Gap and quality-change details are current-session summaries only. StreamFusion does not retain recording history after the terminal notice clears.
- Recovery retains the chosen quality when available. If it disappears, use the nearest available quality and show Quality changed in the player/global status.
- Reconnect retries with backoff for up to five minutes. Exhaustion preserves any captured partial file and enters a transient failure outcome.
- A normal Stream end enters Finalizing and then transient Completed. Unexpected removal or access loss after capture begins preserves the partial file and enters a transient Partial/Failed outcome. A pre-start failure with no file clears without phantom history.
- Finalizing combines preserved sections into one playable MP4 when clean remux succeeds, with the established safe fallback when it does not.
- Terminal completion, partial, and failure notices are transient app UI, not durable records. When a file exists they offer Open and Show in Folder, then clear.
- Focused-app outcomes use an in-app notice. Minimized or unfocused outcomes use desktop notification when enabled and supported.
- A separate one-time recovery journal may persist only while a recording is active or interrupted. It stores the minimum Stream identity, destination, selected quality, section identities, captured duration, gaps, and recovery state needed for Resume or Finalize Partial. It is never exposed as Downloads/history and is deleted after finalization, failure resolution, cancellation before capture, or recovery dismissal.
- On restart, the journal may produce one Interrupted/Partial recovery prompt. Recording never auto-resumes. Resume is offered only when the same Stream is playable; Finalize Partial remains available for captured sections.

## Testing Decisions

- Verify Stream Recording never enqueues, updates, hydrates, or removes a Downloads job.
- Unit-test the typed lifecycle: Preparing, Recording, Reconnecting, Paused, Finalizing, transient Completed, transient Partial/Failed, and one-time Interrupted/Partial recovery.
- Unit-test the atomic single-recording invariant and simultaneous start races.
- Unit-test captured-duration freezing and accumulation across pause, reconnect, and restart sections.
- Unit-test distinct section paths, no overwrite, one-file finalization, and safe output fallback.
- Unit-test selected-quality retention and nearest-quality fallback with visible current-session status.
- Unit-test normal Stream end, unexpected source loss after capture, reconnect exhaustion, and pre-start failure with no file.
- Unit-test recovery-journal creation, hydration, no auto-resume, Resume eligibility, Finalize Partial, and clearing after every terminal resolution.
- Test typed IPC/events for start, pause, resume, stop, lifecycle updates, file actions, and one-time recovery without using Downloads IPC as the recording contract.
- Add renderer tests for player/global state parity, route changes, theater/fullscreen behavior, Stop confirmation, blocked-second dialog, current-session gap/quality summaries, and transient outcome clearing.
- Test focused in-app versus enabled/supported unfocused desktop outcome delivery.
- Verify the real flow in the running app with Electron MCP only, including the resulting file and absence of any Downloads/history row.

## Out of Scope

- Stream Recording rows or controls in Downloads.
- Any recording or recording-history page.
- Durable completed, partial, failed, gap, or quality-change history in app UI.
- Multiple simultaneous or queued Stream Recordings.
- One-step replacement of an active recording.
- Automatic recording resume after launch.
- User-configurable Stream Recording concurrency.
- Separate numbered part files as the user-facing result.
- In-app playback or a local media library for completed files.
- Recording a Stream URL that StreamFusion cannot currently play.

## Further Notes

- `CONTEXT.md` remains correct: Stream Recording is a user-initiated local capture distinct from a Video.
- ADR 0008 remains valid for bundled ffmpeg assembly/remux; the recording controller may reuse media/path helpers without becoming a Downloads job.
- The earlier Downloads PRD remains canonical for Clip and Video downloads only.
