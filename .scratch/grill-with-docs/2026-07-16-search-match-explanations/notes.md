# Search Results Relevance and Real Data: Grilling Session Notes
Date: 2026-07-16 · Goal: Make the submitted Search Results page return only real, relevant Platform results using normal fuzzy-search behavior.

## PRD

- [prd.md](./prd.md)

## Summary / key decisions

- The existing Search Results layout and cards remain unchanged.
- Broaden what qualifies as a search result; do not limit the feature to explaining the current provider-returned set.
- The immediate bug is that a submitted streamer search can show placeholder-like malformed data instead of the real Platform matches.
- Diagnosis reproduced with `streamer univer`: the page renders four `No Thumbnail · Live · 0 viewers` cards linking to `/stream/twitch/undefined` even though Twitch returned 20 real Channels.
- Root cause is two interacting defects: SEARCH_ALL copies live UnifiedChannel objects into the UnifiedStream array without required Stream fields, and the page removes real fuzzy Channel matches with a stricter username/display-name substring filter.
- Search matching is token-aware/fuzzy: normalize spacing and partial terms so a query such as `streamer univer` can match `streamersuniverse` or `Streamer University` when the result satisfies the approved field matrix.
- The overhaul covers every existing search tab: Channels, Streams, Categories, Videos, and Clips. Videos and Clips must be backed by real Platform retrieval rather than remaining empty/placeholder surfaces.
- Eligible fields are limited to text visible on the result card, with one identity exception: the owning Channel username remains searchable across Channel, Stream, Video, and Clip results even when a card displays only the Channel display name. Hidden descriptive metadata such as Video descriptions does not qualify.
- No match explanation UI is required: no highlighting, labels, snippets, chips, or additional rows. The feature is about returning relevant real results whose existing visible text matches the query.
- Every displayed item must satisfy the typed query against its visible searchable fields. Provider suggestions that cannot be justified by those fields must not appear.
- Rank matching items by relevance: exact identity/name, name prefix, fuzzy name, title, category, tags; use popularity only as a tie-breaker.
- Multi-word queries require every normalized token to match somewhere in the result's visible searchable fields. Single terms such as `streamer` must include retrieved Streams whose visible title contains or fuzzily matches that term.
- Retrieval uses real Platform search plus progressive live-directory matching for Stream title/category/tag coverage. Scanning stops at a performance-tested safety limit rather than attempting an unbounded catalog crawl.
- Progressive retrieval uses automatic infinite scroll inside the selected result-type tab rather than Load more controls or blocking the first display.
- Fuzzy tolerance is balanced: partial-word matching plus one-character typo tolerance for longer terms, while requiring every normalized query token to match.
- Videos and Clips use the current-app approach: fetch recent content from matched Channels, merge locally cached content, and fuzzy-filter visible card fields. These tabs are useful but not globally exhaustive.
- Video and Clip sections disclose this boundary with: “Recent content from matching channels.”
- On the All-platform filter, Categories with the same normalized name merge into one cross-platform result carrying both Platform IDs. Channels and owned content remain Platform-scoped.
- On the All tab, Channels and live Streams remain separate sections. Deduplicate within each type, not across types.
- If one Platform fails, show matching partial results from the working Platform plus an explicit retry notice for the failed Platform.
- Matching cached results may appear immediately, then must be reconciled against fresh Platform responses; stale/invalid items are updated or removed.
- The overhaul applies only to the submitted Search Results page. Autocomplete remains a lightweight suggestion surface. Existing Platform and Live Only filters remain intact.
- The All tab shows bounded previews. Automatic network infinite scroll runs only inside the selected result-type tab.
- If a progressive scan reaches its safety limit before Platform exhaustion, show “Search limit reached; refine your query” rather than silently implying completeness.
- The signed-in user's own Channel is treated like every other match; remove the current exact-query-only special exclusion and apply no ownership ranking boost.

## Q&A log

### Q1 — Visual scope
- Asked: Should the grill use quick visual mockups while deciding how matching text appears?
- Captured: Yes, but the UI should not meaningfully change. The feature should show what the user typed and which existing result content caused the match.
- Doc updates: none; this is feature-specific rather than glossary terminology.
- Flags: none.

### Q2 — Search behavior scope
- Asked: Should the feature only explain existing matches, or also expand search matching?
- Captured: Expand search matching.
- Doc updates: none; this is feature-specific behavior.
- Flags: The content types and eligible fields included in expanded matching remain to be decided.

### Q3 — Result-type scope / reported real-data failure
- Asked: Should expanded matching cover Channels and live Streams, or every result tab?
- Captured: The user reported a more fundamental issue instead of selecting a scope: searching for a streamer such as `univer` and submitting it shows mock data rather than real results.
- Doc updates: none.
- Flags: Result-type scope remains unanswered. Diagnosis resolved the data-source question: the content is not a literal fixture; it is malformed real Platform data rendered through placeholder fallbacks.

### Diagnostic checkpoint — submitted search shows placeholder data
- Reproduction: In the running Electron app, navigate to `/search?q=streamer univer`. Four visible cards link to `/stream/twitch/undefined` and show `No Thumbnail`, `Live`, and `0 viewers`. Reproduced twice.
- Direct IPC evidence: `electronAPI.search.all({ query: "streamer univer", platform: "twitch", limit: 20 })` returned 20 real Channels and four live entries in `streams`; those entries contained Channel fields such as `username` but lacked required Stream fields such as `channelName`, `channelDisplayName`, `title`, `thumbnailUrl`, and `viewerCount`.
- Cause 1: `SEARCH_ALL` spreads live UnifiedChannel values into `results.streams` instead of hydrating real UnifiedStream values.
- Cause 2: SearchResults applies a second client filter that only accepts a literal substring in `username` or `displayName`; the spaced fuzzy query is therefore removed even though Twitch returned it as relevant.
- Ruled out: Literal mock fixtures and stale persisted snapshots are not the primary cause; the direct uncached IPC response is already malformed. StreamCard's placeholder is behaving as coded after receiving missing fields.
- Test gap: All 26 focused search-handler tests pass because the live-Twitch test asserts only array length and Platform, not the UnifiedStream contract.
- Doc updates: none; this is implementation behavior, not glossary terminology.

### Q4 — Match semantics
- Asked: Should partial phrases use token/fuzzy matching, strict substrings, or unexamined Platform relevance?
- Captured: Use token/fuzzy matching. The app should handle spaced partial phrases such as `streamer univer` and identify the matching username, title, or category.
- Doc updates: none; this is feature-specific behavior.
- Flags: Exact normalization, scoring threshold, field priority, and fallback behavior for unexplained Platform matches remain to be specified.

### Q5 — Result-type scope
- Asked: Should the first implementation cover live discovery, every tab, or Channels/Streams only?
- Captured: Every tab: Channels, live Streams, Categories, Videos, and Clips.
- Doc updates: none; existing glossary terms already cover these content types.
- Flags: Eligible searchable fields and Platform capability differences remain to be specified.

### Q6 — Eligible searchable fields
- Asked: Should matching use relevant content metadata, only text already visible on cards, or everything returned by Platforms?
- Captured: Use relevant content metadata. Include Channel username/display name/current live title/category; Stream streamer name/title/category/tags; Category name/tags; Video title/channel/description; Clip title/channel/game/creator.
- Doc updates: none; existing glossary terms already cover these fields.
- Flags: Decide how to present one or multiple matching fields inside existing cards.

### Q7 — Match presentation
- Asked: Choose between one strongest-match line, inline highlighting only, or showing every match reason.
- Captured: Inline highlighting only. Preserve the existing card structure and highlight the matching fragment in its existing field.
- Visual: `designs/match-reason-placement.html` documents the compared options.
- Doc updates: none.
- Flags: Q6 includes hidden fields such as Video descriptions, which cannot be explained through inline highlighting unless a conditional snippet is exposed or those fields are removed from matching.

### Q8 — Hidden-field matches
- Asked: Should a hidden matching field appear conditionally, be removed from search, or remain unexplained?
- Captured: Remove hidden fields from search. Only fields already visible on result cards are eligible, so every returned match can be explained through inline highlighting.
- Doc updates: Corrected the Q6 field-set decision in the running summary; no glossary update.
- Flags: Decide whether to highlight one or every visible matching field when multiple fields match.

### Q9 — Correction: no highlighting or match explanation UI
- Asked: If several visible fields match, should every field, the strongest field, or the first field be highlighted?
- Captured: No highlighting at all. Just show the matching real results using the existing UI.
- Supersedes: Q7's inline-highlighting selection and the initial assumption that the app needed an explicit match-reason treatment. The visual mockup is retained only as a discarded design exploration.
- Doc updates: Updated the running summary to define this as search relevance/data correctness rather than match-explanation UI.
- Flags: Ranking between exact identity matches and content-field matches remains to be decided.

### Q10 — Result ranking and eligibility
- Asked: Rank by relevance, popularity, or Platform order?
- Captured: Rank by relevance. The results page should behave like a normal search page and show only items that match what was typed.
- Doc updates: none.
- Flags: Define whether every query token must match or whether any token is sufficient.

### Q11 — Multi-word fuzzy matching
- Asked: Must all query terms match, may any term match, or must the exact phrase match?
- Captured: All query terms must match using fuzzy/partial matching against available visible fields. Example: searching `streamer` should show every available Stream whose title contains that term.
- Doc updates: none.
- Flags: Define how much Platform content must be retrieved/scanned so "every available Stream" has an operational boundary.

### Q12 — Retrieval boundary
- Asked: Use Platform search plus progressive live-directory matching, Platform search only, or an exhaustive catalog scan?
- Captured: Use Platform search plus progressive live-directory matching, stopping at a tested safety limit.
- Doc updates: none.
- Flags: Decide whether progressive retrieval is automatic, user-triggered with Load more, or blocking before first display.

### Q13 — Progressive loading interaction
- Asked: Show immediate matches with Load more, use automatic infinite scroll, or block until scanning finishes?
- Captured: Use automatic infinite scroll.
- Doc updates: none.
- Flags: Define fuzzy tolerance and the visible loading/end state.

### Q14 — Fuzzy tolerance
- Asked: Use balanced fuzzy matching, partial words only, or broad fuzzy matching?
- Captured: Use balanced fuzzy matching: partial words plus limited one-character typo tolerance for longer tokens, with all query tokens still required.
- Doc updates: none.
- Flags: Platform clients have no global Video/Clip title-search endpoint; decide the product boundary for those tabs.

### Code-discovered constraint — Videos and Clips
- Twitch and Kick clients fetch Videos and Clips by Channel only. The existing global search path searches Channels/Categories and live content; it does not provide full-platform Video or Clip title search.
- A truly global Video/Clip title search would require a separately maintained catalog/index or external service. Fetching recent content only for matched Channels is feasible inside the current desktop architecture but is not globally exhaustive.

### Q15 — Video and Clip retrieval
- Asked: Use matched-Channel recent content plus cache, build a global index service, or exclude Videos/Clips?
- Captured: Use the current-app approach: fetch recent Videos/Clips from matched Channels, merge locally cached content, and fuzzy-filter visible fields.
- Doc updates: none.
- Flags: The recent-content depth and concurrency/safety limits should be determined through performance testing rather than guessed in the grill.

### Q16 — Cross-type duplication
- Asked: Should a live broadcaster appear in both Channels and Streams, prefer the Stream, or be combined into one result?
- Captured: Keep both existing sections. Deduplicate within each result type only.
- Doc updates: none; Channel and Stream are already distinct glossary concepts.
- Flags: Decide behavior when one Platform fails while the other returns matches.

### Q17 — Partial Platform failure
- Asked: Show partial results with a retry notice, show them silently, or fail the whole search?
- Captured: Show partial results with a retry notice identifying the failed Platform.
- Doc updates: none.
- Flags: Decide whether matching cached results may appear while fresh Platform responses load.

### Q18 — Cached-result behavior
- Asked: Show cache then reconcile, wait for fresh data only, or keep cached items for the session?
- Captured: Show matching cached results immediately, then reconcile them with fresh Platform data.
- Doc updates: none.
- Flags: Decide whether the autocomplete dropdown shares this full-search behavior or remains a lightweight separate surface.

### Q19 — Submitted page versus autocomplete
- Asked: Apply the overhaul to the Results page only, both autocomplete and Results, or remove autocomplete results?
- Captured: Results page only. Keep autocomplete lightweight.
- Doc updates: none.
- Flags: none.

## Edge-case audit

### Already resolved
- One Platform fails while the other succeeds: show partial matches plus a retry notice.
- Cached results are stale: show matching cache temporarily, then reconcile/remove against fresh responses.
- Duplicate values: deduplicate within a result type using Platform-scoped identity; do not collapse Channel and Stream into one type.
- Provider returns fuzzy suggestions that do not match visible fields: exclude them.
- Provider returns malformed Stream data: validate/hydrate the UnifiedStream contract rather than rendering placeholder cards with undefined routes.
- Pagination/catalog size is unbounded: use progressive loading with a tested safety limit.
- Global Video/Clip search is unavailable: use matched-Channel recent content plus local cache and document that it is not exhaustive.

### Pending decisions or implementation contracts
- Decide whether the All tab paginates all content types or uses bounded previews with per-type tab pagination.
- Decide how to describe the non-exhaustive Video/Clip boundary in product copy.

### Q20 — Very short queries
- Asked: Should one-character input search Channel names only, require two characters, or run the full cross-type search?
- Captured: One-character input searches Channel username/display-name prefixes only. Full fuzzy, cross-type search and catalog scanning begin at two characters.
- Doc updates: none.
- Flags: none.

### Q21 — Query normalization
- Asked: Normalize common formatting, only case/spaces, or require exact characters?
- Captured: Normalize common formatting. Ignore case and accents; trim/collapse spaces; treat `@`, `_`, hyphens, and punctuation as separators; preserve numbers and meaningful emoji.
- Doc updates: none.
- Flags: Repeated tokens still need an explicit contract.

### Q22 — Repeated query tokens
- Asked: Deduplicate repeated terms, require repeated occurrences, or use repetition as a ranking boost?
- Captured: Deduplicate repeated normalized terms. Extra whitespace/punctuation-created empty tokens are also discarded.
- Doc updates: none.
- Flags: none.

### Q23 — Scan safety-limit state
- Asked: Disclose that more matches may exist, stop silently, or ignore the safety limit?
- Captured: Disclose the limit and ask the user to refine the query.
- Doc updates: none.
- Flags: none.

### Q24 — Hidden Channel username identity
- Asked: Should Channel username remain searchable although current Channel cards show only display name?
- Captured: Yes. Username is a canonical identity exception; both username and display name qualify without changing the card UI.
- Doc updates: none; Channel identity is already defined in the glossary.
- Flags: none.

### Q25 — Username identity across owned content
- Asked: Should the Channel username exception apply to all owned content, Channel results only, or Channels/Streams only?
- Captured: Apply it across Channel, Stream, Video, and Clip results. A username search may return all matching content owned by that Channel without changing card UI.
- Doc updates: none.
- Flags: none.

### Q26 — Signed-in user's own Channel
- Asked: Treat the user's own Channel normally, preserve exact-only visibility, or always boost it?
- Captured: Treat it like every other Channel under the same fuzzy eligibility and relevance rules.
- Doc updates: none.
- Flags: none.

## Edge-case review resolution

### Exact searchable-field matrix
- Channel: display name plus the Channel username identity exception.
- Stream: title, Channel display name/username, category, and tags/language that the card can render from the result.
- Category: name and tags already present in the search result. Do not fan out hover-only metadata requests merely to decide eligibility.
- Video: title plus Channel display name/username.
- Clip: title plus Channel display name/username.
- Excluded: hidden descriptions, Clip creator/game fields not shown on the current card, stale Channel titles, and other hidden descriptive metadata.

### Q27 — Infinite scroll on All
- Asked: Use bounded previews on All with per-type infinite tabs, infinite-load every section, or infinite-load Streams only?
- Captured: Use bounded previews on All; automatic infinite scrolling runs inside each selected result-type tab.
- Doc updates: none.
- Flags: Decide copy for the non-exhaustive Video/Clip result boundary.

### Q28 — Non-exhaustive Video/Clip disclosure
- Asked: Always show a short note, omit it, or show it only after no results?
- Captured: Always show the short section note: “Recent content from matching channels.”
- Doc updates: none.
- Flags: none.

### Q29 — Cross-platform Category duplication
- Asked: Merge same-name Twitch/Kick Categories, show separate cards, or prefer the higher-viewer Platform?
- Captured: Merge exact normalized same-name Categories into one cross-platform result carrying both Platform IDs.
- Doc updates: none.
- Flags: none.

### Q30 — Typo-tolerance threshold
- Asked: Allow one edit for tokens of 5+, 4+, or 6+ characters?
- Captured: Allow one edit for tokens of 5+ characters. Adjacent transpositions count as one edit; shorter tokens use partial matching only.
- Doc updates: none.
- Flags: none.

### Required technical edge contracts (no product choice needed)
- Give each search a main-process session id; cancel prior work when query, Platform filter, tab, or Live Only changes. Renderer query-key isolation alone is insufficient because IPC work continues in main.
- Track cursors, seen identities, exhaustion, repeated-cursor termination, failure, and safety-limit end reasons separately per Platform and result type.
- Return per-Platform status/error/retryability so retry targets only the failed Platform.
- Apply wall-clock, page/request, and concurrency budgets; honor 429/Retry-After; defer Video/Clip per-Channel fan-out until its type is actively requested.
- Validate UnifiedChannel, UnifiedStream, UnifiedCategory, UnifiedVideo, and UnifiedClip at the backend boundary before caching or rendering. Missing images may use existing image fallbacks; missing navigation identity or required content fields rejects the result.
- Query/filter/tab changes reset scan state and prevent stale pages from appending. Duplicate pages/items do not loop.
- Counts represent currently loaded matching items and update as pages append. Do not show the final no-results state until enabled Platforms have exhausted, failed, or hit a disclosed limit.
- Loading/retry/limit states use `aria-live`/`aria-busy`; appended results do not steal keyboard focus; tabs expose their selected state; Clip cards must be keyboard-operable.

## Open flags (pending input)

- None. Performance-derived request/page/time budgets remain implementation calibration work, not an unresolved product decision.
