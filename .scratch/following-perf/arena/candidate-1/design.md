# SQLite-owned Following refresh

## Usage, caller's view

`FollowingPage` reads one Follow collection. It never calls `useFollowedChannels` and never merges provider lists.

```tsx
const follows = useFollowStore((state) => state.follows);
const followsReady = useFollowStore((state) => state.status === "ready");
const syncConnectedFollows = useAuthStore((state) => state.syncConnectedFollows);

const visibleFollows = useMemo(
  () => selectFollowingChannels(follows, { filter, searchQuery }),
  [follows, filter, searchQuery]
);

const refresh = async () => {
  const activeContentRefresh = refreshActiveTab(activeTab);
  const [sync, content] = await Promise.allSettled([
    syncConnectedFollows(),
    activeContentRefresh,
  ]);
  setManualRefreshFailed(refreshFailed(sync) || refreshFailed(content));
};
```

The existing content hooks receive channels derived from SQLite.

```tsx
useFollowedStreams(undefined, 20, {
  enabled: activeTab === "live" || activeTab === "categories",
  snapshotIdentity: createFollowedStreamSnapshotIdentity(
    undefined,
    twitchUser?.id ?? "guest",
    String(kickUser?.id ?? "guest"),
    follows
  ),
});

useFollowedVideos(visibleFollows, { enabled: activeTab === "videos", sort: videoSort });
useFollowedClips(visibleFollows, {
  enabled: activeTab === "clips",
  sort: clipSort,
  timeRange: clipTimeRange,
});
```

Account sync remains an auth action. The two platforms reconcile independently and concurrently. The store hydrates once from SQLite after every successful batch.

```ts
const result = await syncConnectedFollows();
// result.outcomes preserves success or failure per connected platform.
// useFollowStore.follows now reflects the final active SQLite rows.
```

## Problem

Manual refresh currently performs account reconciliation serially, then fetches both provider Follow lists again and merges those remote results with the local store. It also refetches followed streams after reconciliation. The measured path takes 37.13 seconds. Account sync costs 30.34 seconds because Twitch takes 6.12 seconds before Kick starts its 24.03 second sync. The page then waits on Follow-list calls of 6.79 and 3.86 seconds plus a 5.27 second live read. SQLite hydration costs only 184 milliseconds. The design must keep the provider-specific reconciliation rules, including Kick's uncertain-result preservation and guest/account visibility, while making `local_follows` the only durable Follow list.

## Shape

### Data ownership

```text
provider account Follow APIs
          |
          | successful reconciliation only
          v
SQLite local_follows  <---- guest Follow writes
          |
          | FOLLOWS_GET_ALL, active rows only
          v
useFollowStore, in-memory projection
          |
          v
FollowingPage membership, filtering, and content inputs

SQLite identities ---> remote live status, videos, clips, category metadata
```

SQLite owns Follow membership, source, identity, and the channel metadata needed to render a stable card. Electron Store keeps auth, user, preference, and window data only. The renderer Follow store loses its Zustand `persist` wrapper, so localStorage is not a second durable Follow list. The unused Follow collection and CRUD methods in `auth-store` and `features/auth/data/useAuth.ts` should be deleted in the same change. Every renderer Follow consumer then reads `useFollowStore`.

### Type sketch

```ts
type FollowSource = "guest" | Platform;

interface LocalFollow {
  id: string;
  platform: Platform;
  channelId: string;
  channelName: string;
  displayName: string;
  profileImage: string;
  followedAt: string;
  source?: FollowSource;
  isVerified?: boolean;
  isPartner?: boolean;
}

type FollowHydrationStatus = "idle" | "loading" | "ready" | "error";

interface FollowState {
  follows: UnifiedChannel[];
  sourceByKey: Map<string, FollowSource>;
  status: FollowHydrationStatus;
  hydrate(): Promise<void>;
  // Existing mutation methods remain. They all converge through SQLite.
}

type PlatformFollowSyncOutcome =
  | {
      platform: Platform;
      status: "synced";
      count: number;
      pendingCount: number;
      changed: boolean;
      syncedAt: string;
    }
  | { platform: Platform; status: "failed"; reason: string };

interface FollowSyncResult {
  outcomes: PlatformFollowSyncOutcome[];
  changedPlatforms: Platform[];
}
```

`isVerified` and `isPartner` add two nullable integer columns to `local_follows`, defaulting to false for existing rows. Provider sync already receives `UnifiedChannel`; it should retain these two fields instead of discarding them. Guest writes copy them from the channel the user followed. This gives Channels stable avatar, display name, slug, platform, and badge metadata without a second Follow fetch. Videos and Clips already need only id, slug, display name, avatar, and platform. Live provides current title, category, viewer count, and live state remotely. Categories continue to derive membership from live streams and use the top-category read only for box art and canonical category metadata.

### Signatures and behavior

```ts
// auth-store.ts
syncConnectedFollows(): Promise<FollowSyncResult>;

async function syncConnectedFollows(): Promise<FollowSyncResult> {
  const connected = selectConnectedPlatforms(get());
  const outcomes = await Promise.all(connected.map(syncOnePlatform));
  if (outcomes.some((outcome) => outcome.status === "synced")) {
    await useFollowStore.getState().hydrate();
  }
  return summarize(outcomes);
}

// follow-store.ts
function channelFromFollow(row: LocalFollow): UnifiedChannel;
function hydrate(): Promise<void>; // single-flight and latest-read-wins

// Following/index.tsx, a local helper, not a new public hook
function refreshActiveTab(tab: FollowingTab): Promise<unknown>;

// stream-handlers.ts
function getFollowedLiveStatus(
  platform: Platform | undefined,
  limit: number
): Promise<UnifiedStream[]>;
```

`syncOnePlatform` calls the existing `auth.syncFollows(platform)` IPC method. It keeps `addedCount`, `removedCount`, `pendingCount`, and errors instead of collapsing them into two arrays. `Promise.all` changes scheduling only. Each backend reconciliation still validates and commits its own platform transaction. A failed platform preserves its prior SQLite rows. A successful platform may add, update, or prune only that platform's account-source rows. Guest rows remain separate. The final `FOLLOWS_GET_ALL` read applies the existing token and Kick-verification rules, so signing out reveals guest rows and signing in reveals confirmed account rows.

The page starts account sync and the active tab's remote content read together. This overlaps the 5.27 second live read with the 24.03 second Kick sync in the common no-change case. If reconciliation changes membership, the hydrated Follow identity changes the React Query key. Live, Videos, and Clips then fetch for the new identity automatically. Categories keeps the live query enabled while its tab is active, so it gets the same identity-change behavior. Channels needs no remote read.

`STREAMS_GET_FOLLOWED` should stop calling authenticated provider "followed streams" endpoints as an alternate membership source. It reads active SQLite rows, then asks the providers only for current status of those channel ids or slugs. Twitch uses the existing batched login lookup. Kick keeps its existing official-id and public status scan, cooldown, and stale snapshot behavior. This preserves remote live metadata without letting a remote response redefine page membership.

### Module map

- `frontend/pages/Following/index.tsx` removes both `useFollowedChannels` calls, the three-way merge, Follow-list loading and error state, and Follow-list refetches. It derives every tab's channel inputs from `useFollowStore`.
- `frontend/store/follow-store.ts` becomes the only renderer Follow collection. It drops Zustand persistence, maps the two badge fields, and makes hydration single-flight with latest-read-wins assignment.
- `frontend/store/auth-store.ts` runs connected platform syncs concurrently, retains per-platform outcomes, hydrates the Follow store once, and deletes its unused duplicate Follow collection and CRUD actions.
- `frontend/features/auth/data/useAuth.ts` deletes the unused wrappers around the duplicate auth-store Follow state.
- `shared/auth-types.ts` adds optional badge metadata to `LocalFollow` and sync inputs.
- `backend/services/database-service.ts` migrates and persists `is_verified` and `is_partner`. Its existing transaction and source-aware reconciliation remain authoritative.
- `backend/ipc/handlers/auth-handlers.ts` passes badge metadata from provider channels into reconciliation. Kick's error, uncertain-prune, pending-write, and account-change checks stay unchanged.
- `backend/ipc/handlers/stream-handlers.ts` treats SQLite rows as membership and performs live-status reads only.
- `backend/services/storage-service.ts` may remain the facade used by handlers, but all Follow methods continue to delegate to `dbService`. No Follow key or list is added to `ElectronStoreSchema`.

The interface is deliberately small. The page sees one array and one sync command. Reconciliation policy, active-source selection, schema details, and transport results stay behind main-process boundaries. No new page data service or pass-through hook earns its cost.

## Synthesis decision

This candidate chooses the direct page/store-derived shape requested for candidate 1. The existing Follow store is deep enough once it becomes a pure SQLite projection. A new `FollowingRepository` in the renderer would repeat `hydrate` and mutation methods without hiding new policy. A combined "refresh everything" IPC channel would mix Follow ownership with tab-specific content scheduling and make the main process aware of renderer UI state.

## Tradeoffs accepted

- We accept a two-column SQLite migration in exchange for removing the 6.79 and 3.86 second Follow-list reads without dropping offline badge metadata.
- We accept a second content fetch only when the Follow identity changes during a concurrent refresh. The common no-change refresh overlaps content work with sync.
- We accept provider sync latency as real account reconciliation cost. Kick's preservation and verification rules matter more than making the spinner stop early.
- We accept keeping `storageService` as a facade in exchange for a smaller diff. Its Follow methods are SQLite delegates, not Electron Store ownership.

## Alternatives considered

- Keep remote Follow hooks and prefer SQLite during the merge. This leaves three membership sources in the page and retains both redundant network calls. The caller must still understand precedence rules.
- Return provider channels from sync and keep metadata only in Zustand. This avoids a migration but creates a volatile second representation that loses badges after restart and can diverge from SQLite.
- Add a new main-process `following.refreshPage` command that syncs accounts and fetches every tab. This hides timing, but it couples backend code to renderer tabs and repeats existing content APIs. Its interface is shallow once callers still need ordinary hooks for polling and tab changes.

## Tests

- Page test. Seed `useFollowStore` with Twitch and Kick channels. Assert Channels, Videos, Clips, Categories, and Live receive SQLite-derived membership. Assert `useFollowedChannels` is no longer imported or called.
- Page refresh test. Assert sync and the active content refetch start before either settles. Assert Channels performs no content request. Assert partial sync failure leaves rows visible and sets the partial-failure UI.
- Auth-store test. Use deferred Twitch and Kick promises to prove both calls start concurrently. Assert one final hydrate, per-platform timestamps only for successes, correct changed-platform reporting, and single-flight behavior for double clicks.
- Database test. Prove badge fields round-trip, old rows default false, metadata-only sync updates them, a failed fetch changes nothing, uncertain Kick results do not prune, successful authoritative results prune only account-source rows, and guest rows survive.
- Stream-handler test. Assert live status uses active SQLite rows and never calls `getFollowedStreams` or `getAllFollowedChannels`. Cover signed-out guest rows, signed-in account rows, Kick verification gating, provider partial failure, and dedupe.
- Store test. Assert no persisted Zustand Follow cache is read after restart, hydration maps metadata, and an older overlapping read cannot overwrite a newer result.
- Run the touched files in isolation under the two-second file budget, then `npm run typecheck`, `npm run architecture:features`, and the deterministic desktop suite.

## Electron measurement plan

Use the same account pair and Follow counts as the 37.13 second baseline. Take five manual-refresh traces after one warm-up and report median plus slowest run. Mark button click, Twitch sync, Kick sync, SQLite hydrate, live-status read, active-tab content read, first updated paint, and button-ready time. Verify Twitch and Kick spans overlap. Verify no `CHANNELS_GET_FOLLOWED`, Twitch `getAllFollowedChannels` outside sync, or Kick followed-channel page call occurs after sync. Verify exactly one live-status read on a no-change Live refresh. The predicted no-change critical path is about 24 seconds, the slower of the measured 24.03 second Kick sync and 5.27 second live read. That is a predicted 13.1 second reduction, about 35 percent, and must be replaced by observed Electron numbers before shipping.

## Open questions and risks

- Do the provider Follow payloads always contain trustworthy badge metadata, or must sync perform an existing batch profile enrichment before commit?
- Can the current Kick live scan accept only stable ids and slugs from active SQLite rows without reopening the expensive followed-page fallback?
- Does removing the renderer-persisted Follow cache change pre-hydration startup paint in a noticeable way, even though measured SQLite hydration is 184 milliseconds?
- Should `followSyncLastSyncedAt` remain session-only, or should SQLite own sync freshness in a later change? It is status metadata, not Follow ownership, so this design leaves it unchanged.

## Red-flag screen

The page coordinates one sync command and one tab read, not reconciliation stages. Storage schema and provider wire types do not cross into the page. No new pass-through module is introduced. Modules remain organized by ownership rather than load, transform, and save phases. A maintainer can answer where Follow membership comes from by tracing `FollowingPage` to `useFollowStore` to `FOLLOWS_GET_ALL` to `local_follows`.

## Rationale and principles

`principle-foundational-thinking` made `LocalFollow` the first design decision and added only the metadata required by real tab access patterns. `principle-model-the-domain` kept guest and account sources in the existing source-tagged SQLite model instead of adding page booleans. `principle-make-operations-idempotent` preserved transaction-based reconciliation and made hydrate latest-read-wins. `principle-subtract-before-you-add` removed remote Follow hooks, renderer persistence, and the duplicate auth-store list before considering a new abstraction. `principle-laziness-protocol` rejected a new repository and a combined refresh IPC command. `principle-minimize-reader-load` reduced page membership tracing to one store and one database. `principle-prove-it-works` produced the Electron trace checks and exact forbidden calls.

## Next implementation step

First add failing database and store tests for badge round-trip, active guest/account selection, no persisted renderer Follow cache, and concurrent sync with one final SQLite hydrate.
