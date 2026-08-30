# Candidate 2: query boundary around followed channels

## Usage

The page reads one followed-channel collection from the local Follow store. Provider calls only answer questions about those channels.

```tsx
const follows = useFollowingChannels({
	enabled: canRenderContent && authInitialized,
});

const live = useFollowedLiveStatus(follows.channels, {
	enabled: activeTab === "live",
	limit: 100,
});

const sync = useConnectedFollowSync();

async function refreshFollowingData() {
	const syncResult = await sync.refreshConnectedPlatforms();
	await follows.refreshFromLocalStore();
	await live.refetch();
}
```

`FollowingPage` stops importing `useFollowedChannels`. It derives Channels, Videos, Clips, and Categories from `follows.channels`. Videos and Clips keep the existing `useFollowedVideos(follows.filteredChannels, ...)` and `useFollowedClips(follows.filteredChannels, ...)` shape. Categories still join `live.streams` to `useTopCategories`, because category art and cross-platform metadata are remote catalog data, not Follow ownership.

The backend live-status call receives local channel seeds, not an implicit provider follow-list request.

```ts
await window.electronAPI.streams.getLiveStatusForFollows({
	platform: "kick",
	channels: follows.channels.filter((channel) => channel.platform === "kick"),
	limit: 100,
});
```

Provider sync remains an auth operation.

```ts
await window.electronAPI.auth.syncFollows("twitch");
await window.electronAPI.auth.syncFollows("kick");
```

## Problem

Manual refresh on `/following` now treats remote followed-channel queries as page data. That makes the page wait on three kinds of work that should not all sit in one path: provider account reconciliation, local follow hydration, and content status reads. The measured baseline shows the cost clearly. Total refresh is 37.13 s. Account sync takes 30.34 s because Twitch takes 6.12 s and Kick takes 24.03 s serially. After SQLite hydrates in 184 ms, the page still repeats remote follow-list calls for Twitch, Kick, and followed streams. SQLite `local_follows` already carries the durable Follow model with `source = guest | twitch | kick`, and `upsertSyncedFollows` already owns provider reconciliation. The redesign should make that boundary explicit.

## Shape

Core data shape:

```ts
type FollowPlatform = Extract<Platform, "twitch" | "kick">;

type FollowIdentity =
	| { kind: "twitch"; id: string; slug: string }
	| { kind: "kick"; broadcasterUserId?: string; channelId: string; slug: string };

interface FollowingChannel {
	identity: FollowIdentity;
	channel: UnifiedChannel;
	source: "guest" | FollowPlatform;
}

interface FollowingChannelSnapshot {
	channels: readonly FollowingChannel[];
	sourceVersion: string;
	hydrated: boolean;
}

interface FollowSyncResult {
	synced: FollowPlatform[];
	failed: FollowPlatform[];
	failureReasons: Partial<Record<FollowPlatform, string>>;
}

interface FollowLiveStatusRequest {
	platform?: FollowPlatform;
	channels: readonly Pick<UnifiedChannel, "id" | "platform" | "username" | "avatarUrl">[];
	limit?: number;
}
```

Function signatures:

```ts
function selectFollowingSnapshot(state: FollowState): FollowingChannelSnapshot;

function filterFollowingChannels(input: {
	channels: readonly FollowingChannel[];
	platform: FollowPlatform | "all";
	searchQuery: string;
	liveStreams: readonly UnifiedStream[];
}): readonly FollowingChannel[];

function joinLiveStatus(input: {
	channels: readonly FollowingChannel[];
	streams: readonly UnifiedStream[];
}): readonly UnifiedStream[];

function buildContentChannelLookup(
	channels: readonly FollowingChannel[]
): ReadonlyMap<string, UnifiedChannel>;

function useFollowedLiveStatus(
	channels: readonly FollowingChannel[],
	options?: { enabled?: boolean; platform?: FollowPlatform; limit?: number }
): UseQueryResult<UnifiedStream[]>;
```

Renderer modules:

- `frontend/store/follow-store.ts` remains the in-memory mirror of SQLite. It exposes `getFollowingSnapshot()` or a selector that returns `FollowingChannelSnapshot`.
- `frontend/features/discovery/data/following-query-boundary.ts` owns filtering, live matching, and channel lookup maps as pure functions. This moves the repeated ID and slug matching out of `FollowingPage`.
- `frontend/features/discovery/data/queries/useStreams.ts` adds `useFollowedLiveStatus(channels, options)`. Its query key includes the sorted local follow identities.
- `frontend/pages/Following/index.tsx` calls the local snapshot hook, `useFollowedLiveStatus`, `useFollowedVideos`, `useFollowedClips`, and `useTopCategories`. It no longer calls `useFollowedChannels`.

Main-process modules:

- `backend/ipc/handlers/auth-handlers.ts` keeps `AUTH_SYNC_FOLLOWS` as the only provider follow-list fetch path. `syncConnectedFollows` should run the two platform syncs with `Promise.allSettled` instead of a serial loop.
- `backend/ipc/handlers/stream-handlers.ts` should add a seed-based live-status handler or change `STREAMS_GET_FOLLOWED` to honor an optional `channels` seed. I prefer a new method named for the read capability, because it prevents callers from assuming the backend can choose the Follow set.
- Provider adapters expose narrow read capability functions. Twitch uses `getStreamsByLogins(logins)` for seeded status. Kick uses `getStreamsByBroadcasterIds(ids)` first and `getPublicStreamBySlug(slug)` only for rows without stable IDs.

The public surface is intentionally small. Callers can ask for the local Follow snapshot, start account sync, and ask for live status for a known channel set. They cannot ask a content query to discover Follow ownership. That follows `model-the-domain`, `boundary-discipline`, and `type-system-discipline`.

## Module map

- `apps/desktop/src/frontend/pages/Following/index.tsx`. Remove `useFollowedChannels` imports, remote follow loading state, remote follow errors, and remote follow refetch calls.
- `apps/desktop/src/frontend/features/discovery/data/following-query-boundary.ts`. New pure helpers for `buildFollowingChannelSnapshot`, `filterFollowingChannels`, `indexLiveStreams`, `joinLiveStatus`, and `buildContentChannelLookup`.
- `apps/desktop/src/frontend/features/discovery/data/queries/useStreams.ts`. Add the seed-based hook and query key. Keep persisted followed-stream snapshots keyed by local follow identity.
- `apps/desktop/src/shared/ipc-channels.ts`. Add `STREAMS_GET_FOLLOW_LIVE_STATUS` and payload types if a new channel is chosen.
- `apps/desktop/src/backend/preload/index.ts`. Add `streams.getFollowLiveStatus`.
- `apps/desktop/src/backend/ipc/handlers/stream-handlers.ts`. Add the handler and keep transport errors local to this boundary.
- `apps/desktop/src/frontend/store/auth-store.ts`. Change `syncConnectedFollows` from serial `for...of` to parallel settled calls. Keep single-flight.

## Rationale

SQLite becomes the only durable Follow source for `/following`. Remote provider follow lists remain durable only after `AUTH_SYNC_FOLLOWS` reconciles them into `local_follows`. This matches the current schema instead of adding a new owner. `electron-store` remains for auth tokens, users, and preferences only. It does not own Follow rows.

Manual refresh becomes two independent phases. First, sync connected accounts into SQLite. Second, hydrate the local Follow store and refresh remote metadata keyed by the local channel set. The page can render the current SQLite list immediately and mark sync in progress while provider reconciliation runs. If sync fails, the page preserves the prior SQLite rows and still refreshes live status for them.

The latency win comes from elimination and parallelism. Removing page-level `useFollowedChannels` deletes 6.79 s for Twitch and 3.86 s for Kick from the refresh path. Making account sync parallel caps sync time near the slowest provider instead of Twitch plus Kick, so the observed 30.34 s sync should move toward about 24.03 s before provider-level Kick work changes. The critical path after sync should be SQLite hydrate plus seeded live-status, not account sync plus redundant follow discovery.

Guest semantics stay intact. When signed out, `getActiveFollowsByPlatform` returns only `source = guest`. When signed in, it returns only `source = platform`, with Kick still hidden until the verified marker matches the current account. The page trusts that active-set policy instead of re-deciding it.

Tab metadata stays covered. Channels use the `UnifiedChannel` rows hydrated from SQLite. Live uses `UnifiedStream` rows from seeded provider status reads and patches missing avatar or verification data from the local channel. Videos and Clips use the same local channel list to fetch per-channel content and to fill card channel metadata. Categories derive from live stream category IDs and names, then join against `useTopCategories` only for art, tags, and cross-platform category metadata.

## Synthesis decision

Candidate 2 should be used when the goal is a clean data boundary. It is deeper than a page-local derivation because it creates a provider-read capability: content queries need channel seeds, not implicit Follow ownership. It rejects a broad repository rewrite and keeps the current sync machinery.

## Tradeoffs accepted

- We accept that Channels may show cached display names and avatars until sync or metadata repair updates SQLite, in exchange for deleting remote follow-list reads from the page.
- We accept a new live-status IPC method, in exchange for a name that prevents accidental follow discovery through `streams.getFollowed`.
- We accept keeping `useFollowedChannels` for other consumers during the first pass, in exchange for a smaller `/following` change. A later pass can move `SidebarFollows` to the same boundary.
- We accept that Kick seeded live status may still be slow for slug-only rows, in exchange for keeping provider reconciliation safety out of the page.

## Alternatives considered

- Page-only derivation from `localFollows`. This removes `useFollowedChannels` from `FollowingPage`, but it keeps `streams.getFollowed` as an implicit follow-list owner. That leaks ownership into the live query.
- Replace `CHANNELS_GET_FOLLOWED` with a SQLite-backed implementation. This hides the network cost, but the method name still says provider followed channels and invites future callers to treat it as remote truth.
- Move all follow and live data into one `getFollowingPageData` IPC call. This shortens the page, but it creates a shallow page-specific backend method and mixes durable follows, account sync, live status, videos, clips, and categories behind one response.

## Risks

- Do any tests rely on `CHANNELS_GET_FOLLOWED` being called from `/following` rather than only from sidebar or hook tests?
- Does persisted followed-stream bootstrap need a new identity version so old snapshots created from provider follow queries cannot resurrect stale live cards?
- Should `SidebarFollows` move to the same boundary in the same change, or should `/following` land first to keep the perf fix small?
- Can Kick `getStreamsByBroadcasterIds` cover enough account rows to avoid slug fan-out after the next successful sync?

## Tests

- Update `tests/pages/Following.test.tsx` so rendering and manual refresh prove `useFollowedChannels` is not called.
- Update the manual refresh test to prove `syncConnectedFollows`, local follow hydration, and live-status refetch happen without `refetchTwitchFollows` or `refetchKickFollows`.
- Add a hook test for `useFollowedLiveStatus` that proves query keys change when the local follow identity changes.
- Add a backend stream-handler test that seeded live status does not call `getFollowedStreams` or provider followed-channel APIs.
- Keep auth-store tests for single-flight and add a case that connected Twitch and Kick syncs start before either resolves.

## Electron measurement plan

Run the same `/following` manual refresh measurement with temporary spans, then remove the spans before shipping. Capture:

- `manual-refresh.total_ms`
- `manual-refresh.account_sync_ms`
- `manual-refresh.sqlite_hydrate_ms`
- `manual-refresh.live_status_ms`
- `manual-refresh.followed_channels_remote_call_count`

Pass criteria:

- Remote followed-channel call count is zero for `/following`.
- Account sync runs both platforms concurrently.
- SQLite hydrate stays near the current 184 ms.
- Total refresh no longer includes the 6.79 s Twitch and 3.86 s Kick followed-channel refetches.

## First implementation step

Create `following-query-boundary.ts` with the `FollowingChannelSnapshot` type and pure join helpers, then update `FollowingPage` to use that local snapshot before adding the seed-based live-status IPC.
