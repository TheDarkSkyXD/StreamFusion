Status: done
Type: AFK
Blocked by: 01-render-fullscreen-chat-rail.md, 02-toggle-fullscreen-chat-from-player-controls.md

# Close Fullscreen Chat From Chat Header

## Parent

../prd.md

## What to build

Add a fullscreen-only `X` close control to the existing Twitch and Kick chat header. The control hides the `Fullscreen Chat Rail` and leaves the player-control chat button available to reopen it.

## Acceptance criteria

- [x] Twitch chat shows a header `X` only when rendered in the fullscreen rail.
- [x] Kick chat shows a header `X` only when rendered in the fullscreen rail.
- [x] Activating the `X` hides the fullscreen rail without mutating global chat preferences.
- [x] The existing non-fullscreen chat header remains unchanged.

## Blocked by

- 01-render-fullscreen-chat-rail.md
- 02-toggle-fullscreen-chat-from-player-controls.md

## Comments

- Closed 2026-07-07: forwarded fullscreen rail close props through `ChatPanel` and added header close buttons to Twitch and Kick chat only for fullscreen rail mode.
