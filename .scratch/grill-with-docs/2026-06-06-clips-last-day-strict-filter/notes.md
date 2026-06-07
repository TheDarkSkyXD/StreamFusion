# Clips "Last Day" → strict 24-hour cutoff (Kick + Twitch): Grilling Session Notes
Date: 2026-06-06 · Goal: Make the Clips tab "Last Day" filter show only clips created within the last 24 hours (rolling window) on both Kick and Twitch.

## Summary / key decisions
- User reports: "Last Day" filter currently returns clips older than 24 hours.
- Code map (already explored):
  - UI: `apps/desktop/src/components/stream/related-content/index.tsx` — `TimeRange = "day" | "week" | "month" | "all"`, dropdown labels "Last Day / Last Week / Last Month / All Time", persisted in `localStorage["clips-filter-preference"]`.
  - IPC handler: `apps/desktop/src/backend/ipc/handlers/video-handlers.ts` `CLIPS_GET_BY_CHANNEL`.
    - Twitch: maps `"day"` → GQL filter `LAST_DAY` and trusts the API. **No client-side cutoff.**
    - Kick: only the "Deep Fetch" branch (when `sort === "views"` AND `timeRange !== "all"`) applies a client-side `new Date(created_at) >= cutoffDate` filter. The "Standard single page fetch" branch (date-sort, or all-time) **passes `timeRange` to `kickClient.getClips` but the Kick endpoint URL ignores it** — no time param is sent to Kick's API. **Filter is a no-op for the date-sort branch.**
  - Kick clips endpoint: `apps/desktop/src/backend/api/platforms/kick/endpoints/clip-endpoints.ts` — only sends `cursor`, `limit`, `sort` to `/channels/<slug>/clips`. Returns `created_at` (ISO) on each clip.
  - Twitch GQL filter `LAST_DAY` is a server-side enum; not guaranteed to be a strict 24-hour rolling window.

### Final plan
1. **`video-handlers.ts` → `CLIPS_GET_BY_CHANNEL`**: add a strict client-side cutoff for `timeRange ∈ {day, week, month}` on both platform branches.
   - Cutoff = `Date.now() − N × 86400000` (N = 1, 7, 30). Inclusive boundary: `createdAt >= cutoff`.
   - **Fill-the-page loop**: each IPC call requests upstream pages (Kick = `limit: 100`, Twitch = `first: 100`) until one of: (a) collected `limit` in-range clips → return next upstream cursor; (b) saw an out-of-range clip → return `cursor: undefined`; (c) hit `MAX_INTERNAL_PAGES = 5` → return upstream cursor.
   - **Twitch branch**: keep `LAST_DAY/WEEK/MONTH` GQL filter as a first-pass server-side hint; layer the strict client-side cutoff on top of GQL results.
   - **Kick standard-fetch branch**: replace the single-page fetch with the new fill-the-page loop when `timeRange ≠ 'all'`.
   - **Kick Deep Fetch branch (views-sort + day/week/month)**: leave intact — pre-fetches + sorts by views + returns `cursor: undefined`. Already correct for its use case.
   - **`timeRange === 'all'`**: no cutoff, no fill-loop. Existing single-page fetch + cursor pass-through is unchanged.
   - Add `console.debug` lines summarising cutoff / candidates fetched / in-range count / final cursor.
2. **`related-content/index.tsx`** (UI): bump per-page request from 5 → 20 for **clips tab and videos tab** (initial + load-more + hasMore + partial-page-stop). Home-dashboard previews stay at 5.
3. **New tests**: `tests/backend/ipc/video-handlers.test.ts` covering day/week/month cutoff (all-in / mixed / all-out), all-time pass-through, views-sort Deep Fetch regression, and MAX_INTERNAL_PAGES safety cap.

## Q&A log
### Q1 — Cutoff semantics
- Asked: How should the 24-hour cutoff be computed? Rolling-from-request vs calendar-day vs rolling-from-tab-open.
- Captured: **Rolling 24h from request time.** Cutoff = `Date.now() - 24*60*60*1000` evaluated inside the IPC handler each call. Boundary inclusive: `clip.createdAt >= cutoff`. Refresh/pagination re-computes — the window slides.
- Doc updates: none yet.
- Flags: none.

### Q2 — Scope of the strict cutoff
- Asked: Apply strict cutoff to all three ranges, or only "Last Day"?
- Captured: **All three ranges.** day=24h, week=7d (7*24h), month=30d (30*24h). 'All Time' is unbounded, no cutoff. One uniform rule keeps Kick's date-sort path correct on every range and protects against Twitch GQL filter slippage.
- Doc updates: none yet.
- Flags: none.

### Q3 — Kick date-sort pagination strategy
- Asked: When client-side cutoff trims a Kick date-sort page below requested size, deep-fetch / accept truncation / always-deep-fetch?
- Captured: **Mini deep-fetch.** Mirror the existing Deep Fetch shape (loop pages, stop when last clip < cutoff), but bounded — keep MAX_PAGES modest (e.g. 5-10) to avoid the 30-page cost. Date-sort means Kick already returns newest-first, so once we see one older-than-cutoff clip we can stop.
- Doc updates: none yet.
- Flags: confirm MAX_PAGES value in Q4.

### Q4 — Kick mini deep-fetch caps
- Asked: How many pages × what page size for date-sort + day/week/month?
- Captured: **100 per page, MAX_PAGES = 5.** Up to 500 newest clips scanned per fetch. Loop stops early when the last clip in a page is older than cutoff. Front-end's `limit: 5` is ignored on the loop; only the final filtered slice is sized for the UI.
- Doc updates: none yet.
- Flags: superseded by Q5 — the loop now fills the UI's requested limit per IPC call instead of scanning to cutoff in one shot.

### Q5 — Pagination strategy with strict filter
- Asked: Keep infinite scroll working with strict cutoff?
- Captured: **Per-IPC-call "fill the page" loop.** Each IPC call loops upstream pages until one of:
  1. Filled `limit` in-range clips → return next upstream cursor (UI keeps scrolling).
  2. Saw a clip older than cutoff → return `cursor: undefined` (UI stops; upstream has nothing more in range).
  3. Hit `MAX_INTERNAL_PAGES = 5` safety cap → return upstream cursor (UI keeps scrolling next call).
  Applies symmetrically on Twitch (GQL pages) and Kick (legacy v2 pages). Replaces the "pre-fetch entire in-range set" idea from earlier — user explicitly said don't break infinite scroll.
- Doc updates: none yet.
- Flags: none.

### Q6 — Upstream page size during the loop
- Asked: Bump upstream page size during the fill loop?
- Captured: **100 per page on both platforms when timeRange != 'all'.** Most channels fit one round-trip → MAX_INTERNAL_PAGES is rarely hit. Result handed to UI is still trimmed to UI's `limit` (typically 5). For timeRange = 'all', leave the current behavior untouched (pass UI's limit straight through).
- Doc updates: none yet.
- Flags: none.

### User clarification (mid-Q6)
- User said: "for the 7 days show also the last 1 sec ago 2 hrs ago and same for the 30 days and 1 day ago" → **confirms rolling-window semantics** for Last Week (now − 7d) and Last Month (now − 30d). 1-second-old clips are still in-range for all three filters; the cutoff is just the older boundary.
- User said: "for all time… there shouldn't be a limit we should see all the clips for that filter" → **All Time must not be artificially capped.** Don't apply a cutoff. Pagination should keep going until the upstream API runs out of clips.

### Q7 — All Time pagination scope
- Asked: Should this PR also fix the early-stop on partial pages for All Time?
- Captured: **Leave existing UI infinite-scroll logic alone.** All Time today already paginates until upstream returns no cursor; we don't touch the cursor for `timeRange === 'all'`. Scope-creep risk is real. If a specific channel shows All Time stopping short, file a separate bug with a repro.
- Doc updates: none yet.
- Flags: none.

### Q8 — Views-sort + day/week/month behavior
- Asked: Switch views-sort to the new fill-the-page loop too, or keep existing Deep Fetch behavior?
- Captured: **Keep existing Deep Fetch.** Views-sort needs a wide sample to rank "top viewed clips in the period" meaningfully. Pre-fetching everything in-range then sorting is correct. Infinite-scroll being off there is acceptable — list is already sorted by what matters.
- Doc updates: none yet.
- Flags: none.

### User clarification (mid-Q8)
- User said: "we should also see 20 at a time when scrolling and load the 20 clips at a time from the 5 we have now" → **bump the per-page request from 5 to 20** for the clips tab. Both initial fetch and load-more should request 20. UI's `< 5` stop conditions become `< 20`.

### Q9 — Scope of the 5→20 page-size bump
- Asked: Which tabs?
- Captured (initial answer): "Clips tab only."
- **User revision (post-Q10): "we should also do the same for videos load 20 instead of 5"** → bump videos tab too. Final scope: **Clips tab + Videos tab.** Home-dashboard previews still stay at 5 (renders only 4 cards).
- Specific edits in `related-content/index.tsx`:
  - L206 `limit: 5` → `20` (videos tab initial fetch)
  - L211 `>= 5` → `>= 20` (videos hasMore check)
  - L221 `limit: 5` → `20` (clips tab initial fetch)
  - L228 `>= 5` → `>= 20` (clips hasMore check)
  - L269 `limit: 5` → `20` (videos load-more)
  - L283/L305 `< 5` → `< 20` (videos load-more partial-page stop, and "newVideos.length < 5" gate)
  - L318 `limit: 5` → `20` (clips load-more)
  - L355 `< 5` → `< 20` (clips load-more partial-page stop)
  - **Do NOT change** L171 (home dashboard clips), L178 (home dashboard videos).
- Doc updates: none yet.
- Flags: none.

### Q10 — Boundary semantics
- Asked: Inclusive or exclusive cutoff at the older edge?
- Captured: **Inclusive (`createdAt >= cutoff`).** Matches existing Kick Deep Fetch (line 425 in video-handlers.ts: `d >= cutoffDate`) and the natural reading of "max 24 hours ago."
- Doc updates: none yet.
- Flags: none.

### Q11 — Safety cap with new limit=20
- Asked: Does MAX_INTERNAL_PAGES=5 still hold up at limit=20?
- Captured: **Yes, keep MAX_INTERNAL_PAGES = 5.** Upstream page = 100 → up to 500 candidates scanned per IPC call. Typical channels fill 20 in-range in 1 round-trip. Sparse cases resolve over 2-3 UI scrolls. No need to tune further.
- Doc updates: none yet.
- Flags: none.

### Q12 — Test strategy
- Asked: How to test this change?
- Captured: **New unit tests for the IPC handler.** Create `tests/backend/ipc/video-handlers.test.ts`. Mock `kickClient.getClips` and `twitchClient.getClipsByChannel`. Coverage:
  - day/week/month cutoff: all-in / mixed / all-out cases; verify in-range subset returned and cursor handling (undefined when older-than-cutoff seen).
  - all-time pass-through: no filter applied, cursor preserved (regression guard).
  - views-sort + day/week/month: existing Deep Fetch behavior preserved (regression guard).
  - MAX_INTERNAL_PAGES = 5 safety cap: loop stops at 5 iterations even if no older clip seen.
- Doc updates: none yet.
- Flags: none.

## Open flags (pending input)
(none yet)
