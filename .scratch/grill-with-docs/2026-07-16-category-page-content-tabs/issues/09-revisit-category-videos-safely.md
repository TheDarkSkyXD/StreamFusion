# Revisit Category Videos Safely Through Caching, Failures, and Navigation

Status: wontfix
Type: AFK

## Parent

Parent PRD: [.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/prd.md](../prd.md)

## What to build

Make repeated Category Video browsing resilient across same-session navigation, cache revalidation, authentication changes, and partial or complete Platform outages. Preserve the viewer's useful context, disclose stale or unavailable data, and keep recovery scoped to the affected Platform without silently presenting old results as current.

## Acceptance criteria

- [ ] A Category Video dataset is keyed by canonical Category identity, content type, Platform filter, sort, page size, and account identity whenever entitlement can change list results.
- [ ] A cached Video dataset remains fresh for approximately five minutes; a fresh revisit renders it without an unnecessary replacement load.
- [ ] A stale revisit renders cached Videos immediately and revalidates them without replacing the grid with first-load skeletons.
- [ ] Persisted Video results up to seven days old are used only when refresh fails, and every affected row set is visibly identified with its Platform and last-updated age.
- [ ] When one Platform fails, fresh results from the working Platform remain usable alongside explicitly stale cached results from the failed Platform when available, with a named Platform-specific retry.
- [ ] A failed Platform with no cached results is presented as an outage rather than an empty result; when both Platforms fail with no cache, the tab shows a full error and retry.
- [ ] Successful Platform recovery refreshes the relevant results and removes stale or outage messaging without discarding healthy results from the other Platform.
- [ ] Login, logout, or an entitlement-relevant identity change invalidates the affected Category Video datasets and never reuses cached playback credentials.
- [ ] Switching tabs and returning during the same app session restores the Video filters, loaded rows, pagination progress, and scroll position for that visited dataset.
- [ ] Returning with Back from a Video, Channel, or another Category restores the prior Category Video tab, URL-backed filters, loaded rows, and same-session position.
- [ ] A never-visited Video dataset opens at the content top, while an app restart restores URL state but does not restore the prior session's scroll position.
- [ ] Cache revalidation, partial failure, recovery, and restoration status use appropriate busy state, restrained polite announcements, visible focus, and keyboard-operable retry controls.
- [ ] Automated query, cache, route, and page tests cover freshness, seven-day failure fallback, explicit stale age, cache-key isolation, auth invalidation, one- and two-Platform failure, recovery, and same-session restoration.
- [ ] Focused tests, lint, type-check, and build pass; Electron verification covers cached revisits, tab switching, Back restoration from a Video and Channel, login/logout invalidation, and Twitch-only, Kick-only, and combined outage/recovery states.

## Blocked by

- [.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/issues/07-continue-category-videos-in-exact-global-order.md](./07-continue-category-videos-in-exact-global-order.md)

## Comments

- 2026-07-16: Closed under the parity rule. [Issue 02 evidence](../evidence/02-category-video-discovery.md) found no complete Kick Category Video discovery source, so resilient caching and navigation for a shippable cross-Platform Video feed have no valid upstream contract. Reopen only if Kick exposes a complete native Category Video feed, Issue 02's capability gate passes, and Issues 05 and 07 are reopened and completed.
