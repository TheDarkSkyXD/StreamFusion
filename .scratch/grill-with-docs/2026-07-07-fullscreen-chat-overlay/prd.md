# Fullscreen Chat Rail PRD

## Problem Statement

When a viewer enters fullscreen on a live Stream page, StreamFusion currently fullscreen-displays the player without the docked chat experience. Users who want a YouTube-like fullscreen viewing mode need chat available beside the stream, with an easy way to hide it and reopen it from player controls.

## Solution

Add a `Fullscreen Chat Rail` to the single live Stream page (`/stream/$platform/$channel`) for Twitch and Kick. In fullscreen, chat appears as a right-side rail beside the resized video, not as a true overlay over the video. When chat is hidden, the video expands to the full fullscreen width and a chat button remains in the bottom-right player controls to reopen it.

## User Stories

- As a viewer watching a live Stream in fullscreen, I can see chat in a right-side rail while the video remains visible beside it.
- As a viewer, I can hide fullscreen chat from the player controls or from the chat header `X`.
- As a viewer, I can reopen hidden fullscreen chat from the bottom-right fullscreen player controls.
- As a viewer who globally hides chat, I do not get chat forced open in fullscreen, but I can still show it for the current fullscreen session.
- As a viewer on a small fullscreen viewport, I start with chat hidden so the video remains usable.

## Implementation Decisions

- Use the canonical term `Fullscreen Chat Rail`; avoid `fullscreen chat overlay`.
- Scope first implementation to the single live Stream page only.
- Copy YouTube's side-by-side fullscreen behavior: chat rail on the right, resized video on the left, full-width video when chat is hidden.
- Size the rail with StreamFusion and YouTube references: roughly `clamp(340px, 30vw, 560px)`.
- Show the fullscreen chat toggle only in fullscreen, in the bottom-right player controls beside settings/fullscreen.
- Toggle action text should map to state: hide chat when open, show chat when hidden.
- Put the `X` in the existing Twitch/Kick chat header, visible only when rendered in the fullscreen rail.
- Preserve the same chat session feel across fullscreen transitions as much as practical: avoid intentional reconnects, preserve messages, preserve scroll position/draft text where feasible.
- Respect `preferences.chat.position === "hidden"` by starting fullscreen with chat hidden. Showing chat from fullscreen controls is session-scoped and must not mutate the global preference.
- Reset fullscreen-only chat visibility when leaving fullscreen. The next fullscreen entry starts from the default rules again.
- On narrow fullscreen viewports, start with chat hidden rather than switching to a true overlay.

## Testing Decisions

- Add unit/component coverage for fullscreen chat default visibility, hide/show control behavior, hidden global preference behavior, and the header `X`.
- Extend existing Stream page/player control tests where possible instead of creating a parallel testing style.
- Run the project's lint, type-check, and build commands before marking implementation done.
- Verify the running StreamFusion desktop app visually with Electron MCP only. Browser, Chrome, desktop automation, or manual OS-level interaction are not acceptable for app verification.

## Out of Scope

- VOD pages and chat replay.
- MultiStream fullscreen and active StreamSlot chat selection.
- User preference for left/right fullscreen chat placement.
- Persisting the fullscreen chat hidden state across sessions.
- True over-video chat overlay mode.

## Further Notes

- YouTube reference research in Chrome found a right rail around 560px on a 1920px viewport, with the video expanding to full width after chat is hidden.
- Current local Stream page chat rail is 341px wide.
- Existing tests already cover Stream page chat rail visibility, hidden chat behavior, PlayerControls, and fullscreen hooks.
