Status: superseded
Type: AFK

# Superseded: Add DVR controls and reconnect behavior for Stream Recording

## Parent

`.scratch/grill-with-docs/2026-07-07-download-clips-vods/prd.md`

## What to build

This slice is superseded by `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md` and its issues. Pause, Resume, reconnect, gaps, and quality changes now belong to the direct-to-file controller and current player/global session UI; they never create Downloads status or history.

### Historical scope (superseded)

Extend Stream Recording with DVR-style pause/resume and automatic reconnect behavior. Pause should stop writing/downloading new live segments and create a visible gap until resumed. Connection loss should retry with backoff for up to five minutes, keep partial files, and fail only after reconnect is exhausted.

## Historical acceptance criteria (superseded)

- [x] Active Stream Recordings can pause and resume.
- [x] Pause creates a recording gap rather than buffering hidden live content.
- [x] The UI makes gaps visible in job details or status history.
- [x] Connection loss triggers automatic reconnect with backoff for up to five minutes.
- [x] Reconnect exhaustion keeps the partial file and marks the job failed with a retry action when appropriate.
- [x] If the Stream source is removed or no longer playable, the job is removed.
- [x] Tests cover pause gaps, resume, reconnect success, reconnect exhaustion, and removed source behavior.

## Blocked by

- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/05-stream-recording-basic.md`

## Comments

- Superseded after implementation. The comments below accurately record the former queue-based implementation and verification; current acceptance is defined by the later recording issues.
- Implemented Stream Recording pause/resume in `stream-recording-service`; pausing stops the active recorder and records an open `paused` gap, resuming closes the gap and starts a fresh recorder.
- Added reconnect handling for recorder failures with configurable backoff up to five minutes, partial-file retention, retryable failed jobs after exhaustion, and source-removed job cleanup.
- Routed Downloads pause/resume IPC for `stream-recording` jobs through the Stream Recording service instead of queue-only status flips.
- Downloads now renders `statusMessage` plus the latest pause/reconnect gap so users can see discontinuities.
- Verification: full download slice passed (101 tests / 14 files), `npm run lint`, `npm run typecheck`, and `npm run build` passed. Build still emits the existing large-chunk warning.
- Electron MCP verification: seeded a temporary `DVR gap demo` queue job through app IPC, confirmed `Reconnecting` and `Reconnect gap: 12:01:00 - 12:01:20` rendered in Downloads, saved `.scratch/images/stream-recording-dvr-issue-06.png`, then removed the temporary job.
