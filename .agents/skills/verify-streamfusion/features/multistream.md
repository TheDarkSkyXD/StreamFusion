# MultiStream

MultiStream lets a user open MultiView, inspect an empty layout, and add live Twitch or Kick Channels through search or favorites. Populated layouts support reordering, slot mute, chat selection, removal, and focused viewing.

## Sub-features

- `multistream-open` opens the MultiView route from the sidebar.
- `multistream-empty-controls` disables focus layout and chat when no StreamSlots exist.
- `multistream-add-dialog` opens the Search and Favorites entry points.
- `multistream-add-channel` adds a selected live Channel to the grid.
- `multistream-slot-controls` reorders, mutes, focuses, selects chat for, or removes populated StreamSlots.

## How to get to it (user POV)

- Choose `MultiView` in the sidebar.
- Choose `Add Stream` in the MultiStream toolbar.
- Search for a live Channel or choose a saved live favorite.

## Driving it with streamfusion-control

Preconditions:

- Doctor reports a healthy isolated desktop instance.
- The fresh profile has zero StreamSlots.
- Adding a live Channel depends on current provider results. Opening and inspecting the dialog does not.

- **Open MultiView.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "MultiView"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "MultiStream" --hash "/multistream"`.
- **Capture the empty layout.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output multistream-before.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output multistream-before.png`.
- **Check the boundary.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs element --run $verifyRun --role button --name "Focus Layout"`. The returned `disabled` value must be `true` with zero StreamSlots.
- **Open Add Stream.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role button --name "Add Stream"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Add Stream to Layout"`.
- **Inspect entry points.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs element --run $verifyRun --role textbox --name "Search live Twitch and Kick channels..."` and `node .agents/skills/verify-streamfusion/scripts/control.mjs element --run $verifyRun --role tab --name "Favorites"`. Both controls must be visible.
- **Capture the dialog.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output multistream-dialog.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output multistream-dialog.png`.

## Gotchas

- The navigation label is `MultiView`; the page heading is `MultiStream`.
- `Focus Layout` gets its accessible name from `title`, not button text.
- Search only returns live Channels. No result may mean the Channel is offline, the provider failed, or the query did not match.
- The layout button updates the layout preference, but focused rendering also needs a selected StreamSlot. Do not claim focus mode from the toolbar button alone.
- With populated slots, prove focus through a slot control or `Ctrl+1` through `Ctrl+6`, then verify one stream is focused.
- Selecting a result mutates the isolated profile. Cleanup removes it. If proving persistence, leave and reopen MultiView before cleanup.
- A full layout rejects additional Channels at the configured MultiviewCap. The fresh-profile recipe tests the zero-StreamSlot boundary only.
