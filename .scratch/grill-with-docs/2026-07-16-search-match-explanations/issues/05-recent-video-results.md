Status: done
Type: AFK

# Return recent Videos from matching Channels

## Parent

`.scratch/grill-with-docs/2026-07-16-search-match-explanations/prd.md`

## What to build

Add non-exhaustive Video search by fetching bounded recent content from matched Channels and merging matching local cache entries. Video eligibility uses only the title and Channel identity fields. Defer Platform fan-out until the Videos tab is active, while allowing the All tab to show only already available or deliberately bounded preview content.

## Acceptance criteria

- [x] Video eligibility requires every normalized query token to match the Video title or Channel display name/username.
- [x] Hidden descriptions and other hidden metadata cannot qualify a Video.
- [x] Searching a Channel username can return that Channel's matching recent Videos even when cards display its display name.
- [x] Video matches use the shared relevance ordering and deterministic popularity/date tie behavior defined for the feature.
- [x] Platform retrieval is bounded by matched-Channel count, content depth/time range, requests, concurrency, and wall-clock budget.
- [x] Per-Channel Video fan-out starts only when the Videos tab is active and stops when the session is cancelled or superseded.
- [x] Matching cached Videos can appear immediately and are reconciled with fresh results, including removals and fresh empty responses.
- [x] The All tab does not trigger unbounded Video fan-out and shows only a bounded preview when results are already available.
- [x] The selected Videos tab automatically requests more bounded work through an IntersectionObserver sentinel without duplicates.
- [x] The section displays `Recent content from matching channels.` so users are not told the results are globally exhaustive.
- [x] Video payloads are runtime-validated before caching/rendering and can never generate navigation containing `undefined`.
- [x] Platform failures, retries, rate limits, limits, exhaustion, counts, and loading state integrate with the shared session UI.
- [x] Tests cover field eligibility, username discovery, active-tab-only fan-out, retrieval bounds, cache reconciliation, validation, cancellation, and disclosure copy.

## Blocked by

- `01-real-channel-and-live-stream-matches.md`
- `02-reliable-cross-platform-search-sessions.md`

## Comments

- Completed 2026-07-17. Independent audit proved 13/13 criteria. Final gates: 322 focused tests with every file under two seconds, typecheck, lint, build, React Doctor, and deslop all passed. Electron returned eight real recent `xqc` Videos, showed the bounded-search disclosure, and opened `/video/twitch/2813703686` successfully.
