# Deliver track selection and basic custom captions

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Deliver the first complete Timed Text Track path through the active HLS player: discover valid subtitle/caption tracks, expose Subtitles/CC only when tracks exist, allow Off or language selection, and render active cues in a StreamFusion-owned overlay on Streams and Videos for either Platform.

## Acceptance criteria

- [x] The settings row is absent when no valid Timed Text Track exists and appears when one or more tracks exist.
- [x] The submenu lists Off and every available language and reflects the current selection.
- [x] Selecting a track renders its active cues in a custom in-player overlay without interrupting playback.
- [x] Track additions, removals, and media changes update the menu and overlay without leaking stale cues.
- [x] Focused tests and Electron verification cover live and VOD player paths.

## Blocked by

None - can start immediately

## Comments

- Completed with focused foundation tests and Electron proof using a real HLS manifest plus an English WebVTT track. The rendered cue is captured in `.scratch/images/caption-overlay-proof.png`.
