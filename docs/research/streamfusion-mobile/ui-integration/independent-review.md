# Mobile UI independent review

Scope: `8ec1636eda26a4c21d2bab593c7b98ad99df8ab6..e97d9e6`, including the now-clean worktree, read-only. Root `AGENTS.md` and `apps/mobile/CONTEXT.md` read first.

## Actionable finding (resolved in later dirty integration)

- **P2 — Twitch moderation history retention control was unreachable at `e97d9e6`.** `apps/mobile/src/features/moderation/components/mod-workspace-home.tsx:233-236` removed the `retention` row for Twitch. `apps/mobile/src/features/moderation/components/provider-tool-sheet.tsx:663-685` renders the only retention input and `setRetention` action when `tool === "retention"`. The later dirty integration exposes Retention for Twitch, resolving this finding pending final verification.

## Additional integration observations

- A later dirty shell callback initially retained `scopeReturn` after returning from Accounts, which would redirect every subsequent visit to Accounts back to Moderation. The current dirty version clears it before dispatch; verify this remains in the final commit.
- `eventsub-feed.ts:67-82` includes broadcaster subscription and cheer events only if the token already holds `channel:read:subscriptions` or `bits:read`. Neither is in `mobile-twitch-scopes.ts`'s allowlist, and Activity requests only follower scope. Newly connected broadcaster accounts therefore cannot opt into those optional events through the current scope flow. If the Activity Feed promises these events, add a scope request or state the coverage limit.

## Decision trail evidence

- `docs/research/streamfusion-mobile/ui-integration/decisions.tsv` contains six rows. Both screenshot artifact paths resolve. The architecture row points to `README.md`, which repeats the cross-judge selection but does not link the independent review output. The emulator-shutdown row contains a command as evidence without a captured result. Add resolving evidence pointers and a verification checkpoint for the current implementation.
- `runtime-ledger.json` remains an initial ownership/status map; its README explicitly says it is not runtime or pixel-parity verification. It should not be cited as acceptance evidence.

## Other checks

- Reviewed provider request/authorization, EventSub subscriptions and socket lifecycle, local log, player tools async fences, media persistence and native Keep validation, shell route dispatch, and production fixture guards. No other high-confidence defect found in those paths.
- `git diff --check 8ec1636eda26a4c21d2bab593c7b98ad99df8ab6` passed. No new suppression comment found in the changed production paths.
