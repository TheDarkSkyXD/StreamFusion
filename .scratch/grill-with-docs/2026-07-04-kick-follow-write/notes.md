# Kick Follow Write: Grilling Session Notes
Date: 2026-07-04 · Goal: Decide whether and how StreamFusion should create real Kick account follows from in-app Follow clicks.

## PRD

- `.scratch/grill-with-docs/2026-07-04-kick-follow-write/prd.md`

## Summary / key decisions

- Signed-in Kick Follow clicks should attempt to create a real Kick account Follow through the authenticated Kick web session, then run follow sync and only show the channel as followed if Kick confirms it.
- If the Kick follow attempt fails or sync cannot confirm the Follow, the app should auto-retry instead of immediately giving up.
- Signed-in Kick Unfollow should also happen in-app, using the same real Kick account write + sync-confirm model.
- Failed or unconfirmed Kick follow/unfollow writes should become pending writes with bounded background retry.
- While a Kick follow/unfollow write is pending retry, the button should show a pending state rather than the requested final state.
- Bounded retry should run for up to 10 minutes with backoff, but the exhausted fallback should stay inside StreamFusion rather than requiring the user to open Kick.
- When bounded retry expires, the button should show a failed state with a Retry action.
- Users should be able to cancel a pending Kick follow/unfollow write before it confirms or fails.
- Opposite actions should not replace pending writes automatically; users cancel first, returning to the last sync-confirmed state.
- If Kick auth/session expires during a pending write, retry pauses and the UI shows "Reconnect Kick"; after reconnect, retry/sync-confirm resumes.
- Kick follow/unfollow writes should live behind a transport seam that can prefer an official API if Kick adds one; current implementation uses the authenticated web-session v2 write.
- Kick follow sync is the source of truth for confirming follow/unfollow writes.
- Pending Kick follow/unfollow writes should persist across app restarts and resume on startup when still within the retry window.
- Pending Kick follows should not appear in Following sidebar/page before sync confirms them.
- Pending Kick follows should not trigger live notifications before sync confirms them.

## Q&A log

### Q1 — Signed-in Kick Follow click contract
- Asked: What should a signed-in Kick "Follow" click mean?
- Captured: Chose option 1: attempt a real Kick account follow, then sync-confirm before showing followed. The app must not create fake `source="kick"` rows; the followed state is only adopted after Kick confirms via sync.
- Doc updates: none yet.
- Flags: exact failure UI/pending behavior still unresolved.

### Q2 — Follow failure behavior
- Asked: If the Kick web-session follow attempt fails or sync does not confirm the channel, what should the UI do?
- Captured: Initially chose option 1, then revised: there should be auto-retry. The app should not create a confirmed `source="kick"` row until sync confirms the Follow, but failure should not immediately be terminal.
- Doc updates: none yet.
- Flags: exact retry limits, pending UI, and whether to implement authed Kick unfollow in-app still unresolved.

### Q3 — Signed-in Kick Unfollow behavior
- Asked: Should signed-in Kick "Unfollow" also happen in-app, or stay as "manage on Kick"?
- Captured: Chose option 1 and reaffirmed: implement in-app follow and in-app unfollow together. Both should be real Kick account writes and should reconcile through sync rather than local-only state. Rationale: symmetric behavior is worth accepting the larger, more brittle Kick web-session write surface.
- Doc updates: none yet.
- Flags: exact retry limits and pending UI still unresolved.

### Q2b — Auto-retry model
- Asked: What kind of auto-retry should Kick follow/unfollow writes use?
- Captured: Chose option 1: pending write with bounded retry. Store a pending follow/unfollow write, retry in background for a limited window, and only mark the final state after sync confirms Kick accepted it.
- Doc updates: none yet.
- Flags: pending UI and retry bounds still unresolved.

### Q4 — Pending UI state
- Asked: While a Kick follow/unfollow write is pending retry, what should the button show?
- Captured: Chose option 1: show pending state, not followed/unfollowed. The app should not pretend the account state changed until sync confirms it.
- Doc updates: none yet.
- Flags: retry bounds still unresolved.

### Q5 — Retry bounds
- Asked: What should "bounded retry" mean?
- Captured: Chose option 1: retry for up to 10 minutes with backoff. User clarified they do not want failure to require opening Kick; StreamFusion should do follow/unfollow from inside the app and sync to Kick. Official Kick Public API docs/OpenAPI do not expose a documented follow/unfollow endpoint, so the feasible in-app path is a hidden authenticated kick.com web-session write against the internal v2 follow endpoint, then sync-confirm.
- Doc updates: none yet.
- Flags: retry-exhausted UI still unresolved; exact write transport validation still needed.

### Q6 — Retry-exhausted UI
- Asked: When the 10-minute retry expires, what should the button show?
- Captured: Chose option 1: failed state with "Retry". Clicking Retry starts a fresh in-app write attempt; opening Kick should not be the normal failure path.
- Doc updates: ADR 0007 created for using the authenticated Kick web session rather than a documented Public API.
- Flags: exact write transport validation still needed.

### Q7 — Cancel pending writes
- Asked: Should users be able to cancel a pending Kick follow/unfollow write?
- Captured: Chose option 1: allow cancel while pending. Pending state should include a cancel affordance so a user can stop a queued account change before it confirms or exhausts retry.
- Doc updates: none.
- Flags: opposite-action behavior while pending still unresolved; exact write transport validation still needed.

### Q8 — Opposite action while pending
- Asked: If a Kick follow/unfollow write is pending and the user changes their mind, should the opposite action replace it?
- Captured: Chose option 1: cancel first; no automatic opposite write. Canceling a pending write returns to the last sync-confirmed state, then the user can start a new action if needed.
- Doc updates: none.
- Flags: auth/session expiration behavior and exact write transport validation still unresolved.

### Q9 — Auth/session expiration while pending
- Asked: If Kick auth/session expires during a pending follow/unfollow retry, what should happen?
- Captured: Chose option 1: pause the pending write and show "Reconnect Kick". Do not keep retrying until auth is restored; after reconnect, resume retry/sync-confirm.
- Doc updates: none.
- Flags: exact write transport validation still needed.

### Q10 — Continue grilling
- Asked: Are we done grilling and should I turn this into a PRD now?
- Captured: Chose option 2: ask more questions first.
- Doc updates: none.
- Flags: exact write transport validation still needed.

### Q11 — Write transport strategy
- Asked: What transport strategy should implementation use for Kick follow/unfollow writes?
- Captured: Chose option 1: prefer official API if Kick adds one; otherwise use hidden web-session v2 write. Code should make the transport seam explicit. Current implementation should use `kick.com/api/v2/channels/{slug}/follow` through the authenticated Kick web session because no official viewer follow/unfollow endpoint exists today.
- Doc updates: none.
- Flags: exact confirmation evidence still unresolved.

### Q12 — Confirmation evidence
- Asked: What evidence should count as "Kick confirmed the follow/unfollow"?
- Captured: Chose option 1: follow sync result is the source of truth. After write, run Kick follow sync. Follow is confirmed only if the channel appears in synced Kick follows; unfollow is confirmed only if it disappears.
- Doc updates: none.
- Flags: startup behavior for persisted pending writes still unresolved.

### Q13 — Startup resume
- Asked: If the app closes while a Kick follow/unfollow write is pending, what should happen on next startup?
- Captured: Chose option 1: resume pending writes on startup. If still within the 10-minute retry window and Kick is connected, resume retry/sync-confirm. If expired, show failed Retry state.
- Doc updates: none.
- Flags: pending visibility outside the channel button still unresolved.

### Q14 — Pending visibility in Following
- Asked: Should pending Kick follow writes appear in the Following sidebar/page before sync confirms?
- Captured: Chose option 2: no, only confirmed follows appear in Following. This keeps Following as sync-confirmed truth; pending state appears only on the channel button/card.
- Doc updates: none.
- Flags: notification behavior for pending writes still unresolved.

### Q15 — Pending notification behavior
- Asked: Should pending Kick follows trigger live notifications before sync confirms?
- Captured: Chose option 2: no, only confirmed follows trigger notifications. Pending follows do not affect live notifications until sync confirms them.
- Doc updates: none.
- Flags: none.

## Open flags (pending input)

- None.
