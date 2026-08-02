Status: done
Type: AFK

## Parent

[Multi Streams Layout Presets PRD](../prd.md)

## What to build

Stabilize user-visible multistream edge cases around active StreamSlot references, offline streams, tiny windows, and player/WCV failures. These behaviors should keep failures local and prevent unexpected layout jumps.

## Acceptance criteria

- [x] Removing the focused StreamSlot moves focus to the next slot by current order, then previous, then none.
- [x] Removing the chat-selected StreamSlot moves chat selection to the next slot by current order, then previous, then none.
- [x] Offline streams remain in their StreamSlot with offline/retry state and do not auto-remove or collapse.
- [x] Tiny windows preserve the selected preset, enforce defined minimums, and allow internal scrolling instead of auto-closing chat or switching presets.
- [x] A single StreamSlot player/WCV failure shows local error/retry while other streams, layout, chat, and preset remain intact.
- [x] Tests cover active-slot fallback and local failure/offline stability where practical.

## Blocked by

- [01-persist-multiview-layout-presets.md](01-persist-multiview-layout-presets.md)
- [02-render-preset-layouts-in-grid.md](02-render-preset-layouts-in-grid.md)

## Comments

Closed 2026-07-07. Removal fallback now moves active chat/focus by current order, grid/page containers enforce minimums with internal scrolling, and StreamSlot offline state remains local with Retry.

Evidence: `npm run typecheck`; `npm run lint`; `npm test` (348 files, 4561 tests, including StreamSlot offline retry coverage); `npm run build`; Electron MCP verification screenshot at `.scratch/images/multistream-six-3x2-electron.png`.
