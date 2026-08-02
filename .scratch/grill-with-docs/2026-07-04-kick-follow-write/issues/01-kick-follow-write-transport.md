# Kick Follow Write Transport

Status: done

## Parent

`.scratch/grill-with-docs/2026-07-04-kick-follow-write/prd.md`

## What to build

Create the account-write path for authenticated Kick Follow and Unfollow actions. The behavior should live behind an explicit transport seam that can prefer an official Kick API if one becomes available, while the current implementation uses the authenticated Kick web session against Kick's internal follow/unfollow surface. After a write attempt, run Kick follow sync and treat sync as the only source of truth for confirmed account state.

## Acceptance criteria

- [ ] Authenticated Kick Follow attempts perform an in-app Kick account write through the transport seam.
- [ ] Authenticated Kick Unfollow attempts perform an in-app Kick account write through the same transport seam.
- [ ] HTTP write success alone never creates or exposes a confirmed `source="kick"` Follow.
- [ ] Follow is confirmed only when follow sync returns the channel in the Kick account Follow list.
- [ ] Unfollow is confirmed only when follow sync no longer returns the channel in the Kick account Follow list.
- [ ] Guest follows remain local-only and do not use the Kick account write transport.
- [ ] Tests cover successful write + confirmed sync, write success + unconfirmed sync, write failure, and guest follow isolation.

## Blocked by

None - can start immediately

## Comments

- 2026-07-04: Implemented authenticated Kick follow/unfollow account writes through the Kick web-session mutation seam. `FOLLOWS_ADD` / `FOLLOWS_REMOVE` now run follow sync after write and only expose confirmed `source="kick"` state from sync.
- Verification: `npm test -- --run tests/backend/ipc/handlers/storage-handlers.test.ts tests/backend/api/platforms/kick/follow-endpoints.test.ts tests/backend/api/platforms/kick/kick-send-window.test.ts` passed (80 tests). `npm run typecheck` passed.
