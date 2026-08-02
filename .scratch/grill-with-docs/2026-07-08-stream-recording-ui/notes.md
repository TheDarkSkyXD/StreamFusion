# Stream Recording UI: Grilling Session Notes
Date: 2026-07-08 · Goal: Stress-test the live stream recording UI and identify missing user-facing states, controls, and edge cases.

## PRD

- Local PRD: `prd.md`
- Approved visual reference: `designs/recording-ui-consolidated-v2.html`

## Summary / key decisions

- VOD download entry points should live only on the Video watch page, not on VOD cards.
- Stream Recording is an independent direct-to-file session. It never appears in Downloads and has no recording/history page.
- Active Stream Recording controls are player-attached while watching a Stream; the global pill/popover owns off-page controls.
- The Stream player should show all critical Stream Recording lifecycle states: starting, recording, reconnecting, paused, finalizing, and failed/partial.
- Player-attached Stream Recording controls include status, selected quality, Pause/Resume, and Stop.
- Stopping from the player or global pill requires confirmation, with Keep Recording as the safe default.
- Theater and fullscreen modes should still expose Stream Recording status; controls appear with player controls on hover/focus.
- When Stream Recordings continue off-page, the app shows a global recording pill with a compact popover for View, Pause/Resume, and Stop.
- The global pill remains visible through Preparing, Recording, Reconnecting, Paused, and Finalizing. Completion, Partial, and Failure use transient notices with Open and Show in Folder when a file exists, then clear without durable history.
- Off-page outcomes are context-aware: use an in-app notice while focused and a desktop notification while minimized or unfocused when enabled and supported.
- After an app close or crash interrupts recording, preserve the footage and show Interrupted/Partial on next launch. Offer Resume Recording when the same Stream is still live, or Finalize Partial; never auto-resume.
- Only one Stream Recording may be active at a time. A second recording attempt is blocked rather than queued so it cannot silently miss live content. This supersedes the earlier multi-recording popover direction.
- If Record is pressed on another Stream while one recording is active, show an explanatory dialog with View Recording and Cancel. Do not queue or offer one-step replacement.
- Starting a Stream Recording should use quality picker if needed, then system Save dialog, then player-attached "Preparing recording..." state before Recording.
- Start failures use player/global recovery UI only when an output session or partial file exists; otherwise use a transient notice and leave Record available.
- Stop or natural Stream end shows "Finalizing file..." and then a transient Completed notice with Open and Show in Folder before clearing.
- Reconnect gaps and quality changes use a current-session summary on the player/global UI; they are not retained as app history.
- Recording timers show captured playable duration, not wall-clock time. They freeze during pauses and reconnect gaps while a separate warning indicates a gap.
- Pauses, reconnects, and restart recovery still produce one final playable file. StreamFusion preserves captured sections internally and combines them during Finalizing.
- If a Stream becomes unavailable after recording starts, preserve the direct output: normal Stream end finalizes as Completed; unexpected removal or access loss preserves the partial file and shows a transient Partial/Failed notice. Pre-start failure with no file creates no history.

## Q&A log

### Q1 — Visual mockup scope / adjacent VOD entry-point correction
- Asked: Should this grill include visual mockups for recording UI states?
- Captured: Before answering the mockup scope, user clarified an adjacent download UI rule: the download button for VODs should only appear while watching the Video, not on cards. User then chose "1 and 3", interpreted as using visual mockups for layout choices and doing a broad visual pass for the important recording states.
- Doc updates: none.
- Flags: none.

### Q2 — Active recording control placement
- Asked: Where should the active Stream Recording controls live while watching a Stream?
- Captured: User chose player-attached status and controls, with Downloads as the detailed manager.
- Doc updates: none.
- Flags: none.

### Q3 — Player-visible recording states
- Asked: Which recording states should be visible directly on the Stream player?
- Captured: User chose all critical lifecycle states: Starting, Recording, Reconnecting, Paused, Finalizing, Failed/Partial.
- Doc updates: none.
- Flags: none.

### Q4 — Player recording controls
- Asked: Which controls belong directly on the Stream player?
- Captured: User chose status + Pause/Resume + Stop, with a Downloads link for problem states, and added that the selected recording quality should also be visible.
- Doc updates: none.
- Flags: none.

### Q5 — Theater/fullscreen recording UI
- Asked: Should recording status/controls also appear in theater and fullscreen modes?
- Captured: User chose always showing status, with Pause/Resume/Stop available on hover/focus in player controls.
- Doc updates: none.
- Flags: none.

### Q6 — Global off-page recording indicator
- Asked: If a Stream Recording continues while the user leaves that Stream page, what global UI should StreamFusion show?
- Captured: User chose a global recording pill in app chrome with compact popover. The pill should make off-page recordings visible and safe to control.
- Doc updates: none.
- Flags: none.

### Q7 — Multiple recording global UI
- Asked: How should the global recording UI handle multiple active Stream Recordings?
- Captured: User chose an aggregated pill with detailed popover rows. Top bar summarizes the count; popover lists each recording with status, quality, View, Pause/Resume, Stop, and Downloads.
- Doc updates: none.
- Flags: none.

### Q8 — Start recording flow
- Asked: What should the start-recording flow look like after the user clicks Record?
- Captured: User chose quality picker if needed, then system Save dialog, then player shows "Preparing recording..." before moving to Recording.
- Doc updates: none.
- Flags: none.

### Q9 — Cannot-start recovery UI
- Asked: If recording cannot start after the user clicks Record, what should the Stream page show?
- Captured: User chose inline player-attached error with retry and Downloads link when a job exists. If no job was created, use toast feedback and keep Record available.
- Doc updates: none.
- Flags: none.

### Q10 — Stop/end finalization UI
- Asked: What should happen in the UI when the user clicks Stop, or the Stream ends naturally?
- Captured: User chose "Finalizing file..." while ffmpeg closes the output, then a short Completed state with Open, Show in Folder, and Downloads actions before fading back to Record.
- Doc updates: none.
- Flags: none.

### Q11 — Reconnect gap UI
- Asked: How should reconnect gaps be shown while recording?
- Captured: User chose small warning in player plus exact gap history in Downloads. Player should say things like "Reconnecting · partial saved" or "Recording resumed · gap detected"; Downloads owns exact timestamps.
- Doc updates: none.
- Flags: none.

### Q12 — Stream unavailable during an active recording
- Asked: When a Stream becomes unavailable during an active Stream Recording, what should happen?
- Captured: User chose option 1: preserve any recording that started. A normal Stream end should finalize as Completed. Unexpected removal or access loss should keep the job and partial file as Failed/Partial. Auto-remove only jobs that never started and created no file.
- Doc updates: corrected the recording UI decision trail; no glossary or ADR update needed.
- Flags: supersedes the earlier broad Downloads rule that removed unavailable jobs even after a Stream Recording had started.

### Q13 — Simultaneous Stream Recording limit
- Asked: How many Stream Recordings may run at once?
- Captured: User chose one active Stream Recording at a time. If one is already active, StreamFusion should block another start rather than queue it, because a queued live recording would silently miss content.
- Doc updates: summary corrected; no glossary or ADR update needed.
- Flags: supersedes Q7's aggregated multi-recording pill and its `multiple-recordings-popover.html` mockup.

### Q14 — Global recording pill lifetime
- Asked: When should the global recording pill remain visible?
- Captured: User chose the state-aware model. Keep the pill visible during Preparing, Recording, Reconnecting, Paused, and Finalizing. Show Completed briefly and then fade it. Keep Failed/Partial visible until the user acknowledges it.
- Doc updates: summary updated; no glossary or ADR update needed.
- Flags: exact Completed fade duration and acknowledgement interaction can be set during UI implementation.

### Q15 — Accidental Stop protection
- Asked: Because missed live footage cannot be recovered, how should Stop behave?
- Captured: User chose confirmation. Stopping from the player, global pill, or Downloads should show "Stop recording?" with Keep Recording as the safe default.
- Doc updates: summary updated; Q10's transient Completed actions clarified as a narrow exception to Q4's Downloads-owned file actions.
- Flags: exact dialog copy can be finalized during UI implementation.

### Q16 — Recording timer meaning
- Asked: After pauses or reconnect gaps, what should the player's timer show?
- Captured: User chose captured duration. The timer represents playable footage and freezes during pauses or reconnect gaps. A separate "gap detected" warning explains the discontinuity; Downloads owns exact gap timestamps.
- Doc updates: summary updated; no glossary or ADR update needed.
- Flags: none.

### Q17 — Off-page recording notifications
- Asked: If the user is elsewhere when recording completes or fails, how should StreamFusion notify them?
- Captured: User chose context-aware notifications. Show an in-app toast while the app is focused and a desktop notification while it is minimized or unfocused. A failure also keeps the global Failed/Partial pill visible until acknowledged.
- Doc updates: summary updated; no glossary or ADR update needed.
- Flags: desktop delivery should respect the app's notification setting and OS availability.

### Q18 — Recovery after app restart or crash
- Asked: If StreamFusion closes during an active recording, what should appear on the next launch?
- Captured: User chose Interrupted/Partial recovery. Preserve the footage and offer Resume Recording if the same Stream is still live, or Finalize Partial. Resuming creates a visible gap. Do not auto-resume on launch.
- Doc updates: summary updated; no glossary or ADR update needed.
- Flags: implementation must persist enough recording-session metadata to resume safely without overwriting earlier footage.

### Q19 — Starting another recording
- Asked: When one Stream Recording is already active and the user presses Record on another Stream, what should happen?
- Captured: User chose a blocking explanatory dialog. Show the active Stream with View Recording, Downloads, and Cancel. The user must stop the current recording separately before starting another; do not offer one-step replacement.
- Doc updates: summary updated; no glossary or ADR update needed.
- Flags: none.

### Q20 — Recording output after gaps
- Asked: When pause, reconnect, or restart creates multiple captured sections, what should the user receive?
- Captured: User chose one final playable file. Preserve sections internally and combine them during Finalizing; Downloads lists the gaps.
- Doc updates: summary updated; no glossary update needed. This refines the existing bundled-ffmpeg media decision without requiring a new ADR.
- Flags: implementation must never resume ffmpeg in a way that overwrites earlier captured sections.

### Q21 — Final visual validation
- Asked: Close the grill and reconcile the PRD, continue with a deeper visual review, or continue grilling another concern?
- Captured: User asked whether more mockups were needed, then approved the recommendation for one targeted consolidated state board rather than a broad redesign. It should cover the single-recording global pill states, captured-duration timer and gap warning, Stop confirmation, blocked second-recording dialog, Interrupted/Partial recovery, and Completed versus Failed/Partial outcomes.
- Doc updates: `designs/recording-ui-consolidated-v1.html` created; no glossary or ADR update needed.
- Flags: superseded by Q22's requested alignment polish before final approval.

### Q22 — Consolidated mockup icon alignment
- Asked: Does the consolidated state board look approved, or what should change before close-out?
- Captured: User liked the first consolidated mockup and requested that the icons inside the lower interaction cards sit to the left of their text, matching the faster left-to-right scan pattern used by the recording status above. User also asked whether this is good UI/UX; confirmed that it improves scanability and density for these compact dialogs. After reviewing V2, the user said it looks good and approved the visual direction.
- Doc updates: `designs/recording-ui-consolidated-v2.html` created with consistent leading-icon title rows; V2 is the approved visual reference.
- Flags: none.

### Q23 — Selected quality disappears during recovery
- Asked: If the chosen recording quality is unavailable after reconnect or restart recovery, should StreamFusion use the nearest available quality, keep retrying the original quality until failure, or pause for user input?
- Captured: User chose the nearest available quality. Recovery should continue rather than lose more live footage, but the change must never be silent: show "Quality changed" in the current player/global recording status. Q24 later superseded durable Downloads history for this transition.
- Doc updates: `prd.md` finalized with the quality-fallback rule and later reconciled to current-session status only; no glossary or ADR update needed.
- Flags: none.

### Q24 — Direct-to-file recording, no Downloads page ownership
- Asked: During implementation review, user observed that pressing Record created an item on Downloads and said it should not: "we just save the recording and have no page for it," while Pause/Resume/Stop should be available from the recording UI.
- Captured: Stream Recordings are direct-to-file sessions, not Downloads jobs. They never appear on Downloads and have no recording/history page. While active, lifecycle status and Pause/Resume/Stop live on the player and global pill. After completion or failure, use transient feedback and file actions such as Open and Show in Folder, then clear the session UI. This supersedes every earlier decision that assigned Stream Recording status, gap history, recovery, or file actions to Downloads.
- Doc updates: `prd.md`, all seven implementation issues, and the earlier Downloads artifacts reconciled. The V2 mockup remains an approved visual reference only where it agrees with Q24; its Downloads actions and durable failure treatment are superseded. `CONTEXT.md` remains correct because the domain definition does not prescribe a management surface.
- Flags: resolved by Q25.

### Q25 — One-time interrupted-session recovery journal
- Asked by codebase review: How can Q18 restart recovery remain safe without turning Stream Recording into a Downloads job or durable recording history?
- Captured: Use a separate, minimal active-session recovery journal. It exists only while capture is active or interrupted and stores the Stream identity, destination, selected quality, preserved section identities, captured duration, gaps, and recovery state needed for a one-time Resume or Finalize Partial prompt. It never appears in Downloads or a history page, never auto-resumes, and clears after finalization, failure resolution, pre-start cancellation, or recovery dismissal.
- Doc updates: `prd.md` and issue 07 reconciled to the one-time journal contract; earlier Downloads persistence claims explicitly exclude Stream Recording.
- Flags: none.

## Open flags (pending input)

- None.

## Close-out reconciliation

- Reconciled the earlier Downloads PRD with Q12's started-recording preservation rule, Q13's one-active-recording limit, Q18's Interrupted/Partial restart recovery, Q20's one-file finalization, and Q1's Video watch-page-only download entry point.
- Q7's aggregated multi-recording direction and `designs/multiple-recordings-popover.html` are superseded exploration artifacts.
- `CONTEXT.md` already defines Stream Recording correctly and needed no change.
- ADR 0008 remains valid for bundled ffmpeg assembly/remux and needed no replacement.
- Approved V2 after moving compact-dialog icons to the left of their title text for faster scanning.
- Q24 supersedes all Downloads ownership for Stream Recording: direct-to-file, player/global controls only, and transient terminal outcomes with no durable history.
- Q25 resolves restart recovery through a separate one-time active-session journal that clears after resolution.
- Closed the final quality-recovery edge in Q23: use the nearest available quality with visible current-session status only.
