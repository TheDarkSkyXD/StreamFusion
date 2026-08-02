Status: done
Type: AFK

# Download playable Clips end-to-end

## Parent

`.scratch/grill-with-docs/2026-07-07-download-clips-vods/prd.md`

## What to build

Add real `Clip Download` execution for playable Twitch and Kick Clips. A user should be able to choose quality when multiple qualities are available, choose a save path through the system save-file dialog, and download the Clip through the persisted Downloads queue with progress, completion, cancellation, retry, and safe partial-file behavior.

## Acceptance criteria

- [x] Clip downloads only start for Clips StreamFusion can resolve and play for the current user.
- [x] Quality defaults to best/source and shows a picker when multiple Clip qualities are available.
- [x] The save-file dialog suggests a sanitized `{username}-{title}` filename.
- [x] Existing destination paths auto-rename with suffixes such as `(1)` and `(2)`.
- [x] Direct MP4 Clip downloads show progress and complete into the selected path.
- [x] Cancel, retry, disk/write error handling, and partial/temp file cleanup behave according to the PRD.
- [x] Tests cover successful Clip downloads, quality selection, filename/path handling, progress events, cancellation, and disk/write errors.

## Blocked by

- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/01-persisted-download-queue.md`

## Comments

- 2026-07-07: Implemented direct MP4 Clip Download orchestration through `electronAPI.downloads.downloadClip`, including Twitch signed MP4 unwrapping, Kick direct MP4 support, system quality picker, system save dialog, sanitized `{username}-{title}.mp4` defaults, existing-path suffixing, queue progress/completion/failure updates, cancellation, retry, and `.part` cleanup.
- 2026-07-07: Non-MP4/HLS clip manifests are rejected with a clear unsupported error in this slice so the FFmpeg slice can own HLS remux/download behavior instead of mixing engines.
- 2026-07-07: Verified with `npx vitest run tests/backend/services/download-queue-service.test.ts tests/backend/services/download-paths.test.ts tests/backend/services/clip-download-service.test.ts tests/backend/services/direct-file-download-service.test.ts tests/backend/ipc/handlers/download-handlers.test.ts`, `npm run lint`, `npm run typecheck`, and `npm run build`.
