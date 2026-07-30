# Slice 05 — Permission-gated Moderation history and one-flow reconnect

Status: done

## Parent

PRD: [../prd.md](../prd.md)

## What to build

Deliver the complete read-only moderator path for Twitch and Kick. Resolve the authenticated viewer's authority in the current Channel and fail closed while it is loading, stale, missing, or unverifiable. Guests and ordinary viewers see no moderation UI or history. Confirmed moderators/broadcasters see the qualified Moderation history surface; confirmed authority with insufficient scopes sees one locked reconnect flow.

Reconnect requests every currently missing canonical StreamFusion scope in one Platform consent operation. The dialog remains open and locked while reconnect is pending, refreshes affected authority/data after success, and returns to its prior state with Retry after cancellation or failure.

Moderation history remains Platform-originated operational data persisted for display, not a claimed complete Platform archive. Query failures and incomplete authorization must never collapse into verified empty.

This covers the PRD stories for permission-safe moderation visibility, one-flow reconnect, truthful available history, accessibility, and development parity.

## Acceptance criteria

- [x] Current-Channel broadcaster/moderator authority is resolved through Platform-backed data and represented separately from profile badge cosmetics.
- [x] Guests and ordinary viewers never see the Moderation section, its tools, or Moderation history.
- [x] While authority is loading or unknown, the Moderation section remains hidden and late resolution never steals focus.
- [x] Stale or unverifiable authority/current moderation state fails closed with `Couldn’t verify · Retry` and no active mutation controls.
- [x] A positively confirmed moderator/broadcaster missing required scopes sees a locked `Reconnect <Platform>` state with an explanation of the added permissions.
- [x] Reconnect requests every missing canonical StreamFusion scope in one flow rather than prompting action by action.
- [x] Reconnect keeps the dialog open but locked, announces progress accessibly, blocks dismissal while submitted, and prevents duplicate reconnect attempts.
- [x] Reconnect success revalidates the granted token, authority, and affected queries in place; cancellation/failure restores prior state and offers Retry.
- [x] Authorized viewers see `Moderation history`, the qualifier `Platform actions available to StreamFusion`, and at most the five newest available records.
- [x] Each record shows action, date, acting moderator, and supported duration/reason details.
- [x] Verified empty copy is `No moderation actions available`; fetch failure is `Couldn’t load · Retry`.
- [x] Missing authorization, partial coverage, or query failure never appears as verified empty.
- [x] `View all in Mod Dashboard` opens the existing Channel-scoped dashboard destination.
- [x] Platform event/API provenance remains intact and local persistence is treated only as the display/history store.
- [x] Tests cover Guest, ordinary viewer, confirmed broadcaster, confirmed moderator, missing scopes, canceled reconnect, failed reconnect, success refresh, empty history, partial coverage, and query failure for both Platforms.
- [x] Browser-development fixtures and Electron MCP proof demonstrate hidden, reconnect-required, authorized-history, empty, and failure states.
- [x] Lint, type-check, relevant tests, React diagnostics, and production build pass.

## Blocked by

- [Slice 01 — Twitch identity-first dialog and truthful profile data](01-twitch-truthful-user-info.md)
- [Slice 02 — Kick truthful profile and follow parity](02-kick-truthful-user-info.md)

## Comments

- Completed 2026-07-29 with fail-closed live Twitch/Kick credential validation, canonical Kick Channel identity binding, retry-safe reconnect revalidation, expiring authority proofs, qualified local history provenance, and development-only state fixtures.
- Verification: 20 focused files / 250 tests passed; Biome, scoped TypeScript, production build, and touched-file React diagnostics passed.
- The shared worktree still has unrelated repository-wide TypeScript and React Doctor findings; no reported diagnostic matched this issue's touched files.
- Browser and Electron MCP artifacts under `.scratch/images/issue05-*` prove authorized, verified-empty, partial, failure, reconnect-required, and hidden states.
