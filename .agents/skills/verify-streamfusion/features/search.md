# Search

Search lets a user submit a query from the top bar and inspect unified Twitch and Kick result tabs for Channels, Streams, Videos, Clips, and Categories.

## Sub-features

- `search-submit` submits the global textbox with Enter.
- `search-route` preserves the query in the `/search` route.
- `search-tabs` exposes the unified result kinds.
- `search-provider-state` shows results, an empty state, or a named provider failure.

## How to get to it (user POV)

- Enter a term in `Search StreamFusion...` and press Enter.
- Select a suggestion from the same textbox when provider suggestions are available.

## Driving it with streamfusion-control

Preconditions:

- Doctor reports a healthy isolated desktop instance.
- The top bar is visible outside theater mode.
- Twitch and Kick may be reachable or unavailable. Record the observed provider state.

- **Return Home.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "StreamFusion"` and wait with `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --hash "#/"`.
- **Capture the entry.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output search-before.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output search-before.png`.
- **Enter the query.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs fill --run $verifyRun --role textbox --name "Search StreamFusion..." --value "ninja"`.
- **Submit.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs press --run $verifyRun --role textbox --name "Search StreamFusion..." --key "Enter"`.
- **Verify routing.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --hash "/search" --timeout 15000`. The snapshot URL must also contain `q=ninja`.
- **Verify results chrome.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Channels" --timeout 15000`. The page exposes result-kind controls even when one provider returns no data.
- **Capture the result.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output search-results.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output search-results.png`.

## Gotchas

- The textbox is `type="text"`, so its implicit role is `textbox`, not `searchbox`.
- Search suggestions debounce and depend on live providers. Enter submission and route proof do not require a suggestion.
- Seeing tabs proves the results page mounted. It does not prove provider results. Name at least one returned result or report the visible empty or error state.
- The clear button is named `Clear search` only after the textbox has a value.
