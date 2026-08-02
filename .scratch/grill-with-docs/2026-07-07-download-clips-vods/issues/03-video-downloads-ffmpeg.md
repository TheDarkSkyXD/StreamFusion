Status: done
Type: AFK

# Download playable Videos with bundled ffmpeg

## Parent

`.scratch/grill-with-docs/2026-07-07-download-clips-vods/prd.md`

## What to build

Add real `Video Download` execution for playable Twitch and Kick Videos using bundled ffmpeg for HLS assembly/remux. The job should refresh temporary media URLs at job start, respect conservative queue pressure, report progress, and save `.mp4` when possible with a segment-safe fallback when MP4 finalization fails.

## Acceptance criteria

- [x] Video downloads only start for Videos StreamFusion can resolve and play for the current user.
- [x] Twitch Video downloads use refreshed playback token/HLS URLs at job start.
- [x] Kick Video downloads use the best available playable HLS/source URL and handle fragile/missing source data gracefully.
- [x] ffmpeg binary resolution is handled in the main process and returns clear errors when unavailable.
- [x] Output defaults to `.mp4` and clearly reports a fallback format if MP4 finalization fails.
- [x] Queue pressure allows one active Video download and limited per-job segment/media concurrency.
- [x] Tests cover Video media resolution, ffmpeg invocation, progress parsing, MP4 fallback, URL refresh, and unavailable media removal.

## Blocked by

- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/01-persisted-download-queue.md`

## Comments

- 2026-07-07: Added `ffmpeg-static` as the bundled FFmpeg source, main-process FFmpeg binary resolution, HLS remux invocation, FFmpeg progress parsing, `.mp4` output with `.ts` fallback, and an unpack rule for the packaged binary.
- 2026-07-07: Added `electronAPI.downloads.downloadVideo` and default Twitch/Kick Video resolution at job start so temporary playback URLs are refreshed before FFmpeg runs.
- 2026-07-07: Added one-active-Video queue pressure in the video download service; later Video jobs remain queued until the active FFmpeg job finishes.
- 2026-07-07: Verified with `npx vitest run tests/backend/services/download-queue-service.test.ts tests/backend/services/storage-service.test.ts tests/backend/services/download-paths.test.ts tests/backend/services/clip-download-service.test.ts tests/backend/services/direct-file-download-service.test.ts tests/backend/services/ffmpeg-download-service.test.ts tests/backend/services/video-download-service.test.ts tests/backend/ipc/handlers/download-handlers.test.ts tests/pages/Downloads.test.tsx`, `npm run lint`, `npm run typecheck`, and `npm run build`.
