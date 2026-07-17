# Slice 04 — Browse the first page of Category Clips

Status: wontfix
Type: AFK

## Parent

PRD: [Category Page Content Tabs](../prd.md)

## What to build

Deliver the first complete, playable page of Category-wide Clips after both Platform capability and Category tab navigation are proven. Selecting `Clips` lazily loads one page from Twitch and Kick for the Category, merges the results into one exact order for the selected sort, and presents content from offline as well as currently live Channels. Keep Platform requests and failures independent, and dedupe only identical `platform:id` records.

Reuse the Channel Clip browsing model: `Most Recent | Views` sorting, `Last Day | Last Week | Last Month | All Time` ranges, and the same saved preferences. URL values take precedence; saved preferences provide defaults only when the corresponding URL value is absent. Include the active Platform scope, sort, and time range in the URL and dataset identity. Changing one resets to the first page and content top.

Render mixed-Platform cards using each Clip’s own Platform and Channel identity. The main card action opens the existing Clip dialog; the avatar and Channel name are separate semantic links to that Channel. Cards display the Clip’s accumulated View Count. Keep the header’s combined “watching live” count and omit tab totals.

Provide accessible first-load skeletons, empty and filtered-empty states, a full-tab retry when neither Platform can load, and a named retryable warning that leaves the working Platform usable when only one Platform fails. This slice ends after the first merged page; continuing pagination and persisted stale fallback belong to later slices.

## Acceptance criteria

- [ ] The Clips tab is available only after both Twitch and Kick pass the Category Clip capability gate; otherwise a Clips deep link resolves to Live Streams.
- [ ] Selecting Clips starts its first requests only on first visit and does not cause Clips or Videos to preload when the Category initially opens.
- [ ] The first page comes from complete Category-scoped Twitch and Kick discovery rather than fan-out over currently live Channels and includes eligible Clips from offline Channels.
- [ ] Twitch and Kick first-page requests use the correct native Category identity and keep query health, retry, and result state independent.
- [ ] `All`, `Twitch`, and `Kick` Platform scope, `Most Recent` and `Views` sort, and all four Clip time ranges are validated URL state and produce correctly keyed first-page datasets.
- [ ] Channel Clip sort and time-range preferences are shared with Category Clips, apply only when URL values are absent, and update consistently when the viewer changes the controls.
- [ ] Combined results are deduplicated only by `platform:id` and are in exact global order for the selected sort and time range; similarly titled cross-Platform Clips remain distinct.
- [ ] Each Clip card shows its accumulated View Count and routes playback, restriction behavior, Platform identity, and Channel identity from the item rather than from the Category route’s primary Platform.
- [ ] The main Clip card action is a single keyboard-operable Dialog trigger; Enter and Space open it, Escape or close stops autoplay, and focus returns to the invoking card.
- [ ] Channel avatar and name are separate semantic links to the correct Channel with no nested interactive targets inside the Clip trigger.
- [ ] The first uncached visit shows card-shaped skeletons below the stable header, tabs, and controls, while tab and filter controls remain operable and expose restrained busy/status announcements.
- [ ] Empty Category content, no matches for the active filters, and no content on the selected Platform are distinct states that name the active scope and offer a reset where applicable.
- [ ] If one Platform fails, fresh results from the working Platform remain usable with a named Platform-specific warning and retry; if both fail with no usable result, the tab shows a full error and retry.
- [ ] Controls preserve visible focus, WCAG AA contrast, reduced-motion behavior, 40px practical targets, no resting shadows, and no horizontal overflow with the Platform segments stacked on a full-width narrow row.
- [ ] Automated Platform-contract, shared-contract, IPC/preload, query, page, Dialog, routing, failure-state, and accessibility tests cover the first-page Clip path end to end.
- [ ] The running Electron app is verified with Electron MCP across Twitch and Kick, wide and narrow windows, keyboard-only Clip/Dialog use, Channel navigation, empty states, and one- and two-Platform failures.

## Blocked by

- `.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/issues/01-prove-category-clip-discovery.md`
- `.scratch/grill-with-docs/2026-07-16-category-page-content-tabs/issues/03-url-backed-live-streams-category-tab.md`

## Comments

- 2026-07-16: Closed under the failed Issue 01 parity gate. [Issue 01 evidence](../evidence/01-category-clip-discovery.md) shows that Twitch lacks the required `Most Recent` feed and Kick cannot provide exact globally ordered continuation pages. Reopen only if new upstream evidence proves both Platforms satisfy the complete Category Clip contract.
