# Slice 03 — Make Category Live Streams URL-backed and Platform-filterable

Status: needs-info
Type: AFK

## Parent

PRD: [Category Page Content Tabs](../prd.md)

## What to build

Turn the current Category Live Stream experience into the first complete tab of the new Category navigation. Keep the stable Category header first, add a sticky `Live Streams | Clips | Videos` navigation row beneath it, and render the Live Stream controls and grid below. Until a media capability gate has passed, deep links to an unshipped Clips or Videos tab fall back to Live Streams.

Make the active tab, `All | Twitch | Kick` Platform scope, language, tag query, and viewer sort validated URL state so filtered views can be copied, refreshed, and traversed with Back and Forward. Missing or invalid state falls back safely to Live Streams and established Live defaults. Preserve the cross-Platform Category match while changing tabs or filters, including native Platform Category identity and the existing secondary Category match.

The Platform control sits on the left of the scrolling control row and remains a three-way segmented control at every width, stacking onto a full-width row when necessary. Keep the existing independent Twitch/Kick loading, pagination, cached-first rendering, partial-failure handling, and exact Live Viewer Count ordering. The header continues to show the combined count labeled “watching live,” with no totals in tab labels.

Use semantic native links for the tab navigation and accessible controls throughout. Changing a URL-backed filter opens the newly keyed Live dataset at the content top; same-session Back/Forward restores the applicable URL state without breaking the Category identity.

## Acceptance criteria

- [ ] The Category page renders a stable header followed by tabs in the order `Live Streams`, `Clips`, `Videos`, with Live Streams selected by default and only the tab row sticky.
- [ ] The tab navigation is a labeled semantic navigation region whose native links expose the active destination with `aria-current="page"` and visible keyboard focus.
- [ ] Missing, invalid, or unshipped tab values resolve to Live Streams without crashing or losing the Category.
- [ ] The URL validates and represents the active tab, Platform scope, language, tag query, and viewer sort; copied URLs, refresh, Back, and Forward reproduce the same Live view.
- [ ] Tab and filter links preserve the secondary cross-Platform Category match and use the correct native Category identity for each Platform.
- [ ] `All`, `Twitch`, and `Kick` Platform selections filter the Live grid correctly while keeping each Platform’s query, cursor, health, retry, and exhaustion state independent.
- [ ] The segmented Platform control remains text-labeled and visibly selected without relying on color, retains practical 40px targets, and stacks without horizontal page overflow at narrow widths.
- [ ] Language, tag, and viewer-sort behavior remains available on the right side of the control row and changing any URL-backed filter resets the new dataset to page one and the content top.
- [ ] The stable Category header keeps the combined Live Viewer Count labeled “watching live” for every tab destination, and tab labels show no content totals.
- [ ] Live Streams remain in exact selected viewer-count order and immediately re-sort when membership or Live Viewer Count changes, including while the viewer is scrolled down.
- [ ] Existing cached-first rendering, skeletons, explicit empty and filtered-empty states, independent pagination, and one-Platform partial-failure retry behavior remain intact for Live Streams.
- [ ] Automated route and page tests cover default, invalid, and deep-linked tab/filter state, preserved cross-Platform identity, Platform filtering, filter resets, accessibility semantics, and Back/Forward behavior.
- [ ] The running Electron app is verified with Electron MCP at wide and narrow widths, for keyboard navigation, all three Platform scopes, copied/deep-linked state, partial Platform failure, and immediate Live reorder behavior.

## Blocked by

None — can start immediately.

## Comments

- 2026-07-16: Implementation and acceptance evidence are complete: [Issue 03 URL-backed Live Streams evidence](../evidence/03-url-backed-live-streams-category-tab.md). Focused tests, production build, scoped formatting, deslop, independent review, and Electron MCP verification pass. Tracker closure and the required issue-referencing commit need a human decision because the relevant source/test files already contained overlapping user changes before Issue 03 began; those changes cannot be safely committed as this issue without authorization.
