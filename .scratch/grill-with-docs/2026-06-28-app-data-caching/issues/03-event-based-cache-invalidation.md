Status: done
Type: AFK

## Parent

`.scratch/grill-with-docs/2026-06-28-app-data-caching/prd.md`

## What to build

Wire targeted event-based cache invalidation so meaningful app events update or clear affected cache families without wiping unrelated data. Events include auth login/logout, account switch, auth loss, follow/unfollow, platform health recovery, and manual refresh.

The implementation should prefer invalidating affected query keys or updating known query data over clearing every cache.

## Acceptance criteria

- [ ] Auth login/logout and account switch invalidate or remove affected followed-channel and followed-stream cache families.
- [ ] Follow/unfollow updates or invalidates affected follow, followed-channel, and followed-stream cache families.
- [ ] PlatformHealth recovery can trigger refresh of stale-success browsing data without clearing unrelated caches.
- [ ] Manual refresh exists where appropriate and targets the relevant surface's query families.
- [ ] Unrelated search/category/history/local-state caches are not cleared by follow/auth events unless directly affected.
- [ ] Tests cover at least the auth and follow/unfollow invalidation paths.

## Blocked by

- `.scratch/grill-with-docs/2026-06-28-app-data-caching/issues/01-cache-policy-tiers.md`

## Comments

Closed on 2026-06-28.

Added `cache-invalidation.ts` helpers for follow mutations, platform account cache removal, and platform recovery refresh. Wired them into auth session loss/logout/follow sync, follow/unfollow/upgrade mutations, stale Kick follow repair, manual Following refresh, and PlatformHealth recovery.

Tests cover follow mutation invalidation, auth-loss removal, and recovery refresh without touching unrelated search caches. Verification: targeted cache/follow tests and full test suite passed.
