# Settings

Settings lets a user inspect and change playback, chat, network, account, update, diagnostic, and application information from one desktop page.

## Sub-features

- `settings-open` opens the Settings page from the app sidebar.
- `settings-search` filters settings by user-entered text.
- `settings-accounts` shows Twitch and Kick connection controls.
- `settings-version` shows the current StreamFusion version in About.

## How to get to it (user POV)

- Choose `Settings` in the main sidebar.
- Choose a Settings section such as `Integrations`, `API / Tokens`, or `About` in the Settings navigation.
- Enter a term in `Search settings` to filter sections and rows.

## Driving it with streamfusion-control

Preconditions:

- Doctor reports a healthy isolated desktop instance.
- The isolated profile starts signed out unless the recipe explicitly provisions a test account.

- **Open Settings.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "Settings"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Personalize your StreamFusion experience" --hash "/settings"`.
- **Capture the entry.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output settings-entry.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output settings-entry.png`.
- **Inspect account controls.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "Integrations"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Twitch" --timeout 15000`. The page must also name Kick and show connected or signed-out controls for each Platform.
- **Inspect version.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "About"`, then `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "StreamFusion" --timeout 15000`. The visible About panel includes a `v<version>` value.
- **Search settings.** Return to Settings through the sidebar, then run `node .agents/skills/verify-streamfusion/scripts/control.mjs fill --run $verifyRun --role textbox --name "Search settings" --value "token"` and `node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "API / Tokens"`. Capture the filtered state. Search is last because the global and Settings search controls can both expose a button named `Clear search`.
- **Capture the result.** Run `node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output settings-about.json` and `node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output settings-about.png`.

## Gotchas

- A fresh verification profile is intentionally signed out. Do not use a developer's real profile to make account controls look connected.
- Settings links update the search portion of the hash route. Wait for panel text, not only `/settings`.
- `Logs` and `Report Bug` appear only in development builds.
- Toggling a switch writes isolated profile state. Capture its before and after values, then confirm the value after leaving and reopening the section.
- Opening OAuth, checking for updates, reporting a bug, deleting data, or changing proxy settings needs task-specific authorization beyond this smoke recipe.
