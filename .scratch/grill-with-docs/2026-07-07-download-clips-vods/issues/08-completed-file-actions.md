Status: done
Type: AFK

# Add completed-file actions and delete safeguards

## Parent

`.scratch/grill-with-docs/2026-07-07-download-clips-vods/prd.md`

## What to build

Add completed and partial-file actions to the Downloads page. Users should be able to reveal files in the system file explorer, open completed files in the system default player, remove rows from the Downloads list without deleting files, and explicitly delete completed or partial files only after confirmation.

## Acceptance criteria

- [x] Completed items support Show in Folder.
- [x] Completed items support Open in default player.
- [x] Remove from list does not delete the file.
- [x] Delete File is separate from remove and requires confirmation.
- [x] Partial files expose safe cleanup actions where applicable.
- [x] Tests cover shell/file actions, remove-vs-delete behavior, confirmations, and missing-file states.

## Blocked by

- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/01-persisted-download-queue.md`

## Comments

- Implemented OS-backed file actions through main-process IPC, with Show in Folder, Open File, Remove from List, and confirmed Delete File kept as separate paths.
- Added renderer controls for completed jobs and partial-file cleanup, including missing-file feedback.
- Verified with focused service/IPC/UI tests, the full download regression slice, lint, typecheck, and production build.
