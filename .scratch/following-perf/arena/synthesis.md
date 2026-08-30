# Following refresh synthesis

## Pick

Candidate 1 is the base. Both candidates converge on the two decisions that directly answer the measured problem: SQLite `local_follows` owns membership, and Twitch/Kick reconciliation runs concurrently. The cross-judge also selected candidate 1 (29/30 versus 20/30).

## First implementation slice

1. Remove `useFollowedChannels` and the remote merge from `FollowingPage`; render the database-hydrated `useFollowStore.localFollows` projection.
2. Remove the persisted Follow payload from `useFollowStore`, so browser storage is not a second durable Follow list. Keep Zustand only as the in-memory SQLite projection and optimistic write surface.
3. Run connected provider sync calls concurrently with per-platform failure isolation, then hydrate once.
4. Remove page-level remote Follow refetches. Start only the active tab's content refresh alongside reconciliation; the existing SQLite Follow identity key/invalidation triggers a corrective query when membership changes.
5. Add regression tests for database-owned page membership, no remote Follow refetch, no persisted Follow cache, and concurrent platform start.

This slice preserves the existing backend reconciliation, guest/account selection, and current live/content APIs. It targets the observed 37.13-second critical path without mixing a stream-API redesign or database badge migration into the latency fix.

## Grafts

From candidate 2:

- Use settled per-platform concurrency so one provider rejection cannot cancel the other.
- Keep content queries keyed by the existing sorted SQLite Follow identity.

## Rejected for this slice

- New seeded live-status IPC: architecturally clean, but not needed to remove the measured page Follow-list calls and expands the change through shared IPC, preload, backend, and provider clients.
- Badge columns and schema migration: useful if offline badges become a product requirement, but identity, display name, avatar, and tab inputs are already in SQLite. This performance fix should not introduce an unrelated migration.
- New `FollowingChannelSnapshot`/query-boundary module: duplicates the existing `UnifiedChannel[]` projection without hiding additional policy.
- A broad combined refresh API: the renderer can overlap the existing independent operations and let the SQLite identity key trigger a corrective read when reconciliation changes membership.

## Verification contract

- Electron: the Following page renders SQLite rows and manual refresh makes no page-level remote followed-channel calls.
- Timing: provider spans overlap; total should approach slowest-provider sync plus the active content read instead of both provider syncs plus two remote Follow-list reads.
- Tests: targeted page, Follow store, and auth store suites; typecheck/lint; React diagnostics.

## Verification result

The real Electron button measured 24.1582 seconds and 23.9528 seconds after one diagnostic run exposed and removed an unthrottled Kick metadata sweep from the hydration critical path. The final median is 24.0555 seconds, 35.2% faster than the 37.1265-second baseline. Targeted tests, TypeScript, scoped ESLint, feature-boundary checks, and React Doctor passed.
