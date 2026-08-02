Status: done
Type: AFK

# Replace mock Downloads page with a real persisted queue

## Parent

`.scratch/grill-with-docs/2026-07-07-download-clips-vods/prd.md`

## What to build

Replace the mock-only Downloads page with a real persisted queue for `Clip Download` and `Video Download` jobs. The queue should be owned by the main process, exposed through `electronAPI`, hydrated by the renderer, and displayed in the queue-first layout with visible groups for active, queued, paused, failed, waiting, and completed jobs. Stream Recording is explicitly excluded by the later direct-to-file rescope.

This slice does not need to perform real media downloads yet. It must establish the end-to-end queue contract, persistence, progress/status updates, and basic job controls so later slices can plug in real engines.

## Acceptance criteria

- [x] Downloads queue state lives in the main process and persists queued, paused, failed, and completed Clip/Video jobs across restart.
- [x] Active jobs are not silently resumed after restart; they hydrate as paused or failed with a resumable/retryable state.
- [x] The renderer can list jobs, enqueue a placeholder job, pause, resume, cancel, retry, remove from list, and receive progress/status updates through `electronAPI`.
- [x] The `/downloads` page no longer uses `MOCK_DOWNLOADS`.
- [x] The `/downloads` page uses a queue-first layout with visible status groups.
- [x] Tests cover queue persistence, hydration, status grouping, and renderer update handling.

## Blocked by

None - can start immediately

## Comments

- Canonical rescope: Stream Recording is not a Downloads job. The comments below are preserved historical implementation evidence and do not establish current recording architecture.
- 2026-07-07: Implemented persisted main-process download queue, IPC/preload bridge, queue-backed Downloads page, and focused coverage for persistence, hydration, status grouping, and renderer updates.
- 2026-07-07: Verified with `npx vitest run tests/backend/services/download-queue-service.test.ts tests/backend/services/storage-service.test.ts tests/backend/ipc/handlers/download-handlers.test.ts tests/pages/Downloads.test.tsx`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- 2026-07-07: Electron MCP verification navigated the running app to `#/downloads`; screenshot saved at `.scratch/images/downloads-queue-issue-01.png`. The Electron log reader itself failed on Windows because it shells out to `ps`, so no renderer log assertion was made.
