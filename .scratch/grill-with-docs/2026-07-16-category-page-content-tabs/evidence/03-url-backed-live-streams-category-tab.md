# Issue 03 evidence — URL-backed Live Streams Category tab

Date: 2026-07-16

## Outcome

Issue 03 is implemented and acceptance-proven. Category pages now expose a URL-backed Live Streams tab, native tab links, an accessible three-way Platform scope, preserved cross-Platform Category identity, independent Platform loading/failure/pagination state, cached-first rendering, and exact Live Viewer Count ordering.

The user-requested visual follow-up is included:

- the active Category content tab uses white text and a white underline without a filled tab background;
- selected Platform scopes match Following: All is white, Twitch is purple, and Kick is green.

Unshipped or invalid Clips and Videos destinations canonicalize back to Live Streams. Issues 04–09 remain governed by the separate Clip and Video feasibility gates.

## Automated evidence

Authoritative focused command:

```text
npm test --workspace=streamfusion -- --run tests/pages/CategoryDetail.test.tsx tests/pages/CategoryDetail.state.test.tsx tests/pages/CategoryDetail.reliability.test.tsx tests/pages/CategoryDetail.filters.test.tsx tests/routes/category-detail-router.integration.test.tsx tests/routes/category-detail-search.test.ts tests/hooks/queries/useInfiniteStreams.test.tsx tests/components/stream/stream-grid.test.tsx tests/components/ui/skeleton.test.tsx tests/components/discovery/category-filter-bar.test.tsx --maxWorkers=1
```

Observed result: 10 files passed, 75 tests passed, zero skipped, zero React `act` or runtime warnings. All page shards were below two seconds and all isolated behavior tests were below 500 ms in the final independent audit.

Covered behaviors include:

- default, invalid, unshipped, copied, refreshed, Back, and Forward URL state;
- canonical tab, Platform, language, tag, sort, and `otherId` serialization;
- safe `otherId` validation, repair, removal, and transient-failure recovery without trusting an unvalidated ID;
- truthful secondary identity failure warning/retry and suppression of false warnings when the safe Kick name fallback succeeds;
- All, Twitch, and Kick filtering with independent cursors, exhaustion, failures, retry, and one-side continuation;
- page-two to page-one dataset reset, filtered-empty state, persisted cache paint, and background revalidation;
- Live Viewer Count and membership reorder without resetting the existing scroll position;
- reduced-motion handling for header, grid, and pagination loading indicators.

Quality gates observed on the final feature tree:

- production build: passed;
- scoped Biome over 17 touched source/test files: passed;
- deslop/diff review: no cleanup required;
- independent code review: no remaining actionable Issue 03 defects;
- React Doctor: repository-wide changed-branch score 49/100; its Category Detail findings are the pre-existing giant-component and render-time query-ref warnings, not a new Issue 03 regression.

The full workspace type-check passed during the implementation and review cycle. A later final-tree rerun was blocked only by concurrent, unrelated implicit-any errors in `tests/hooks/queries/useSearch.test.tsx`; no Category Detail or Issue 03 file produced a type error.

## Electron MCP evidence

The running StreamFusion Electron window was exercised at the app's supported wide and minimum restored width using Electron MCP only.

- Deep link opened successfully at `/categories/twitch/666605016` with `otherId`, tab, Platform, language, tag, and sort search state.
- All showed both Platforms (41 Twitch and 2 Kick links observed); Twitch showed 41 Twitch and 0 Kick; Kick showed 0 Twitch and 2 Kick.
- Real `history.back()` restored Twitch state and `history.forward()` restored Kick state.
- At the minimum restored viewport, `innerWidth` and `document.body.scrollWidth` were both 1024, proving no horizontal page overflow.
- Programmatic keyboard focus reached Clips and displayed the visible white focus ring while Live retained the white active underline.
- Content scroll was set to 480 px. A controlled Query Client update changed MOONMOON from 15.4K to 1,000K viewers; observed DOM order changed from `xQc, MOONMOON` to `MOONMOON, xQc` while scroll remained exactly 480 px.
- A controlled Twitch query failure displayed `Twitch streams are temporarily unavailable`, retained the usable mixed cached feed, and exposed `Retry Twitch`; activating Retry removed the warning after a successful refetch.
- The temporary development-only Query Client proof exposure was removed before final tests and build.

Visual artifacts:

- [minimum-width layout and Kick selected styling](../../../images/issue-03-narrow-live-tab.png)
- [keyboard focus and white active underline](../../../images/issue-03-keyboard-focus.png)
- [partial Twitch failure with usable feed and retry](../../../images/issue-03-partial-twitch-failure.png)

## Review history

Independent code and test reviews repeatedly challenged stale/tampered identity, URL canonicalization, real history behavior, debounce behavior, partial counts, outage versus empty states, reduced motion, cache hydration, scroll-preserving reorder, false Platform warnings, and test-suite structure. Every actionable finding was fixed and re-reviewed. The final reviewers reported no remaining actionable code or automated-test gaps.
