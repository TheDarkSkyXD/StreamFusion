# Android usability comparison

StreamFusion Development 0.1.4-alpha.1, Android version code 6, was built from current source and installed with `adb install -r` on `Medium_Phone_API_36.1`, device `emulator-5558`. The existing production package was preserved after Android rejected its differently signed update. Existing Development history and preferences remained visible after the upgrade. Metro served the UI changes recorded in this commit.

Twitch 31.5.2 was already installed on this emulator. Native inspection covered its home feed, category browsing and filters, live playback and chat, chat settings sheet, profile, settings, preferences, and theme selection sheet. Full-row selections, readable supporting text, and clear separation of tabs from filters informed the changes. This is an observed design comparison, not a measured usability study.

## Changes

- Settings selections open when the user taps the label, description, current value, or chevron. Supporting descriptions use larger text.
- Search uses underlined result tabs and distinct selected platform filters. Stream cards put language and content tags below channel identity.
- Category filters start collapsed with a summary of their current values. The existing typed request identity still owns platform, language, sort, tag, and time choices.
- Player tools have visible labels. More contains Polls and predictions. Chat uses one composer row with an emote button, input, and Send.
- Guest chat and account guidance explain build availability in plain language. Busy buttons show a spinner. Navigation labels are larger.

## Runtime coverage

| Area | Observed on the emulator | Limits |
| --- | --- | --- |
| Discovery | Home stream cards, Search, categories, category detail, platform filters, language and sort selection, filter collapse and selected summary | Provider results vary over time |
| Following and Activity | Existing screens and their empty or guest states | Provider account activity and follow writes were not exercised |
| Player and chat | Live video and chat, new tool labels, More, Quality and Captions sheets, guest composer, floating mini-player after opening Search | Chat send is unavailable in this build; caption model was not downloaded |
| More | History, Downloads, Moderation, MultiView and its Add stream sheet with an empty disabled submission, Accounts, Diagnostics | Moderation account actions and provider sign-in are unavailable in this build; MultiView playback was not started |
| Settings | All 16 category screens opened, including General, playback, controls, buffer, chat, notifications, predictions, ad blocking, proxy, integrations, tokens, updates, diagnostics, logs, bug report and About | Opening a screen does not prove every control or every scrolled section |
| Selection | Density opened from its label, changed to Compact, reopened with that selection, and restored to Comfortable; category language and sort were changed and restored | No destructive preference or credential operations |
| Larger text and dismissal | Android font scale 1.3, General rows, Density sheet choices, and visible Close returning to General; font scale restored to 1.0 | This proves those settings paths only. Keyboard avoidance and every sheet's Back/backdrop behavior remain unverified |

The source inventory contains 21 shell routes, 16 settings categories, 23 shared component families, and 29 component exports. Explorers reviewed their ownership and paths. These counts do not imply that every route, button, or authenticated flow was executed.

## Verification

The full mobile command passed 73 Node tests and 1,025 Vitest tests across 179 files, followed by the architecture import proof. Mobile ESLint and TypeScript checks passed. React Doctor scanned 22 changed files and reported 89/100 with three control-flow complexity warnings in ChatPanel, CategoryFilterBar, and WatchScreen. No React Doctor errors were reported. These warnings remain maintenance work.

Two interaction tests use real React state with host-only React Native mocks. They verify clicking a settings label, numeric selection and cancellation, and category expansion, retained choices, summaries, and tab-specific controls. Native screenshots provide separate runtime evidence.

ESLint was rerun after the test command completed because the architecture verifier temporarily creates and deletes fixture files under `.storybook`. Running those two checks concurrently produced a transient missing-file error. The final sequential lint run passed.

The Android UI hierarchy sometimes failed to become idle during live video/chat or returned a transient modal view after a tap. The driver rejects missing dumps and deletes the previous XML before capturing again. Failed attempts are not counted as proof. Screenshots and successful fresh hierarchies were checked separately. Account data, raw account dumps, logs, and Twitch profile screenshots remain local.

## Evidence and reproduction

Compare [before General](before-appearance.png) with [after General](after-general.png), [the Density sheet](after-density-sheet.png), [Search](after-search.png), [expanded category filters](after-category-detail.png), and [collapsed category filters](after-category-final.png). [General with larger text](large-text-general.png) and [its Density sheet](large-text-density-sheet.png) record font scale 1.3. [Installed versions](installed-versions.txt) and the check logs record direct command output. The local directory also contains the broader emulator tour and raw fresh hierarchies.

Run Metro for the Development client and select the reviewed emulator explicitly. The reusable driver uses live UI bounds rather than fixed button positions.

```powershell
$env:ANDROID_SERIAL = 'emulator-5558'
$env:EVIDENCE_OUT_DIR = 'verification/evidence/mobile-twitch-ux'
node verification/scripts/drive-mobile-ux.mjs snapshot current-screen
node verification/scripts/drive-mobile-ux.mjs tap shell-settings settings-hub
node verification/scripts/drive-mobile-ux.mjs tour-settings
```

`tour-settings` opens all settings categories. `tour-more` opens the six secondary workspaces. Individual `tap`, `back`, and `scroll` commands capture a fresh hierarchy and a screenshot with a SHA-256 digest. Check the resulting screen before treating a tap as successful.

## Decisions

Experience First shaped full-row selections and shorter category filters. Model the Domain and Type System Discipline kept the existing request identity and typed option values. Laziness Protocol kept existing tabs and sheets and removed the inert test callback from production UI. Build the Lever produced the reusable emulator driver. Test Behavior, Not Implementation led to interaction tests through real React state. Prove It Works required native playback, selection, and navigation evidence in addition to passing source checks.

The [design decision](design-decision.md) records the two candidate directions. The append-only [decision log](decisions.tsv) includes corrections to the initial estimated timestamps and inventory counts.

## Attention

Reviewed by gpt-6-astra. The reviewer found no confirmed UI regression in the checked screenshots and diff. Its audit identified indirect proof references and incomplete keyboard coverage. The log now points to direct installed-version and check outputs. Original setup times remain unknown, and the historical device-access and dependency-repair observations have no standalone committed output. Keyboard avoidance remains unverified. This reviewer received a supplied handoff and local artifacts rather than the original full transcript.

The comment review removed one narrating comment and its inert test callback. No comments were restored, no review reruns were needed, and no constraint encodings or comment-review flags remain open.
