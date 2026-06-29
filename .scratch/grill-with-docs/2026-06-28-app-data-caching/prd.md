# App Data Caching

## Problem Statement

StreamFusion has multiple data-heavy browsing surfaces whose first paint can feel slower than necessary: the followed sidebar, following page, search, category pages, multiview metadata, and history-adjacent flows. The app already has several cache mechanisms, including React Query caches, main-process endpoint caches, persisted Zustand state, and PlatformHealth stale-success behavior, but the policy is scattered across hooks and services.

Users should see useful data quickly without being misled by stale account state or noisy refresh indicators.

## Solution

Adopt a hybrid cache strategy:

- Tune and standardize the existing React Query, Zustand, and main-process caches.
- Add targeted cache behavior only where a specific browsing surface needs it.
- Avoid a single global cache.
- Paint browsing data stale-first, then refresh in the background.
- Require fresh or confirmed state for user actions and account-sensitive status.
- Use event-based invalidation plus TTL expiry.
- Keep remote browsing caches mostly memory-only; persist only local/user-owned state.
- Keep cache UI quiet unless refresh failure, PlatformHealth degradation/down state, or user trust requires a visible signal.

## User Stories

- As a viewer, I want the followed sidebar and following page to show useful data immediately so app navigation feels fast.
- As a viewer, I want live status and viewer counts to refresh in the background so the app stays current without constant loading states.
- As a viewer, I want search and category pages to reuse recent results so returning to a query/page is quick.
- As a viewer, I want multiview stream metadata to remain responsive when switching layouts or returning to streams.
- As a viewer, I want history, sidebar state, and multiview layout to persist because those are my local app state.
- As a user taking an action, I want follow/unfollow/auth-sensitive state to be confirmed fresh so the app does not show wrong action status.
- As a viewer during platform trouble, I want the app to avoid blanking out useful stale data, but only warn me when it matters.

## Implementation Decisions

- Define a named cache policy table for data tiers instead of scattering raw timings through hooks.
- Suggested tiers:
  - Live/followed stream status: 30 seconds stale, 60 second visible refresh interval.
  - Stream/channel detail: 30 seconds stale, refresh while mounted where live data matters.
  - Followed channel list: 5 minutes stale, invalidate on auth/follow events.
  - Following videos/clips: 2 minutes stale, 10 minutes cache retention.
  - Search: 5 minutes stale, 10 minutes cache retention, no interval.
  - Categories: 5 minutes stale, 15 minutes cache retention, refresh viewer counts while visible.
  - History/sidebar UI/local state: persisted local state with no remote TTL.
- Route-open refresh, sensible visible intervals, auth/follow/platform events, and manual refresh are the background update triggers.
- Event invalidation should target affected query families instead of clearing every cache.
- Follow/unfollow, logout, account switch, auth loss, and platform health recovery must invalidate or update affected follow/followed-stream caches.
- Local/user-owned state remains in Zustand persistence where it already belongs.
- Remote browse snapshots should not be disk-persisted in this iteration.
- Existing PlatformHealth stale-success behavior remains the outage-resilience model for remote failures.

## Testing Decisions

- Unit-test cache policy constants and query option helpers if introduced.
- Test event invalidation for auth login/logout, follow/unfollow, and platform health recovery.
- Test stale-first behavior by ensuring previous data remains visible while background refetch occurs.
- Test action freshness by ensuring follow/unfollow state is not finalized from stale cache alone.
- For UI surfaces, manually verify sidebar, Following, Search, CategoryDetail, MultiStream, and History behavior in the desktop app.
- Run lint, type-check, and build before marking issues done.

## Out of Scope

- A single global cache for all app data.
- Disk-persisted remote browsing snapshots.
- True push/live updates for all browsing data.
- Aggressive polling everywhere.
- Constant refresh indicators or noisy stale-data labels.

## Further Notes

- This PRD came from the grill session in `notes.md`.
- The local tracker for this repo stores implementation issues under this same grill session folder when using grill-originated features.
