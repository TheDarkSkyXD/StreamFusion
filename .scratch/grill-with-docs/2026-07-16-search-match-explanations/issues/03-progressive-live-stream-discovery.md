Status: done
Type: AFK

# Discover Streams by title, category, tags, and language

## Parent

`.scratch/grill-with-docs/2026-07-16-search-match-explanations/prd.md`

## What to build

Supplement Platform-native identity search with progressive live-directory discovery so a submitted query can find real live Streams through the approved visible Stream fields. Deliver network-backed automatic pagination in the selected Streams tab, with independent Platform state, bounded work, cancellation, and explicit terminal reasons.

## Acceptance criteria

- [x] A query such as `streamer` can return a retrieved live Stream when the term matches its visible title, category, result-provided tags/language, or Channel identity.
- [x] Every Stream passes the shared all-token fuzzy eligibility contract before display and is a complete validated `UnifiedStream`.
- [x] Platform-native results and progressive live-directory pages merge without duplicate Platform-scoped Stream identities.
- [x] Twitch and Kick track cursor, seen identities, exhaustion, repeated cursor, failure, and safety-limit reason independently.
- [x] Empty, repeated, and stuck cursors terminate retrieval without duplicate-page loops.
- [x] An IntersectionObserver sentinel automatically requests the next network page only while the Streams tab is selected.
- [x] The All tab displays a bounded Stream preview and does not continuously scan live directories at its bottom.
- [x] Query, Platform, tab, and Live Only changes cancel scanning and prevent stale page append.
- [x] Centralized wall-clock, page, request, and concurrency budgets are calibrated by performance tests rather than arbitrary constants.
- [x] Rate limits honor 429 and Retry-After responses and expose a retryable or terminal state without discarding other Platform results.
- [x] Hitting a calibrated cap before exhaustion displays `Search limit reached; refine your query.` and remains distinct from true exhaustion.
- [x] Appended Stream results update counts and do not steal keyboard focus.
- [x] Tests cover matching across multiple fields, independent pagination, duplicate pages, cancellation, rate limiting, caps, and selected-tab-only retrieval.

## Blocked by

- `01-real-channel-and-live-stream-matches.md`
- `02-reliable-cross-platform-search-sessions.md`

## Comments

- Completed 2026-07-17. Final audit proved 13/13 criteria with 162 focused tests. Six real Electron observations calibrated provider budgets; Electron showed matching Twitch/Kick titles and a clickable Kick result with working player and live chat.
