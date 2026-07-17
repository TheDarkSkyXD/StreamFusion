# Category Page Content Tabs: Grilling Session Notes
Date: 2026-07-16 · Goal: Define how Category pages should present Live Streams, Clips, and Videos across Twitch and Kick.

## PRD

- [Category Page Content Tabs PRD](./prd.md)

## Issues

1. [Prove complete Category Clip discovery](./issues/01-prove-category-clip-discovery.md)
2. [Prove complete Category Video discovery](./issues/02-prove-category-video-discovery.md)
3. [Make Category Live Streams URL-backed and Platform-filterable](./issues/03-url-backed-live-streams-category-tab.md)
4. [Browse the first page of Category Clips](./issues/04-browse-first-page-category-clips.md)
5. [Browse the first page of Category Videos](./issues/05-browse-first-page-category-videos.md)
6. [Continue Category Clips in exact global order](./issues/06-continue-category-clips-in-exact-global-order.md)
7. [Continue Category Videos in exact global order](./issues/07-continue-category-videos-in-exact-global-order.md)
8. [Revisit Category Clips safely](./issues/08-revisit-category-clips-safely.md)
9. [Revisit Category Videos safely](./issues/09-revisit-category-videos-safely.md)

## Summary / key decisions

- Final scope: Category page tabs for Live Streams, Clips, and Videos.
- The product interview and edge-case audit are complete. The only remaining gate is engineering feasibility for complete Twitch and Kick Category media discovery.
- Current Category pages merge Twitch and Kick Streams into one live-only grid; tab state is not yet represented in the URL.
- Existing Clip and Video discovery is Channel-scoped. Category-wide Clips and Videos, especially on Kick, require new data capabilities rather than a UI-only change.
- Existing interaction conventions are: Clips open in a dialog, Videos navigate to the Video page, and tabs on Channel pages are deep-linkable.
- Visual mockups will accompany layout and navigation decisions.
- Clips and Videos must be complete Category-wide feeds across Twitch and Kick; deriving them only from currently live Channels is explicitly rejected.
- Each new content tab is parity-gated: it ships only when both Twitch and Kick can provide a reliable, complete Category-wide feed for that content type.
- Tabs are URL-backed and deep-linkable. Live Streams is the default; Clips and Videos persist through URL state and browser navigation.
- Layout: keep the Category header stable, place the tabs immediately below it, then render tab-specific controls and content.
- The Category header keeps its combined Live Viewer Count on every tab, labeled as “watching live.” Each Clip and Video card shows that item’s accumulated View Count instead.
- Category Clip and Video tabs mirror the existing Channel Clip and Video tabs instead of introducing new browsing behavior: both support Most Recent/Views sorting; Clips also support Last Day/Last Week/Last Month/All Time filtering. Existing fallback defaults are Views and All Time when no preference is saved.
- Category and Channel media tabs share the same saved sort and Clip time-range preferences.
- Every Category tab includes an `All Platforms | Twitch | Kick` filter.
- Existing playback conventions carry forward: Clips open in the Clip dialog; Videos navigate to the Video page.
- Runtime Platform failures degrade independently: keep successful Platform results visible and show a named, retryable warning for the failing Platform.
- Tab labels do not show counts; exact Clip and Video totals are not required.
- Filter layout: Platform scope sits on the left of the control row; tab-specific sorting/time/language/tag controls sit on the right.
- Each tab preserves its loaded items, filters, and scroll position when the user switches away and returns.
- Clips and Videos load lazily on their first visit, then remain cached; visiting a Category does not immediately fetch all three feeds.
- The active tab and all filters are URL-backed. Shared saved preferences provide defaults only when the corresponding URL parameters are absent.
- Only the tab row remains sticky while scrolling; the Platform and content-control row scrolls normally.
- Scroll restoration is guaranteed within the current app session for tab switches and Back navigation. Never-visited tabs open at their content top; app restarts restore URL state but not scroll.
- During a Platform outage, retain that Platform's cached rows with a named warning and visible last-updated age while fresh results from the working Platform remain available.
- Live Streams re-sort immediately when viewer counts or membership change, preserving the selected exact viewer-count order even if cards move while the user is scrolled down.
- Clip and Video feeds maintain exact global ordering across pagination. Later pages insert items into their correct position for the selected Views or Most Recent sort.
- On mixed Category media cards, the Channel avatar/name link to that Channel while the main card action continues to open the Clip dialog or Video page.
- The `All | Twitch | Kick` segmented Platform control remains visible at every window width; on narrow layouts it occupies its own full-width row rather than collapsing into a Select.
- Category media reuse the Channel media cache policy: five-minute freshness, stale-first revalidation, and up-to-seven-day fallback only after refresh failure with visible age.

## Repository findings

- Preserve the existing cross-Platform Category match (`otherId` plus normalized-name fallback), merged viewer count, independent Platform pagination, partial-failure behavior, and Stream filters.
- The current live filters (language, tag, viewer sort) do not map directly to Clips and Videos.
- No category-scoped Clip or Video IPC contract exists. A fan-out over currently live Channels would be incomplete, biased, and request-heavy.
- The design system calls for neutral navigation styling, Platform colors only as identifiers, explicit loading/empty/error states, keyboard focus, reduced-motion support, and no resting shadows.
- The local-markdown tracker is configured; a completed grill should produce `prd.md` in this session folder.

## Edge-case audit

### Covered by existing decisions

- Complete Category-wide feeds, Twitch/Kick parity gating, lazy loading, independent runtime failures, URL-backed tabs, Platform filtering, per-tab state restoration, no tab counts, and existing Clip/Video playback conventions.

### Derived from project conventions (no product decision required)

- Preserve `otherId` on tab links; invalid/unshipped tab values fall back to Live Streams.
- Keep Platform-native Category IDs and cursors separate; dedupe only by `platform:id`; validate stale cross-Platform Category matches.
- Cache keys include canonical Category identity, content type, Platform filter, sort/time/filter state, page size, and account scope where entitlement changes results.
- Cursor pagination stops on empty, unchanged-cursor, or all-duplicate pages; exhausting one Platform does not stop the other; load-more errors keep existing cards and expose inline retry.
- First uncached loads use card skeletons; cached loads render stale-first without layout replacement; empty, filtered-empty, outage, and load-more error states remain distinct.
- Use semantic link navigation, labelled controls, visible focus, `aria-current`, polite loading/error announcements, keyboard-operable Clip cards, Dialog focus restoration, and per-item Platform routing.
- Responsive controls wrap/stack without page overflow; active Platform state is never communicated by color alone.
- Category-wide sources must support signed-out discovery, respect rate limits/auth changes, exclude deleted/private/unplayable records, retain supported restricted/mature metadata, and never cache playback credentials.
- Endpoint, IPC, hook, route, merge/pagination, failure, accessibility, and Electron UI proof coverage are required.

### Product choices still open

- None identified after the edge-case audit. The remaining gate is engineering feasibility for complete Twitch and Kick Category media discovery.

## Q&A log

### Setup — Visual companion
- Asked: Should the session use visual mockups for layout and navigation decisions, or stay text-only?
- Captured: Use visual mockups.
- Doc updates: None.
- Flags: None.

### Q1 — Category content completeness
- Asked: Should Clips and Videos be complete Category-wide feeds, an approximation from currently live Channels, or limited to Platforms with reliable support?
- Captured: Complete Category feed. Include content from all Channels in the Category across Twitch and Kick. Do not approximate from currently live Channels.
- Doc updates: None; this is feature scope, not glossary terminology or an ADR-worthy architectural decision yet.
- Flags: Confirm release behavior if either Platform cannot reliably supply a Category-wide Clip or Video feed. -> Product owner

### Q2 — Cross-Platform release gate
- Asked: If one Platform lacks a reliable Category feed, should StreamFusion delay the tab, show partial results, or hide unsupported tabs dynamically?
- Captured: Require Twitch and Kick parity. Do not ship a Clip or Video tab until both Platforms provide a reliable, complete Category-wide feed for that content type.
- Doc updates: None; this is feature release scope and does not warrant a standalone ADR.
- Flags: None.

### Q3 — Tab navigation behavior
- Asked: Should Category tabs be URL-backed, page-local, or remembered globally across Category pages?
- Captured: Use URL-backed tabs. Live Streams is the default; Clips and Videos support deep links, refresh persistence, and Back/Forward navigation.
- Doc updates: None; this follows an existing navigation convention and does not warrant an ADR.
- Flags: The exact route value (`streams` versus `live`) can be settled during implementation without changing the user-facing contract.

### Q4 — Tab placement
- Asked: Choose between tabs below the Category header, tabs before the header, or compact tabs inside the header.
- Captured: Option A. Keep the Category header first, tabs directly beneath it, and tab-specific controls/content below the tabs.
- Doc updates: Visual comparison created at `designs/tab-placement-options.html`; no glossary or ADR update.
- Flags: None.

### Q5 — Viewer and view counts
- Asked: Should the Category's combined live audience remain in the header across tabs, appear only on Live Streams, or be replaced with tab totals?
- Captured: Keep the Category header count on every tab, clearly labeled as people “watching live.” Clips and Videos show their own accumulated views on each item, not a live audience count.
- Doc updates: Added `Live Viewer Count` and `View Count` to `CONTEXT.md` to preserve the distinction.
- Flags: None.

### Q6 — Clip and Video browsing controls
- Asked: Choose a new default ordering for Category Clips.
- Captured: Do not invent a new Category-only ordering. Make the Category Video and Clip tabs behave like the existing tabs on a Channel. Repository verification: both use `Most Recent | Views`; Clips additionally use `Last Day | Last Week | Last Month | All Time`; current fallback defaults are `Views` and `All Time`, with saved preferences restored when present.
- Doc updates: None; this reuses an existing product convention.
- Flags: Confirm whether Category and Channel tabs share the same saved preferences or persist them separately. -> Product owner

### Q7 — Shared media preferences
- Asked: Should Category and Channel tabs share sort/time-range preferences, remember them separately, or reset Category tabs on each visit?
- Captured: Share the same preferences across Category and Channel tabs.
- Doc updates: None; this extends the existing preference behavior.
- Flags: None.

### Q8 — Platform filtering
- Asked: Should the merged Twitch/Kick Category feed have a Platform filter on every tab, media tabs only, or no filter?
- Captured: Add `All Platforms | Twitch | Kick` filtering to Live Streams, Clips, and Videos.
- Doc updates: None; this is feature behavior, not glossary or an architectural trade-off.
- Flags: None.

### Q9 — Runtime partial failure
- Asked: If one Platform temporarily fails while the other succeeds, should the tab show partial results with a warning, fail entirely, or silently use stale data?
- Captured: Show available results and a retryable warning that names the unavailable Platform.
- Doc updates: None; this aligns with the existing per-Platform health model and does not require a new ADR.
- Flags: None.

### Q10 — Tab counts
- Asked: Should tab labels omit counts, show only loaded-item counts, or require exact totals?
- Captured: No counts. Keep the labels `Live Streams`, `Clips`, and `Videos`.
- Doc updates: None.
- Flags: None.

### Q11 — Filter layout
- Asked: Choose between separating Platform scope from content controls, clustering all controls together, or placing Platform filtering beside the tabs.
- Captured: Option A. Put `All Platforms | Twitch | Kick` on the left and tab-specific controls on the right.
- Doc updates: Visual comparison created at `designs/filter-layout-options.html`; no glossary or ADR update.
- Flags: None.

### Q12 — Per-tab continuity
- Asked: When returning to a previously visited tab, should StreamFusion restore its position, reset to the top while keeping cache, or reload it entirely?
- Captured: Restore loaded items, filters, and scroll position independently for each tab.
- Doc updates: None; this is reversible UI state behavior and does not warrant an ADR.
- Flags: None.

### Q13 — Media loading strategy
- Asked: Should Clip and Video feeds load on first visit, preload immediately with Live Streams, or preload in the background?
- Captured: Load each media feed on first visit, then cache it.
- Doc updates: None; this follows existing cache policy and is not ADR-worthy.
- Flags: None.

### Q14 — URL-backed filter state
- Asked: Should the URL contain only the tab, tab plus Platform, or the tab and every filter?
- Captured: Put the active tab and all filters in the URL: Platform, media sort, Clip time range, Live language, Live tag query, and Live viewer sort. Saved preferences act as defaults only when URL values are absent.
- Doc updates: None; this extends the already selected route-state convention and does not warrant an ADR.
- Flags: None.

### Q15 — Sticky navigation
- Asked: Should the tabs alone remain sticky, should tabs and filters remain sticky, or should everything scroll away?
- Captured: Keep only the tab row sticky. Platform and content controls scroll normally.
- Doc updates: None; this matches the existing Channel-tab pattern and is reversible UI behavior.
- Flags: None.

### Q16 — Scroll restoration boundary
- Asked: Should per-tab position restore only during tab switches, throughout same-session navigation, or across app restarts too?
- Captured: Guarantee same-session restoration for tab switches and Back navigation from Clips, Videos, Channels, and other Categories. A never-visited tab opens at its content top. App restart may restore URL state, but not scroll.
- Doc updates: None; this is UI state scope rather than a domain or architecture decision.
- Flags: None.

### Q17 — Stale cache during a Platform outage
- Asked: When a Platform refresh fails but cached rows exist, should StreamFusion show those rows as stale, hide them, or hide the entire combined feed?
- Captured: Keep cached rows visible, label the affected Platform as stale/unavailable, and show the last-updated age. Continue showing fresh results from the working Platform.
- Doc updates: None; this specializes the existing stale-success policy without creating a new architectural direction.
- Flags: None.

### Q18 — Live-feed ranking updates
- Asked: When refreshed Streams change membership or viewer-count rank while the user is scrolled down, should changes wait behind an affordance, apply immediately, or wait until the feed is reopened?
- Clarified: This concerns the existing Live Stream grid's selected viewer-count sort, which defaults to highest Live Viewer Count first.
- Captured: Re-sort immediately. Maintain exact viewer-count order even if cards move during scrolling.
- Doc updates: None; this preserves the current Category sorting behavior.
- Flags: None.

### Q19 — Global media ordering
- Asked: When a later Clip or Video page contains an item that ranks above existing cards, should StreamFusion reinsert it into exact order, append the page stably, or defer re-sorting until the user returns to the top?
- Captured: Maintain exact global order. Insert newly loaded Clips and Videos into their correct position for the selected Views or Most Recent sort, even if existing cards move.
- Doc updates: None; this is feed presentation behavior, not an ADR-worthy architecture decision.
- Flags: The Category media source and merge must prove globally monotonic pagination or an equivalent bounded merge; per-page sorting alone does not satisfy this decision.

### Q20 — Channel navigation from media cards
- Asked: Should Channel identity on a mixed Category Clip/Video card link to the Channel, remain display-only, or move behind a menu?
- Captured: Make the Channel avatar and name clickable secondary navigation to the Channel. The main card still opens the Clip dialog or Video page.
- Doc updates: None; this is card interaction behavior.
- Flags: Ensure separate semantic targets, keyboard focus, and Dialog focus restoration without nested interactive elements.

### Q21 — Narrow-window Platform control
- Asked: Should the Platform filter adapt from a segmented control to a Select, remain segmented at every width, or always use a Select?
- Captured: Keep the segmented control at every width. On narrow layouts it may stack into its own full-width row.
- Doc updates: Visual comparison created at `designs/narrow-platform-control-options.html`; no glossary or ADR update.
- Flags: Preserve usable target sizes, text labels, non-color selection cues, and no horizontal page overflow.

### Q22 — Category media cache freshness
- Asked: Should Category media reuse the Channel media cache policy, discard anything older than five minutes, or require fresh results only?
- Captured: Reuse the Channel media policy. Treat in-memory media as fresh for about five minutes; revalidate stale snapshots; allow persisted results up to seven days old only when refresh fails and clearly display their age.
- Doc updates: None; this applies an existing cache convention and stale-success policy.
- Flags: None.

## Open flags (pending input)

- Prove complete, signed-out-capable Category Clip and Video discovery for both Twitch and Kick before either media tab is considered shippable. -> Engineering feasibility spike
