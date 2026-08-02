Status: done
Type: AFK

# Return real Channel and live Stream matches

## Parent

`.scratch/grill-with-docs/2026-07-16-search-match-explanations/prd.md`

## What to build

Make the submitted Search Results path return only real, query-eligible Channel and live Stream results from Twitch and Kick. Introduce the shared normalization, fuzzy eligibility, and ranking contract through this end-to-end slice. Hydrate matched live Channels into complete `UnifiedStream` values instead of copying Channel-shaped data into the Stream collection. Preserve the current page and card design; do not add highlighting or match explanations.

## Acceptance criteria

- [x] The submitted query `streamer univer` displays only real Channels and complete live Streams that match every normalized query token.
- [x] Query normalization handles Unicode case and accents, collapsed whitespace, punctuation, `@`, underscores, hyphens, numbers, meaningful emoji, and repeated-token deduplication.
- [x] Matching supports substring and prefix matches and allows one Damerau-style edit only for tokens of five or more characters, including adjacent transposition.
- [x] A one-character query returns Channel username/display-name prefix matches only and performs no live-directory, Category, Video, or Clip scan.
- [x] Channel eligibility uses only display name and username; Stream eligibility uses title, Channel display name/username, category, and result-provided visible tags/language.
- [x] Every normalized query token must match at least one approved field; hidden fields and unverified Platform suggestions cannot qualify a result.
- [x] Results rank exact identity/name before prefix, fuzzy identity/name, title, category, and tags/language, with popularity used only as a deterministic tie-breaker.
- [x] The signed-in user's Channel participates normally in fuzzy matching without an ownership boost or exact-query-only exclusion.
- [x] A matched live Channel is hydrated through the Platform stream endpoint and returned as a complete validated `UnifiedStream`.
- [x] Malformed Channels and Streams are rejected at the backend boundary; existing image fallbacks remain allowed.
- [x] No result creates an `/undefined` navigation path or a placeholder Stream card caused by missing required data.
- [x] Clicking a valid Stream result navigates with its real Platform and Channel identity to the watch page, where the Stream can be opened in the running Electron app.
- [x] Platform-scoped identities are deduplicated within each result type while a Channel and its live Stream remain separate results.
- [x] Focused matcher, backend contract, and renderer regression tests cover these behaviors before implementation is completed.

## Blocked by

None - can start immediately.

## Comments

- Completed 2026-07-17. Focused tests, typecheck, lint, and build passed. Electron verified real fuzzy Channel/Stream results for `streamer univer`, no placeholder routes, and a result opening the live watch page.
