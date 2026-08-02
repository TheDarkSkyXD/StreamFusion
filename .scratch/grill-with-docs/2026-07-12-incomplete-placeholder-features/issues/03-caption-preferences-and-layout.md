# Add persistent caption styling and safe cue layout

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Make custom captions durable and readable: persist enabled state and preferred language globally, restore only an available preferred language, add text-size/background-opacity/Reset controls, honor valid cue positioning, and use a bottom-center control-safe fallback for malformed or absent positioning.

## Acceptance criteria

- [x] Enabled state, preferred language, text size, and background opacity persist through the existing player-preference storage.
- [x] A preferred language is restored when available and captions remain Off when it is unavailable.
- [x] Text size, background opacity, and Reset update the overlay with accessible fixed font and foreground colors.
- [x] Valid cue alignment/positioning is honored; invalid or missing positioning falls back safely above visible controls.
- [x] Tests cover persistence, unavailable-language fallback, multiline/overlapping/rapid cues, malformed positioning, resize, and fullscreen.

## Blocked by

- [02-caption-selection-and-overlay.md](./02-caption-selection-and-overlay.md)

## Comments

- Completed with persisted caption preferences, safe positioned-cue rendering, responsive/fullscreen coverage, and Electron verification of the restored English selection.
