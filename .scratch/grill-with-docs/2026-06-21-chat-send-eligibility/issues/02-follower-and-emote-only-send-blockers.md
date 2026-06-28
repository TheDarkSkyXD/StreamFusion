# Follower And Emote-Only Send Blockers

Status: done
Type: AFK

## Parent

PRD: `../prd.md`

## What to build

Add Chat Send Eligibility handling for follower-only and emote-only chat modes using the existing room-state store. The composer should block sends with a single above-input blocker when room state says the current viewer cannot send, while preserving the draft and using known role bypasses to avoid false blocks.

## Acceptance criteria

- [x] Follower-only room state can produce a send blocker above the input.
- [x] Emote-only room state can produce a send blocker above the input for non-emote messages.
- [x] The blocker action for follower-only opens the platform-owned channel page.
- [x] Known bypass roles do not get pre-blocked for follower-only or emote-only when the app knows they can bypass the mode.
- [x] Unknown role state does not create an extra false-block condition beyond the known room-state blocker.
- [x] Blocked sends preserve the draft, emote slots, and reply state.
- [x] Tests cover blocker priority between follower-only and emote-only.
- [x] Tests cover role-bypass behavior.

## Blocked by

- `01-auth-blocker-and-draft-editing-foundation.md`

## Comments

- 2026-06-22: Implemented follower-only and emote-only send blockers in ChatInput using room state, follow-store state, and known room-mode bypass roles. Added tests for follower action routing, draft/reply/emote preservation, follower-store bypass, priority, and role bypass.
