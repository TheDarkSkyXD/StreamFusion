Status: done
Type: AFK

## Parent

[Multi Streams Layout Presets PRD](../prd.md)

## What to build

Persist `MultiviewLayoutPreset` as the visual layout choice for the MultiStream page. The store must expose the lean count-compatible preset inventory, select the default preset for the current StreamSlot count, preserve the selected preset when add/remove keeps it compatible, and fall back to the count default when it does not.

This slice should also handle persisted-state hardening: invalid or incompatible persisted preset data silently recovers to the default preset for the restored StreamSlot count. Existing streams survive if `MultiviewCap` is lowered below current count, and future additions remain blocked until the count is under the cap.

## Acceptance criteria

- [x] `MultiviewLayoutPreset` state is persisted across reload/restart when compatible with the restored StreamSlot count.
- [x] The store exposes compatible presets and a default preset for each StreamSlot count from 1 to 6.
- [x] Adding or removing StreamSlots preserves the selected preset when compatible and falls back to the new count default when incompatible.
- [x] Invalid or incompatible persisted preset state silently recovers to the current count default.
- [x] Lowering `MultiviewCap` below the current StreamSlot count keeps existing streams and blocks future additions until the count is under cap.
- [x] Store migration tests cover the version bump and recovery behavior.

## Blocked by

None - can start immediately.

## Comments

Closed 2026-07-07. Implemented in `multistream-store` with schema version 2, compatible preset helpers, add/remove/clear fallback behavior, migration hardening, and store tests.

Evidence: `npm run typecheck`; `npm run lint`; `npm test` (348 files, 4561 tests); `npm run build`; Electron MCP verification screenshot at `.scratch/images/multistream-six-3x2-electron.png`.
