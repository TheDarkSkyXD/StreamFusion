# PRD: Kick Account Follow Writes

## Problem Statement

StreamFusion currently syncs Kick account follows into the app, but signed-in Kick Follow clicks do not create a real Kick account Follow. Users expect an authenticated Kick Follow/Unfollow action inside StreamFusion to update their Kick account, not create a local-only state or require opening Kick manually.

## Solution

Add signed-in Kick account follow/unfollow writes inside StreamFusion. The implementation should use a transport seam that prefers an official Kick API if one becomes available; today, because Kick's official Public API does not expose viewer follow/unfollow writes, the implementation should use the authenticated Kick web session against Kick's internal follow/unfollow surface.

After each write attempt, run Kick follow sync. Sync result is the source of truth:

- Follow is confirmed only when the channel appears in synced Kick follows.
- Unfollow is confirmed only when the channel disappears from synced Kick follows.

No UI or storage path should create a fake confirmed `source="kick"` row before sync confirms it.

## User Stories

- As a signed-in Kick user, when I click Follow on a Kick channel in StreamFusion, the app attempts a real Kick account follow from inside the app.
- As a signed-in Kick user, when I click Unfollow on a Kick account follow in StreamFusion, the app attempts a real Kick account unfollow from inside the app.
- As a user, while the write is unconfirmed, I see a pending state rather than a misleading followed/unfollowed state.
- As a user, if a pending write cannot be confirmed, StreamFusion retries automatically for a bounded window.
- As a user, if retry expires, I see a failed state with a Retry action.
- As a user, I can cancel a pending follow/unfollow write before it confirms or fails.
- As a user, if my Kick session expires during retry, the pending write pauses and asks me to reconnect Kick.

## Implementation Decisions

- Scope applies only to authenticated Kick account follows. Guest follows remain local-only.
- Implement in-app follow and unfollow together for symmetry.
- Use a transport seam: official API if available; current implementation uses authenticated Kick web-session v2 write.
- Retry pending writes for up to 10 minutes with backoff.
- Persist pending writes across app restart. Resume on startup when still within the retry window and Kick is connected; otherwise show failed Retry state.
- Opposite actions do not replace pending writes automatically. User must cancel first, returning to the last sync-confirmed state.
- Pending follows do not appear in the Following sidebar/page before sync confirms.
- Pending follows do not trigger live notifications before sync confirms.
- Retry-exhausted fallback stays inside StreamFusion. Opening Kick is not the normal failure path.

## Testing Decisions

- Unit-test the pending-write state machine: pending, confirmed, failed, canceled, paused-for-auth, startup resume.
- Unit-test storage/DB behavior so unconfirmed writes never create confirmed `source="kick"` rows.
- Unit-test FollowButton/Card behavior for pending, failed Retry, cancel, and confirmed states.
- Integration-test Kick write handler with mocked web-session transport and sync-confirm outcomes.
- Electron MCP verify the live app: signed-in Kick Follow and Unfollow both update through in-app flow and only render confirmed state after sync.

## Out of Scope

- Guest follows writing to Kick.
- Twitch follow/unfollow write behavior changes.
- Treating HTTP write success as final confirmation.
- Showing pending follows in Following/sidebar.
- Live notifications for pending follows.

## Further Notes

- ADR: `docs/adr/0007-kick-follow-writes-use-web-session.md`.
- Grill notes: `.scratch/grill-with-docs/2026-07-04-kick-follow-write/notes.md`.
