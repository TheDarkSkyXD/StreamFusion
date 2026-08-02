Status: done
Type: AFK

# Make cross-Platform searches reliable

## Parent

`.scratch/grill-with-docs/2026-07-16-search-match-explanations/prd.md`

## What to build

Turn the Channel/Stream search slice into a reliable Twitch-and-Kick search session. Give submitted searches a main-process session identity, preserve successful Platform results when the other Platform fails, expose targeted retry state, and reconcile matching cached results with fresh results. This slice must deliver observable renderer behavior rather than only changing an IPC contract.

## Acceptance criteria

- [x] Every submitted search has a main-process session identifier shared across its retrieval work and responses.
- [x] Changing the query, Platform filter, active tab, or Live Only filter cancels prior main-process work and prevents late results from appending.
- [x] Search responses expose status, retryability, and error information separately for Twitch and Kick instead of converting failures into empty successes.
- [x] When Twitch fails and Kick succeeds, Kick results remain visible and the notice names Twitch; the inverse behavior also works.
- [x] Retrying a failed Platform requests only that Platform and preserves results from the working Platform.
- [x] Matching cached results can render immediately and fresh results reconcile additions, updates, removals, and fresh empty responses.
- [x] Cache keys include normalized query, Platform, result type, filters, and relevant retrieval limits.
- [x] Loading, partial failure, retrying, exhaustion, and final no-results are distinct states; final no-results waits until every enabled Platform has exhausted or failed.
- [x] Counts represent currently loaded valid matches and update when results are reconciled or appended.
- [x] Boundary validation rejects malformed Channel and Stream payloads before caching or rendering and records a diagnostic event.
- [x] Status changes use appropriate `aria-live`/`aria-busy` behavior and do not steal keyboard focus.
- [x] Tests cover cancellation, stale responses, cache reconciliation, both one-Platform failure directions, and targeted retry.

## Blocked by

- `01-real-channel-and-live-stream-matches.md`

## Comments

- Completed 2026-07-17. All acceptance criteria passed independent review, including cancellation, stale-response suppression, canonical caching, partial failures, retry, validation, counts, and focus stability.
