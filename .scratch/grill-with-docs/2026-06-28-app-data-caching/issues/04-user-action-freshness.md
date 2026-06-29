Status: done
Type: AFK

## Parent

`.scratch/grill-with-docs/2026-06-28-app-data-caching/prd.md`

## What to build

Preserve freshness guarantees for user actions and account-sensitive state while browsing surfaces paint stale-first. Follow/unfollow, auth-sensitive status, and destructive or account-changing actions must not be finalized from stale cache alone.

This slice should make the boundary clear between cached browsing data and confirmed action state.

## Acceptance criteria

- [ ] Follow/unfollow UI can show pending state but final success/error is based on the action result or confirmed refreshed state.
- [ ] Auth-sensitive status is refreshed or confirmed before being treated as final after account changes.
- [ ] Stale browsing cache does not cause follow buttons to settle into the wrong final state.
- [ ] Action failures keep or restore a trustworthy visible state.
- [ ] Tests cover at least one stale-cache follow/unfollow scenario.
- [ ] The implementation does not disable stale-first browsing data for non-action surfaces.

## Blocked by

- `.scratch/grill-with-docs/2026-06-28-app-data-caching/issues/02-stale-first-browsing-queries.md`
- `.scratch/grill-with-docs/2026-06-28-app-data-caching/issues/03-event-based-cache-invalidation.md`

## Comments

Closed on 2026-06-28.

Follow/unfollow now returns an in-flight mutation promise so the UI can keep action state pending until the backend confirms. Backend failures restore trustworthy state and reject to the FollowButton, which shows an action-scoped error toast instead of finalizing from stale cache.

Verification: `follow-store.test.ts` covers the stale-cache/action promise path and backend rejection rollback. Targeted tests, typecheck, lint, build, and full tests passed.
