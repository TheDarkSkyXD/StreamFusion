# Continue Category Clips in Exact Global Order

Status: wontfix
Type: AFK

## Parent

Parent PRD: [.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/prd.md](../prd.md)

## What to build

Extend Category Clips beyond the first page so viewers can continue browsing a complete Twitch-and-Kick feed without weakening the selected `Views` or `Most Recent` ordering. Advance each Platform independently, merge later results into their exact global positions, and keep already loaded Clips usable when one pagination request needs a retry.

## Acceptance criteria

- [ ] Loading more Clips advances Twitch and Kick with independent cursors, health, exhaustion, and retry state.
- [ ] Under `All Platforms`, every newly loaded Clip is inserted into its exact global position for the selected `Views` or `Most Recent` sort instead of being appended as an approximately sorted page.
- [ ] The selected Clip time range is honored across every loaded page, including exact boundary handling for `Last Day`, `Last Week`, `Last Month`, and `All Time`.
- [ ] Results are deduplicated only by `platform:id`; similarly titled Clips from different Platforms remain distinct.
- [ ] An empty page, unchanged cursor, or page containing only duplicate records exhausts only that Platform and cannot cause a pagination loop.
- [ ] Exhausting one Platform does not prevent the other Platform from continuing until it is also exhausted.
- [ ] Twitch-only and Kick-only views request and paginate only the selected Platform while preserving exact ordering.
- [ ] Changing any URL-backed Clip filter starts the newly keyed dataset at page one and the content top; returning to a previously visited combination may reuse its loaded rows.
- [ ] A load-more failure keeps the existing Clip grid usable, identifies the affected Platform, and provides an inline Platform-specific retry without replacing the grid.
- [ ] Pagination progress, completion, and retry feedback are keyboard accessible and announced with restrained polite status messaging.
- [ ] Automated contract, query, merge, and page tests prove cursor progression, termination, deduplication, exact cross-page ordering, time cutoffs, independent exhaustion, and retry behavior for both Platforms.
- [ ] Focused tests, lint, type-check, and build pass; long pagination, exact card reordering, independent exhaustion, and load-more retry are verified in the running Electron app for Twitch, Kick, and All Platforms.

## Blocked by

- [.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/issues/04-browse-first-page-category-clips.md](./04-browse-first-page-category-clips.md)

## Comments

- 2026-07-16: Closed transitively under the failed Issue 01 parity gate; exact multi-page Category Clip ordering cannot be implemented from the sources documented in [Issue 01 evidence](../evidence/01-category-clip-discovery.md). Reopen only if new upstream evidence proves both Platforms satisfy the complete Category Clip contract.
