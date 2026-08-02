Status: done
Type: AFK

# Return recent Clips from matching Channels

## Parent

`.scratch/grill-with-docs/2026-07-16-search-match-explanations/prd.md`

## What to build

Add non-exhaustive Clip search by fetching bounded recent content from matched Channels and merging matching local cache entries. Clip eligibility uses only title and Channel identity fields. Defer Platform fan-out until the Clips tab is active and make the existing Clip result interaction fully keyboard-operable.

## Acceptance criteria

- [x] Clip eligibility requires every normalized query token to match the Clip title or Channel display name/username.
- [x] Hidden Clip creator, game, descriptions, and other hidden metadata cannot qualify a Clip.
- [x] Searching a Channel username can return that Channel's matching recent Clips even when cards display its display name.
- [x] Clip matches use the shared relevance ordering and deterministic popularity/date tie behavior defined for the feature.
- [x] Platform retrieval is bounded by matched-Channel count, content depth/time range, requests, concurrency, and wall-clock budget.
- [x] Per-Channel Clip fan-out starts only when the Clips tab is active and stops when the session is cancelled or superseded.
- [x] Matching cached Clips can appear immediately and are reconciled with fresh results, including removals and fresh empty responses.
- [x] The All tab does not trigger unbounded Clip fan-out and shows only a bounded preview when results are already available.
- [x] The selected Clips tab automatically requests more bounded work through an IntersectionObserver sentinel without duplicates.
- [x] The section displays `Recent content from matching channels.` so users are not told the results are globally exhaustive.
- [x] Clip payloads are runtime-validated before caching/rendering and can never generate navigation containing `undefined`.
- [x] Existing Clip cards can be reached and activated by keyboard and expose appropriate interactive semantics.
- [x] Platform failures, retries, rate limits, limits, exhaustion, counts, and loading state integrate with the shared session UI.
- [x] Tests cover field eligibility, username discovery, active-tab-only fan-out, retrieval bounds, cache reconciliation, validation, cancellation, disclosure copy, and keyboard activation.

## Blocked by

- `01-real-channel-and-live-stream-matches.md`
- `02-reliable-cross-platform-search-sessions.md`

## Comments

- 2026-07-17: Completed and independently audited 14/14. Final playback/search regression set passed 217/217; typecheck, lint, and production build passed. Clean Electron proof returned 12 real `xqc` Clips and played Twitch clip `the word` natively through 00:44/00:44 with no failed-load UI or iframe fallback. Evidence: `.scratch/images/search-clips-xqc-results.png` and `.scratch/images/search-clip-xqc-playback-fixed.png`.
