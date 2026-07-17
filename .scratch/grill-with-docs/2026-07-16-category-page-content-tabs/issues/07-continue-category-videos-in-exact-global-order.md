# Continue Category Videos in Exact Global Order

Status: wontfix
Type: AFK

## Parent

Parent PRD: [.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/prd.md](../prd.md)

## What to build

Extend Category Videos beyond the first page so viewers can continue browsing a complete Twitch-and-Kick feed without weakening the selected `Views` or `Most Recent` ordering. Advance each Platform independently, merge later results into their exact global positions, and keep already loaded Videos usable when one pagination request needs a retry.

## Acceptance criteria

- [ ] Loading more Videos advances Twitch and Kick with independent cursors, health, exhaustion, and retry state.
- [ ] Under `All Platforms`, every newly loaded Video is inserted into its exact global position for the selected `Views` or `Most Recent` sort instead of being appended as an approximately sorted page.
- [ ] Results are deduplicated only by `platform:id`; similarly titled Videos from different Platforms remain distinct.
- [ ] An empty page, unchanged cursor, or page containing only duplicate records exhausts only that Platform and cannot cause a pagination loop.
- [ ] Exhausting one Platform does not prevent the other Platform from continuing until it is also exhausted.
- [ ] Twitch-only and Kick-only views request and paginate only the selected Platform while preserving exact ordering.
- [ ] Changing any URL-backed Video filter starts the newly keyed dataset at page one and the content top; returning to a previously visited combination may reuse its loaded rows.
- [ ] A load-more failure keeps the existing Video grid usable, identifies the affected Platform, and provides an inline Platform-specific retry without replacing the grid.
- [ ] Pagination progress, completion, and retry feedback are keyboard accessible and announced with restrained polite status messaging.
- [ ] Automated contract, query, merge, and page tests prove cursor progression, termination, deduplication, exact cross-page ordering, independent exhaustion, and retry behavior for both Platforms.
- [ ] Focused tests, lint, type-check, and build pass; long pagination, exact card reordering, independent exhaustion, and load-more retry are verified in the running Electron app for Twitch, Kick, and All Platforms.

## Blocked by

- [.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/issues/05-browse-first-page-category-videos.md](./05-browse-first-page-category-videos.md)

## Comments

- 2026-07-16: Closed under the parity rule. [Issue 02 evidence](../evidence/02-category-video-discovery.md) found no complete Kick Category Video discovery source, so exact cross-Platform Video pagination cannot be implemented without an unauthorized approximation. Reopen only if Kick exposes a complete native Category Video feed, Issue 02's capability gate passes, and Issue 05 is reopened and completed.
