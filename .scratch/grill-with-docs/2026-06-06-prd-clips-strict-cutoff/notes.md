## Problem Statement

When viewers open a channel's Clips tab and pick **Last Day**, they expect to see only the clips that were created within the last 24 hours — from clips made a few seconds ago up to clips made at most 24 hours ago. In practice the list also contains clips from days, weeks, or even months earlier, so "Last Day" feels broken. The same trust issue affects **Last Week** and **Last Month**: both ranges currently leak clips older than their nominal window.

A secondary friction: scrolling the Clips and Videos tabs only loads 5 items at a time, so viewers have to scroll repeatedly to browse a channel's history.

## Solution

The Clips tab's time-range filter becomes a **strict rolling window** computed at request time on both Kick and Twitch:

- **Last Day** = clips with `createdAt` between now and 24 hours ago (inclusive on the older edge).
- **Last Week** = clips with `createdAt` between now and 7 days ago.
- **Last Month** = clips with `createdAt` between now and 30 days ago.
- **All Time** = no cutoff applied; pagination continues until the upstream platform reports there are no more clips.

The filter is enforced inside the main process's clips IPC handler so the UI doesn't need to know whether the platform is Kick or Twitch. Infinite scroll is preserved — each IPC call still returns a cursor when more in-range clips may exist upstream, and only returns `cursor: undefined` once it has actually walked past the older boundary.

On top of the correctness fix, the Clips tab and Videos tab both load **20 items per page** instead of 5. Home-dashboard previews (which only render 4 cards) keep the existing 5-item fetch.

## User Stories

1. As a viewer browsing a channel, I want **Last Day** to show only clips created in the last 24 hours, so the filter label matches what I see.
2. As a viewer, I want a clip made one second ago to appear under **Last Day**, so newly-made clips are still considered recent.
3. As a viewer, I want a clip made 23 hours and 59 minutes ago to appear under **Last Day**, so the boundary is intuitive.
4. As a viewer, I want a clip made 24 hours and 1 minute ago to be hidden from **Last Day**, so older clips cannot leak through.
5. As a viewer, I want the **Last Week** filter to follow the same rolling-window rule — anything from one second ago up to 7 days ago is shown, anything older is hidden.
6. As a viewer, I want the **Last Month** filter to follow the same rule with a 30-day window.
7. As a viewer, I want **All Time** to keep showing every clip the platform has, with no artificial cap — I should be able to scroll until the platform runs out of clips.
8. As a viewer, I want each refresh of the Clips tab to recompute the window from "now," so the list never gets stale just because I left the tab open.
9. As a viewer, I want the rolling-window rule to apply on **both Kick and Twitch** channels so the behavior is consistent regardless of platform.
10. As a viewer, I want infinite scroll to keep working under **Last Day / Last Week / Last Month** so I can load more in-range clips beyond the first page.
11. As a viewer, I want infinite scroll to stop automatically once there are no more in-range clips on the channel, so I'm not stuck waiting for items that will never appear.
12. As a viewer sorting clips by **Most Recent** under a time-range filter, I want the newest in-range clips first.
13. As a viewer sorting clips by **Views** under a time-range filter, I want the existing "top viewed clips in the period" behavior preserved — that ranking already deep-fetches and is correct.
14. As a viewer, I want the Clips tab to load **20 clips per scroll** instead of 5, so I can scan a channel's clip library faster.
15. As a viewer, I want the Videos tab to load **20 videos per scroll** instead of 5, with the same rationale.
16. As a viewer on a channel's **home view** (the default tab with "Stream Videos" and "Popular Clips" preview rows), I want those preview rows to stay snappy — they don't need to fetch 20 items just to render 4.
17. As a viewer, I want my chosen filter (Last Day / Week / Month / All Time) to remain selected across page reloads, the same way it does today.
18. As a viewer on a quiet channel that hasn't clipped anything in the last 24 hours, I want **Last Day** to show an empty state rather than fall back to older clips.
19. As a viewer, I want the filter and sort selectors to behave the same way they do today (instant update, same labels) — only the result set changes.
20. As a developer maintaining this feature, I want the cutoff logic to live in one place (the IPC handler) so future platforms or filters can hook into the same rule.
21. As a developer, I want the IPC handler to log enough diagnostic detail (cutoff timestamp, candidates fetched, in-range count, final cursor) so I can debug filter complaints from real channels.
22. As a developer, I want unit tests around the IPC handler's cutoff and fill-the-page loop so regressions are caught before release.
23. As a developer, I want the existing Kick "Deep Fetch" branch (views-sort + non-"all" time range) untouched so I don't destabilize a working code path.
24. As a developer, I want the All Time path untouched so the existing infinite-scroll behavior for unfiltered browsing doesn't regress.

## Implementation Decisions

### Cutoff semantics
- The cutoff is a **rolling window** recomputed each IPC call: `cutoff = Date.now() − N × 86_400_000`, where N is 1 for `day`, 7 for `week`, 30 for `month`. `All Time` has no cutoff.
- The boundary is **inclusive**: a clip is in-range when `clip.createdAt >= cutoff`. This matches the existing Kick Deep Fetch branch and the natural reading of "max 24 hours ago."
- "Now" is the moment the IPC handler runs the request, not the moment the user opened the tab. The window slides on every fetch.

### Where the cutoff lives
- The cutoff and the fill-the-page loop both live inside the clips IPC handler (the existing handler that resolves clips by channel for both platforms). The renderer continues to pass `timeRange` as today; no UI logic needs to know how the cutoff is enforced.
- The Twitch GQL `LAST_DAY / LAST_WEEK / LAST_MONTH` filter is still passed as a first-pass server-side hint, but the strict client-side cutoff is layered on top. Twitch's enum is not guaranteed to be a strict 24-hour rolling window, so it cannot be the source of truth.
- The Kick clip endpoint does not support time filtering at the URL level today; the strict cutoff is enforced after fetching.

### Fill-the-page loop (Twitch GQL branch + Kick standard-fetch branch)
- Per IPC call, the handler loops upstream pages until one of three conditions is met:
  1. **Filled `limit` in-range clips** → return the next upstream cursor so the UI's infinite scroll can request the next batch.
  2. **Encountered a clip with `createdAt < cutoff`** → return `cursor: undefined`. Because both platforms return clips in newest-first order for the date-sort path, an older-than-cutoff clip signals there is nothing more in range.
  3. **Hit the internal safety cap (`MAX_INTERNAL_PAGES = 5`)** → return the next upstream cursor so the next infinite-scroll trigger continues where this call stopped.
- Each upstream page in this loop requests **100 items** (vs the UI's `limit`). For typical channels one round-trip fills 20 in-range clips; sparse cases resolve over a few UI scrolls.
- The result handed back to the UI is trimmed to the UI's `limit` (`20` after this change).

### Kick "Deep Fetch" branch (views-sort + non-"all" time range)
- Untouched. The existing branch already pre-fetches up to 30 pages, filters by cutoff, sorts by views, and returns `cursor: undefined`. That behavior is correct for "top viewed clips in the period" — switching it to the fill-the-page loop would break the ranking's accuracy by only sampling a few pages.

### All Time path
- Untouched. No cutoff applied. Upstream cursor is passed through to the UI. The existing infinite-scroll behavior (stop when upstream returns no cursor, when all returned IDs are duplicates, or when the cursor doesn't advance) remains the source of truth for end-of-list.

### Page-size bump (5 → 20)
- The Clips tab's initial fetch, load-more request, "has more" check, and partial-page-stop guard all switch from 5 to 20.
- The Videos tab's initial fetch, load-more request, "has more" check, and partial-page-stop guards all switch from 5 to 20.
- The home-dashboard preview fetches (which render only 4 cards) stay at 5 to avoid wasted bandwidth.
- The `localStorage` keys for filter and sort preferences (`clips-filter-preference`, `content-sort-preference`, `stream-tab-preference`) are unchanged.

### Diagnostics
- Add `console.debug` lines summarising each cutoff-aware fetch: range, computed cutoff (ISO), pages walked, candidates seen, in-range count, and what was returned for `cursor`. Mirror the format of the existing `[KickClip]` Deep Fetch logs.

### What does not change
- The `TimeRange` type (`"day" | "week" | "month" | "all"`), the filter dropdown labels, the sort dropdown, and how preferences persist all stay the same.
- The Kick legacy v2 clips endpoint URL (only `cursor`, `limit`, `sort`) is unchanged — Kick still doesn't accept a time parameter; the filter is purely renderer-bound through the IPC handler.
- The shape of the IPC response (`{ success, data, cursor }`) is unchanged.

## Testing Decisions

### What makes a good test here
- Test the IPC handler's **observable behavior** — the `{ success, data, cursor }` it returns for a given combination of `(platform, timeRange, sort, cursor)` — by mocking the upstream platform clients. Do not test the internal loop counter or how many upstream pages it hit; those are implementation details.
- Use deterministic time. Freeze `Date.now()` (Vitest fake timers) so cutoff math is reproducible. Build fixture clips with `createdAt` offsets relative to "now" (e.g. `now − 1h`, `now − 23h`, `now − 25h`, `now − 8d`).
- Cover the three branches (Twitch standard, Kick standard, Kick Deep Fetch) independently — they have distinct code paths.

### Modules under test
- **Primary**: the clips IPC handler in `backend/ipc/handlers`. Mock `kickClient.getClips` and `twitchClient.getClipsByChannel`. Assert the data array contents (in-range clips only), the cursor (next upstream cursor when more may exist; `undefined` when the loop crossed the cutoff or scanned everything), and that views-sort + day/week/month still drops the cursor (regression guard for Deep Fetch).
- **Secondary**: a light component-level regression in the existing `RelatedContent` test file — assert the mocked `electronAPI.clips.getByChannel` / `videos.getByChannel` are called with `limit: 20` on the Clips and Videos tabs. No need to re-test the cutoff logic from the component.

### Coverage matrix for the IPC handler
- For each `timeRange ∈ {day, week, month}` on each platform branch:
  - All fixture clips in-range → returns `min(limit, fixtureCount)` clips, cursor passed through unchanged.
  - Mixed (some in, some out) → returns only the in-range subset up to `limit`; cursor is `undefined` as soon as an out-of-range clip is encountered.
  - All clips out-of-range → returns `[]`, cursor `undefined`.
- `timeRange === 'all'` → cutoff path skipped, cursor passed through, no clips dropped (regression guard).
- Views-sort + day/week/month on Kick → existing Deep Fetch path runs, returns `cursor: undefined` and a views-sorted slice (regression guard).
- Safety cap → with a stub that keeps producing in-range clips and never returns out-of-range, the loop stops at `MAX_INTERNAL_PAGES = 5` and returns the upstream cursor.

### Prior art
- `tests/backend/ipc/sender-origin.test.ts` — pattern for testing IPC handler behavior in isolation.
- `tests/backend/api/platforms/kick/*.test.ts` and `tests/backend/api/platforms/twitch/*.test.ts` — patterns for mocking platform clients with `vi.fn()` fixtures.
- `tests/components/stream/related-content/index.test.tsx` — existing component test that already mocks `electronAPI`; extend it for the `limit: 20` assertion.

## Out of Scope

- Changing the dropdown labels ("Last Day", "Last Week", "Last Month", "All Time") or adding new ranges (e.g. "Last Hour", custom date range).
- Changing the sort options or their labels.
- Fixing or auditing the existing UI infinite-scroll stop conditions (`newClips.length < limit`, duplicate-ID stop, cursor-unchanged stop) for the **All Time** path. If a specific channel exhibits early-stop under All Time, that's a separate bug with a separate repro.
- Touching the Kick "Deep Fetch" views-sort branch other than letting it coexist with the new path.
- Modifying the home-dashboard preview rows beyond what's needed to keep them rendering 4 cards from a 5-item fetch.
- Server-side filtering on the Kick API (the legacy v2 endpoint does not expose one).
- Caching / persisting the result set across navigations.
- VOD-availability checks for clips (the existing logic that maps `livestream_id` to known VODs stays exactly as it is).

## Further Notes

- The user emphasized during grilling that infinite scroll must not be broken by the strict filter. The fill-the-page loop is the mechanism that keeps infinite scroll meaningful under day/week/month.
- The grilling session capture file is at `.claude/skills/grill-with-docs/grill-with-docs-designs/2026-06-06-clips-last-day-strict-filter.md` and contains the full Q&A trail behind each decision.
- The Kick standard-fetch branch's bug (silently dropping the `timeRange` argument because the URL doesn't include it) is the primary failure mode for "Last Day" on Kick today. Twitch's failure mode is platform-side: GQL `LAST_DAY` is not guaranteed to be a strict 24-hour rolling window.
- No CONTEXT.md / ADR additions: the change is reversible, the trade-offs are small, and the decision-rich detail lives in the grilling capture file plus this PRD.
