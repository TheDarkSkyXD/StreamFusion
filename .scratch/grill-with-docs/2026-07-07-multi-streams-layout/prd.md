# Multi Streams Layout Presets PRD

## Problem Statement

The MultiStream page currently supports simultaneous streams, but layout behavior is limited and mostly implicit: stream count determines the grid, Focus mode is separate, per-stream volume is not exposed in the slot UI, and edge cases such as duplicate adds, invalid persisted layout state, and active-slot removal are not fully specified.

Users need a predictable multiview page that supports up to the configured MultiviewCap, auto-adjusts layouts as StreamSlots are added or removed, and offers multiple count-compatible layout presets without turning the first version into a custom layout editor.

## Solution

Add `MultiviewLayoutPreset` support to the MultiStream page.

The page will expose a compact toolbar dropdown with visual mini-icons. The dropdown shows only presets compatible with the current StreamSlot count. Presets control video geometry only; they do not change playback quality, resource behavior, chat selection, or audio policy.

Focus remains a separate temporary viewing mode. Chat remains a docked rail outside the preset grid. StreamSlot order controls visual prominence in main-focused presets.

## User Stories

- As a viewer, I can choose from layout presets that fit my current number of streams so I can arrange the page for equal viewing or main-stream viewing.
- As a viewer, I can add and remove streams without unexpected layout jumps when the selected preset still fits.
- As a viewer, I can keep one stream large by dragging it to the first slot in a Main+N preset.
- As a viewer, I can control volume independently for each StreamSlot from that slot's hover/focus overlay.
- As a viewer, I can keep chat docked beside the video grid and choose which StreamSlot's chat is shown.
- As a viewer, I can trust offline or failed streams to stay local to their StreamSlot without disrupting the rest of the multiview.

## Implementation Decisions

### Preset Inventory

- 1 StreamSlot: Single.
- 2 StreamSlots: Side by side, Stacked.
- 3 StreamSlots: Main+2, Three across, Stacked.
- 4 StreamSlots: Quad, Main+3.
- 5 StreamSlots: Main+4, 3x2 with gap.
- 6 StreamSlots: 3x2, 2x3.

### Auto-Adjust Rule

When the StreamSlot count changes, preserve the selected preset if it is compatible with the new count. Otherwise, switch to the default preset for the new count.

### Main Slot Rule

For Main+N presets, the first StreamSlot in current order is the large main slot. Drag/reorder changes visual prominence. Audio volume remains independent per StreamSlot.

### Toolbar And Selection

- Preset selection lives in a compact toolbar dropdown with visual mini-icons.
- The dropdown is count-aware and only shows compatible presets.
- Add Stream remains a toolbar action.
- When the StreamSlot count reaches MultiviewCap, Add Stream is disabled and explains the cap with a tooltip or equivalent affordance.

### Focus Mode

Focus remains separate from MultiviewLayoutPreset selection. Presets control grid arrangements; Focus is a temporary viewing mode with one large StreamSlot and a rail. Drag/reorder is available only in preset/grid view.

### Chat

Chat remains a docked rail outside the preset grid. One selected StreamSlot owns the visible chat, and the rail can be toggled closed.

### Audio

- Every StreamSlot exposes its own volume control in the slot hover/focus overlay, alongside mute.
- Newly added streams default to muted, including the first StreamSlot.
- Users explicitly unmute and adjust each StreamSlot's volume.

### Persistence

The selected MultiviewLayoutPreset persists across reload/restart when compatible with the restored StreamSlot count. If incompatible or invalid, the page falls back to the default preset for that count.

### Resource Policy

Changing MultiviewLayoutPreset is visual only. Existing SlotPresence and background-quality behavior remain responsible for playback quality and resource management.

## Edge-Case Matrix

| Edge case | Required behavior |
|---|---|
| Duplicate platform/channel add | Block with visible inline or toast feedback such as "Already in multiview." Keep one StreamSlot per platform/channel. |
| At MultiviewCap | Disable Add Stream and explain the cap. |
| MultiviewCap lowered below current count | Keep existing streams. Block future additions until count is under cap. |
| Invalid persisted preset | Recover silently to the default preset for the current StreamSlot count. |
| Stream goes offline | Keep the StreamSlot in place with offline/retry state. Do not auto-remove or collapse it. |
| Focused StreamSlot removed | Move focus to next slot by current order, then previous, then none. |
| Chat-selected StreamSlot removed | Move chat selection to next slot by current order, then previous, then none. |
| Drag/reorder during playback | Preserve player instances and move only layout wrappers. Do not remount or reload streams. WCV/player bounds update after drop. |
| Tiny window with chat rail | Preserve selected preset, let StreamSlots shrink to defined minimums, and allow internal scrolling if needed. Do not auto-close chat or auto-switch presets. |
| One StreamSlot player/WCV crashes | Show local error/retry in that StreamSlot. Other streams, layout, chat, and preset remain intact. |
| Keyboard shortcuts | Keep existing Ctrl+1..6 behavior for focusing StreamSlots. Do not add preset shortcuts in the first version. |

## Testing Decisions

- Store tests cover schema migration, default preset seeding, invalid persisted preset fallback, compatible preset preservation, and fallback on add/remove when incompatible.
- Grid layout tests cover preset-to-layout mapping, StreamSlot order, Main+N first-slot behavior, and count-compatible rendering.
- MultiStream page tests cover toolbar dropdown behavior, compatible preset filtering, Focus button semantics, Add Stream cap disabled state, and chat rail preservation.
- StreamSlot tests cover per-slot mute/volume interactions.
- AddStreamDialog tests cover cap-reached and duplicate-add feedback.
- E2E playbook coverage should include preset switching, add/remove auto-adjust, Focus interaction, duplicate add, offline/retry local state, and player/WCV local failure where testable.

## Out Of Scope

- Saved custom named layouts.
- Full custom layout editor.
- Preset keyboard shortcuts.
- Per-slot chat inside video slots.
- Floating chat panel.
- Auto-removing offline or failed streams.
- Layout-driven playback quality changes.

## Further Notes

Implementation should treat `MultiviewLayoutPreset` as a persisted schema addition, likely requiring a multistream-store version bump. Focus mode should remain session-only unless a separate decision changes that behavior.
