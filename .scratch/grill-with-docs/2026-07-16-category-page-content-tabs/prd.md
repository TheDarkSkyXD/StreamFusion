# PRD: Category Page Content Tabs

## Problem Statement

Category pages currently present only live Streams, even though StreamFusion already treats Streams, Clips, and Videos as distinct playable content types. Viewers cannot browse Category-wide Clips or Videos, compare content across Twitch and Kick, deep-link filtered Category views, or return to a prior media position.

This is not only a UI gap. StreamFusion currently discovers Clips and Videos by Channel, not by Category. A feed derived from currently live Channels would omit offline creators, bias results, create request fan-out, and fail the promise of complete Category browsing.

## Solution

Add three tabs directly below the stable Category header, in this order:

1. `Live Streams` (default)
2. `Clips`
3. `Videos`

All tabs merge complete Category-wide content from Twitch and Kick. A Clip or Video tab ships only after StreamFusion proves a reliable, signed-out-capable Category feed for that content type on both Platforms. A currently-live-Channel fan-out is not an acceptable substitute.

The active tab and all filters are URL-backed. The Category header remains visible and retains the combined `Live Viewer Count`, labeled as “watching live,” on every tab. Clip and Video cards show their own accumulated `View Count`; tab labels do not show totals.

### Tab controls

- Every tab: `All | Twitch | Kick` segmented Platform filter on the left.
- Live Streams: existing language, tag, and viewer-count sort controls on the right.
- Clips: existing Channel-tab time range (`Last Day | Last Week | Last Month | All Time`) and sort (`Most Recent | Views`) controls on the right.
- Videos: existing Channel-tab sort (`Most Recent | Views`) controls on the right.
- Media sort and Clip time-range preferences are shared with Channel tabs and act as URL defaults when the URL does not specify them.

### Interaction model

- Only the tab row is sticky. The Platform and content-control row scrolls normally.
- Clips load in the existing Clip dialog. Videos navigate to the Video page.
- On mixed media cards, the Channel avatar and name navigate to the Channel; the main card action retains its Clip/Video behavior.
- The Platform selector remains segmented at every window width. On narrow layouts it occupies its own full-width row.
- Each media tab loads on first visit, then caches its data. Category entry does not fetch all three feeds immediately.
- Loaded rows, filters, and scroll position are preserved per tab during the current app session. Back navigation from a Clip, Video, Channel, or another Category restores the prior Category tab and position. Never-visited tabs open at their content top. App restart restores URL state but not scroll.

## User Stories

- As a viewer, I can switch between Live Streams, Clips, and Videos for a Category.
- As a viewer, I see complete Category-wide results from Twitch and Kick rather than results limited to currently live Channels.
- As a viewer, I can filter every tab to All Platforms, Twitch, or Kick.
- As a viewer, I can use the same Clip/Video sorting, time-range behavior, and saved defaults I already use on a Channel.
- As a viewer, I can copy or revisit a URL that preserves the active tab and every filter.
- As a viewer, I can use Back and Forward without losing my tab, filters, loaded results, or same-session scroll position.
- As a viewer, I can open a Clip without leaving the Category page, open a Video on its player page, or navigate from a media card to its Channel.
- As a viewer, I can continue using one Platform's results when the other Platform temporarily fails.
- As a keyboard or assistive-technology user, I can navigate tabs, filters, cards, dialogs, errors, and retries with semantic, labeled controls and visible focus.

## Implementation Decisions

### Release and data capability gate

- Build an engineering feasibility spike before implementing either media tab.
- A shippable Category media source must cover all upstream-discoverable public content for the current viewer/region, work while signed out, and provide globally correct pagination for supported sorts and Clip time ranges.
- “Complete” excludes Platform-hidden, deleted, private, pruned, or unplayable records. Retain supported subscriber-only and mature-content metadata with existing locks/labels and entitlement behavior.
- Do not ship a media tab for only one Platform. Do not silently approximate from currently live Channels.
- Runtime Platform failure is separate from build-time capability: a shipped tab remains visible during an outage.

### Route and identity

- Extend the Category route search schema to validate the active tab and all applicable filters: Platform, media sort, Clip time range, Live language, Live tag query, and Live viewer sort.
- Missing or invalid tab state falls back to Live Streams. Deep links to an unshipped tab also fall back to Live Streams.
- Tab/filter navigation preserves `otherId` so the existing cross-Platform Category match remains intact.
- Preserve canonical Platform-native Category IDs and validate stale cross-Platform matches before use.
- Use native links for tab navigation with a labeled navigation region and `aria-current="page"`.

### Feed merge, ordering, and pagination

- Keep Twitch and Kick query state, cursors, health, retries, and exhaustion independent.
- Dedupe only by `platform:id`; similarly titled cross-Platform items are distinct.
- Merge both Platforms into one exact global ordering for the selected sort.
- Live Streams immediately re-sort when membership or `Live Viewer Count` changes, even if cards move while the user is scrolled down.
- Clips and Videos insert later-page results into their exact global `Views` or `Most Recent` position, even if existing cards move.
- Per-page client sorting is insufficient. The data source or bounded merge must prove globally monotonic results.
- An empty page, unchanged cursor, or all-duplicate page ends that Platform's pagination. Exhausting one Platform does not stop the other.
- Changing any URL-backed filter creates a correctly keyed dataset, resets it to page one, and opens at the content top. Returning to a previously visited filter combination may restore its cached rows.

### Cache and failure behavior

- Cache keys include canonical Category identity, content type, Platform filter, sort/time/filter state, page size, and account identity when entitlement affects list results.
- Never cache playback credentials across auth changes.
- Reuse the Channel media cache policy: approximately five-minute freshness, stale-first revalidation, and persisted fallback up to seven days old only when refresh fails.
- During a one-Platform outage, show fresh results from the working Platform plus cached rows from the failing Platform when available. Name the failing Platform, show the cached rows' last-updated age, and provide a Platform-specific retry.
- Never present stale rows silently. A failed Platform is not an empty state.
- If both Platforms fail and no cache exists, show a full-tab error with retry. Load-more failure keeps loaded cards and exposes an inline retry without replacing the grid.
- Platform recovery and login/logout invalidate the relevant Category-media queries.

### UI states and accessibility

- First uncached visit: render card-shaped skeletons under the stable header, tabs, and controls.
- Cached revisit: render cached rows immediately and revalidate without replacing them with skeletons.
- Distinguish: no Category content, no matches for active filters, selected Platform has no content, one-Platform outage, both-Platform outage, and load-more failure.
- Filtered empty states name the active Platform/filter and provide a reset action where applicable.
- Controls wrap or stack without horizontal page overflow. The three-way Platform control remains segmented and uses text/shape/ARIA, not color alone, to communicate selection.
- Maintain at least 40px practical interactive height, visible keyboard focus, WCAG AA contrast, reduced-motion behavior, and no resting shadows.
- Clip cards use one semantic Dialog trigger with Enter/Space support. Closing/Escape restores focus to the invoking card and stops autoplay.
- Channel secondary links and main card actions are separate semantic targets without nested interactive elements.
- Content loading and partial failures use restrained `aria-live="polite"` status messaging and `aria-busy` where appropriate.
- Per-item navigation/playback uses the item's own Platform and Channel identity, never the Category route's primary Platform.

## Testing Decisions

- Platform contract tests prove Category-wide Clip/Video discovery, signed-out behavior, cursor progression, global sort correctness, time cutoffs, rate limits, auth changes, restricted/deleted records, and error classification for Twitch and Kick.
- IPC/preload/shared-contract tests cover Category media methods, validation, pagination, retries, and response typing.
- Query-hook tests cover lazy enablement, complete cache keys, Twitch/Kick merge, `platform:id` dedupe, one-Platform failure, explicit stale fallback, stuck cursors, filter resets, recovery invalidation, and exact cross-page ordering.
- Category page tests cover default/invalid/deep-linked tabs, URL-backed filters, preserved `otherId`, Platform filtering, loading/empty/error/load-more states, shared media preferences, per-tab cache and scroll restoration, and mixed-item routing.
- Accessibility tests cover semantic navigation, `aria-current`, labels, Platform selection state, keyboard Clip activation, Dialog focus return, and live status announcements.
- UI work must be verified in the running Electron app with Electron MCP across Twitch and Kick, wide and narrow windows, keyboard navigation, partial Platform failure, stale cache, long pagination, Back restoration, and exact reorder behavior.
- Lint, type-check, tests, and build must pass before completion.

## Out of Scope

- Category media derived only from currently live Channels.
- Shipping a Clip or Video tab for only Twitch or only Kick.
- Standalone Clip routes.
- Tab-label counts or authoritative total Clip/Video counts.
- Background preloading of unvisited media tabs.
- Persisting scroll positions across app restarts.
- Replacing existing Channel Clip/Video controls with a new Category-only filtering model.
- Silent stale data, whole-window reload retries, or hiding all results when only one Platform fails.

## Further Notes

- The existing Category page already merges cross-Platform Streams and should retain its Category matching, merged header count, Stream filters, balanced Platform pagination, cached-first rendering, and explicit empty states.
- Existing media cards assume one parent Channel/Platform and are not safe to reuse unchanged for a mixed Category feed. Extract or introduce a category-safe card contract that receives Platform and Channel identity per item.
- Existing Clip cards require keyboard/focus hardening before reuse.
- The feasibility spike is the first implementation issue. If complete Twitch and Kick Category discovery cannot be proven for a content type, that tab remains blocked under the agreed parity rule.
- Visual decisions are captured in `designs/tab-placement-options.html`, `designs/filter-layout-options.html`, and `designs/narrow-platform-control-options.html`.
