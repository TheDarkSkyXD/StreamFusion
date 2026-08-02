Status: done
Type: AFK

## Parent

[Multi Streams Layout Presets PRD](../prd.md)

## What to build

Render `MultiviewLayoutPreset` geometry in the MultiStream grid. The selected preset should determine StreamSlot placement in grid view, including the Main+N layouts where the first StreamSlot in current order becomes the large main slot.

Drag/reorder remains available only in preset/grid view. Reordering must preserve player instances and move only layout wrappers; live streams should not remount or reload when the user changes order. Focus mode remains separate.

## Acceptance criteria

- [x] Grid rendering maps each compatible preset to the expected geometry for 1 to 6 StreamSlots.
- [x] Main+N presets render the first StreamSlot in current order as the large main slot.
- [x] Drag/reorder in grid view changes order and therefore Main+N visual prominence.
- [x] Focus mode remains separate from preset selection and does not expose rail dragging in this slice.
- [x] Reordering preserves StreamSlot/player identity and does not force stream reloads.
- [x] Grid layout tests cover preset-to-geometry mapping and reorder behavior.

## Blocked by

- [01-persist-multiview-layout-presets.md](01-persist-multiview-layout-presets.md)

## Comments

Closed 2026-07-07. Grid rendering now consumes `layoutPreset`, maps presets to explicit grid classes, applies Main+N first-slot prominence, and keeps Focus mode separate from preset geometry.

Evidence: `npm run typecheck`; `npm run lint`; `npm test` (348 files, 4561 tests); `npm run build`; Electron MCP verification screenshot at `.scratch/images/multistream-six-3x2-electron.png`.
