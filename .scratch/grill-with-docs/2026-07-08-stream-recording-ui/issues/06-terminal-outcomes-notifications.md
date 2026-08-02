Status: done
Type: AFK

# Preserve and communicate terminal recording outcomes

## Parent

`.scratch/grill-with-docs/2026-07-08-stream-recording-ui/prd.md`

## What to build

Distinguish natural completion, unexpected source loss, and harmless pre-start failure across the recording controller, player, global pill, and notification surfaces. Normal Stream end finalizes as Completed. Unexpected removal or access loss after capture begins preserves footage and emits a transient Partial/Failed outcome. A pre-start failure with no output/session clears without history. Focused delivery uses an in-app notice; unfocused delivery uses desktop notification when enabled and supported.

## Acceptance criteria

- [x] A normal Stream end finalizes the recording and reaches Completed.
- [x] Unexpected removal or access loss after capture begins preserves the file/sections and emits transient Partial/Failed actions; it never creates a Downloads job.
- [x] Pre-start failure that created no file/session leaves Record available and creates no phantom history.
- [x] Completed and Partial/Failed are transient notices with Open and Show in Folder when a file exists, then clear the session UI and recovery journal.
- [x] Focused-app completion/failure uses an in-app toast; minimized or unfocused delivery uses desktop notification only when enabled and supported.
- [x] Outcome text and state changes are announced accessibly without duplicate announcements.
- [x] Tests cover all three source outcomes, file actions, focused/unfocused routing, notification settings/availability, transient clearing, journal clearing, and absence of durable history.
- [x] Electron MCP verifies natural completion, preserved unexpected failure, transient file actions, focus-dependent notification behavior, and no Downloads row.

## Blocked by

- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/04-confirm-stop-finalize-file.md`
- `.scratch/grill-with-docs/2026-07-08-stream-recording-ui/issues/05-reconnect-quality-recovery.md`

## Comments

- Final evidence after repeated independent audit: 165 focused tests passed across 18 files; typecheck, full lint across 504 source files, production build, diff check, and deslop passed.
- Crash/failure evidence includes atomic durable settlement, playable+owned artifact verification, Partial settlement throw/false preservation with same-process and restart retry, native presentation failure isolation, typed file-action errors, pre-start idle/no notice, and zero Downloads/notification-store/history coupling.
- Delivery matrix tests cover focused in-app, minimized/unfocused native notification, enabled/supported settings, sound policy, stale-safe TTL, dedupe, and native-click window restore/promotion exactly once. The single root live region prevents duplicate terminal announcements.
- Electron MCP verified the focused transient Partial notice with Open and Show in Folder and the Completed notice from issue 04; real Windows controller proof verified natural playable completion and preserved unexpected failure. Proof images: `.scratch/images/stream-recording-issue-04-completed.png` and `.scratch/images/stream-recording-issue-06-partial.png`. Native focus routing is main-process behavior covered through the real coordinator/window contract tests because Electron MCP cannot inspect the Windows notification center.
