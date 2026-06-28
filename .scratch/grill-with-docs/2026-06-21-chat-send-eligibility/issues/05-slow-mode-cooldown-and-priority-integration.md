# Slow Mode Cooldown And Priority Integration

Status: done
Type: AFK

## Parent

PRD: `../prd.md`

## What to build

Add slow-mode Chat Send Eligibility behavior and integrate the final blocker priority order across all blocker types. Slow mode should display from room state, locally track this viewer's cooldown after successful sends when the interval is known, and accept server rejections as the correction source when local cooldown state is missing or wrong.

## Acceptance criteria

- [x] Slow mode displays the configured interval when active.
- [x] After a successful send in slow mode, the composer locally tracks this viewer's cooldown.
- [x] Attempting to send during local cooldown shows a slow-mode blocker with remaining time.
- [x] Server slow-mode rejection can update or correct the local blocker.
- [x] Slow mode does not displace higher-priority blockers.
- [x] Final blocker priority is auth, Twitch verification, follower-only, subscriber-only, emote-only, then slow mode.
- [x] Blocked slow-mode sends preserve the draft, emote slots, and reply state.
- [x] Tests cover local cooldown after successful send.
- [x] Tests cover final priority across all blocker types.

## Blocked by

- `01-auth-blocker-and-draft-editing-foundation.md`
- `04-structured-send-rejection-classification.md`

## Comments

- 2026-06-22: Added local slow-mode cooldown tracking after successful sends and retry-after correction for structured Kick send failures. Slow mode is checked after auth/follower/subscriber/emote blockers and covered by focused ChatInput tests.
