Status: done
Type: AFK
Blocked by: 01-render-fullscreen-chat-rail.md, 02-toggle-fullscreen-chat-from-player-controls.md

# Respect Preferences And Narrow Viewports

## Parent

../prd.md

## What to build

Make fullscreen chat visibility follow the agreed default rules: globally hidden chat starts hidden, fullscreen hide/show state is session-scoped, leaving fullscreen resets the fullscreen-only choice, and narrow fullscreen viewports start with chat hidden rather than using a true overlay.

## Acceptance criteria

- [x] When `preferences.chat.position === "hidden"`, entering fullscreen starts with the rail hidden.
- [x] Showing/hiding fullscreen chat never mutates the global chat preference.
- [x] Leaving fullscreen resets fullscreen-only chat visibility so the next entry starts from the default rules again.
- [x] Narrow fullscreen viewports start with chat hidden.

## Blocked by

- 01-render-fullscreen-chat-rail.md
- 02-toggle-fullscreen-chat-from-player-controls.md

## Comments

- Closed 2026-07-07: fullscreen chat visibility is session-scoped, respects global hidden chat on entry, resets on fullscreen exit, and starts hidden below 900px.
