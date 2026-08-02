# Kick Follow Button UX

Status: done

## Parent

`.scratch/grill-with-docs/2026-07-04-kick-follow-write/prd.md`

## What to build

Update the Kick Follow button/card behavior so authenticated Kick Follow and Unfollow actions run inside StreamFusion, show explicit pending and failed states, and avoid misleading optimistic confirmed state. Opening Kick should not be the normal follow/unfollow failure path.

## Acceptance criteria

- [ ] Signed-in Kick Follow clicks start the in-app Kick follow write flow instead of routing to Kick.
- [ ] Signed-in Kick Unfollow clicks start the in-app Kick unfollow write flow instead of routing to Kick.
- [ ] While a write is pending, the button shows a pending state rather than followed/unfollowed.
- [ ] Pending state includes a cancel affordance.
- [ ] Expired or failed pending state shows a Retry action.
- [ ] Retry starts a fresh in-app write attempt.
- [ ] The button returns to the last sync-confirmed state when a pending write is canceled.
- [ ] Tests cover follow pending, unfollow pending, cancel, failed Retry, and no optimistic confirmed state.

## Blocked by

- `.scratch/grill-with-docs/2026-07-04-kick-follow-write/issues/02-pending-kick-follow-write-state.md`

## Comments

- 2026-07-04: Updated FollowButton to run signed-in Kick follow/unfollow in-app, render pending cancel and failed retry states, and avoid optimistic confirmed follow rows while writes are pending.
- Verification: `npm test -- --run tests/components/ui/follow-button.test.tsx tests/store/follow-store.test.ts` passed (33 tests). `npm run typecheck` passed.
