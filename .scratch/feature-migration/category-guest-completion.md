# Guest category media completion

Twitch category Videos and Clips now use an explicit anonymous public GQL primary read for both guests and authenticated users. The playback adapter validates provider responses and preserves actual pagination, languages, video ordering, and clip periods. The reader no longer routes category videos through Helix then live-channel fanout. No credentials, auth storage, or remote mutations were used.

## Behavior

- Recorded videos map real status, broadcast type, owner, category, and playback ID. Recording rows are excluded without inventing a completed VOD. A page containing only recordings preserves its continuation cursor and offers one explicit Load more action instead of scanning indefinitely.
- Clips retain their public playable slug and provider period/language filtering. Twitch category clips expose Views only; unsupported Most Recent remains available only for Kick scope. Media tabs omit the unused Tag control; Live keeps it.
- Provider errors never also render a successful empty-state message. Genuine successful empty pages still do.
- Failed next pages stop automatic continuation until explicit Retry. Immediate repeated cursors fail at the adapter; longer cycles stop against the current infinite-query traversal and surface an error. Changed cursor chains during refetch are permitted.
- Kick video coverage is disclosed as videos from channels currently live in that category. The separate Kick owner tightened membership to actual VOD metadata. Its new gameId fixture field was integrated.

## Primary-read evidence

`public-category-source-success.json` records bounded unauthenticated HTTP 200 requests using the exact source queries for Twitch Art (509660): 60 video nodes (17 recorded, 43 recording) and 20 clips. Separate bounded probes verified video/clip cursor continuation and provider language/filter types. No bearer token or cookies were supplied. Twitch's public GQL interface is not the documented Helix contract; response validation and visible failures remain necessary if it changes.

## Verification

- `category-guest-final-tests.log`: 5 suites, 137 tests passed. Includes public GQL transport mapping/error tests, guest/auth reader strategy, IPC, category UI, and actual InfiniteQuery lifecycle tests.
- Pagination regression explicitly refetches the active query from old cursors ['', A, B] into ['', B, A], asserting all six calls and no false cycle.
- `category-guest-types-final.log`: whole desktop TypeScript passed.
- `category-guest-lint-final.log`: scoped ESLint passed.
- `category-guest-boundaries.log`: 19 feature architecture proofs passed.
- `category-guest-i18n.log`: all 50 display-language catalogs complete.
- Independent reviewer reran 19 focused tests and reported no remaining findings.

Production source frozen for root's rebuilt Electron category paging/filter proof. No claim of final compiled category UI verification is made here; root owns that check.
