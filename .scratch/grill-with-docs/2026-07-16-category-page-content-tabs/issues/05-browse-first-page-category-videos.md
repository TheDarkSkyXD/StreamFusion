# Slice 05 — Browse the first page of Category Videos

Status: wontfix
Type: AFK

## Parent

PRD: [Category Page Content Tabs](../prd.md)

## What to build

Deliver the first complete, playable page of Category-wide Videos after both Platform capability and Category tab navigation are proven. Selecting `Videos` lazily loads one page from Twitch and Kick for the Category, merges the results into one exact order for the selected sort, and presents content from offline as well as currently live Channels. Keep Platform requests and failures independent, and dedupe only identical `platform:id` records.

Reuse the Channel Video browsing model: `Most Recent | Views` sorting and the same saved preference. URL values take precedence; the saved preference supplies the default only when the URL does not specify a sort. Include the active Platform scope and sort in the URL and dataset identity. Changing either resets to the first page and content top.

Render mixed-Platform cards using each Video’s own Platform and Channel identity. The main card action navigates to the existing Video page; the avatar and Channel name are separate semantic links to that Channel. Cards display the Video’s accumulated View Count. Keep the header’s combined “watching live” count and omit tab totals.

Provide accessible first-load skeletons, empty and filtered-empty states, a full-tab retry when neither Platform can load, and a named retryable warning that leaves the working Platform usable when only one Platform fails. This slice ends after the first merged page; continuing pagination and persisted stale fallback belong to later slices.

## Acceptance criteria

- [ ] The Videos tab is available only after both Twitch and Kick pass the Category Video capability gate; otherwise a Videos deep link resolves to Live Streams.
- [ ] Selecting Videos starts its first requests only on first visit and does not cause Clips or Videos to preload when the Category initially opens.
- [ ] The first page comes from complete Category-scoped Twitch and Kick discovery rather than fan-out over currently live Channels and includes eligible Videos from offline Channels.
- [ ] Twitch and Kick first-page requests use the correct native Category identity and keep query health, retry, and result state independent.
- [ ] `All`, `Twitch`, and `Kick` Platform scope plus `Most Recent` and `Views` sort are validated URL state and produce correctly keyed first-page datasets.
- [ ] The Channel Video sort preference is shared with Category Videos, applies only when the URL value is absent, and updates consistently when the viewer changes the control.
- [ ] Combined results are deduplicated only by `platform:id` and are in exact global order for the selected sort; similarly titled cross-Platform Videos remain distinct.
- [ ] Each Video card shows its accumulated View Count and routes playback, restriction behavior, Platform identity, and Channel identity from the item rather than from the Category route’s primary Platform.
- [ ] The main Video card action navigates to the correct existing Video page, and the Channel avatar and name are separate semantic links to the correct Channel with no nested interactive targets.
- [ ] The first uncached visit shows card-shaped skeletons below the stable header, tabs, and controls, while tab and filter controls remain operable and expose restrained busy/status announcements.
- [ ] Empty Category content, no matches for the active filters, and no content on the selected Platform are distinct states that name the active scope and offer a reset where applicable.
- [ ] If one Platform fails, fresh results from the working Platform remain usable with a named Platform-specific warning and retry; if both fail with no usable result, the tab shows a full error and retry.
- [ ] Controls and cards preserve semantic labels, visible focus, WCAG AA contrast, reduced-motion behavior, 40px practical targets, no resting shadows, and no horizontal overflow with the Platform segments stacked on a full-width narrow row.
- [ ] Automated Platform-contract, shared-contract, IPC/preload, query, page, navigation, failure-state, and accessibility tests cover the first-page Video path end to end.
- [ ] The running Electron app is verified with Electron MCP across Twitch and Kick, wide and narrow windows, keyboard-only navigation, Video and Channel routing, empty states, and one- and two-Platform failures.

## Blocked by

- `.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/issues/02-prove-category-video-discovery.md`
- `.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/issues/03-url-backed-live-streams-category-tab.md`

## Comments

- 2026-07-16: Closed under the parity rule. [Issue 02 evidence](../evidence/02-category-video-discovery.md) found no complete Kick Category Video discovery source, so a mixed Twitch-and-Kick first page cannot meet this issue's contract. Reopen only if Kick exposes a complete native Category Video feed and Issue 02's cross-Platform capability gate is rerun successfully.
