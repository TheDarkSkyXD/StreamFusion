# Multi Streams Layout: Grilling Session Notes
Date: 2026-07-07 · Goal: Define the Multi Streams page behavior for up to 6 concurrent streams with auto-adjusting layouts and multiple layout modes.

## PRD

[prd.md](prd.md)

## Summary / key decisions

Visual mockups will be used during the grill session for layout and spatial decisions.
“Multiple layouts” means a preset chooser per active StreamSlot count, not only the current Grid/Focus toggle and not full saved custom layouts.
The first preset inventory will be lean and count-compatible: 1 = Single; 2 = Side by side/Stacked; 3 = Main+2/Three across/Stacked; 4 = Quad/Main+3; 5 = Main+4/3x2 with gap; 6 = 3x2/2x3.
When the StreamSlot count changes, preserve the selected preset if it is compatible with the new count; otherwise switch to the default preset for the new count.
Each StreamSlot must expose its own volume control.
For main-focused presets, the first StreamSlot in the current order is the large main slot. Drag/reorder changes visual prominence; audio volume remains independent per StreamSlot.
Each StreamSlot's volume control appears locally in that slot's hover/focus overlay, alongside mute.
The page respects the existing MultiviewCap: it supports up to 6 StreamSlots, but the user-configured cap may be lower.
Chat remains a docked rail outside the preset grid. One selected StreamSlot owns the visible chat, and the rail can be toggled closed.
Users choose a MultiviewLayoutPreset from a compact toolbar dropdown with visual mini-icons. The dropdown is count-aware and only shows presets compatible with the current StreamSlot count.
The selected MultiviewLayoutPreset persists across reload/restart when compatible with the restored StreamSlot count; otherwise the page falls back to the default preset for that count.
If a stream goes offline, its StreamSlot remains in place and shows an offline/retry state. The layout does not auto-remove or collapse offline streams.
Adding streams remains a toolbar action. When the current StreamSlot count reaches the MultiviewCap, Add Stream is disabled and explains the cap with a tooltip or equivalent affordance.
Focus remains a separate toolbar toggle. MultiviewLayoutPresets control grid arrangements; Focus is a temporary viewing mode with one large StreamSlot and a rail.
Drag/reorder is available only in preset/grid view. Reordering controls Main+N visual prominence; Focus mode uses click/shortcut focus selection and does not support rail dragging in the first version.
Newly added streams default to muted, including the first StreamSlot. Users explicitly unmute and adjust each StreamSlot's volume.
Changing MultiviewLayoutPreset is visual only. It does not change playback quality or resource behavior; existing SlotPresence/background-quality rules remain responsible for that.
Keyboard shortcuts keep their existing role: Ctrl+1..6 focuses StreamSlots. Preset switching stays in the toolbar dropdown; no preset shortcuts in the first version.
Duplicate platform/channel additions are blocked with visible inline or toast feedback such as "Already in multiview." The app keeps one StreamSlot per platform/channel.
Invalid or incompatible persisted MultiviewLayoutPreset state recovers silently to the default preset for the current StreamSlot count.
When the focused StreamSlot or chat-selected StreamSlot is removed, the active reference moves to the next available StreamSlot by current order, then the previous StreamSlot, then none if the multiview is empty.
Drag/reorder preserves live player instances and moves only layout wrappers. Reordering must not remount or reload streams; WCV/player bounds update after drop.
When the window is too small for the selected preset plus chat rail, preserve the selected preset, let StreamSlots shrink to defined minimums, and allow internal scrolling if needed. Do not auto-close chat or auto-switch presets.
If one StreamSlot's player or WCV crashes/fails, the failure is local to that StreamSlot. It shows an error/retry state while other streams, layout, chat, and preset remain intact.
If the user lowers MultiviewCap below the current StreamSlot count, existing streams remain. Future additions are blocked until the count is under the cap.

## Q&A log

### Q1 — Visual companion
- Asked: Since this is a visual layout feature, do you want HTML mockups as we grill the layout choices?
- Captured: User chose "Yes, show mockups as we go."
- Doc updates: none
- Flags: none

### Q2 — Layout strategy
- Asked: What should "multiple layouts" mean for this first implementation?
- Captured: User chose "Preset Chooser per Count": users can choose layout variants like 2x1, 1x2, 2x3, 3x2, and main + side, with auto-fallback when stream count changes.
- Doc updates: none
- Flags: Need define exact compatible preset list and fallback behavior.

### Q3 — Preset inventory
- Asked: Which preset inventory should the first version ship with?
- Captured: User chose "Lean compatible presets": 1 = Single; 2 = Side by side/Stacked; 3 = Main+2/Three across/Stacked; 4 = Quad/Main+3; 5 = Main+4/3x2 with gap; 6 = 3x2/2x3.
- Doc updates: none
- Flags: Need define fallback behavior when StreamSlot count changes.

### Q4 — Auto-adjust behavior
- Asked: When streams are added or removed and the current layout no longer fits, how should auto-adjust behave?
- Captured: User chose "Preserve when compatible, otherwise default for count."
- Doc updates: none
- Flags: Need define which StreamSlot becomes the main slot in main-focused presets.

### Q5 — Main slot owner / audio controls
- Asked: In Main+2, Main+3, and Main+4, which StreamSlot should become the large main slot?
- Captured: User first clarified that each stream has its own volume control, then chose "First slot in current order." Drag/reorder controls which StreamSlot becomes main; volume stays independent per stream.
- Doc updates: none
- Flags: Need define where/how per-slot volume controls appear in the UI.

### Q6 — Per-slot volume UI
- Asked: Where should each stream's volume control appear?
- Captured: User chose "Per-slot hover overlay": each StreamSlot shows mute plus a compact volume slider on hover/focus.
- Doc updates: none
- Flags: Need reconcile max 6 wording with existing user-configurable MultiviewCap glossary.

### Q7 — MultiviewCap
- Asked: Your wording says "max up to 6," but the repo glossary already defines MultiviewCap as user-configurable from 1-6 with default 4. Should this feature respect that cap or always allow 6?
- Captured: User chose "Respect MultiviewCap, max allowed 6": the page supports up to 6, but the user's configured cap can be lower.
- Doc updates: none
- Flags: Need define how chat coexists with layout presets.

### Q8 — Chat placement
- Asked: How should chat coexist with the layout presets?
- Captured: User chose "Docked chat rail outside the grid": one selected StreamSlot owns the visible chat, and the rail can be toggled closed. Layout presets only arrange video StreamSlots.
- Doc updates: Added `MultiviewLayoutPreset` to CONTEXT.md.
- Flags: Need define how the user selects presets in the toolbar.

### Q9 — Preset selection UI
- Asked: How should users choose a MultiviewLayoutPreset?
- Captured: User chose "Toolbar dropdown with visual mini-icons": compact, count-aware, and shows only compatible presets for the current StreamSlot count.
- Doc updates: none
- Flags: Need define whether selected presets persist across reload/restart.

### Q10 — Preset persistence / offline streams
- Asked: Should the selected MultiviewLayoutPreset persist after reload/restart?
- Captured: User chose "Persist the current preset when compatible" and asked how offline streams should be handled.
- Doc updates: none
- Flags: Need define offline StreamSlot behavior.

### Q11 — Offline StreamSlot behavior
- Asked: If a stream goes offline while it is in the multiview page, what should happen?
- Captured: User chose "Keep the StreamSlot in place with an offline/retry state": layout does not jump, user can wait or remove it manually.
- Doc updates: none
- Flags: Need define add-at-cap behavior and empty/add affordance.

### Q12 — Add stream at cap
- Asked: How should adding streams work at or below the MultiviewCap?
- Captured: User chose "Toolbar Add only, disabled at cap with tooltip": when count reaches cap, Add Stream is disabled and explains the cap.
- Doc updates: none
- Flags: Need define how existing Focus mode relates to MultiviewLayoutPreset selection.

### Q13 — Focus mode relationship
- Asked: What should happen to the current Focus mode?
- Captured: User chose "Keep Focus as a separate toolbar toggle": presets control grid arrangements; Focus remains a temporary viewing mode with one large stream and a rail.
- Doc updates: none
- Flags: Need define drag/reorder behavior in preset and focus modes.

### Q14 — Drag/reorder behavior
- Asked: How should drag/reorder work with presets and Focus?
- Captured: User chose "Drag reorder only in preset/grid view": order controls Main+N; Focus uses click/shortcut to choose focused stream, and reordering happens after returning to grid.
- Doc updates: none
- Flags: Need define audio defaults when streams are added.

### Q15 — Audio defaults
- Asked: When a new stream is added, what should its audio default be?
- Captured: User chose "All streams muted until user unmutes": newly added streams default muted, including the first stream.
- Doc updates: none
- Flags: Need define whether preset selection affects playback quality/resource behavior.

### Q16 — Presets and resource behavior
- Asked: Should changing MultiviewLayoutPreset affect stream quality/resource behavior?
- Captured: User chose "No, layout only": presets only change geometry; existing SlotPresence/background-quality rules decide resource use.
- Doc updates: none
- Flags: Need define keyboard shortcut behavior for preset selection and focus.

### Codebase review checkpoint — implementation risks
- Captured: Explorer review found these likely implementation seams: `multistream-store.ts` needs a persisted schema change for presets; current `partialize` intentionally persists layout as `"grid"` so Focus remains session-only; `grid-layout.tsx` hard-codes count-based classes and should move to preset data; current Focus toolbar can appear active without a focused stream; `StreamSlot` has persisted volume state but no real volume UI; add-at-cap currently hard-stops silently in the store while the dialog closes.
- Doc updates: none
- Flags: Extend store, grid, page, stream-slot, add-dialog, and E2E tests when implementation begins.

### Q17 — Keyboard shortcuts
- Asked: Should keyboard shortcuts cover layout presets?
- Captured: User chose "Keep existing Ctrl+1..6 for focusing slots only, no preset shortcuts": preset switching stays in the dropdown.
- Doc updates: none
- Flags: Need final completeness check before close-out.

### Q18 — Completeness check
- Asked: Is there anything else this multi-stream layout plan must cover before close-out?
- Captured: User said edge cases still need to be covered.
- Doc updates: none
- Flags: Need define edge-case policies before PRD close-out.

### Q19 — Edge-case coverage scope
- Asked: For edge cases, should we cover them as a dedicated policy matrix in the PRD?
- Captured: User chose "Yes, cover the full matrix": cap, duplicates, offline, invalid persisted preset, removed focused/chat stream, drag during playback, tiny window, and WCV/player failures.
- Doc updates: none
- Flags: Need define each edge-case policy before PRD close-out.

### Q20 — Duplicate stream add
- Asked: If the user tries to add a duplicate stream already present in another StreamSlot, what should happen?
- Captured: User chose "Block it with an inline/toast message": keep one StreamSlot per platform/channel and explain "Already in multiview."
- Doc updates: none
- Flags: Need define invalid persisted preset behavior.

### Q21 — Invalid persisted preset
- Asked: If persisted layout state is invalid or incompatible after an app update, what should happen?
- Captured: User chose "Recover silently to the default preset for the current count": no crash, no user-facing alarm; covered by migration tests.
- Doc updates: none
- Flags: Need define removed focused/chat StreamSlot fallback.

### Q22 — Removed active StreamSlot fallback
- Asked: If the focused stream or chat-selected stream is removed, what should become active next?
- Captured: User chose "Next available slot by current order, else previous, else none": deterministic and preserves the user's ordering.
- Doc updates: none
- Flags: Need define drag/reorder during playback behavior.

### Q23 — Drag/reorder during playback
- Asked: During drag/reorder, what should happen to live playback?
- Captured: User chose "Preserve player instances and only move layout wrappers": no stream reload on reorder; WCV/player bounds update after drop.
- Doc updates: none
- Flags: Need define tiny window behavior.

### Q24 — Tiny window behavior
- Asked: What should happen when the window is too small for the selected preset plus chat rail?
- Captured: User chose "Preserve preset, let slots shrink to a minimum, and allow internal scrolling if needed": no unexpected layout changes; user can close chat or resize.
- Doc updates: none
- Flags: Need define WCV/player failure behavior.

### Q25 — Player/WCV failure
- Asked: If one StreamSlot's player or WCV crashes/fails, how should the multiview behave?
- Captured: User chose "Local failure only with retry in that StreamSlot": failed slot shows error/retry; other streams, layout, chat, and preset stay intact.
- Doc updates: none
- Flags: Need define behavior when MultiviewCap is lowered below current count.

### Q26 — Lowered MultiviewCap
- Asked: If the user lowers MultiviewCap below the current number of streams, what should happen?
- Captured: User chose "Keep existing streams, block future adds until count is under cap": matches current store behavior and avoids destructive removal.
- Doc updates: none
- Flags: none

### Close-out — PRD
- Captured: Final gap scan found no unresolved contradictions. Local markdown issue tracker is configured, so PRD was written into the grill session folder.
- Doc updates: Created `prd.md`.
- Flags: none

## Open flags (pending input)
None.
