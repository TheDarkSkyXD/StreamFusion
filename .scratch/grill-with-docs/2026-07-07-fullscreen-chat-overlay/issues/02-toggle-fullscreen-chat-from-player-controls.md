Status: done
Type: AFK
Blocked by: 01-render-fullscreen-chat-rail.md

# Toggle Fullscreen Chat From Player Controls

## Parent

../prd.md

## What to build

Add a fullscreen-only chat toggle to the bottom-right player controls beside settings/fullscreen. When the rail is open, the control hides chat and expands the video to full fullscreen width. When hidden, the same control reopens the rail and resizes the video beside it.

## Acceptance criteria

- [x] A chat toggle appears only in fullscreen player controls.
- [x] Activating the toggle while chat is open hides the fullscreen rail and expands the video.
- [x] Activating the toggle while chat is hidden restores the fullscreen rail.
- [x] Toggle label/tooltip reflects the current action: hide chat or show chat.

## Blocked by

- 01-render-fullscreen-chat-rail.md

## Comments

- Closed 2026-07-07: added the fullscreen-only player chat control with Hide chat / Show chat labels and verified it hides and restores the rail in Electron MCP.
