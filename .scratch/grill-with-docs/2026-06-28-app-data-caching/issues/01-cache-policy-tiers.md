Status: done
Type: AFK

## Parent

`.scratch/grill-with-docs/2026-06-28-app-data-caching/prd.md`

## What to build

Define named app-data cache policy tiers for StreamFusion browsing and local-state surfaces. The goal is to turn the existing scattered cache timings into a reusable policy that future query hooks can share without introducing one global cache.

The policy should distinguish live/followed stream status, stream/channel detail, followed channel lists, following videos/clips, search, categories, and local/user-owned state such as history, sidebar state, and multiview layout.

## Acceptance criteria

- [ ] A named cache policy table or equivalent helper exists for app-data cache tiers.
- [ ] The policy includes stale time, cache retention where applicable, refresh interval where applicable, and whether the data may paint stale-first.
- [ ] Local/user-owned state is explicitly documented as persisted local state rather than remote browse cache.
- [ ] The policy does not create a single global TTL for all data.
- [ ] Existing query behavior can continue to use current timings through the named policy.
- [ ] Tests or type-level checks cover the exported policy shape if the implementation introduces code helpers.

## Blocked by

None - can start immediately.

## Comments

Closed on 2026-06-28.

Implemented `apps/desktop/src/hooks/queries/cache-policy.ts` with named tiered policies for followed stream status, stream detail, stream lists, followed channels, followed content, search results, categories, category references, and local/user-owned persisted state. The policy keeps remote browse data memory-only and documents local/user-owned state as `persisted-local`.

Verification: `cache-policy.test.ts`, targeted cache/follow tests, `npm run typecheck --workspace=streamfusion`, `npm run lint --workspace=streamfusion`, `npm run build --workspace=streamfusion`, and full `npm test --workspace=streamfusion` all passed.
