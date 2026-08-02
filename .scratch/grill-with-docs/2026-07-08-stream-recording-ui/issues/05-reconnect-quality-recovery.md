Status: done
Type: AFK

# Recover reconnect gaps and recording-quality changes

## Parent

`.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`

## What to build

Recover temporary capture loss without discarding footage or lying about quality. Reconnecting retries with backoff for up to five minutes, writes resumed capture to a new safe section, freezes captured duration while disconnected, and preserves partial footage after exhaustion. Recovery retains the selected quality when available or switches to the nearest available quality with a visible current-session status.

## Acceptance criteria

- [x] Capture loss enters explicit Reconnecting and retries with backoff for no longer than five minutes.
- [x] Captured duration freezes while disconnected and resumes from its previous total after capture restarts.
- [x] Reconnect writes to a new safe section and preserves every earlier section.
- [x] Recovery retains the selected quality when available.
- [x] If the selected quality disappears, recovery chooses the nearest available quality and shows Quality changed in player/global status for the current session.
- [x] Reconnect exhaustion preserves usable partial footage through the issue 04 finalizer and emits a typed transient Partial/Failed outcome; issue 06 owns Open/Show delivery, expiry, and notification UI. It creates no job or history.
- [x] Tests use fake timers and public controller/IPC/UI seams to cover retry timing, duration, section preservation, quality retention/fallback, transient exhaustion, and no Downloads mutation.
- [x] Electron MCP verifies Reconnecting, frozen duration, visible quality fallback, typed exhaustion outcome, and no recording history. Issue 06 separately verifies terminal file actions and delivery.

## Blocked by

- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/02-recording-status-player-global.md`
- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/03-safe-pause-resume-sections.md`
- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/04-confirm-stop-finalize-file.md`

## Comments

- Scope sequencing clarification: issue 05 owns reconnect, quality selection/change state, and truthful typed exhaustion outcome. Issue 06 owns transient Open/Show actions and focused/native delivery so the slices do not duplicate or depend circularly on notification UI.
- Final evidence after repeated independent audit: 113 focused tests passed; Windows real-media regressions passed 2/2; typecheck, full lint across 501 source files, production build, targeted Biome, diff hygiene, and deslop passed. The full suite passed 4,906/4,908; the two remaining unrelated failures are tracked for the final repo audit.
- Crash-safety evidence includes SHA-256+size commit intent persisted before public no-clobber commit, identity-verified restart probe/cleanup, preservation of unrelated playable/unplayable MP4/TS files, and zero speculative fallback snapshots before recorder creation succeeds.
- Electron MCP verified visible Reconnecting with frozen `1:15`, resumed current-session quality fallback `Source → 720p60`, typed `partial` lifecycle projection, and no recording page/history. Proof images: `.scratch/images/stream-recording-issue-05-reconnecting.png` and `.scratch/images/stream-recording-issue-05-quality-changed.png`.
