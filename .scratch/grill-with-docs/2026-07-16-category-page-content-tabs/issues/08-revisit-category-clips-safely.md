# Revisit Category Clips Safely Through Caching, Failures, and Navigation

Status: wontfix
Type: AFK

## Parent

Parent PRD: [.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/prd.md](../prd.md)

## What to build

Make repeated Category Clip browsing resilient across same-session navigation, cache revalidation, authentication changes, and partial or complete Platform outages. Preserve the viewer's useful context, disclose stale or unavailable data, and keep recovery scoped to the affected Platform without silently presenting old results as current.

## Acceptance criteria

- [ ] A Category Clip dataset is keyed by canonical Category identity, content type, Platform filter, sort, time range, page size, and account identity whenever entitlement can change list results.
- [ ] A cached Clip dataset remains fresh for approximately five minutes; a fresh revisit renders it without an unnecessary replacement load.
- [ ] A stale revisit renders cached Clips immediately and revalidates them without replacing the grid with first-load skeletons.
- [ ] Persisted Clip results up to seven days old are used only when refresh fails, and every affected row set is visibly identified with its Platform and last-updated age.
- [ ] When one Platform fails, fresh results from the working Platform remain usable alongside explicitly stale cached results from the failed Platform when available, with a named Platform-specific retry.
- [ ] A failed Platform with no cached results is presented as an outage rather than an empty result; when both Platforms fail with no cache, the tab shows a full error and retry.
- [ ] Successful Platform recovery refreshes the relevant results and removes stale or outage messaging without discarding healthy results from the other Platform.
- [ ] Login, logout, or an entitlement-relevant identity change invalidates the affected Category Clip datasets and never reuses cached playback credentials.
- [ ] Switching tabs and returning during the same app session restores the Clip filters, loaded rows, pagination progress, and scroll position for that visited dataset.
- [ ] Closing a Clip dialog restores focus and position to its invoking card; returning with Back from a Channel or another Category restores the prior Category Clip tab and same-session position.
- [ ] A never-visited Clip dataset opens at the content top, while an app restart restores URL state but does not restore the prior session's scroll position.
- [ ] Cache revalidation, partial failure, recovery, and restoration status use appropriate busy state, restrained polite announcements, visible focus, and keyboard-operable retry controls.
- [ ] Automated query, cache, route, and page tests cover freshness, seven-day failure fallback, explicit stale age, cache-key isolation, auth invalidation, one- and two-Platform failure, recovery, and same-session restoration.
- [ ] Focused tests, lint, type-check, and build pass; Electron verification covers cached revisits, tab switching, Clip dialog focus return, Back restoration, login/logout invalidation, and Twitch-only, Kick-only, and combined outage/recovery states.

## Blocked by

- [.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/issues/06-continue-category-clips-in-exact-global-order.md](./06-continue-category-clips-in-exact-global-order.md)

## Comments

- 2026-07-16: Closed transitively under the failed Issue 01 parity gate; there is no shippable Category Clip feed to cache or restore under the evidence in [Issue 01](../evidence/01-category-clip-discovery.md). Reopen only if new upstream evidence proves both Platforms satisfy the complete Category Clip contract.
