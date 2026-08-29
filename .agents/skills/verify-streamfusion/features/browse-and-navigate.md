# Browse and navigate

Browse and navigate lets a user move among StreamFusion's Home, Following, Categories, MultiView, History, Downloads, and Settings pages from the desktop shell.

## Sub-features

- `shell-home` renders the StreamFusion brand, global search, sidebar, and Home content.
- `nav-following` opens followed Channels and Guest Follows.
- `nav-categories` opens Twitch and Kick categories.
- `nav-history` opens watched-content history.
- `nav-downloads` opens the download queue.

## How to get to it (user POV)

- Choose `StreamFusion` in the top bar to return Home.
- Choose `Following`, `Categories`, `History`, or `Downloads` in the sidebar.
- Choose `Browse All Categories` from Home to reach Categories.

## Driving it with streamfusion-control

Preconditions:

- Doctor reports a healthy isolated desktop instance.
- The `database` command reports a healthy isolated database with no missing required tables.
- The sidebar is expanded. A fresh verification profile starts expanded.

- **Capture Home.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output browse-home.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output browse-home.png`. The snapshot names `StreamFusion` and `Search StreamFusion...`; Home shows `Browse All Categories` or an explicit stream-loading error.
- **Open Categories.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "Categories"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Categories" --hash "/categories"`. A Categories heading appears.
- **Open Following.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "Following"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Following" --hash "/following"`. The page shows followed content, an empty state, or a named provider error.
- **Verify the database.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs database --run $verifyRun --output browse-database.json`. Require `healthy: true`, `quickCheck: ["ok"]`, and no missing required tables. Record whether the isolated database was seeded and the `local_follows` row count before interpreting the Following state.
- **Open History.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "History"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Watch History" --hash "/history"`. The History page appears.
- **Open Downloads.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "Downloads"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Downloads" --hash "/downloads"`. The download queue, empty state, or explicit load error appears.
- **Capture the result.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output browse-downloads.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output browse-downloads.png`.

## Gotchas

- The sidebar label is `MultiView`; the page heading is `MultiStream`.
- A collapsed sidebar hides link text, so role-and-name lookup cannot find the labels. Start from a fresh profile or choose `Expand sidebar` first.
- Provider failures can leave the shell and navigation healthy. Report shell navigation separately from live data loading.
- Empty History and Downloads pages are valid only when their headings and empty-state copy render without an uncaught error.
