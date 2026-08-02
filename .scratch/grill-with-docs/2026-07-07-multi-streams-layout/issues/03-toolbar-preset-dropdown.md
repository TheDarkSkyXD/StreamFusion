Status: done
Type: AFK

## Parent

[Multi Streams Layout Presets PRD](../prd.md)

## What to build

Add a compact toolbar dropdown for selecting the current `MultiviewLayoutPreset`. The dropdown should use visual mini-icons, show only presets compatible with the current StreamSlot count, and preserve the existing separate Focus toggle. Preset switching remains visible in the dropdown; no keyboard shortcuts are added for presets.

## Acceptance criteria

- [x] MultiStream toolbar includes a compact count-aware preset dropdown with visual mini-icons.
- [x] The dropdown lists only presets compatible with the current StreamSlot count.
- [x] Selecting a preset updates grid view geometry without changing chat, audio, or playback resource policy.
- [x] Focus remains a separate toolbar toggle and is not folded into the preset dropdown.
- [x] Ctrl+1..6 remains reserved for focusing StreamSlots; no preset shortcut is introduced.
- [x] Page/component tests cover compatible filtering, selection, and Focus button semantics.

## Blocked by

- [01-persist-multiview-layout-presets.md](01-persist-multiview-layout-presets.md)
- [02-render-preset-layouts-in-grid.md](02-render-preset-layouts-in-grid.md)

## Comments

Closed 2026-07-07. MultiStream toolbar now exposes a compact preset dropdown with mini layout glyphs and count-compatible options while leaving Focus as its own toolbar control.

Evidence: `npm run typecheck`; `npm run lint`; `npm test` (348 files, 4561 tests); `npm run build`; Electron MCP verification screenshot at `.scratch/images/multistream-six-3x2-electron.png`.
