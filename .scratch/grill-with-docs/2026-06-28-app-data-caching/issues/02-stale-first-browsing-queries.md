Status: done
Type: AFK

## Parent

`.scratch/grill-with-docs/2026-06-28-app-data-caching/prd.md`

## What to build

Apply the named cache policy tiers to browsing queries so the followed sidebar, Following page, search results, category surfaces, and multiview-adjacent stream metadata can paint cached data first and refresh in the background.

Keep route/page data fetching in React Query hooks. Do not persist remote browse snapshots to disk as part of this slice.

## Acceptance criteria

- [ ] Browsing queries use the named cache policy tiers instead of ad hoc raw timings where practical.
- [ ] Cached previous data remains visible while background refetches run for target browsing surfaces.
- [ ] Search and category queries keep their stale-first behavior without adding polling where it is not needed.
- [ ] Followed/live stream queries continue to refresh while visible on the policy cadence.
- [ ] Multiview-adjacent metadata uses cache behavior that avoids unnecessary reloads when switching layouts or returning to streams.
- [ ] Remote browsing data remains memory-only for this slice.

## Blocked by

- `.scratch/grill-with-docs/2026-06-28-app-data-caching/issues/01-cache-policy-tiers.md`

## Comments

Closed on 2026-06-28.

Applied named cache policies to streams, infinite streams, search, categories, followed channels, followed videos/clips, CategoryDetail category matching, and StreamCard hover prefetches. Search/category reference data stays stale-first without unnecessary polling; followed/live stream status keeps the visible refresh cadence.

Manual desktop verification screenshots:

- `.scratch/grill-with-docs/2026-06-28-app-data-caching/electron-following-cache-verification.png`
- `.scratch/grill-with-docs/2026-06-28-app-data-caching/electron-search-cache-verification.png`
- `.scratch/grill-with-docs/2026-06-28-app-data-caching/electron-categories-cache-verification.png`
- `.scratch/grill-with-docs/2026-06-28-app-data-caching/electron-category-detail-cache-verification.png`
- `.scratch/grill-with-docs/2026-06-28-app-data-caching/electron-multistream-cache-verification.png`

Verification: targeted cache/follow tests, full `npm test --workspace=streamfusion` (334 files, 4174 tests), typecheck, lint, and build passed.
