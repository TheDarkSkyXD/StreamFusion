Status: done
Type: AFK

# Harden queue edge cases and user-safety flows

## Parent

`.scratch/grill-with-docs/2026-07-07-download-clips-vods/prd.md`

## What to build

Harden the Clip/Video Downloads queue for duplicate content, duplicate save paths, disk/write failures, removed/unavailable sources, temporary signed URL expiry, platform rate limits, and app quit with active download jobs. Direct-to-file Stream Recording quit/recovery belongs to the later recording PRD and never hydrates into this queue.

## Acceptance criteria

- [x] Duplicate content detection asks before adding a second job.
- [x] Duplicate destination paths auto-rename without overwriting existing files.
- [x] Disk/write errors keep partial/temp files and offer Retry or Choose New Path.
- [x] Temporary signed URL expiry refreshes before treating content as unavailable.
- [x] Removed or no-longer-playable Clip or Video sources remove the download job.
- [x] Twitch/Kick throttling shows `Waiting for platform` with next retry time and backs off automatically.
- [x] Quitting with active Clip/Video download jobs shows a confirmation and safely stops those jobs if quitting proceeds.
- [x] Tests cover every edge-case transition above.

## Blocked by

- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/02-clip-downloads.md`
- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/03-video-downloads-ffmpeg.md`

## Comments

- Canonical rescope: these queue edge cases apply to Clip/Video downloads only. The historical `recording` quit behavior below is preserved as implementation history, not current recording acceptance.
- Duplicate content confirmation is covered by the existing `useDownloadActions`/`VideoCard` duplicate prompt test.
- Destination auto-renaming is covered by `download-paths` and clip retry path tests.
- Direct downloader now keeps `.part` files on non-cancel disk/write failures while still deleting temp files on cancellation.
- Clip jobs now mark non-cancel failures as `partial` and `retryable`, refresh expired signed URLs once before failing, remove gone sources on retry, and move platform throttles into `waiting` with `nextRetryAt`.
- Downloads renders `statusMessage` and `nextRetryAt`, so platform waits are visible.
- Main-process `before-quit` now asks before quitting with queued/downloading/recording/waiting jobs and persists those active jobs as paused when quitting proceeds.
- Verification: full download slice passed (105 tests / 14 files), `npm run lint`, `npm run typecheck`, and `npm run build` passed. Build still emits the existing large-chunk warning.
