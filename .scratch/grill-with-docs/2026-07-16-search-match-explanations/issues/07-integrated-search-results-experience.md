Status: done
Type: AFK

# Complete the integrated Search Results experience

## Parent

`.scratch/grill-with-docs/2026-07-16-search-match-explanations/prd.md`

## What to build

Integrate Channels, Streams, Categories, Videos, and Clips into the complete submitted Search Results experience. Preserve the existing layout and card styling while making All a bounded overview and each type tab the sole owner of its network pagination. Finish filter resets, aggregate state, accessibility, and end-to-end Electron verification across both Platforms.

## Acceptance criteria

- [x] The All tab shows bounded previews of available result types and never paginates all five types concurrently.
- [x] Each selected result-type tab owns its IntersectionObserver pagination and stops work when another tab becomes active.
- [x] Platform and Live Only filters are preserved and changes reset incompatible pages, cancel prior work, and never mix sessions.
- [x] Channels and live Streams remain separate results and sections even when they refer to the same broadcaster.
- [x] Counts reflect currently loaded eligible results and update consistently across reconciliation, filters, and appended pages.
- [x] Loading, partial Platform failure, retrying, true exhaustion, safety-limit, disclosure, and final no-results states remain distinct.
- [x] Final no-results appears only when all enabled Platforms have exhausted, failed, or reached a disclosed limit.
- [x] Retry controls target only failed Platforms while preserving all working results across every result type.
- [x] Search tabs expose selected state; loading surfaces use `aria-live`/`aria-busy`; appended content does not steal focus; Clip results remain keyboard-operable.
- [x] The current page layout and result cards are preserved with no match highlighting, match-reason labels, explanation snippets, or autocomplete expansion.
- [x] Once a submitted search has prefetched or cached a result type, activating any Search Results tab renders its eligible cached content within 50 ms at p95 in repeatable Electron measurements; provider freshness updates continue in the background without blanking the tab.
- [x] The reproduced `streamer univer` scenario shows only real eligible results and never renders malformed Stream placeholders or `/undefined` navigation.
- [x] Electron MCP verification covers All and every type tab, infinite scrolling, Platform/Live Only filters, query changes, partial failure and retry, safety limits, disclosures, and keyboard behavior.
- [x] Focused tests, the full test suite, lint, type-check, build, and the repository's `deslop` workflow all pass before the issue is closed.

## Blocked by

- `03-progressive-live-stream-discovery.md`
- `04-fuzzy-cross-platform-category-results.md`
- `05-recent-video-results.md`
- `06-recent-clip-results.md`

## Comments

- Completed the integrated Search Results experience with bounded All previews, active-tab-only pagination, stable session/filter resets, eligible active counts, terminal-state handling, targeted retries, accessibility state, and unchanged card/layout styling without match highlighting.
- Added cache-first progressive rendering and background freshness behavior. Production Electron measurements are recorded in `.scratch/logs/runtime/search-tab-p95.json`: three runs per tab, 40 reported samples per run after warmups, every p95 below 50 ms; worst p95 was 35.7 ms and worst maximum was 41.8 ms.
- Electron proof covered real Twitch and Kick filtering, All and every type tab, Videos/Clips switching to Streams under Live Only, query changes, bounded paging and duplicate-page exhaustion, disclosed safety limits, Clip focus/playback, real `streamer univer` title/channel matches, valid Stream navigation/playback, and controlled partial Kick failure/retry while retaining the working Twitch result. Key artifacts are under `.scratch/images/search-integrated-*` and `.scratch/images/search-streamer-univer-playback-production.png`.
- Final verification: focused Search suite 47/47; independent audit suite 219/219 across 11 files; full suite 452 files and 5,705 tests; lint checked 562 files; type-check passed; production build passed; `git diff --check` and the repository deslop review passed.
- Independent acceptance audit recommended closure with all 14 criteria passing.
