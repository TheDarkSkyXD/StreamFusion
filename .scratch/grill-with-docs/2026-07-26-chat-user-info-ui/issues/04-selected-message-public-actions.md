# Slice 04 — Selected-message public actions

Status: done

## Parent

PRD: [../prd.md](../prd.md)

## What to build

Complete the public selected-message footer for Twitch and Kick. Reply, Copy, disabled Translate, internal View Channel, and the secondary external Platform link all operate from explicit dialog state and follow the approved close/focus behavior. No public action may infer a new target from live message arrival.

Reply must reuse the existing Chat Send Eligibility and send path. View Channel resolves the selected chatter's actual Channel inside StreamFusion; the external link remains independently available when internal resolution fails.

This covers the PRD stories for Guest-safe behavior, eligible and ineligible Reply, message copying, stable targets, Channel navigation, accessibility, and development parity.

## Acceptance criteria

- [x] The selected-message footer exposes Reply, Copy, disabled `Translate · Coming Soon`, View Channel, and a secondary external Platform link in the approved icon treatment.
- [x] Guest viewers do not see Reply.
- [x] Authenticated eligible viewers can choose Reply; the dialog closes and the composer receives the correct reply context and focus.
- [x] Authenticated ineligible viewers see Reply disabled with the exact reason from the shared Chat Send Eligibility source.
- [x] No eligibility rule or restriction copy is duplicated inside the dialog.
- [x] Copy writes only the selected message's visible content, converts emotes to their names, excludes timestamp/username metadata, keeps the dialog open, and confirms success.
- [x] Translate remains disabled and is clearly labelled `Coming Soon`; no translation request or message data leaves the app.
- [x] View Channel navigates to the selected chatter's resolved internal Channel and closes the dialog.
- [x] Failed internal Channel resolution disables View Channel with `Couldn’t verify · Retry` without blocking the rest of the dialog.
- [x] The external Twitch/Kick link remains available independently of internal Channel resolution and has an accessible name and tooltip.
- [x] When no message is selected, Reply and Copy are absent.
- [x] Live insertion, pruning, or badge updates never retarget any public action.
- [x] Keyboard tests cover the complete footer, disabled reasons, composer focus transfer, normal close focus restoration, and external-link labelling.
- [x] Twitch and Kick tests cover internal resolution success/failure, exact Reply context, and copied content.
- [x] Browser-development fixtures expose every action state, and Electron MCP proof verifies Reply focus, Copy persistence, and View Channel navigation.
- [x] Lint, type-check, relevant tests, React diagnostics, and production build pass.

## Blocked by

- [Slice 02 — Kick truthful profile and follow parity](02-kick-truthful-user-info.md)
- [Slice 03 — Live Recent Chat Messages and complete badge context](03-live-recent-chat-and-badges.md)

## Comments

- Implemented selected-message Reply, Copy, disabled Translate, internal View Channel, and independently available external Platform actions for Twitch and Kick.
- Added a composer-owned Chat Send Eligibility snapshot, including stale subscriber-check protection so late results cannot send into a different Channel.
- Relevant verification is green: 188 tests across six files, scoped Biome, diff whitespace check, and the production Electron build.
- React Doctor was run on the branch diff. Issue 04's render-time ref mutation and non-component export findings were fixed; its branch-wide score remains affected by unrelated parallel work.
- Global type-check exits on unrelated parallel branch files. Filtering that output against every Issue 04 source and test path reports zero matches.
- Browser proof: `.scratch/images/issue04-browser-public-actions.png`.
- Live Electron proof: `.scratch/images/issue04-electron-public-actions.png`. The live viewer was a guest, so Electron correctly hid Reply; authenticated Reply context and post-dialog composer focus are covered by the integration test and authenticated browser fixture rather than fake authentication. Electron directly verified Copy keeps the dialog open and View Channel closes it and navigates to `#/stream/twitch/bazyll1`.
