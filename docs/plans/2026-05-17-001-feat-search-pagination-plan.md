---
title: feat: Search pagination — show all results
type: feat
status: completed
date: 2026-05-17
origin: docs/brainstorms/2026-05-17-search-pagination-requirements.md
---

# feat: Search pagination — show all results

## Summary

Implement true page-2+ pagination for Twitch global search by adding a raw-GQL LoadMore path that runs alongside the existing persisted query (page 1). Bound the dropdown at 100 results with a "Show more" CTA; restructure the Search Results page to consume the existing infinite query hooks for Channels and Categories, deriving Streams from `channels.filter(isLive)`. Keep all three loop-stop guards (cursor-no-advance, integrity-check-as-end-of-list, empty-page) as defense in depth.

---

## Problem Frame

Twitch's bundled persisted GQL search operation does not honor cursor input — every paginated call re-serves the same first page (cursor `MTA=`), so users searching for less-popular Twitch channels currently cannot reach them on either surface. A loop-stop guard added earlier today halts the resulting skeleton-flicker bug, but leaves the user capped at the persisted query's first page. See origin: `docs/brainstorms/2026-05-17-search-pagination-requirements.md`.

---

## Requirements

- R1. Dropdown renders up to 100 combined channel + category results, then shows "Show more" CTA. (See origin R1.)
- R2. Scrolling near the bottom of the dropdown auto-loads additional results until either Twitch is exhausted or 100 is reached. (See origin R2.)
- R3. Dropdown ends list at actual result count when results < 100; no perpetual loading. (See origin R3.)
- R4. "Show more" CTA at the 100-cap routes to the full Search Results page for the same query. (See origin R4.)
- R5. Dropdown silently ends list on true exhaustion or pagination rejection; no error UI. (See origin R5.)
- R6. Each section on the Search Results page (Channels, Streams, Categories) infinite-scrolls until Twitch exhausts; Videos/Clips remain on the existing single-shot path. (See origin R6, modified by plan decision below.)
- R7. Section scroll triggers next page only for that section, not for others. (See origin R7.)
- R8. Sections end naturally at actual result count. (See origin R8.)
- R9. Existing tabs, platform filter, and live-only toggle behavior on the Search Results page are preserved. (See origin R9.)
- R10. Kick contributes first-page-only results; no synthetic Kick pagination. (See origin R10.)
- R11. No per-platform "N of M" UI indicators. (See origin R11.)
- R12. Cursor-no-advance guard remains enforced. (See origin R12.)
- R13. `"failed integrity check"` errors from Twitch raw GQL are treated as legitimate end-of-list. (See origin R13.)
- R14. Empty-page (`data: []`) is treated as end-of-list regardless of cursor. (See origin R14.)

**Origin acceptance examples:** AE1 (covers R2, R4), AE2 (covers R3), AE3 (covers R5, R13), AE4 (covers R10), AE5 (covers R6, R7), AE6 (covers R12).

---

## Scope Boundaries

- No Twitch OAuth / Helix path. Anonymous GQL only.
- No Kick pagination implementation; Kick stays first-page-only.
- No sort, relevance, or dedup-logic changes on either surface.
- No result-card visual changes.
- No per-platform UI indicators ("Kick: N · Twitch: M").
- No telemetry or monitoring of integrity-check rejection rates.
- No new IPC endpoints or paginated hooks for Streams, Videos, or Clips. Streams derive from `channels.filter(isLive)`; Videos/Clips keep the existing `useSearchAll` one-shot path.

---

## Context & Research

### Relevant Code and Patterns

- `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts` — `gqlSearchChannels`, `gqlSearchCategories` (the surfaces this plan modifies) and `gqlGetStreamsByGameId` (the load-bearing precedent for raw-GQL cursor pagination + integrity-check handling, around lines 320–407).
- `apps/desktop/src/hooks/queries/useSearch.ts` — `useSearchChannels`, `useSearchCategories` (existing infinite queries; `getNextPageParam` already has the empty-page guard from earlier today).
- `apps/desktop/src/components/search/UnifiedSearchInput.tsx` — dropdown component; `onScroll` near-bottom handler at the dropdown container, existing "See all results for X" footer.
- `apps/desktop/src/pages/SearchResults/index.tsx` — full search page; currently consumes `useSearchAll` for all 5 sections.
- `apps/desktop/src/backend/ipc/handlers/search-handlers.ts` — IPC handler combining Twitch + Kick search; Kick gate at `!params.after`.

### Institutional Learnings

- `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md` — unrelated but signals the codebase's solutions-doc style for future learning capture.
- Inline learning in `twitch-gql-client.ts` (around line 391–397): "failed integrity check" is Twitch's expected response to paginated anonymous raw queries; treat as end-of-stream rather than logging noise. This plan generalizes that pattern to search.

### External References

- None. Codebase has a direct local pattern to mirror.

---

## Key Technical Decisions

- **Raw-GQL LoadMore for Twitch page 2+, persisted query for page 1.** The persisted op is verified to ignore `after`/`first` empirically (returns same `MTA=` cursor on every call). Page 1 stays on the known-good persisted path; page 2+ uses a hand-written raw query mirroring `gqlGetStreamsByGameId`'s shape.
- **Three loop-stop guards stay as defense in depth.** Cursor-no-advance + integrity-check-as-end-of-list + empty-page. Even after pagination works, Twitch's anonymous GQL guarantees can shift; these are cheap and stay.
- **Streams section on the Search Results page derives from `channels.filter(isLive)`.** No new paginated IPC needed; streams inherit Twitch pagination automatically as channels load. Avoids doubling the new backend surface.
- **Videos and Clips remain on `useSearchAll`.** Twitch GQL search doesn't surface them through the persisted query the rest of this plan uses, and Kick has no cursor API. Adding pagination here would be new surface with no useful effect.
- **`gqlRequest` calls stay in the existing `twitch-gql-client.ts` module.** New LoadMore helpers are private to that file; the public surface (`gqlSearchChannels`, `gqlSearchCategories`) keeps its existing signature so callers don't change.
- **Unit tests target the safety properties, not happy-path pagination.** Mocked-`gqlRequest` tests verify cursor-no-advance, integrity-check-as-end-of-list, and empty-page guards survive future GQL-shape rework. Happy-path is verified via electron-mcp on the running app.

---

## Open Questions

### Resolved During Planning

- **Should Streams have its own paginated IPC on the Search Results page?** No — derive from `channels.filter(isLive)`. Smaller surface; pagination inherits from channels.
- **How does this plan handle `useSearchAll`?** It stays untouched. The Search Results page continues using it for Videos/Clips/Streams scaffolding but reads Channels and Categories from the per-section infinite queries. (Streams ultimately derive from channels per above; we still need Videos/Clips from somewhere.)
- **What test framework?** Vitest (per `apps/desktop/vitest.config.ts`); tests live under `apps/desktop/tests/backend/`.

### Deferred to Implementation

- **Exact GQL field names for the `searchFor` connection arguments.** Likely candidates: `userQuery` vs `query`, `cursor` vs `after`, `limit` vs `first`. The implementer should send a first attempt mirroring `gqlGetStreamsByGameId`'s `first`/`after`/`options` shape; if Twitch returns `errors: [...]` indicating bad argument names, iterate by reading the response. Field-name discovery is an execution-time concern.
- **The "Show more" CTA exact label and styling.** "Show more results for 'X'" is a reasonable starting point; current `UnifiedSearchInput.tsx` already renders a similar footer. The implementer's judgment on copy and styling.
- **Whether the Search Results page should distinguish the Channels and Streams sections when the channels infinite query is paginating.** Loading skeletons in Streams during channels-fetch is a minor UX question that surfaces only at implementation.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
useSearchChannels (page 1)              useSearchChannels (page N>1)
        │                                          │
        ▼                                          ▼
gqlSearchChannels                         gqlSearchChannels
        │                                          │
        │  no `after`                              │  after = cursor from page N-1
        ▼                                          ▼
getQuerySearchResultsPageSearchResults   gqlSearchChannelsLoadMore  (raw GQL)
(persisted op, returns ~10)                        │
        │                                          │
        ▼                                          ▼
{ data: 10 channels, cursor: "MTA=" }   { data: N channels, cursor: "<next>" }
                                                   │
                                                   ▼
                              Guard 1: cursor === input after?
                              Guard 2: errors include "failed integrity check"?
                              Guard 3: data.length === 0?
                              Any guard → return { data: ..., cursor: undefined }
```

Per-section page composition on the Search Results page:

```text
SearchPage
├─ Channels section    ← useSearchChannels  (infinite, paginates via Twitch raw-GQL LoadMore)
├─ Streams section     ← derived: channels.filter(c => c.isLive)
├─ Categories section  ← useSearchCategories (infinite, paginates via Twitch raw-GQL LoadMore)
├─ Videos section      ← useSearchAll       (one-shot; Kick-only source)
└─ Clips section       ← useSearchAll       (one-shot; Kick-only source)
```

---

## Implementation Units

### U1. Raw-GQL LoadMore for channels

**Goal:** Replace the current `cursor: undefined` short-circuit in `gqlSearchChannels` with real page-2+ pagination via a private raw-GQL helper. Page 1 keeps the existing persisted query.

**Requirements:** R2, R6, R12, R13, R14

**Dependencies:** None

**Files:**
- Modify: `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts`

**Approach:**
- Add a private function (e.g., `gqlSearchChannelsLoadMore`) inside `twitch-gql-client.ts` that constructs and sends a raw GQL query against the `searchFor.channels` connection with cursor input.
- Modify `gqlSearchChannels` to branch on `options.after`: when absent, use the existing persisted-query path (unchanged behavior); when present, delegate to the new LoadMore helper.
- Both branches apply the three guards before returning a cursor: (1) returned cursor equals input `options.after` → `cursor: undefined`; (2) response contains GraphQL errors with `"failed integrity check"` substring → `cursor: undefined`; (3) `data.length === 0` → `cursor: undefined`.
- The "failed integrity check" guard must consume the error without re-throwing, mirroring the inline learning at `gqlGetStreamsByGameId` (around line 391–397). Other GraphQL errors should still surface as `console.warn` for debuggability.
- Public function signature of `gqlSearchChannels` does not change; callers (`twitch-client.ts`, IPC search handler) are untouched.

**Technical design:** *(optional — directional guidance, not implementation specification)*

```text
gqlSearchChannels(query, options):
  if !options.after:
    return persistedQueryPath(query, options)   # existing code path

  raw = await rawSearchChannelsLoadMore(query, options.after, options.first)
  if raw.errors?.some(e => e.message.includes("failed integrity check")):
    return { data: <whatever-rendered>, cursor: undefined }
  if cursorEqualsInput(raw.cursor, options.after) || raw.data.length === 0:
    return { data: raw.data, cursor: undefined }
  return { data: raw.data, cursor: raw.cursor }
```

**Patterns to follow:**
- `gqlGetStreamsByGameId` in the same file — mirror its raw-query string shape, error-message filtering, and cursor handling.
- Existing `gqlSearchChannels` transform code (the `edge.item` → `UnifiedChannel` mapping) — reuse the same mapping for raw-GQL responses; transform should live in a shared helper or be duplicated, implementer's choice.

**Test scenarios:**
- *Happy path:* Given `options.after = "MTA="` and a mocked `gqlRequest` that returns `{ data: { searchFor: { channels: { cursor: "MjA=", edges: [...5 items...] } } } }`, expect `gqlSearchChannels` to return `{ data: [5 channels], cursor: "MjA=" }`.
- *Edge case — cursor-no-advance (Covers AE6):* Given `options.after = "MTA="` and the response returns the same cursor `"MTA="`, expect `cursor: undefined` in the result, regardless of whether `data` is non-empty.
- *Edge case — empty page:* Given `options.after = "MTA="` and the response returns `edges: []` with any cursor value, expect `cursor: undefined`.
- *Error path — integrity check (Covers AE3):* Given `options.after = "MTA="` and the response contains `errors: [{ message: "failed integrity check" }]`, expect `cursor: undefined` and no thrown error; expect `console.warn` is NOT called for this specific error.
- *Error path — other GraphQL error:* Given the response contains `errors: [{ message: "Some unexpected error" }]`, expect `cursor: undefined` and `console.warn` IS called so the error surfaces during development.
- *Edge case — page 1 path unchanged:* Given `options.after` is undefined, expect the persisted-query path to be invoked (mock the persisted-query call and verify the raw-GQL helper is not called).
- *Integration:* Given a sequence of calls `gqlSearchChannels(q)` → `gqlSearchChannels(q, {after: "MTA="})` → `gqlSearchChannels(q, {after: "MjA="})`, expect the first to hit persisted, the second and third to hit raw-GQL with the respective cursors, and the merged channels list to have no duplicates between page 1 and page 2 (verifies cursor handoff is correct).

**Verification:**
- Searching `"ninja"` on the running app and scrolling the dropdown to the bottom causes the backend log to print `[SearchHandler] Returning N channels (cursor: <new-different-cursor>)` rather than the repeating `cursor: MTA=` pattern.
- Channels visible in the dropdown grow past the initial ~30 combined Twitch + Kick set as the user scrolls.
- When Twitch returns `"failed integrity check"`, the dropdown silently caps at the last successful page; no error UI; no infinite loop.

---

### U2. Raw-GQL LoadMore for categories

**Goal:** Same shape as U1 but for `gqlSearchCategories` against the `searchFor.games` connection.

**Requirements:** R2, R6, R12, R13, R14

**Dependencies:** U1 (pattern; categories mirrors the channels shape)

**Files:**
- Modify: `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts`

**Approach:**
- Add a private function (e.g., `gqlSearchCategoriesLoadMore`) that targets `searchFor.games` instead of `searchFor.channels`, mapping `edge.item` to `UnifiedCategory`.
- Branch in `gqlSearchCategories` on `options.after` the same way U1 branches in `gqlSearchChannels`.
- Apply the same three guards before returning a cursor.

**Patterns to follow:**
- Mirror U1 exactly. Naming, branch logic, guard order should match.

**Test scenarios:**
- *Happy path:* Given `options.after = "MTA="` and a mocked response with 4 game edges, expect `{ data: [4 categories], cursor: <returned> }`.
- *Edge case — cursor-no-advance:* As U1's equivalent scenario.
- *Edge case — empty page:* As U1's equivalent scenario.
- *Error path — integrity check:* As U1's equivalent scenario.
- *Error path — other GraphQL error:* As U1's equivalent scenario.
- *Edge case — page 1 path unchanged:* As U1's equivalent scenario.

**Verification:**
- Searching a category-heavy query like `"chess"` on the running app and scrolling past the initial categories shows additional categories load when Twitch's cursor advances; otherwise the list ends gracefully.

---

### U3. Unit tests for raw-GQL pagination safety properties

**Goal:** Cement the safety guarantees (cursor-no-advance, integrity-check-as-end-of-list, empty-page) in tests so future changes to the GQL shape cannot silently regress the loop-stop behavior.

**Requirements:** R12, R13, R14, plus AE3 (R5+R13), AE6 (R12)

**Dependencies:** U1, U2

**Files:**
- Create: `apps/desktop/tests/backend/twitch-gql-search.test.ts`

**Approach:**
- Mock `gqlRequest` (the module-local helper inside `twitch-gql-client.ts`). Vitest's `vi.mock` against the same-module export should work; if the export shape doesn't allow this, switch to dependency injection at the helper boundary.
- Run the test scenarios from U1 and U2 against the mock, asserting on returned `{ data, cursor }` shapes.
- Cover both `gqlSearchChannels` and `gqlSearchCategories` in this single test file. Group with `describe` blocks per function.
- These tests are the regression net — if a future agent rewrites `gqlSearchChannels` and breaks the integrity-check handling, this test should fail loudly.

**Execution note:** Implement test-first for these safety properties — they are the load-bearing reason this work doesn't regress the skeleton-flicker bug. Write the test cases listed in U1 and U2, see them fail against the current code (which already returns `cursor: undefined` for empty pages but not for cursor-no-advance until U1/U2 land), then implement U1 and U2 to make them pass.

**Patterns to follow:**
- `apps/desktop/tests/adblock/network-adblock-service.test.ts` (or a similar service-level test) for module mock setup conventions.

**Test scenarios:**
- All scenarios from U1 and U2 above — this is where they live. The U1 / U2 unit definitions enumerate them so the planning trace is clear, but the actual test file is here.

**Verification:**
- `npm test -w streamfusion` (or the project's equivalent) passes `twitch-gql-search.test.ts` cleanly.
- Coverage report (`npm run test:coverage -w streamfusion`) shows the LoadMore helpers and guard branches are exercised.

---

### U4. Dropdown 100-cap + "Show more" CTA

**Goal:** Cap the dropdown at 100 combined channel + category results and surface a "Show more" CTA that routes to the full Search Results page when the cap is reached AND Twitch still has more results available.

**Requirements:** R1, R3, R4, R5

**Dependencies:** U1, U2 (so pagination actually advances; without them this CTA would never fire because the cursor-no-advance guard hides further pages)

**Files:**
- Modify: `apps/desktop/src/components/search/UnifiedSearchInput.tsx`

**Approach:**
- Track the combined rendered count of channels + categories visible in the dropdown.
- Wrap the existing `onScroll` near-bottom handler so it stops auto-fetching once the combined count reaches 100 — even if both `channelsHasNextPage` and `categoriesHasNextPage` are still true.
- Compute a derived flag like `capReachedWithMore = combinedCount >= 100 && (channelsHasNextPage || categoriesHasNextPage)`. When true, render the "Show more" CTA in place of (or below) the existing `"See all results for 'X'"` footer.
- The "Show more" CTA uses the existing `onSearch` callback path that the search bar already wires up — that already navigates to `/search?q=...`.
- When `combinedCount < 100` and there is no next page, keep the existing footer behavior (no CTA addition).
- When `combinedCount < 100` and a next page genuinely exists, infinite scroll continues until either the cap is reached or Twitch is exhausted.

**Patterns to follow:**
- Existing `onScroll` handler and the footer-rendering block in the same file (current structure for `"See all results for 'X'"`).
- React Query's `hasNextPage` / `fetchNextPage` semantics already in use throughout the file.

**Test scenarios:**
- *Happy path — fewer than 100 (Covers AE2):* For a query returning 1 channel, the dropdown renders one row, no skeletons, no "Show more" CTA, scroll bottom = end of list.
- *Happy path — cap reached with more available (Covers AE4):* For a query returning ~50 Twitch channels (paginated) + 20 Kick channels totaling 70 — and pagination continues past 100 with cursor advancing — once the user has scrolled to render 100 combined items, no further `fetchNextPage` fires and "Show more" CTA appears.
- *Edge case — cap reached, no more available:* For a query that returns exactly 100 channels with `cursor: undefined` on the last page, the dropdown ends at 100 with no "Show more" CTA (because there's nothing to show more of).
- *Edge case — Kick-only query:* For a Kick-niche query returning only 5 Kick channels and zero Twitch, the dropdown renders 5 channels and ends; no skeleton, no CTA.
- *Integration — CTA navigates correctly:* Clicking the "Show more" CTA invokes the same handler as the existing "See all results for 'X'" footer, navigating to `/search?q=<currentQuery>`.

**Verification:**
- Manual electron-mcp probe: search `"ninja"`, scroll, observe at most 100 rows render and a "Show more" CTA appears at the bottom.
- Click the CTA, observe navigation to the Search Results page for the same query.
- Search `"obscure_streamer_xyz_123"`, observe the dropdown ends at the actual (small) result count with no CTA.

---

### U5. Search Results page per-section infinite queries

**Goal:** Replace the Search Results page's reliance on `useSearchAll` for Channels and Categories with the per-section infinite queries already in use by the dropdown. Derive the Streams section from `channels.filter(c => c.isLive)`. Keep Videos and Clips on `useSearchAll`.

**Requirements:** R6, R7, R8, R9, R10, R11

**Dependencies:** U1, U2 (Twitch pagination must work for the page to actually exhaust meaningfully)

**Files:**
- Modify: `apps/desktop/src/pages/SearchResults/index.tsx`

**Approach:**
- Replace the Channels and Categories reads from `useSearchAll`'s `results.channels` and `results.categories` with calls to `useSearchChannels(q, platformFilter, 50)` and `useSearchCategories(q, platformFilter, 20)`.
- Flatten infinite-query pages into single arrays for the rendering loop — mirror the existing flatten pattern in `UnifiedSearchInput.tsx`.
- Streams section: derive from `channelsFlattened.filter(c => c.isLive)`. As the user scrolls past the Channels section into deeper pages, the Streams section will also grow if any of the later channels are live.
- Keep `useSearchAll` for `results.streams` (Kick-only streams), `results.videos`, and `results.clips`. These remain one-shot.
- Wire `onScroll` near-bottom handlers per visible section — Channels triggers `fetchMoreChannels`, Categories triggers `fetchMoreCategories`. Use the same near-bottom threshold pattern from `UnifiedSearchInput.tsx`.
- Preserve existing UX: tabs (`all`, `channels`, `streams`, `videos`, `clips`, `categories`), platform filter (`all`, `twitch`, `kick`), live-only toggle. Live-only continues to filter client-side over the loaded set.
- Handle the case where the user changes platform filter mid-scroll — React Query's queryKey already includes `platform`, so changing the filter starts a fresh paginated sequence; old pages are dropped naturally.

**Patterns to follow:**
- `UnifiedSearchInput.tsx` for the flatten + scroll-handler + cursor-advance pattern.
- Existing `SearchResults/index.tsx` for tab/filter/live-only state management.

**Test scenarios:**
- *Happy path — single-section scroll (Covers AE5):* Open Search Results page for `"ninja"`, scroll to the bottom of the Channels section, verify Channels fetches the next page while Categories does NOT refetch (assert via mock that `fetchMoreCategories` was not invoked).
- *Edge case — Streams derivation:* Given a paginated channels response where page 2 contains 3 live channels, after page 2 loads the Streams section count grows by 3 without any independent stream-fetch IPC call.
- *Edge case — live-only toggle preservation:* With live-only enabled, scrolling Channels still triggers pagination; client-side filter still applies on the new page.
- *Edge case — platform filter change clears pagination:* User scrolls 3 pages deep on `platform=all`, then switches to `platform=twitch`. The new request starts at page 1; prior pages for `platform=all` are not commingled with new results.
- *Integration:* User opens `/search?q=ninja`, scrolls Channels to bottom, then switches to the Channels tab — the tab change does not reset pagination (still showing accumulated pages).

**Verification:**
- Manual electron-mcp probe: navigate to `/search?q=ninja` (with `>` 30 Twitch results), scroll Channels section, observe new channels appear without a full-page refetch.
- Streams section count tracks the live subset of channels rendered.
- Switching platform filter resets to page 1 cleanly.
- Tabs and live-only toggle preserve their current behavior (no regression).

---

## System-Wide Impact

- **Interaction graph:** `useSearchAll` continues to power Videos / Clips on the Search Results page but no longer drives Channels / Categories. `useSearchChannels` and `useSearchCategories` now drive both the dropdown and the Search Results page — the existing query-key isolation in React Query (per `query, platform, limit` tuple) prevents cross-surface cache collisions.
- **Error propagation:** `"failed integrity check"` is suppressed at the GQL client layer (U1, U2). Other GraphQL errors still surface as `console.warn` for development visibility. No new error UI is added on either surface.
- **State lifecycle risks:** Switching `platformFilter` mid-pagination invalidates the query cache for the prior key — React Query handles this; verified in U5 test scenarios.
- **API surface parity:** `gqlSearchChannels` and `gqlSearchCategories` public signatures are unchanged; IPC handler (`apps/desktop/src/backend/ipc/handlers/search-handlers.ts`) is unchanged; preload bridge is unchanged. The only public-surface change is the behavior on `after` being non-null.
- **Integration coverage:** Mocked-`gqlRequest` unit tests don't prove the raw GQL field names are correct. Manual electron-mcp probe is required to confirm Twitch accepts the raw query and returns paginated data.
- **Unchanged invariants:** The dropdown's onScroll near-bottom threshold (200px), the "See all results for 'X'" footer behavior when fewer than 100 results exist, the Kick gate at `!params.after` in the IPC handler, and all of `useSearchAll`'s current behavior for Videos/Clips/initial-snapshot of all 5 sections — none of these change.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Raw GQL field names (`userQuery` vs `query`, `cursor` vs `after`, `limit` vs `first`) are guessed; first attempt may return GraphQL `errors`. | Iterate at implementation time by reading response errors. Page 1 (persisted query) still works regardless — worst case is page 2+ silently stops via the guards, leaving the user where they are today. |
| Twitch may reject the raw paginated query with `"failed integrity check"` for some queries or under certain headers. | This is treated as legitimate end-of-list per R13. The user reaches "end of scroll" silently. Documented as accepted in the brainstorm. |
| The Streams section deriving from `channels.filter(isLive)` means Streams cannot exceed the channels paginated count. If a query has live streams that are NOT in the channel-search results (unlikely but possible), they will not appear. | Out of scope per the brainstorm. If this surfaces in practice, a follow-up plan can add a dedicated streams pagination path. |
| Tests against a mocked `gqlRequest` cannot prove the raw GQL string is well-formed; only happy-path electron-mcp verification can. | The unit tests cover the *guard* behavior, which is the load-bearing safety property. GQL-shape correctness lives in manual verification. |
| Refactoring `SearchResults/index.tsx` to consume per-section infinite queries may inadvertently break the existing tab / filter / live-only behavior. | U5 test scenarios explicitly cover these. |

---

## Documentation / Operational Notes

- No new docs/solutions/ entry required by this plan, but if the raw-GQL field-name discovery surfaces a non-obvious result (e.g., Twitch's connection uses a name we didn't guess), capture that in `docs/solutions/` via `/ce-compound` afterward — future agents touching this code will benefit.
- No monitoring or rollout flags; this ships as a normal change behind the existing search surfaces.
- No new dependencies added.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-17-search-pagination-requirements.md](../brainstorms/2026-05-17-search-pagination-requirements.md)
- Related code:
  - `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts` — `gqlSearchChannels`, `gqlSearchCategories`, `gqlGetStreamsByGameId` (pattern to follow)
  - `apps/desktop/src/hooks/queries/useSearch.ts` — existing infinite queries
  - `apps/desktop/src/components/search/UnifiedSearchInput.tsx` — dropdown
  - `apps/desktop/src/pages/SearchResults/index.tsx` — full search page
  - `apps/desktop/src/backend/ipc/handlers/search-handlers.ts` — IPC layer
- Related PRs/issues: none — this is the first plan for the search-pagination effort.
- External docs: none.
