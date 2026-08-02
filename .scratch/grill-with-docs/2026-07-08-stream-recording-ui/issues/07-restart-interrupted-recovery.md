Status: done
Type: AFK

# Recover an Interrupted/Partial recording after restart

## Parent

`.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`

## What to build

Recover an active direct-to-file Stream Recording explicitly after app close or crash through a separate one-time recovery journal, never a Downloads job or history row. If the same Stream remains playable, offer Resume Recording with a visible restart gap and the approved quality-recovery rule. Always offer Finalize Partial. Both paths preserve prior sections and clear the journal after resolution.

## Acceptance criteria

- [x] A separate minimal recovery journal includes Stream identity, destination, selected quality, section identities, cumulative captured duration, gaps, and recovery state only while active/interrupted.
- [x] The journal produces a one-time Interrupted/Partial prompt after restart and never starts network/file activity automatically.
- [x] If the same Stream is still playable, Resume Recording is offered and continues in a new section with a visible restart gap.
- [x] If the selected quality is unavailable on Resume, the nearest available quality is used with visible current-session Quality changed status.
- [x] Finalize Partial is available whether or not the Stream remains playable and combines preserved sections into one playable output.
- [x] Resume and Finalize Partial preserve earlier footage and cumulative duration; gap/quality details exist only for the current recovery session.
- [x] Finalization, failure resolution, pre-start cancellation, or recovery dismissal clears the journal and creates no durable recording history.
- [x] Recovery actions, dialog focus, and status announcements are keyboard and screen-reader accessible.
- [x] Tests cover journal persistence/hydration/clearing, no auto-resume, Resume eligibility, quality fallback, Finalize Partial, section preservation, final output, and no Downloads mutation.
- [x] Electron MCP verifies a real one-time recovery flow through Resume and Finalize Partial, including the resulting file and absence of history.

## Blocked by

- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/03-safe-pause-resume-sections.md`
- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/04-confirm-stop-finalize-file.md`
- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/05-reconnect-quality-recovery.md`
- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/06-terminal-outcomes-notifications.md`

## Comments

- Scope dependency clarification: restart Resume must reuse issue 05's canonical quality-selection and visible Quality changed contract rather than introducing a second fallback rule.
- TDD and independent audit evidence: the final recording/FFmpeg suite passed 163/163 tests; a separate reviewer ran 281/281 focused tests across 22 files and cleared journal/path ownership, stable broadcast identity, finalization checkpoints, terminal FFmpeg shutdown, persistence-failure locks, typed IPC, accessibility state, and no Downloads mutation.
- Real Windows media evidence: focused tests produced a 274,292-byte paused TS and a 427,606-byte MP4 with paused/output/partial validation statuses all 0. Recording-scoped Biome passed, and the post-fix production build completed successfully.
- Electron MCP restart proof: the one-time alert dialog hydrated with Check & Resume focused, ignored Escape, showed 0:02 captured with an open restart gap, and resumed the same live Kick broadcast into a second section. Pause then produced a 26,682,840-byte live section that passed full FFmpeg validation.
- Electron MCP Finalize Partial proof: a fresh interrupted journal using that real live section finalized to `.scratch/logs/runtime/recovery-finalize-proof.mp4` (25,856,285 bytes), and full FFmpeg decode validation exited 0. The recording journal cleared, Stream Recording state returned idle, and Downloads remained exactly 9 entries before and after both recovery actions.
- The Electron MCP screenshot transport timed out while connecting over CDP, so proof used Electron MCP DOM, focus, IPC state, file-state, and media-validation observations only; no non-Electron UI fallback was used. The user's original development profile was restored byte-for-byte from its backup and the backup was removed after SHA-256 equality verification.
- Final repository run after unrelated concurrent caption/browse changes: all recording tests passed, but 4 unrelated caption/browse tests failed (5,308/5,312 overall). The same unrelated work also blocks repository-wide typecheck/lint; no recording diagnostics were reported. `git diff --check` and the final production build passed.
