# Downloads and Stream Recording PRD

> Stream Recording UI and recovery behavior was refined by `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`. That later PRD governs whenever the two documents differ.

## Problem Statement

StreamFusion can already discover and play Twitch/Kick Streams, Videos, and Clips, but users cannot save playable content locally or monitor long-running media jobs. The current `/downloads` page is mock-only, and the existing Phase 10 plan does not reflect the newer requirement that every job asks the user where to save before queueing.

Users need a platform-respectful download and recording workflow that saves playable Clips, Videos, and live Stream Recordings without overloading Twitch or Kick, while making progress, errors, partial files, and completed files easy to manage.

## Solution

Add a main-process Downloads service that owns a persistent queue for two job types:

- `Clip Download`
- `Video Download`

The renderer exposes Video Download on the Video watch page and Clip Download where playable Clips are presented. Before queueing a download, StreamFusion resolves available quality options, asks the user for quality when multiple qualities exist, opens a system save-file dialog with a sanitized `{username}-{title}` filename suggestion, and then enqueues the job.

Stream Recording is adjacent but independent: it is one direct-to-file active session controlled from the player and global recording pill. It never enters Downloads and creates no recording/history page. See the canonical recording PRD at `../2026-07-08-stream-recording-ui/prd.md`.

The Downloads page replaces mock data with a queue-first operational layout showing active, queued, paused, failed, waiting, and completed jobs in visible status groups. Jobs support pause, resume, cancel, retry, remove-from-list, and confirmed delete-file actions where applicable.

## User Stories

- As a viewer, I can download a playable Twitch or Kick Clip after choosing where to save it.
- As a viewer, I can download any playable StreamFusion Video, including Twitch archives/highlights/uploads and Kick replays/VODs.
- As a viewer, I can record one currently playable Stream directly to a chosen file without creating a Downloads or history item.
- As a viewer, I can monitor active, queued, paused, failed, waiting, and completed jobs from the Downloads page.
- As a viewer, I can pause, resume, cancel, retry, or remove jobs without losing files accidentally.
- As a viewer, I can recover from disk errors by retrying or choosing a new save path.
- As a viewer, I can open completed files in the system default player or reveal them in the file explorer.

## Implementation Decisions

- Entitlement: download or record only content StreamFusion can already resolve and play for the current user. Do not bypass private, deleted, subscriber-only, DRM-like, or unavailable content.
- Save picker: show a system save-file dialog once per job before queueing.
- Filename suggestion: use sanitized `{username}-{title}` and trim long names as needed. If the resolved path already exists, auto-rename with suffixes such as `(1)`, `(2)`.
- Quality selection: default to best/source quality, but show a picker when multiple qualities are available.
- Engine: bundle ffmpeg for Video and Stream Recording HLS assembly/remux; use direct HTTP for Clips when a direct MP4 URL is available. See `docs/adr/0008-bundled-ffmpeg-for-media-downloads.md`.
- Output: save `.mp4` by default when ffmpeg can remux cleanly. Fall back to `.ts` or another segment-safe/native output if MP4 finalization fails.
- Queue pressure: allow one active Video download, up to three active Clip downloads, and limited internal segment concurrency per Video. Stream Recording has an independent one-active-session lock.
- Persistence: persist queued, paused, failed, and completed Clip/Video jobs. Stream Recording uses only a separate minimal active-session recovery journal for a one-time Resume/Finalize Partial prompt, then clears it.
- Rate limits: automatically back off and show `Waiting for platform` with the next retry time.
- Removed source: remove a Clip or Video job when its source is truly removed or no longer playable, after attempting temporary signed URL refresh. A started direct-to-file Stream Recording instead preserves captured output and shows a transient Partial/Failed outcome.
- Duplicate content: if the same Clip or Video is queued again, ask the user whether to add a duplicate job. Recording uses the independent one-active-session rule.
- Disk/write errors: keep partial/temp files, show a clear error, and offer Retry or Choose New Path.
- App quit: when downloads or a direct recording are active, confirm before quit. Download jobs follow queue persistence; recording preserves sections through its separate one-time recovery journal and never hydrates into Downloads.
- Completed actions: Show in Folder and Open in default player. In-app local playback and full media library behavior are out of scope for v1.
- Remove/delete: Remove from list does not delete files. Delete File is separate and requires confirmation.

## Stream Recording Decisions

- Stream Recording is a user-initiated local capture of a currently live Stream.
- Stream Recording is a direct-to-file session, not a Downloads job, and has no recording/history page.
- Exactly one Stream Recording may be active. A second start is blocked rather than queued or used to replace the current recording.
- A Stream Recording must ask for save path before recording starts.
- Pause stops writing/downloading new live segments until resumed, so the saved file has a gap.
- On connection loss, StreamFusion retries reconnect with backoff for up to five minutes.
- If reconnect is exhausted, preserve captured partial output and show a transient Partial/Failed notice with Open and Show in Folder when applicable.
- If the Stream ends normally, finalize as transient Completed. If the source becomes inaccessible after capture starts, preserve footage and show a transient Partial/Failed outcome. A pre-start failure with no file creates no history.
- Pauses, reconnects, and restart recovery preserve safe captured sections that Finalizing combines into one playable file. Gap and quality-change detail is current-session UI only.
- Player and global recording UI own lifecycle and Pause/Resume/Stop. Downloads never owns recording controls or status.
- After app restart or crash, a separate minimal journal may offer one-time Resume Recording or Finalize Partial; never auto-resume, and clear the journal after resolution.

## Testing Decisions

- Unit-test filename sanitization, truncation, and auto-rename collision handling.
- Unit-test queue scheduling for one Video plus up to three Clips, including paused and waiting jobs.
- Unit-test the independent direct-to-file recording controller, including atomic one-active enforcement and no Downloads mutations.
- Unit-test duplicate content detection and duplicate-confirmation flow.
- Unit-test disk/write error transitions, partial-file preservation, Retry, and Choose New Path.
- Unit-test removed/unavailable Clip/Video handling versus temporary signed URL refresh. Test Stream Recording source outcomes through its separate controller.
- Unit-test rate-limit backoff status and next-retry display.
- Unit-test restart hydration: active jobs become resumable/failed, not auto-running.
- Unit-test Stream Recording pause gaps, reconnect backoff, section finalization, transient outcomes, recovery-journal clearing, and partial-file preservation.
- Add IPC handler tests for downloads queue operations and privileged file actions.
- Add renderer tests for the queue-first Downloads page replacing `MOCK_DOWNLOADS`.
- UI verification must use Electron MCP only, per repo instructions.

## Out of Scope

- Downloading or recording content StreamFusion cannot already play.
- Bypassing private, deleted, subscriber-only, DRM-like, or unavailable content restrictions.
- In-app local media playback for completed files.
- A full local media library view.
- Live Stream recording from URLs not opened/playable in StreamFusion.
- Background downloads continuing after the app UI closes.
- User-configurable concurrency settings in v1.
- Stream Recording rows in Downloads or any recording/history page.
- Durable Stream Recording completion, failure, gap, or quality-change history.

## Further Notes

- Existing `/downloads` route and sidebar entry already exist, but the page is mock-only.
- Existing Video/Clip playback URL IPC can inform download resolution, but downloads need their own main-process service, IPC contract, persisted queue, progress push events, and file actions.
- Twitch Video downloads use playback tokens and Usher HLS playlists. Twitch Clips can usually use signed MP4 source URLs.
- Kick Video downloads depend on legacy/internal endpoints or HLS playlist discovery; handle Kick with conservative concurrency and backoff.
- Implementation still needs to choose exact IPC channel names, ffmpeg packaging package/path strategy, segment concurrency values, retry intervals, temp-file layout, and quality parsing details.
