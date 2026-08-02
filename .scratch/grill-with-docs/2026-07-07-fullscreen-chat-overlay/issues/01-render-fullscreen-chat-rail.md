Status: done
Type: AFK
Blocked by: None

# Render Fullscreen Chat Rail On Live Stream

## Parent

../prd.md

## What to build

Render a `Fullscreen Chat Rail` on the single live Stream page when a Twitch or Kick live Stream is in fullscreen. The rail appears on the right, the video resizes beside it, and the rail uses StreamFusion's chat scale plus the YouTube reference sizing (`clamp(340px, 30vw, 560px)`). This first slice only needs the rail to appear by default when fullscreen starts and chat is globally available.

## Acceptance criteria

- [x] Entering fullscreen on `/stream/$platform/$channel` renders chat in a right-side fullscreen rail beside the resized live player.
- [x] The rail uses a responsive width equivalent to `clamp(340px, 30vw, 560px)`.
- [x] The normal docked chat panel remains unchanged outside fullscreen.
- [x] VOD pages and MultiStream are unaffected.

## Blocked by

None - can start immediately.

## Comments

- Closed 2026-07-07: implemented the fullscreen chat rail on the single live Stream page, targeting the stream watch shell for fullscreen so the video resizes beside the right rail.
