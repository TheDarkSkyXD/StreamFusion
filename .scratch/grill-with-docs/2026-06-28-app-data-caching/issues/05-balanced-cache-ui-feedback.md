Status: done
Type: AFK

## Parent

`.scratch/grill-with-docs/2026-06-28-app-data-caching/prd.md`

## What to build

Balance cache-related UI feedback so the app feels fast and calm. Routine background refresh should not show constant indicators. Refresh failure, PlatformHealth degraded/down state, and states that materially affect user trust may use subtle visible feedback.

The intent is quiet stale-first behavior, not a noisy cache-status UI.

## Acceptance criteria

- [ ] Routine background refresh does not show persistent or constantly repeating refresh indicators.
- [ ] Manual refresh gives short, localized feedback where the user initiated the action.
- [ ] Refresh failure surfaces a subtle retry or last-updated style state where useful.
- [ ] PlatformHealth degraded/down states remain visible enough to explain stale-success behavior.
- [ ] Follow/unfollow and auth-sensitive actions still show appropriate pending/success/error feedback.
- [ ] Manual desktop verification confirms cache feedback is not noisy on sidebar, Following, Search, CategoryDetail, MultiStream, and History surfaces.

## Blocked by

- `.scratch/grill-with-docs/2026-06-28-app-data-caching/issues/02-stale-first-browsing-queries.md`
- `.scratch/grill-with-docs/2026-06-28-app-data-caching/issues/03-event-based-cache-invalidation.md`

## Comments

Closed on 2026-06-28.

Routine background refresh remains quiet. Following has a small localized manual refresh button that only spins after a user click, and failed manual refreshes leave a subtle retry/failure affordance on that button. PlatformHealth stale/degraded visibility remains in existing stream-card staleness UI, and follow/unfollow actions show pending and scoped failure feedback.

Manual desktop verification observed no noisy refresh/cache copy on Following, Search, Categories, CategoryDetail, MultiView, or History. Evidence screenshots are saved under `.scratch/grill-with-docs/2026-06-28-app-data-caching/`.
