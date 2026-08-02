# Confirmed-Only Follow Consumers

Status: done

## Parent

`.scratch/grill-with-docs/2026-07-04-kick-follow-write/prd.md`

## What to build

Keep app consumers aligned with the sync-confirmed Follow model. Pending Kick follows should not appear in the Following sidebar/page and should not trigger live notifications until Kick follow sync confirms them.

## Acceptance criteria

- [x] Pending Kick follow writes do not appear in the Following sidebar.
- [x] Pending Kick follow writes do not appear in the Following page.
- [x] Pending Kick follow writes do not affect followed-stream browsing.
- [x] Pending Kick follow writes do not trigger live notifications.
- [x] Confirmed Kick follows continue to appear in Following and drive live notifications.
- [x] Pending Kick unfollow writes do not prematurely remove a confirmed Follow from consumers until sync confirms removal, except where the dedicated pending button state is shown.
- [x] Tests cover Following/sidebar exclusion and live notification exclusion for pending follows.

## Blocked by

- `.scratch/grill-with-docs/2026-07-04-kick-follow-write/issues/02-pending-kick-follow-write-state.md`

## Comments

- Implemented by keeping pending Kick follow writes in `pendingWrites` rather than `localFollows`; sidebar/page/followed-stream consumers continue to read only confirmed follow rows. Live notification candidate selection remains backed by active/guest follows and explicitly ignores pending writes.
- Verification: `npm test -- --run tests/backend/services/live-notification-service.test.ts tests/store/follow-store.test.ts` passed with 45 tests.
