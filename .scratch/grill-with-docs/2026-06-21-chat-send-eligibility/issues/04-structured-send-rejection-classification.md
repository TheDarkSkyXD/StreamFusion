# Structured Send Rejection Classification

Status: done
Type: AFK

## Parent

PRD: `../prd.md`

## What to build

Classify platform send failures into structured Chat Send Eligibility blockers instead of surfacing raw error strings in the composer. This should cover Twitch verified phone/email chat rejections after failed sends, Twitch/Kick restriction rejections, and non-eligibility errors that should remain normal send errors.

## Acceptance criteria

- [x] Twitch send failures can be mapped into typed eligibility blockers where the platform provides a recognizable restriction reason.
- [x] Twitch verified phone/email blockers are shown only after Twitch rejects a send.
- [x] Twitch verified blockers use specific phone/email wording when the rejection reason provides it.
- [x] Kick send failures preserve useful structured failure information instead of flattening everything to plain `Error(message)`.
- [x] Kick restriction rejections can produce typed eligibility blockers.
- [x] Non-eligibility failures still surface as normal send errors.
- [x] Typed blockers preserve the draft and focus the input.
- [x] Tests cover Twitch verified phone/email classification.
- [x] Tests cover Kick failure classification and non-eligibility passthrough.

## Blocked by

- `01-auth-blocker-and-draft-editing-foundation.md`

## Comments

- 2026-06-22: Added typed send rejection classification in ChatInput and a structured KickChatSendError wrapper. Twitch phone/email verification, Kick subscriber/follower/emote restrictions, Kick retry-after, and normal error passthrough now have targeted regression tests.
