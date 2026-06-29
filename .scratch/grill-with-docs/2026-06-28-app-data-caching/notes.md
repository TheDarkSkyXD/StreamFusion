# App Data Caching: Grilling Session Notes
Date: 2026-06-28 . Goal: decide whether and how StreamFusion should add broader caching for app data load times.

## PRD

- Local PRD: prd.md
- Local issues:
  - issues/01-cache-policy-tiers.md
  - issues/02-stale-first-browsing-queries.md
  - issues/03-event-based-cache-invalidation.md
  - issues/04-user-action-freshness.md
  - issues/05-balanced-cache-ui-feedback.md
  - issues/06-cache-behavior-verification.md

## Summary / key decisions

- Existing code already uses multiple cache forms: renderer React Query caches for follows/following, main-process endpoint caches for Kick stream lookups, persisted Zustand stores for local UI/history state, and platform-health stale-success behavior.
- Decision: prefer a hybrid of targeted per-data caching plus tuning existing caches. Do not introduce one giant global cache.
- Decision: allow stale-first paint for browsing surfaces, but require fresh/confirmed state for user actions and account-sensitive status.
- Decision: use event-based invalidation plus TTL expiry for automatic cache clearing.
- Decision: use stale-first paint with background refresh on route open, interval, and key events as the real-time update model.
- Decision: standardize cache windows as a tiered policy table instead of ad hoc per-hook timings or one global TTL.
- Decision: remote browse caches should be mostly memory-only; persist only local/user-owned state.
- Decision: use quiet stale-first UI. Do not constantly show refresh indicators; surface stale/cache state only when refresh fails, platform health is degraded/down, or the state materially affects user trust.

## Q&A log

### Q1 - cache strategy
- Asked: Should StreamFusion add targeted per-data caching, one unified global cache, or only tune existing caches?
- Captured: User asked about combining option 1 and option 3, with a recommendation on what would be best.
- Recommendation: combine them. Keep existing React Query/Zustand/main-process caches where they fit, add targeted cache policies only for specific slow surfaces, and avoid a centralized global cache because following status, search results, category streams, multiview metadata, and local history all have different freshness rules.
- Doc updates: none.
- Flags: none.

### Q2 - stale-first surfaces
- Asked: Which surfaces are allowed to paint stale data first?
- Captured: User chose option 1: stale-first for browsing data, fresh-required for user actions.
- Decision: sidebar/following/category/search/multiview can show cached data immediately and refresh in the background. Follow/unfollow state, auth status, and destructive actions must confirm fresh state before showing final action state.
- Doc updates: none.
- Flags: none.

### Q3 - automatic cache clearing
- Asked: How aggressive should automatic cache clearing be?
- Captured: User chose event-based invalidation plus TTL expiry.
- Decision: clear or update affected caches on meaningful events such as login/logout, follow/unfollow, platform health recovery, app update/schema version change, and manual clear. Let normal browsing caches expire by TTL instead of wiping constantly.
- Doc updates: none.
- Flags: none.

### Q4 - real-time update model
- Asked: What should "update the cache in real time" mean?
- Captured: User chose stale-first plus background refresh on route open, interval, and key events.
- Decision: screens should paint cached data immediately, then refresh when opened, on sensible intervals, after follow/auth/platform events, and after manual refresh. Avoid true push/live updates as the default because platform coverage is uneven, and avoid aggressive polling everywhere because it increases API load/rate-limit risk.
- Doc updates: none.
- Flags: none.

### Q5 - tiered cache windows
- Asked: Should cache windows be standardized per surface?
- Captured: User chose a tiered cache policy table.
- Decision: define named cache tiers for live/followed stream status, stream/channel detail, followed channel lists, followed videos/clips, search, categories, and local history/sidebar UI state. Keep current timings where they fit, but make the timing contract visible and reusable.
- Doc updates: none.
- Flags: none.

### Q6 - cache storage boundary
- Asked: Should remote browsing caches persist across app restarts?
- Captured: User chose mostly memory-only caches, with persistence only for local/user-owned state.
- Decision: use React Query/main-process memory caches for remote browsing data during a session. Persist sidebar state, multiview layout, history, search history, preferences, and other local/user-owned state through existing stores. Avoid disk-persisted remote browse snapshots for now, except backend stale-success mechanisms used for outage resilience if already present.
- Doc updates: none.
- Flags: none.

### Q7 - stale UI visibility
- Asked: Should the UI tell users when they are seeing cached/stale data?
- Captured: User chose quiet stale-first, visible only on refresh failure/platform degradation, with a strong UX requirement that it must not be annoying, noisy, or constantly show refresh state.
- Decision: cached data appears normally while background refresh runs. Avoid persistent "refreshing" indicators for routine background refresh. Use subtle refresh affordances only where helpful, and show stale/degraded messaging only when refresh fails, PlatformHealth is degraded/down, or stale data materially changes user trust.
- Doc updates: none.
- Flags: none.

### Q8 - PRD and issues
- Asked: Should this grill session become a PRD and implementation issue set?
- Captured: User chose yes: make a PRD and then split into issues.
- Decision: write a local PRD in this grill session folder, then publish the approved vertical-slice issues.
- Doc updates: prd.md created; six ready-for-agent issue files created under issues/.
- Flags: none.

## Open flags (pending input)

- None.
