# Auth Blocker And Draft-Editing Foundation

Status: done
Type: AFK

## Parent

PRD: `../prd.md`

## What to build

Build the first Chat Send Eligibility path through the composer: viewers can type drafts even when they are not authenticated, and attempting to send opens the correct platform auth flow instead of silently doing nothing. Add the above-input blocker surface and preserve the draft on blocked sends.

This slice establishes the eligibility/draft-editing separation that later restriction slices build on.

## Acceptance criteria

- [x] A signed-out Twitch viewer can type in the chat input.
- [x] A signed-out Kick viewer can type in the chat input.
- [x] Sending while signed out opens the matching Twitch or Kick auth flow.
- [x] Sending while signed out shows an above-input auth blocker using platform-like wording.
- [x] A blocked auth send does not clear the draft, emote slots, or reply state.
- [x] After a blocked auth send, focus returns to the chat input.
- [x] A successful send still clears the draft as before.
- [x] Tests cover draft retention, auth blocker rendering, and platform-specific auth action dispatch.

## Blocked by

None - can start immediately

## Comments

- 2026-06-22: Implemented auth-gated send behavior in the chat composer while keeping drafts editable for signed-out Twitch and Kick viewers. Added platform auth dispatch, above-input blocker messaging, draft/reply retention, focus restoration, and regression tests. Verified with targeted ChatInput tests, typecheck, lint, build, and the full desktop Vitest suite.
