Status: done
Type: AFK

# Add Download actions to playable Clip and Video surfaces

## Parent

`.scratch/grill-with-docs/2026-07-07-download-clips-vods/prd.md`

## What to build

Add Download actions to playable Clip surfaces and the Video watch page. Video cards and Video search/result cards do not expose Download. The action should drive the quality picker, save-file dialog, duplicate-content confirmation, and queue enqueue flow without bypassing the current playback entitlement boundary.

## Acceptance criteria

- [x] The playable Video watch page exposes Download; Video cards do not.
- [x] Playable Clip surfaces expose a Download action.
- [x] Download actions are hidden or disabled with clear feedback when content is not playable/downloadable.
- [x] Duplicate content detection asks before adding a duplicate job.
- [x] The enqueue flow runs quality selection before save-file selection when quality choices exist.
- [x] Tests cover the entry points, disabled states, duplicate prompt, and successful enqueue into the Downloads queue.

## Blocked by

- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/02-clip-downloads.md`
- `.scratch/grill-with-docs/2026-07-07-download-clips-vods/issues/03-video-downloads-ffmpeg.md`

## Comments

- Canonical rescope: later Q1 narrowed Video Download to the Video watch page. The comments below preserve the historical implementation and verification, including now-superseded Video-card actions.
- 2026-07-07: Added a shared renderer download action hook with duplicate detection/confirmation and toast feedback.
- 2026-07-07: Added Download actions to the Video page, Video cards, and Clip dialog. Unplayable/sub-only content disables the action with a title explaining that the item is not downloadable.
- 2026-07-07: The main-process clip flow still owns quality selection before save-file selection; renderer entry points call `electronAPI.downloads.downloadClip` / `downloadVideo` without bypassing playback resolution.
- 2026-07-07: Verified with focused entry-point tests plus the combined download suite, `npm run lint`, `npm run typecheck`, and `npm run build`. Electron MCP verified the running Video page exposes disabled main Download for an unavailable VOD and enabled Download buttons on related playable Video cards; screenshot capture timed out, so DOM structure was used as proof.
