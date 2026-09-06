# Moderation workspace

Moderation combines live video/chat with local history, retention, and platform-authorized tools.

## Sub-features

- `/mod` lists managed channels and global retention.
- Channel workspaces preserve live component identity while docking/resizing.
- Retention on Kick and AutoMod Queue on Twitch are pinned. Mod Actions moves only to
  the left or right of the pinned panel. Chat can fill the outer right edge.
- Layout lock, reset, optional tool restoration, keyboard panel menus, and persistence.
- Mod Actions filters match Twitch's 14 categories. Filtering happens before pagination.
- Twitch AutoMod receives live held and resolved events. It does not import historical held messages.

## How to get to it (user POV)

Open Mod View from a channel's chat controls, or use `/mod` and choose a managed channel.
The supported deep links are `/mod/twitch/$channel` and `/mod/kick/$channel`.
An authenticated broadcaster can open their own resolved channel while remote tool permissions
are checked. Other channels require confirmed moderation authority.

## Driving it with streamfusion-control

Require a healthy doctor/database result and a fresh isolated Electron run.
Navigate to the documented `/mod` deep link, capture its channel links, then click one by name.
Capture the workspace before editing. Drag the Mod Actions header to the left or right side
of the fixed panel with actual pointer events. Capture the colored half-panel preview and
the committed geometry. Top/bottom drops must leave the layout unchanged.
Drag Chat to the outer right edge and verify it spans the canvas height.
Use `Lock layout`, `Unlock layout`, and `Reset layout` buttons by accessible name.
Open `Filters (14 selected)` and verify the checkbox menu. Reload and confirm the saved layout.
Capture screenshots, semantic snapshots, and console errors; clean up the isolated run.

## Gotchas

Do not click Allow/Deny, send chat, or perform remote moderation without an authorized test case.
An expired Twitch token or missing `moderator:manage:automod` scope cannot prove successful
queue delivery. Verify the permission state and report live delivery as an unmet precondition.
Empty queues prove no held events received in the current session, not complete historical parity.
Do not edit source or run compiler boundary checks during a pointer proof; development rebuilds
restart Electron and invalidate node-identity evidence. Hidden-window RAF timing is not a performance result.
