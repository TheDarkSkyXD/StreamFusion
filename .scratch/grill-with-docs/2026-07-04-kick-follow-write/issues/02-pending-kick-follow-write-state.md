# Pending Kick Follow Write State

Status: done

## Parent

`.scratch/grill-with-docs/2026-07-04-kick-follow-write/prd.md`

## What to build

Add the pending-write state machine for authenticated Kick follow/unfollow writes. Unconfirmed writes should persist, retry with bounded backoff for up to 10 minutes, survive app restart, support cancel, pause when Kick auth/session is unavailable, and move to a failed Retry state when the retry window expires.

## Acceptance criteria

- [ ] Unconfirmed Kick follow/unfollow writes are stored as pending writes, not confirmed Follows.
- [ ] Pending writes retry with backoff until confirmed, canceled, paused for auth, or expired.
- [ ] Retry expires after 10 minutes and records a failed state that can be retried by the user.
- [ ] Pending writes can be canceled before confirmation or expiry; cancel returns the channel to the last sync-confirmed state.
- [ ] Opposite actions do not replace pending writes automatically; the user must cancel first.
- [ ] Pending writes resume on app startup when still within the retry window and Kick is connected.
- [ ] Pending writes pause and surface a reconnect-required state when Kick auth/session is unavailable.
- [ ] Tests cover pending, confirmed, canceled, failed, retry, auth-paused, and startup-resume transitions.

## Blocked by

- `.scratch/grill-with-docs/2026-07-04-kick-follow-write/issues/01-kick-follow-write-transport.md`

## Comments

- 2026-07-04: Added pending Kick follow write state-machine persistence, retry/backoff scheduling, auth-paused and failed states, cancel/retry IPC, and startup resume scheduling.
- Verification: `npm test -- --run tests/backend/services/kick-follow-write-service.test.ts tests/backend/services/database-service.test.ts tests/backend/ipc/handlers/storage-handlers.test.ts tests/store/follow-store.test.ts` passed (77 tests). `npm test -- --run tests/store/auth-store.test.ts` passed (19 tests). `npm run typecheck` passed.
