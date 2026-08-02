# Fullscreen Chat Rail: Grilling Session Notes
Date: 2026-07-07 · Goal: Define how chat should sit beside a fullscreen live Stream and how users hide/show it from player controls.

## PRD

- [prd.md](./prd.md)

## Summary / key decisions

- Fullscreen chat rail should appear on the right side of the fullscreen live Stream.
- Use HTML mockups only for major layout decisions, especially fullscreen rail proportions and control placement.
- Codebase observation: `StreamPage` currently renders a docked `ChatPanel` outside the live player; fullscreen is owned by the Kick/Twitch live player containers via `useFullscreen`. `PlayerControls` owns the bottom control bar and already has a `rightAddon` slot plus fullscreen-aware control rendering.
- Fullscreen chat rail should start open every time fullscreen starts. If the user hides it, that hide applies only to the current fullscreen session.
- Fullscreen chat should copy YouTube's side-by-side fullscreen rail behavior: chat appears as a right rail, the video resizes beside it, and hiding chat expands the video to the full fullscreen width.
- Fullscreen chat rail width should use StreamFusion's existing chat scale plus the YouTube reference: clamp around a 340px minimum, 30vw preferred width, and about 560px maximum.
- YouTube reference checked in Chrome: YouTube fullscreen live chat uses a right-side rail around 560px wide on a 1920px viewport, with the player narrowed to the remaining 1360px. When chat is hidden, the player expands to the full 1920px width and a chat button remains in the right-side player control cluster near settings/fullscreen.
- Fullscreen chat toggle should live in the bottom-right player controls beside settings/fullscreen. It appears only in fullscreen and toggles between hide/show chat.
- Fullscreen transitions should preserve the same chat session feel: avoid intentional chat reconnects, and preserve messages, scroll position, and draft text as much as practical.
- Existing global hidden-chat preference should be respected: if `preferences.chat.position === "hidden"`, fullscreen starts with chat hidden, but the fullscreen chat button can show it for that fullscreen session.
- Fullscreen chat close control should live in the existing chat header: `Chat` on the left, `X` on the right, visible only for the fullscreen rail.
- First version scope is the single live Stream page (`/stream/$platform/$channel`) for Twitch and Kick live streams. VOD pages and MultiStream fullscreen are out of scope.
- Proof should include unit/component regression tests plus visual verification in the running StreamFusion desktop app using Electron MCP only.
- Small fullscreen viewports should start with chat hidden rather than switching to a true overlay. The user can still open chat from the fullscreen chat button when there is enough room.
- CONTEXT.md now defines `Fullscreen Chat Rail` and marks `fullscreen chat overlay` as an avoided term.

## Q&A log

### Q1 - Chat overlay side
- Asked: Which side should fullscreen chat live on?
- Captured: User chose option 1: right side. Fullscreen chat should overlay on the right side when a stream enters fullscreen.
- Doc updates: later reconciled into CONTEXT.md as `Fullscreen Chat Rail`.
- Flags: none.

### Q2 - Visual mockups
- Asked: Do you want quick HTML mockups as we go?
- Captured: User chose option 1: yes, only for major layout decisions.
- Doc updates: none.
- Flags: none.

### Q3 - Fullscreen chat default visibility
- Asked: When the user enters fullscreen, should the chat overlay always start open?
- Captured: User chose option 1: open every time fullscreen starts. Hiding the overlay is scoped to the current fullscreen session, not persisted as a preference.
- Doc updates: none.
- Flags: none.

### Q4 - Fullscreen chat overlay width
- Asked: How wide should the fullscreen chat overlay be?
- Captured: User chose option 1: responsive rail. They also suggested inspecting YouTube live fullscreen with chat on the side as the reference pattern.
- Doc updates: none.
- Flags: YouTube reference revealed an important product distinction: side-by-side fullscreen rail instead of true overlay. User needs to choose whether to copy that behavior or keep a true overlay.

### Q5 - YouTube-style rail vs true overlay
- Asked: Do we want to copy YouTube's behavior exactly?
- Captured: User chose option 1: YouTube-style side rail. Fullscreen chat should sit beside the resized video rather than floating over it. Hiding chat expands the video to the full fullscreen width.
- Doc updates: later reconciled into CONTEXT.md as `Fullscreen Chat Rail`.
- Flags: none.

### Q6 - Fullscreen chat toggle placement
- Asked: Where exactly should the fullscreen chat toggle live?
- Captured: User chose option 1: bottom-right player controls beside settings/fullscreen. One chat icon button appears only in fullscreen. When chat is open its action is hide chat; when hidden its action is show chat.
- Doc updates: none.
- Flags: none.

### Q7 - Chat continuity across fullscreen transitions
- Asked: Should chat feel continuous when entering/exiting fullscreen?
- Captured: User chose option 1: keep the same chat session feel. Preserve messages, scroll position as much as practical, draft text if supported, and avoid intentional reconnects.
- Doc updates: none.
- Flags: none.

### Q8 - Existing hidden-chat preference
- Asked: How should this interact with StreamFusion's existing hidden chat preference?
- Captured: User chose option 1: respect hidden preference. If the user globally hid chat, fullscreen starts with chat hidden, but the fullscreen chat button can show it for that fullscreen session.
- Doc updates: none.
- Flags: none.

### Q9 - Fullscreen chat close button placement
- Asked: Where should the `X` live in fullscreen chat?
- Captured: User chose option 1: in the existing chat header. Fullscreen chat shows `Chat` on the left and an `X` on the right, visible only in the fullscreen rail.
- Doc updates: none.
- Flags: none.

### Q10 - First version scope
- Asked: What is the scope for this first version?
- Captured: User chose option 1: single live Stream page only. This applies to `/stream/$platform/$channel` for Twitch/Kick live streams. VOD pages and MultiStream fullscreen are out of scope.
- Doc updates: none.
- Flags: none.

### Q11 - Implementation proof
- Asked: What proof should the implementation require?
- Captured: User chose option 1: unit/component tests plus Electron MCP visual verification. Test the fullscreen state/toggle behavior in code, then verify the running desktop app with Electron MCP only.
- Doc updates: none.
- Flags: none.

### Q12 - Edge case review
- Asked: Final grill check: is there any edge we have not touched?
- Captured: User asked whether the agent thinks there are edge cases, then delegated small-screen behavior to agent judgment. Decision: on small fullscreen viewports, start chat hidden instead of switching to a true overlay. Local research found the current Stream page docked chat rail is 341px, chat display default width is 30%, and tests already cover Stream page chat rail/hidden-chat behavior, PlayerControls, and fullscreen hooks.
- Doc updates: CONTEXT.md term added: `Fullscreen Chat Rail`.
- Flags: none.

## Open flags (pending input)

- None.
