Status: done
Type: AFK

# Return fuzzy cross-Platform Category matches

## Parent

`.scratch/grill-with-docs/2026-07-16-search-match-explanations/prd.md`

## What to build

Add real Category results to submitted search using the shared fuzzy contract and reliable search-session behavior. Search Category names and tags already present in Platform results, paginate only in the selected Categories tab, and merge exactly equivalent Category names across Platforms while retaining both Platform identities.

## Acceptance criteria

- [x] A Category is displayed only when every normalized query token matches its name or tags already present in the search result.
- [x] Hover-only metadata is not fetched or used to establish Category eligibility.
- [x] Category matches use the shared exact, prefix, fuzzy, field-priority, and deterministic popularity ranking rules.
- [x] One-character queries do not request or display Category results; full Category search begins at two characters.
- [x] Category payloads are runtime-validated before caching or rendering, with malformed values rejected and diagnosed.
- [x] Categories are deduplicated by Platform-scoped identity within each Platform.
- [x] Under the All-Platform filter, Categories merge only when normalized names exactly match and retain both Platform IDs for navigation.
- [x] The selected Categories tab automatically fetches additional network pages through an IntersectionObserver sentinel.
- [x] Twitch and Kick pagination, seen identities, terminal reasons, failures, cancellation, and retry remain independent.
- [x] The All tab shows only a bounded Category preview and does not trigger unbounded Category pagination.
- [x] Counts and loading, partial-error, exhaustion, retrying, and limit states update accessibly as pages append.
- [x] Tests cover hidden-field exclusion, cross-Platform merging, near-name non-merging, independent pagination, validation, and cancellation.

## Blocked by

- `01-real-channel-and-live-stream-matches.md`
- `02-reliable-cross-platform-search-sessions.md`

## Comments

- Completed 2026-07-17. Independent audit proved 12/12 criteria. Final gates: 161 focused tests, typecheck, lint (559 files), build, React Doctor, and deslop all passed. Electron showed a single exact-merged `Just Chatting` result retaining Twitch `509658` and Kick `15`, then navigated with both IDs.
