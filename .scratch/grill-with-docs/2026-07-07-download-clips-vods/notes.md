# Download Clips and VODs: Grilling Session Notes
Date: 2026-07-07 · Goal: Define the StreamFusion feature for queued Twitch/Kick Clip and Video downloads with user-chosen save locations and progress UI.

## PRD

- Local PRD: `prd.md`

## Summary / key decisions

- Initial request: add download support for Twitch and Kick Clips and Videos.
- User requirement: every download must ask where to save via the system file/directory picker.
- User requirement: downloads should support multiple Clips or Videos at a time through a queue so StreamFusion does not overload Platform servers.
- Visual mockups are approved for UI/layout questions during this grill session.
- Entitlement boundary: StreamFusion should download only Clips or Videos the app can already resolve and play for the current user; it should not bypass private, deleted, subscriber-only, DRM-like, or otherwise unavailable content.
- Save-picker behavior: use a system save-file dialog once per Clip or Video before queueing, with a suggested filename and user-controlled final path.
- Video scope: support all playable StreamFusion Videos, including Twitch archives, highlights, uploads, and Kick replays/VODs.
- Download engine: bundle ffmpeg for Video HLS assembly/remux, and use direct HTTP for Clips when a direct MP4 URL is available.
- Queue pressure limits: use a conservative mixed queue with one active Video download at a time and up to three active Clip downloads; each Video may use limited segment concurrency internally.
- Download controls: support pause, resume, cancel, and retry for queued or active downloads.
- Persistence: persist queued, paused, failed, and completed download items across restart; active jobs should not silently resume and should require user action after restart with fresh media URLs.
- Downloads page layout: use a queue-first layout with visible status groups for active, queued, paused, failed, and completed items.
- Download entry points: Clip actions remain on playable Clip surfaces; Video Download appears only on the Video watch page, not Video cards. Q1 of the later recording grill supersedes the broader Video-surface direction.
- Live Stream recording: later Q24 supersedes queue ownership. Stream Recording is one independent direct-to-file active session with player/global controls only, no Downloads row, and no recording/history page.
- Quality selection: default to best/source quality, but show a quality picker when multiple qualities are available; after quality selection, open the save-file dialog and queue the job.
- Stream Recording pause semantics: pause stops writing/downloading new live segments until resumed, so the saved file has a gap.
- Stream Recording connection loss behavior: retry reconnect and preserve partial output if retries exhaust; show a transient Partial/Failed outcome with file actions and no durable history.
- Stream Recording reconnect window: retry reconnect for up to 5 minutes with backoff before failing and keeping the partial file.
- Output format: save as `.mp4` by default when ffmpeg can remux cleanly, with a safe fallback such as `.ts` or platform-native segment-safe output when MP4 finalization fails.
- Completed download actions: support Show in Folder and Open in system default player for v1; in-app local playback and full media library behavior are out of scope.
- Remove/delete behavior: removing a Downloads page item removes it from the list only; deleting completed or partial files is a separate confirmed action.
- Duplicate destination behavior: if the chosen save path already exists, auto-rename the new file with a suffix such as `(1)`, `(2)`, etc.
- Disk/write errors: keep the partial/temp file, fail with a clear error, and offer Retry or Choose New Path.
- Suggested filenames should use sanitized `{username}-{title}` without platform or content ID; collision handling uses auto-rename suffixes.
- App quit behavior: if downloads or a direct Stream Recording are active, confirm before quit. Downloads use queue persistence; recording uses a separate one-time recovery journal and never becomes Downloads history.
- Removed/unavailable source behavior: Clip/Video download jobs are removed when their source is unavailable after signed-URL refresh. Later Q24 supersedes this for Stream Recording: preserve direct output after capture begins and show a transient Partial/Failed outcome.
- Duplicate content behavior: if the same Stream, Clip, or Video is queued again, ask the user whether to add a duplicate job.
- Rate-limit behavior: automatically back off and show the job as "Waiting for platform" with the next retry time.
- Existing app state: `/downloads` route and sidebar entry already exist, but the page is mock-only.
- Existing app state: backend already resolves Video and Clip playback URLs through IPC; downloads still need their own queue/service contract because playback URLs are temporary and downloads need destination, progress, cancellation, retry, and completion state.
- Existing docs: `apps/desktop/documentation/features/planned/phase-10-downloads-spec.md` already covers downloads, but it conflicts with the new "always ask where to save" requirement by mentioning default folders.
- Research finding: Twitch Video downloads are HLS playlist/segment downloads via Twitch playback token + Usher; Twitch Clip downloads can usually use signed MP4 source URLs.
- Research finding: Kick Video downloads currently depend on legacy/internal Kick endpoints or HLS playlist discovery; Kick's own help article recommends third-party tools or manually finding `master.m3u8`.
- Research finding: ffmpeg is likely required for Video assembly/remux; Clips may avoid ffmpeg when a direct MP4 URL is available.
- Research finding: queue design should limit both active jobs and per-job segment concurrency, especially for Kick's undocumented endpoints.
- Research inputs requested by user:
  - ihabunek/twitch-dl
  - schneidermanuel/TwitchLeecher-Dx
  - Kick help article for downloading replays
  - juliogarciape/kick-dl

## Research log

### Local codebase pass

- `UnifiedVideo` and `UnifiedClip` already exist in `apps/desktop/src/backend/api/unified/platform-types.ts`.
- Existing Video/Clip IPC channels live in `apps/desktop/src/shared/ipc-channels.ts`; `video-handlers.ts` resolves metadata, playback URLs, lists, clips, and Kick clip-to-Video lookup.
- Twitch playback resolver returns signed HLS for Videos and signed MP4 quality URLs for Clips.
- Kick playback resolver can return HLS/source URLs, but numeric Kick Video IDs are fragile unless the direct source URL is carried from the Video list.
- No existing `showSaveDialog` pattern was found in `apps/desktop/src`; save-picker UX is a new main-process IPC responsibility.
- The update service has a useful main-to-renderer progress push pattern to mirror for downloads.

### Reference project pass

- `ihabunek/twitch-dl`: uses Twitch GQL for metadata/tokens, Usher HLS for Videos, signed source URLs for Clips, and ffmpeg for Video joining/remux.
- `TwitchLeecher-Dx`: downloads Twitch Video HLS chunks in parallel itself, then uses ffmpeg for final conversion/remux/crop. It supports queued downloads and default folders, but is Twitch-Video focused.
- Kick help article: official guidance does not provide a first-party API; it points users to third-party tools or manual `m3u8` discovery.
- `juliogarciape/kick-dl`: uses Puppeteer/internal Kick API calls to find Videos/Clips and bundles `ffmpeg-static`; it shells out to ffmpeg for downloading.

## Q&A log

### Q1 — Visual companion

- Asked: This feature has real UI decisions for the Downloads page. Do you want me to create small HTML mockups as we go so you can compare layouts visually?
- Captured: User chose option 1: "Yes, use visual mockups as needed."
- Doc updates: none.
- Flags: none.

### Q2 — Entitlement boundary

- Asked: What is the entitlement boundary for downloads?
- Captured: User chose option 1: "Download playable content only." StreamFusion should only download Clips or Videos the app can already resolve and play for the current user.
- Doc updates: none.
- Flags: none.

### Q3 — Save picker behavior

- Asked: When the user starts downloads for multiple Clips or Videos, how should the save picker work?
- Captured: User chose option 1: "Save-file dialog per item." Each Clip or Video gets its own system save-file prompt with a suggested filename before the item is queued.
- Doc updates: none.
- Flags: none.

### Q4 — Video scope

- Asked: What should count as "Video" for downloads?
- Captured: User chose option 1: "All playable Videos." Downloads should support all StreamFusion `Video` types the app can play: Twitch archives, highlights, uploads, and Kick replays/VODs.
- Doc updates: `CONTEXT.md` updated so `Video` includes Twitch highlights and Kick replays when playable in StreamFusion; "replay" added to avoided terms.
- Flags: none.

### Q5 — Download engine

- Asked: Which download engine strategy should StreamFusion use for Videos?
- Captured: User chose option 1: "Bundle ffmpeg for Videos, direct HTTP for Clips." StreamFusion should bundle ffmpeg for Video HLS assembly/remux and download Clips directly over HTTP when a direct MP4 URL is available.
- Doc updates: `docs/adr/0008-bundled-ffmpeg-for-media-downloads.md` created.
- Flags: packaging must account for cross-platform ffmpeg binary size and path resolution.

### Q6 — Queue pressure limits

- Asked: What queue pressure limits should Downloads use?
- Captured: User chose option 1: "Conservative mixed queue." Use one active Video download at a time, up to three active Clip downloads, and limited internal segment concurrency for each Video.
- Doc updates: none.
- Flags: implementation must define the exact internal segment concurrency cap and backoff behavior.

### Q7 — Download controls

- Asked: What controls should users have over queued or active downloads?
- Captured: User chose option 2: "Pause/resume/cancel/retry for all downloads." Manual controls should apply to queued and active downloads.
- Doc updates: none.
- Flags: active Video pause/resume must handle expiring HLS/media URLs, ffmpeg process state, and partial/temp file cleanup.

### Q8 — Queue persistence

- Asked: Should queued, paused, and completed downloads persist after StreamFusion restarts?
- Captured: User chose option 1: "Persist queue/history; active jobs require resume after restart." Persist queued, paused, failed, and completed download items across restart; active jobs should not auto-resume on app launch.
- Doc updates: none.
- Flags: implementation must classify in-progress jobs on startup and refresh media URLs before resume.

### Q9 — Downloads page layout

- Asked: Which Downloads page layout should we use?
- Captured: User chose option 1: "Option A: Queue First." Downloads should use a dense operational queue layout with active, queued, paused, failed, and completed status groups visible on the page.
- Doc updates: HTML mockup created at `.scratch/grill-with-docs/2026-07-07-download-clips-vods/designs/downloads-layout-options.html`.
- Flags: none.

### Q10 — Download entry points

- Asked: Where should users be able to start a download?
- Captured: User first chose option 1: "Playable Videos and Clips everywhere they appear." User then revised the scope: "lets also Include live Stream recording too." Add Download actions anywhere StreamFusion presents playable Videos or Clips, and include live Stream recording.
- Doc updates: none.
- Flags: live Stream recording needs separate decisions for entitlement, stop behavior, file splitting, progress display, and queue pressure because a Stream has no fixed duration.

### Q11 — Live Stream recording behavior

- Asked: How should live Stream recording behave?
- Captured: User first chose option 1: "Manual recording job, stops on user stop or Stream end." User then revised the decision to: "Full DVR-style recording with pause/resume and automatic reconnects in v1." Record only Streams the app can currently play, require a save path before recording starts, and show the recording as a separate job type in the Downloads queue.
- Doc updates: `CONTEXT.md` added `Stream Recording` as distinct from `Video`.
- Flags: DVR-style v1 needs separate decisions for pause semantics, reconnect window, segment/file handling, and how gaps are represented.

### Q12 — Quality selection

- Asked: How should quality selection work before saving?
- Captured: User chose "Best quality by default, picker when multiple qualities exist." Default to best/source quality, but show a picker when multiple qualities are available. After quality selection, open the save-file dialog and queue the job.
- Doc updates: none.
- Flags: none.

### Q13 — Stream Recording pause semantics

- Asked: For DVR-style Stream Recording, what should "pause" mean?
- Captured: User chose option 1: "Pause recording, create a gap until resumed." Pause stops writing/downloading new live segments until the user resumes, so the saved file has a gap.
- Doc updates: none.
- Flags: UI should make recording gaps visible in job details/history.

### Q14 — Stream Recording connection loss outcome

- Asked: If a live Stream Recording loses connection before the Stream ends, what should StreamFusion do?
- Captured: User chose "Retry reconnect, keep partial file, fail if exhausted." StreamFusion should preserve the partial recording and only mark the job failed after reconnect attempts are exhausted.
- Doc updates: none.
- Flags: exact reconnect retry window still needs confirmation.

### Q15 — Stream Recording reconnect retry window

- Asked: What reconnect retry window should count as "exhausted" for Stream Recording?
- Captured: User answered "q14 1", interpreted as the current option 1: "5 minutes with backoff." StreamFusion should retry reconnect for up to 5 minutes, then fail and keep the partial file.
- Doc updates: none.
- Flags: none.

### Q16 — Output format

- Asked: What output format should downloads and Stream Recordings save as?
- Captured: User chose option 1: "MP4 by default, safe fallback if needed." Save `.mp4` when ffmpeg can remux cleanly, and fall back to `.ts` or another segment-safe/native format if MP4 finalization fails.
- Doc updates: none.
- Flags: implementation should surface fallback format clearly in the completed item.

### Q17 — Completed item actions

- Asked: What should users be able to do with completed downloads inside StreamFusion?
- Captured: User chose option 1: "Show in Folder + Open in default player." Completed items should support showing the file in the system file explorer and opening the file in the OS default media player. In-app local playback is out of scope for v1.
- Doc updates: none.
- Flags: none.

### Q18 — Remove and delete behavior

- Asked: When a user removes an item from the Downloads page, what should happen?
- Captured: User chose option 1: "Remove from list only; separate confirmed Delete File." Removing a row should only remove it from the Downloads list. File deletion for completed or partial files is a separate confirmed action.
- Doc updates: none.
- Flags: none.

### Q19 — Edge-case coverage check

- Asked: Completeness check before PRD: is there anything else the Downloads/Recording feature must include?
- Captured: User asked whether edge cases have been covered. Current answer: major product edges are covered, but several implementation/user-safety edge cases still need explicit decisions before PRD.
- Doc updates: none.
- Flags: need decisions for duplicate destinations, disk space exhaustion, unavailable/deleted media, app quit with active jobs, platform rate limiting, same Stream/Clip/Video queued twice, and Stream Recording edge states.

### Q20 — Duplicate destination behavior

- Asked: If the user chooses a save path that already exists, what should happen?
- Captured: User chose option 2: "Auto-rename with `(1)`, `(2)`, etc." A user-selected save path is treated as the preferred base path; StreamFusion should avoid overwriting existing files by choosing the next available suffixed filename.
- Doc updates: none.
- Flags: final resolved path should be visible in job details/completion state.

### Q21 — Disk space and write errors

- Asked: What should happen if disk space runs out or the save location becomes unwritable during a download/recording?
- Captured: User chose option 1: "Keep partial file, fail with Retry/Choose New Path." StreamFusion should keep the partial/temp file, show a clear error, and offer Retry or Choose New Path after the user resolves the storage issue.
- Captured: User added that saved files should use the Stream username and Clip or Video title in the filename.
- Doc updates: none.
- Flags: filename sanitization/truncation needs a decision.

### Q22 — Filename sanitization and uniqueness

- Asked: How should StreamFusion handle invalid or very long filenames from usernames/titles?
- Captured: User chose option 2: "Sanitized `{username}-{title}` only." StreamFusion should suggest filenames using the Stream username and Clip/Video/Stream Recording title, sanitize invalid filesystem characters, trim long names as needed, and rely on auto-rename suffixes for collisions.
- Doc updates: none.
- Flags: exact maximum filename length can be implementation-defined per platform.

### Q23 — App quit with active jobs

- Asked: What should happen if the user quits StreamFusion while downloads or Stream Recordings are active?
- Captured: User chose option 1: "Confirm before quit; keep partials and require resume later." StreamFusion should show a confirmation before quitting when downloads or Stream Recordings are active. If quitting proceeds, jobs stop safely, partial files are kept, and the user must resume/retry later.
- Doc updates: none.
- Flags: quit dialog copy should distinguish active downloads from live Stream Recordings.

### Q24 — Removed or unavailable media

- Asked: If queued media becomes unavailable, deleted, private, or the signed URL expires before the job starts, what should happen?
- Captured: User answered: "if say the stream gets removed or clip in the middle of the download or before it starts then just remove the job i think." If the source Stream, Clip, or Video is removed or no longer playable before or during the job, StreamFusion should remove the job rather than leave a failed retry item. Temporary signed URL expiry is distinct: refresh first, then remove only if the source is no longer playable.
- Doc updates: none.
- Flags: implementation must decide whether to show a transient toast/activity note when a job is auto-removed.

### Q25 — Duplicate content behavior

- Asked: If the user queues the same Stream, Clip, or Video twice, what should happen?
- Captured: User chose option 3: "Ask the user whether to add a duplicate." StreamFusion should detect duplicate content and ask before adding a second job.
- Doc updates: none.
- Flags: duplicate detection should key by content identity, not filename, because filenames may auto-rename.

### Q26 — Rate-limit and throttling visibility

- Asked: If Twitch or Kick rate-limits or throttles downloads, how should StreamFusion show that?
- Captured: User chose option 1: "Auto-backoff with `Waiting for platform` status." StreamFusion should automatically back off and display a waiting state with the next retry time instead of making the user manually retry rate-limit failures.
- Doc updates: none.
- Flags: implementation should use documented Twitch reset headers when available and conservative inferred backoff for Kick/internal endpoints.

### Q27 — Close scope

- Asked: Close scope now and write the PRD?
- Captured: User chose option 1: "Close scope and write PRD." The Downloads and Stream Recording scope is ready to turn into a PRD.
- Doc updates: `prd.md` created in this grill session folder.
- Flags: remaining details are implementation-level: exact IPC names, ffmpeg package choice, segment concurrency number, retry intervals, and test breakdown.

## Open flags (pending input)

- Define exact segment concurrency and backoff behavior -> implementation planning
- Cross-platform ffmpeg packaging details -> implementation planning

## Post-session refinement

- Stream Recording UI, exclusivity, source-loss preservation, restart recovery, and one-file finalization were refined and approved in `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`. That later PRD supersedes conflicting Stream Recording decisions in this earlier audit trail.
- Video Download entry points were narrowed to the Video watch page; Video cards do not show Download.
- Downloads persists Clip/Video jobs only. Stream Recording is independent, direct-to-file, single-active, and controlled only through player/global UI.
- Terminal Stream Recording notices are transient with Open/Show in Folder and no durable history.
- Minimal Stream Recording recovery metadata may survive restart only for a one-time Resume/Finalize Partial prompt, then clears.
- Historical Stream Recording queue/job/history language in the Q&A log is retained as audit history but superseded by this refinement.
