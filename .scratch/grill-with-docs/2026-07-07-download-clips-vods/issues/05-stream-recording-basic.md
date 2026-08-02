Status: superseded
Type: AFK

# Superseded: Add Stream Recording jobs for playable live Streams

## Parent

`.scratch/grill-with-docs/2026-07-07-download-clips-vods/prd.md`

## What to build

This slice is superseded by `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md` and its issues. The canonical model is an independent direct-to-file single active session with player/global controls, transient terminal file actions, no Downloads job, and no recording/history page.

### Historical scope (superseded)

Add `Stream Recording` as a queue job type for currently playable live Streams. A user should be able to start a recording from a playable Stream surface, choose quality when choices exist, choose a save path, see the recording in Downloads, stop it, and receive a completed or partial output file.

## Historical acceptance criteria (superseded)

- [x] Stream Recording only starts for Streams StreamFusion can currently resolve and play.
- [x] The recording flow asks quality when multiple qualities are available, then asks for a save path.
- [x] The save-file dialog suggests a sanitized `{username}-{title}` filename.
- [x] A recording job appears in the same Downloads queue and reports elapsed time/progress-like status.
- [x] Stopping a recording finalizes the file when possible and keeps a partial file when finalization fails.
- [x] Tests cover starting, stopping, queue visibility, save path handling, and removed/unavailable Stream handling.

## Blocked by

- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/01-persisted-download-queue.md`
- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/03-video-downloads-ffmpeg.md`

## Comments

- Superseded after implementation. The comments below accurately record what was built and verified under the former queue-based design; they do not claim compliance with the current direct-to-file PRD.
- Implemented live Stream Recording as a `stream-recording` queue job backed by the same persisted Downloads queue, bundled ffmpeg recording, quality selection, and save dialog flow.
- Added Stream page Record entry point gated by playable HLS source; offline/unresolved Streams keep the Record button disabled.
- Added partial-output metadata so stopped recordings can complete with `partial: true` when ffmpeg returns a kept partial file.
- Verification: targeted issue tests passed (`stream-recording-service`, `download-handlers`, `StreamPage`), full download slice passed (95 tests / 14 files), `npm run lint`, `npm run typecheck`, and `npm run build` passed.
- Electron MCP verification: `#/stream/twitch/ninja` showed Record visible and disabled when unavailable; `#/stream/twitch/xqc` showed Record visible and enabled. Screenshot: `.scratch/images/stream-recording-issue-05.png`.
