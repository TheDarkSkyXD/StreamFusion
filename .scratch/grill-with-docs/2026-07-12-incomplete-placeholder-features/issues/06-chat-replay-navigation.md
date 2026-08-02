# Add replay browsing, seeking, and safe message interactions

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Complete the core replay interaction: scrolling suspends rail auto-follow without pausing the Video, a time-labelled return control resynchronizes the rail, message timestamps seek precisely, and rich historical messages remain read-only with no sending or moderation surface.

## Acceptance criteria

- [ ] Scrolling away suspends auto-follow but does not pause or seek the Video.
- [ ] The return control displays current playback time and restores the current replay window.
- [ ] Clicking only a message timestamp seeks to its offset; links and other message interactions do not seek.
- [ ] Badges, emotes, mentions, links, and lightweight user details render without send or moderation actions.
- [ ] Tests and Electron verification cover navigation and the read-only boundary.

## Blocked by

- [05-first-platform-chat-replay.md](./05-first-platform-chat-replay.md)

## Comments

- Added auto-follow suspension/return, explicit timestamp seeking, read-only user details, rich fragments, and stable `role="log"` semantics without send or moderation actions.
- Focused/adjacent tests passed 22/22 with type-check, targeted Biome, production build, React Doctor, and deslop gates.
- Electron proof confirmed the synchronized message window and time-labelled return control on a real Twitch Video.
