# PRD: Real, Relevant Search Results

## Problem Statement

The submitted Search Results page does not behave like a normal search page. It can hide relevant Platform results, render malformed live results as placeholder cards, and show content that is not demonstrably related to the submitted query.

The reproduced query `streamer univer` exposed the core failure:

- Twitch returned 20 real Channels.
- The renderer removed fuzzy Channel matches with a stricter username/display-name substring filter.
- The backend copied four live `UnifiedChannel` objects into the `UnifiedStream[]` response without required Stream fields.
- The UI rendered those malformed objects as `No Thumbnail · Live · 0 viewers` cards linking to `/stream/twitch/undefined`.

The current global search also leaves Videos and Clips empty, silently converts per-Platform failures into successful empty responses, cannot cancel main-process work after a query change, and does not provide true network-backed infinite pagination.

## Solution

Rebuild the submitted Search Results data path around real, validated Platform content and a shared fuzzy eligibility/ranking contract. Preserve the existing result cards and page layout. Do not add match highlighting, reason labels, or explanation snippets.

The Results page will:

- Search Channels, live Streams, Categories, Videos, and Clips across Twitch and Kick.
- Return only items satisfying every normalized query token against the approved fields.
- Rank eligible items by relevance, using popularity only to break ties.
- Use real hydrated `UnifiedStream` values rather than Channel-shaped placeholders.
- Use native Platform search plus progressive live-directory scanning for Stream title/category/tag matches.
- Show bounded previews on All; use automatic infinite scroll only inside the selected result-type tab.
- Fetch recent Videos and Clips from matched Channels, merge locally cached content, and disclose that these sections are not globally exhaustive.
- Keep working-Platform results visible when the other Platform fails, with a targeted retry notice.
- Show matching cache immediately, then reconcile it against fresh results.
- Stop safely on Platform exhaustion, repeated cursors, failure, or a calibrated scan limit.

## User Stories

- As a viewer, when I submit `streamer univer`, I see real Channels, Streams, or Categories that fuzzily match both terms, not placeholder cards or unrelated suggestions.
- As a viewer, when I search `streamer`, I see retrieved live Streams with `streamer` in their visible title, category, tags, or Channel identity.
- As a viewer, when I search a Channel username, I can find that Channel and its matching live Stream, Videos, and Clips even if cards display the Channel display name.
- As a viewer, exact and prefix identity matches appear before weaker title, category, tag, or typo-tolerant matches.
- As a viewer, I can scroll a selected result tab to fetch more real matches without manually pressing Load more.
- As a viewer, I see immediate matching cached results, but stale entries disappear or update when fresh Platform data arrives.
- As a viewer, if one Platform fails, I still see results from the other Platform and can retry only the failed one.
- As a viewer, I am told when a scan limit means more matches may exist.
- As a viewer, Video and Clip sections clearly say they contain recent content from matching Channels.

## Implementation Decisions

### Scope and UI

- Apply the overhaul only to the submitted Search Results page.
- Keep autocomplete as the existing lightweight suggestion surface.
- Preserve existing result card structure and page sections.
- Preserve Platform and Live Only filters.
- Keep Channels and live Streams as separate sections/results.
- On All, show bounded previews; do not paginate all five types concurrently.
- On each selected type tab, use an IntersectionObserver sentinel for automatic network pagination.
- Display `Recent content from matching channels.` in Video and Clip sections.
- Display `Search limit reached; refine your query.` when a calibrated safety cap is reached before Platform exhaustion.

### Query normalization and fuzzy eligibility

- Normalize Unicode case and accents.
- Trim/collapse whitespace.
- Treat `@`, underscores, hyphens, and punctuation as separators.
- Preserve numbers and meaningful emoji tokens.
- Remove empty tokens and deduplicate repeated tokens.
- Require every normalized query token to match somewhere in the result's eligible field set.
- Support substring and prefix matching.
- For tokens of five or more characters, allow one Damerau-style edit; adjacent transposition counts as one edit.
- Tokens shorter than five characters do not receive typo tolerance.
- A one-character query searches Channel username/display-name prefixes only. It does not scan Categories, live directories, Videos, or Clips.
- Full cross-type fuzzy search begins at two characters.
- Do not trust a Platform suggestion merely because the Platform returned it; it must pass local eligibility.

### Searchable-field matrix

- Channel: display name and username.
- Stream: title, Channel display name/username, category, and result-provided tags/language that the existing card can render.
- Category: name and tags already present in the search result. Do not fetch hover-only metadata merely to establish eligibility.
- Video: title and Channel display name/username.
- Clip: title and Channel display name/username.
- Exclude hidden descriptions, hidden Clip creator/game fields, stale Channel titles, bios, and other hidden descriptive metadata.
- Treat Channel username as a canonical identity exception across Channel, Stream, Video, and Clip results.
- Treat the signed-in user's own Channel like every other match; remove the current exact-query-only exclusion and apply no ownership boost.

### Ranking and deduplication

Rank eligible results within each result type:

1. Exact Channel username/display name or exact primary name/title.
2. Identity/name prefix.
3. Fuzzy identity/name.
4. Title.
5. Category.
6. Tags/language.
7. Popularity as a deterministic tie-breaker, treating missing counts consistently.

Deduplicate by Platform-scoped result identity within each type. Do not collapse a Channel and its live Stream. On the All-platform filter, merge Categories only when their normalized names exactly match, retaining both Platform IDs for cross-platform navigation.

### Retrieval and pagination

- Use Platform-native search for first-party relevance and identity discovery.
- Hydrate real live Streams from matched live Channels through Platform stream endpoints before returning them.
- Supplement native results with progressively fetched live-directory pages filtered by the shared fuzzy contract.
- Track cursor, seen identity, exhaustion, repeated cursor, failure, and safety-limit end reason separately per Platform and result type.
- Terminate on empty/repeated/stuck pages; never loop duplicate pages.
- Calibrate centralized wall-clock, page, request, and concurrency budgets through performance tests.
- Honor 429 and Retry-After behavior.
- Defer Video/Clip per-Channel fan-out until the corresponding tab is active.
- For Videos/Clips, fetch bounded recent content from matched Channels and merge locally cached content. This is intentionally not a Platform-wide title index.
- Cache keys include normalized query, Platform, type, filters, and relevant limits.

### Search sessions, cancellation, and failures

- Give each submitted search a main-process session identifier.
- Cancel prior main-process work when query, Platform filter, active tab, or Live Only changes.
- Ignore late responses from superseded sessions and prevent stale page append.
- Return per-Platform status, retryability, and error data instead of swallowing failures into empty success.
- Retry only the failed Platform while preserving working results.
- Reconcile cached results with fresh results, including fresh empty responses.

### Runtime validation

- Validate required fields for every `UnifiedChannel`, `UnifiedStream`, `UnifiedCategory`, `UnifiedVideo`, and `UnifiedClip` at the backend boundary before caching or rendering.
- Missing images may use existing image fallbacks.
- Missing Platform, stable identity, navigation identity, or required content fields rejects the result and records a diagnostic event.
- Never create navigation paths containing `undefined`.

### Loading, counts, and accessibility

- Counts represent currently loaded eligible results and update as pages append.
- Do not show final no-results UI until enabled Platforms have exhausted, failed, or hit a disclosed limit.
- Distinguish loading, true exhaustion, partial failure, retrying, and safety-limit states.
- Loading and status surfaces use `aria-live`/`aria-busy` appropriately.
- Appended results do not steal keyboard focus.
- Search tabs expose selected state.
- Clip results are keyboard-operable, not click-only containers.

## Testing Decisions

Use test-first implementation for each acceptance behavior.

### Matching unit tests

- Case, accents, collapsed whitespace, punctuation separators, `@`, underscores, hyphens, numbers, and emoji.
- Repeated-token deduplication and removal of empty tokens.
- All-token eligibility across one or multiple approved fields.
- Partial word matching.
- One-edit threshold at exactly four versus five characters.
- Adjacent transposition behavior.
- One-character Channel-prefix-only behavior.
- Ranking: exact > prefix > fuzzy identity/name > title > category > tags; deterministic popularity tie-breakers with missing counts.
- Exact searchable-field matrix; hidden fields cannot qualify.

### Backend/contract tests

- `streamer univer` returns real typed results and no malformed Stream objects.
- A live Twitch Channel is hydrated into a complete `UnifiedStream`, not spread into the Stream array.
- Runtime validators reject malformed objects for every result type.
- Working-Platform results survive failure of the other Platform; error metadata names the failure and retry targets only it.
- Signed-in user's Channel participates in fuzzy matching normally.
- Per-Platform/type cursors paginate independently.
- Empty, repeated, and stuck cursors terminate.
- Seen-item sets deduplicate repeated pages.
- 429/Retry-After and budget exhaustion produce explicit end/error states.
- Search session cancellation stops further main-process fan-out and late results cannot append.
- Video/Clip retrieval runs only for active tabs and respects matched-Channel/content/concurrency bounds.

### Renderer/page tests

- The reproduced query never renders `/stream/*/undefined`, `No Thumbnail · Live · 0 viewers` from missing required fields, or unrelated provider suggestions.
- All shows bounded previews; selected tabs auto-fetch at the sentinel.
- Tab/filter/query changes reset state and do not mix old pages.
- Cache renders immediately, then stale items update/remove after fresh responses.
- Partial Platform error, targeted retry, retrying, limit reached, true exhausted, and final no-results states are distinct.
- Counts update as valid matches append.
- Cross-platform same-name Categories merge; Channel/Stream and cross-Platform Channel identities remain separate.
- Video/Clip disclosure copy is present.
- Accessibility state and Clip keyboard activation are covered.

### Verification gates

- Focused unit/integration tests stay within the repository's test-time budgets.
- Full tests, lint, type-check, and build pass.
- Run the project `deslop` workflow on the final diff.
- Verify the running Search Results page with Electron MCP only, including the original `streamer univer` scenario, infinite scrolling, filters, partial failure/retry, and keyboard behavior.

## Out of Scope

- Match highlighting, match-reason labels, or additional per-card explanation UI.
- Changing the autocomplete dropdown into full search.
- A remote/global Video and Clip indexing service.
- Exhaustively crawling every live Stream or historical content item on Twitch/Kick.
- Redesigning result cards or combining Channel and Stream into one result.
- Searching hidden bios, descriptions, stale Channel titles, or hidden Clip metadata.

## Further Notes

- The current malformed Stream bug is directly reproducible in the running app and through `electronAPI.search.all`.
- Existing focused search-handler tests pass despite the bug because they assert only Stream-array length and Platform, not the `UnifiedStream` contract.
- The discarded visual exploration remains in `designs/match-reason-placement.html`; it is not part of the approved solution.
- No `CONTEXT.md` or ADR update is needed. Existing Channel, Stream, Video, Clip, Category, Platform, and Unified type definitions already describe the relevant domain language.
