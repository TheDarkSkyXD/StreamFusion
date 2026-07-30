# Slice 03 — Live Recent Chat Messages and complete badge context

Status: done

## Parent

PRD: [../prd.md](../prd.md)

## What to build

Replace the dialog's raw message snippets with a complete, live `Recent Chat Messages` experience for the current Channel and current live-chat session. The list contains up to 10 messages authored by the selected chatter plus replies addressed to that chatter, always preserving each row's true author and the normal rich chat presentation.

The clicked message begins selected. The selected identity is independent of the capped live collection and remains pinned in the selected-message footer until the viewer explicitly chooses another message. Live insertion may automatically scroll to the new matching entry, but it must never retarget actions or selection.

Complete badge context in the same slice: each message row shows at most four badges, while the header's dedicated `Badges` section shows the complete set from the selected chatter's newest authored message in one horizontally scrollable row. Tooltips expose the full badge name and Platform/source.

This covers the PRD stories for rich conversation context, true authorship, stable action targeting, badges, accessibility, and development parity.

## Acceptance criteria

- [x] The section is labelled `Recent in this chat` and reads only the canonical current-Channel message bucket.
- [x] Membership includes messages authored by the selected chatter and replies addressed to them; every row visibly retains its true author.
- [x] Up to 10 entries use the normal rich renderer for timestamps, emotes, links, reply context, name treatment, and deleted-message preference.
- [x] A verified empty collection keeps the section visible with `No recent messages in this chat`.
- [x] The message that opened the dialog begins selected, and selecting another row deliberately changes the selected-message footer target.
- [x] The selected message remains pinned when new entries prune it from the visible 10-message collection.
- [x] Matching messages update live and automatically scroll into view; reduced-motion preference disables animated movement.
- [x] Live insertion and pruning never change the selected message or the target IDs exposed to Reply, Copy, or Delete.
- [x] Each Recent Chat Message row renders no more than four badges.
- [x] The header Badges section derives its complete set only from the selected chatter's newest authored message, never by unioning older messages or using another author's reply.
- [x] The Badges section uses one horizontal scrolling row and remains visible in loading, verified-empty, and failure states.
- [x] Verified empty copy is `No badges on the latest message`; failure has a distinct Retry state.
- [x] Hovering or keyboard-focusing a badge announces its full name and Platform/source without duplicating screen-reader output.
- [x] Store/selector tests cover reply membership, true authorship, Channel isolation, live pruning, stable selection, deleted rows, and badge-source selection.
- [x] Renderer tests cover rich content, badge caps, empty/failure states, reduced motion, and keyboard selection.
- [x] The same behavior is available in browser development fixtures and is proven in the running Electron app with Electron MCP.
- [x] Lint, type-check, relevant tests, React diagnostics, and production build pass.

## Blocked by

- [Slice 01 — Twitch identity-first dialog and truthful profile data](01-twitch-truthful-user-info.md)

Slice 02 can proceed in parallel.

## Comments

- Implemented canonical current-Channel recent-message selection, rich reply/deleted rows, stable exact-message targeting, complete newest-authored badge context, and live platform badge rehydration.
- Browser Storybook proof confirmed complete header badges, rich reply/deleted rows, the four-badge row cap, and deliberate selection. Electron proof is completed through the parent issue workflow.
- Verification: 13 focused/adjacent test files and 300 tests pass; the Issue 03 Biome/diff/production-build gate is clean. React Doctor completed against the shared changed branch and reported no Issue 03 correctness error.
