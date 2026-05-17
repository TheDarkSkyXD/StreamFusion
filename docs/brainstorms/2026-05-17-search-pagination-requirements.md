---
date: 2026-05-17
topic: search-pagination
---

# Search Pagination — Show All Results

## Summary

Both the global search dropdown and the dedicated Search Results page should let the user scroll until they've seen every Twitch result the API surfaces for their query. The dropdown is bounded at 100 results with a "Show more" link to the full page; the full page paginates each section until exhaustion. Kick contributes its single-page result set as an explicit asymmetry — Kick exposes no cursor API.

---

## Problem Frame

The current dropdown shows ~30 combined Twitch + Kick channels per query and silently stops. The "See all results for 'X'" footer routes to a dedicated Search Results page that itself shows only ~20 results per content type — also capped, also silent. Earlier this session a skeleton-flicker loop bug exposed the deeper issue: the existing infinite-query plumbing in the dropdown couldn't actually advance pages because Twitch's persisted GQL search operation ignores `after`/`first` inputs. A no-loop guard now stops the flicker, but it leaves the user at "the persisted-query first page" without knowing that's all they're being shown. Users searching for less-popular channels — anyone not in the top ~10 Twitch matches — currently cannot reach them at all on either surface.

---

## Requirements

**Dropdown — bounded infinite scroll**

- R1. The dropdown SHALL render up to 100 combined channel + category results for a query before halting auto-pagination.
- R2. Scrolling near the bottom of the dropdown SHALL load additional results until either (a) Twitch reports end-of-list, or (b) the 100-result cap is reached, whichever comes first.
- R3. When fewer than 100 results exist for a query, the dropdown SHALL end the scrollable list at the actual result count, with no perpetual loading indicators or artificial padding.
- R4. When the 100-cap is reached AND more results remain (Twitch's cursor still advances), the bottom of the dropdown SHALL show a "Show more" CTA that routes to the full Search Results page for the same query.
- R5. When the user reaches a true end-of-list — Twitch exhausted, integrity check rejected, or empty page returned — the dropdown SHALL stop fetching silently; no error state or "may be limited" hint is shown.

**Full Search Results page — exhaustive infinite scroll**

- R6. Each result section on the Search Results page (Channels, Streams, Videos, Clips, Categories) SHALL infinite-scroll until Twitch reports no more results for that section.
- R7. Scrolling near the bottom of a section SHALL load the next page of that section independently of other sections.
- R8. When a section is genuinely exhausted, the section SHALL stop loading and end at the actual result count.
- R9. The page SHALL preserve current behavior for active-tab filters, platform filter (All / Twitch / Kick), and live-only toggle. Pagination interacts with platform filter the same way the initial search does — Kick stays first-page-only regardless of how deep Twitch paginates.

**Platform asymmetry — Kick**

- R10. Kick channels and categories SHALL contribute first-page-only results on both surfaces. The Kick API does not expose cursor pagination; no synthetic pagination is added.
- R11. The merged result list SHALL NOT present Kick's first-page-only nature differently in the UI; per-platform "N of M" indicators are out of scope.

**Loop-stop and failure handling**

- R12. The pagination plumbing SHALL never re-fetch when Twitch returns a cursor equal to the input cursor (cursor-no-advance guard). Already in place; must remain.
- R13. The pagination plumbing SHALL treat Twitch GQL `"failed integrity check"` errors on paginated raw queries as legitimate end-of-list. No retry, no error UI, no telemetry.
- R14. The pagination plumbing SHALL treat an empty data page (`data: []`) as end-of-list regardless of any cursor returned. Already in place; must remain.

---

## Acceptance Examples

- AE1. **Covers R2, R4.** Given a query like `ninja` with ~50 Twitch results returned across paginated requests, when the user scrolls the dropdown to the bottom, then results load incrementally until either 100 are visible (Show more CTA appears at bottom) or Twitch is exhausted before 100 (list ends, no CTA).
- AE2. **Covers R3.** Given a query like `obscure_streamer_xyz_123` with 1 matching channel, when the user opens the dropdown, then exactly one channel renders and the scrollable area ends there with no loading indicator.
- AE3. **Covers R5, R13.** Given a paginated request to Twitch returns `"failed integrity check"`, when this happens, then the scroll list ends silently at whatever results were already loaded; the user sees no error message and no retry indicator.
- AE4. **Covers R10.** Given a query `ninja` returns 20 Kick channels on first load and 50 Twitch channels across multiple pages, when the user scrolls past the initial render into deeper Twitch pages, then the dropdown grows via Twitch additions only; Kick's contribution remains at its first-load count.
- AE5. **Covers R6, R7.** Given the full Search Results page is open with all sections populated, when the user scrolls into the Videos section's bottom, then only the Videos section fetches its next page; Channels, Streams, Clips, and Categories sections are not refetched.
- AE6. **Covers R12.** Given a paginated Twitch request returns a cursor equal to the input cursor, when this happens, then the plumbing treats this as end-of-list and stops fetching; the skeleton-flicker class of bugs is not reintroduced.

---

## Success Criteria

- A user searching for any Twitch channel — popular or niche — can reach that channel by scrolling the dropdown or the search page, as long as Twitch's API will surface it via paginated search.
- The "Show more" CTA appears only when meaningful: when 100 dropdown results have rendered AND Twitch still has more available. It never appears as a dead-end button on an exhausted list.
- Both surfaces silently stop loading when results genuinely run out. No skeleton flickers, no perpetual loaders, no error toasts on pagination failure.
- A downstream implementing agent can plan against this doc without re-deciding scope, surface boundaries, failure-mode UX, or platform asymmetry.

---

## Scope Boundaries

- No Twitch OAuth / Helix-authenticated path. The mechanism stays anonymous-only.
- No Kick pagination implementation. Kick contributes first-page-only on both surfaces.
- No changes to sort, relevance ranking, dedup logic, or per-section ordering on either surface.
- No changes to result-card visual design or per-row interaction patterns.
- No per-platform "showing N of M from Kick" indicators.
- No telemetry, logging, or monitoring of integrity-check rejection rates in this slice.
- The existing "See all results for 'X'" footer in the dropdown is replaced by the new "Show more" CTA only when the 100-cap is reached. For shorter result sets the existing footer behavior is preserved.

---

## Key Decisions

- **Raw-GQL LoadMore for Twitch page 2+, persisted query stays for page 1.** The bundled `twitch-gql-queries` persisted op ignores cursor input (verified empirically — every call returns the same `MTA=` cursor). Raw GQL with hand-written cursor variables is the only available anonymous path. Page 1 stays on the known-good persisted op to avoid integrity-check exposure on the first hit, where users always start.
- **Defense in depth with three loop-stop guards.** Cursor-no-advance + integrity-check-as-end-of-list + empty-page-as-end-of-list. All three remain in place even after pagination works correctly, because Twitch's anonymous GQL behavior is not contractually stable.
- **Dropdown 100-cap with "Show more" CTA, not unbounded scroll.** Dropdowns become unwieldy at hundreds of rows. The dedicated Search Results page is where exhaustive browsing belongs. 100 is a UX bound, not a technical one.
- **Graceful silent end-of-list on failure.** No "results may be limited" hint when integrity check rejects. Simpler UX, accepts that the user cannot distinguish "truly exhausted" from "rejected mid-paginate." Telemetry can be added later if rejection frequency becomes a problem.
- **Kick asymmetry is accepted and undisguised.** No synthetic Kick pagination, no per-platform UI labels. The user gets what each platform's API can deliver.

---

## Dependencies / Assumptions

- Twitch's web GQL endpoint will continue to accept anonymous raw queries against the `searchFor` connection with cursor variables. Field-name discovery (exact GQL argument names for `cursor` / `after` / `first` / `limit`) is a planning-time task. If the schema diverges from expectations, page 1 still works via the persisted op and the user sees the existing first-page experience — degraded but not broken.
- The `"failed integrity check"` error pattern documented in the existing `gqlGetStreamsByGameId` implementation (see `apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts:391-397`) generalizes to search. Treating this error as end-of-list is consistent with how that helper handles it today.
- The 100-cap on the dropdown is a product judgment, not a technical constraint. Raising or lowering it later is a single-line change with no UX cliff.
- The Kick IPC handler can be called with `after` set without throwing; current code gates Kick on `!params.after`, and that gate stays.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] How to restructure the Search Results page's data layer. It currently uses `useSearchAll` — one batched IPC call returning all 5 content types in a single 20-item snapshot via `apps/desktop/src/hooks/queries/useSearch.ts`. Per-section infinite scroll likely requires either splitting `search.all` into 5 paginated IPCs or wiring 5 separate infinite queries to the existing per-type endpoints. The decision is a planning-time trade-off between IPC churn and code duplication.
- [Affects R2][Needs research] What does Twitch's actual GQL schema accept for the `searchFor` connection arguments? The argument names (`userQuery` vs `query`, `cursor` vs `after`, `limit` vs `first`) are guesses until verified empirically in the running app. The cursor `MTA=` returned today is base64 of "10", suggesting offset semantics — but the exact GQL field name to send it back as is unknown.
- [Affects R4][UX detail] The "Show more" CTA's exact label and styling. Current "See all results for 'X'" footer is a reasonable starting point; the planning agent can decide whether to copy that label verbatim or adjust.
- [Affects R10] Confirm whether Kick's IPC handler can return `data: []` cleanly when called with `after` set, without throwing. Current code gates Kick on `!params.after`; that gate stays, but the planning task should verify no edge case sneaks through.
