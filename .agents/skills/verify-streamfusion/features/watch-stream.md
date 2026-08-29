# Watch a stream

Watch a stream lets a user open a Twitch or Kick Channel, see its player or offline state, inspect Channel information, and use the adjacent chat area.

## Sub-features

- `stream-open-card` opens a Channel from a live stream card or search result.
- `stream-deep-link` opens a shared Stream route.
- `stream-player-state` shows video, loading, offline, or a named playback error.
- `stream-chat-state` shows chat chrome and its eligibility or connection state.

## How to get to it (user POV)

- Choose a live stream card on Home, Following, Categories, or Search.
- Open a shared StreamFusion route shaped as `#/stream/<platform>/<channel>`.
- Choose a Channel from the followed-Channels sidebar.

## Driving it with streamfusion-control

Preconditions:

- Doctor reports a healthy isolated desktop instance.
- Use a Channel observed in the current Home or Search snapshot when proving live playback.
- Authentication is optional for viewing. Chat sending needs a valid account for the selected Platform.

- **Capture the source view.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output stream-source.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output stream-source.png` before selecting a visible Channel.
- **Open a visible Channel.** Read the snapshot, choose the exact accessible name of a live Channel link, then run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name $channelName`. This click is the preferred proof because it follows the same path as a user.
- **Deep-link fallback.** When live discovery has no cards, run `node .agents/skills/verify-streamfusion/scripts/control.mjs evaluate --run $verifyRun --expression "location.hash = '#/stream/twitch/ninja'"`. Record that the shared-route entry was tested instead of card selection.
- **Verify the route.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --hash "/stream/" --timeout 15000`.
- **Observe player and chat.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output stream-open.json`. Require either a `video`-backed player state, explicit offline copy, or a named playback error, plus chat-related visible text or the `stream-chat-rail` region.
- **Capture the result.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output stream-open.png` and `node .agents/skills/verify-streamfusion/scripts/control.mjs logs --run $verifyRun --lines 120`.

## Gotchas

- Channel availability changes during a run. Record the Platform, Channel slug, and observed live or offline state.
- An offline message proves the route and fallback UI, not video playback.
- Autoplay, ads, proxies, and provider tokens can affect playback after the player container mounts.
- Do not send a chat message unless the task authorizes an external message and a dedicated test account is active.
- The direct `location.hash` command is a shared-link entry, not proof that discovery cards work.
