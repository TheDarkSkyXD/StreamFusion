# Slice 03 - Sidebar follow-sync affordance

Status: done

## Parent

PRD: ../prd.md

## What to build

Add a compact manual follow-sync control to the sidebar Following section. The sidebar control should reuse the same account-follow sync behavior and state from the `/following` page: one click syncs all connected Platforms, success is quiet, failure is visible, and progress is reflected in the icon.

The sidebar UI should stay compact. In expanded mode, show the refresh affordance near the Following header. In collapsed mode, avoid adding noisy text; use a tooltip/title so users can still discover what the icon does.

## Acceptance criteria

- [x] Expanded sidebar Following header includes a compact refresh icon affordance.
- [x] The sidebar refresh icon triggers the same all-connected-Platforms account-follow sync behavior as the `/following` page.
- [x] While sync is in flight from either surface, the sidebar icon shows progress and duplicate clicks are blocked.
- [x] On success, no toast appears and sidebar follow rows update from hydrated sync results.
- [x] On partial/full failure, the same Platform-specific failure toast behavior is used.
- [x] Sidebar tooltip/title summarizes sync freshness using the oldest connected Platform timestamp while preserving per-Platform state internally.
- [x] Collapsed sidebar remains visually compact and does not introduce text overflow or layout shift.
- [x] Component tests cover expanded, collapsed, pending, failure, and freshness-tooltip states.

## Blocked by

- 02-manual-account-follow-sync-following-page.md

## Comments

- Closed 2026-07-02: sidebar Following now has an icon-only sync control in expanded/collapsed states, shared pending/failure/freshness behavior, and component coverage. Electron MCP screenshot proof saved at `.scratch/images/sidebar-follow-sync.png`.
