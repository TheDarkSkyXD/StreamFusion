# Subscriber-Only Preflight Blockers

Status: done
Type: AFK

## Parent

PRD: `../prd.md`

## What to build

Add subscriber-only Chat Send Eligibility preflight for both Twitch and Kick. Twitch should use the current user token and surface a reconnect blocker when required scopes are missing. Kick should use a robust tri-state subscription result: `subscribed`, `notSubscribed`, or `unknown`; unknown must not block the send attempt.

## Acceptance criteria

- [x] Twitch subscriber-only mode checks the viewer's subscription state before blocking.
- [x] Twitch tokens missing required preflight scopes produce a "Reconnect Twitch" blocker with an auth/reconnect action.
- [x] Kick subscriber-only mode checks viewer subscription state through a robust tri-state path.
- [x] Kick `notSubscribed` produces a subscriber-only blocker.
- [x] Kick `unknown` does not block and allows the send attempt to proceed.
- [x] Subscriber-only blockers use platform-like copy and platform-owned actions.
- [x] Known subscriber/broadcaster/mod/VIP bypasses avoid false pre-blocking when available.
- [x] Tests cover Twitch subscribed, unsubscribed, and missing-scope outcomes.
- [x] Tests cover Kick `subscribed`, `notSubscribed`, and `unknown` outcomes.

## Blocked by

- `01-auth-blocker-and-draft-editing-foundation.md`

## Comments

- 2026-06-22: Added subscriber eligibility IPC/service preflight. Twitch uses Helix subscription checks with missing-scope handling; Kick uses robust tri-state parsing and treats ambiguous web-session results as unknown so sends are not falsely blocked.
