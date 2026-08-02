Status: done
Type: AFK

## Parent

[Multi Streams Layout Presets PRD](../prd.md)

## What to build

Expose independent volume control for every StreamSlot in that slot's hover/focus overlay, alongside mute. Newly added streams default to muted, including the first StreamSlot, and users explicitly unmute/adjust volume per slot.

## Acceptance criteria

- [x] Every StreamSlot overlay exposes local mute and compact volume controls.
- [x] Volume changes apply only to the selected StreamSlot.
- [x] Newly added streams default to muted, including the first StreamSlot.
- [x] Volume state is respected by the rendered player path where supported by the existing player components.
- [x] StreamSlot and store tests cover per-slot mute/volume behavior and muted-by-default adds.

## Blocked by

None - can start immediately.

## Comments

Closed 2026-07-07. Stream slots now show per-slot volume sliders, store volume per stream, pass slot volume into Twitch/Kick live players, and default all added streams to muted.

Evidence: `npm run typecheck`; `npm run lint`; `npm test` (348 files, 4561 tests); `npm run build`; Electron MCP verification confirmed six visible volume sliders in the seeded six-stream layout.
