Status: done
Type: AFK

# Confirm Stop and finalize one playable file

## Parent

`.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`

## What to build

Make Stop an explicit, safe transition from active capture to one playable output. Player and global pill use the same confirmation with Keep Recording as the safe default. After confirmation, Finalizing remains visible while every preserved section is combined into MP4 or the established safe fallback. Completion briefly offers Open and Show in Folder, then clears without history.

## Acceptance criteria

- [x] Stop from the player and global pill always opens the same confirmation before mutating the recording.
- [x] Keep Recording is the safe default/focused action, cancels Stop, and returns focus to the invoking surface.
- [x] Confirmed Stop enters explicit Finalizing and remains visible until the output is playable or finalization fails.
- [x] Finalizing combines every preserved section into one playable file without overwriting earlier footage.
- [x] Output uses MP4 when clean remux succeeds and clearly reports the established safe fallback when it does not.
- [x] Completed appears briefly with Open and Show in Folder, then clears the session UI and one-time recovery journal.
- [x] Tests cover both confirmation surfaces, safe-default focus, cancellation, section assembly, fallback output, transient completion timing, journal clearing, and absence of Downloads history.
- [x] Electron MCP verifies confirmation, Keep Recording, Finalizing, completion actions, and the resulting playable file.

## Blocked by

- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/02-recording-status-player-global.md`
- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/03-safe-pause-resume-sections.md`

## Comments

- Final evidence after two independent audit loops: 146 focused tests passed across 16 files; typecheck, full lint across 497 source files, production build, targeted Biome, diff check, and deslop passed.
- Real Windows bundled-ffmpeg proof exercised the actual graceful stdin-`q` path: Pause produced a decodable 274,292-byte TS and confirmed Stop produced a decodable 427,606-byte MP4; both validation statuses were 0. The journal cleared only after committed-output metadata was durable, then staging sections were removed.
- Safety regressions cover forced-timeout rejection, Interrupted recovery on Pause shutdown failure, no-clobber section collisions, link-to-exclusive-copy race winners, committed-output retry after durable-clear failure/restart without duplicate assembly, sender authorization on all eight recording IPC handlers, nested Escape focus, `.mp4` normalization, and manifest path safety.
- Electron MCP verified the shared Stop confirmation with Keep Recording focused, visible Finalizing state, and transient `Recording saved as MP4` actions for Open and Show. Proof images: `.scratch/images/stream-recording-issue-04-stop-confirmation.png`, `.scratch/images/stream-recording-issue-04-finalizing.png`, and `.scratch/images/stream-recording-issue-04-completed.png`.
