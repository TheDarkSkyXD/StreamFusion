# Candidate B. Session registry with one visible chat pane

## Problem

Categories persists a merged top-catalogue under `CATEGORY_KEYS.top`, but the Categories route consumes separate provider infinite keys. A restart therefore cannot paint the persisted catalogue on that route. MultiView permits an unlimited saved layout, but every slot currently subscribes to the full Zustand state and two independent start delays decide when a playback request begins. Chat has the harder ownership problem. `TwitchChat` and `KickChat` own both channel lifecycle and the virtualized view. Mounting one for every MultiView channel keeps data live, but also mounts a hidden `Virtuoso` tree per channel and duplicates renderer-side event listeners. Mounting only the selected one loses live messages when a tab is not selected.

The existing `twitchChatService` and `kickChatService` already own one provider transport, concurrent channel joins, and reference-counted channels. This design builds on those services. It does not create a second socket layer.

## Usage

```tsx
function CategoriesPage() {
  const catalogue = useCategoryCatalogue();

  return (
    <VirtualizedCategoryGrid
      categories={catalogue.categories}
      hasNextPage={catalogue.hasNextPage}
      isFetchingNextPage={catalogue.isFetchingNextPage}
      onLoadMore={catalogue.loadMore}
    />
  );
}

function MultiStreamPage() {
  const streams = useMultiStreamStore(selectOrderedStreams);
  const chat = useMultiStreamChatTabs(streams);

  return (
    <>
      <VirtualizedMultiStreamGrid streams={streams} />
      <MultiStreamChatRail tabs={chat.tabs} activeTabId={chat.activeTabId} onSelect={chat.selectTab} />
    </>
  );
}
```

The grid asks one planner which slots own playback. It never decides from an array index itself.

```tsx
function MultiStreamSlot({ slot }: { slot: StreamSlotModel }) {
  const active = usePlaybackAssignment(slot.id);

  return <StreamSlotChrome slot={slot}>{active ? <SlotPlayer slot={slot} /> : <DormantSlot />}</StreamSlotChrome>;
}
```

The rail owns all channel leases, but mounts exactly one visual chat component. The active component retains current composer, moderation, prediction, emote, and message-list behavior.

```tsx
function MultiStreamChatRail(props: ChatRailProps) {
  const active = useChatSession(props.activeTabId);

  return active ? (
    <ChatChannelPane key={active.key} session={active} showComposer />
  ) : (
    <EmptyChatRail />
  );
}
```

## Shape

### Stable identifiers

```ts
declare const streamSlotIdBrand: unique symbol;
declare const chatChannelKeyBrand: unique symbol;

export type StreamSlotId = string & { readonly [streamSlotIdBrand]: true };
export type ChatChannelKey = string & { readonly [chatChannelKeyBrand]: true };

export interface ChatChannelRef {
  readonly key: ChatChannelKey;
  readonly platform: ChatPlatform;
  readonly channel: string;
  readonly channelId?: string;
  readonly kickChannelId?: string;
  readonly chatroomId?: number;
  readonly kickUserId?: string;
  readonly displayName: string;
}

export function makeChatChannelRef(input: {
  platform: ChatPlatform;
  channel: string;
  channelId?: string;
  kickChannelId?: string;
  chatroomId?: number;
  kickUserId?: string;
  displayName?: string;
}): ChatChannelRef;
```

`makeChatChannelRef` normalizes the provider channel name and creates the one key used by the session registry, `chat-store`, tabs, and message routing. The key is not a UI label. Twitch and Kick channels with the same slug remain distinct. Kick requires `chatroomId` before a session can join. Validation happens here and at the IPC-backed channel resolver. Code below this boundary receives a complete `ChatChannelRef`.

### Channel sessions

```ts
export interface ChatSessionSnapshot {
  readonly ref: ChatChannelRef;
  readonly phase: "resolving" | "joining" | "live" | "failed";
  readonly unreadCount: number;
  readonly lastMessageAt: number | null;
}

export interface ChatSessionLease {
  readonly key: ChatChannelKey;
  release(): void;
}

export interface ChatSessionRegistry {
  reconcile(channels: readonly ChatChannelRef[]): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReadonlyMap<ChatChannelKey, ChatSessionSnapshot>;
  retainVisible(key: ChatChannelKey): ChatSessionLease;
  dispose(): void;
}

export function createChatSessionRegistry(deps: ChatSessionDependencies): ChatSessionRegistry;
export function useMultiStreamChatTabs(streams: readonly StreamSlotModel[]): {
  readonly tabs: readonly ChatSessionSnapshot[];
  readonly activeTabId: ChatChannelKey | null;
  selectTab(key: ChatChannelKey): void;
};
```

The registry has one record per `ChatChannelKey`. `reconcile` diffs the saved MultiView channels against records, starts a baseline session for additions, and releases only removed records. Repeating `reconcile` with the same set is a no-op. `retainVisible` only protects a selected record from removal while React commits a tab switch. It does not start another provider subscription.

`ChatChannelSession` is internal. It moves only nonvisual work from `TwitchChat` and `KickChat`: acquire and release, connect and join, history gate, service-event filtering, normalized message writes, room state, badge hydration, and persisted history. Each session registers service listeners once and checks `event.channel` against its normalized `ref.channel` before writing `chat-store`. Provider-wide connection status remains provider-owned. Per-channel status, unread counts, and all content writes are keyed by `ChatChannelKey`.

```ts
interface ChatChannelSession {
  readonly ref: ChatChannelRef;
  start(): Promise<void>;
  stop(): Promise<void>;
  markRead(): void;
}

function createTwitchChatSession(ref: ChatChannelRef, deps: ChatSessionDependencies): ChatChannelSession;
function createKickChatSession(ref: ChatChannelRef, deps: ChatSessionDependencies): ChatChannelSession;
```

`ChatChannelPane` becomes a small dispatcher that renders the existing `TwitchChat` or `KickChat` in `mode="view"`. In view mode those components retain their current rendering and channel-scoped interactions, but do not acquire services, join channels, seed history, or register live-event listeners. The active pane reads its existing `ChatMessageList` bucket by `ref.key`. It is the only mounted virtualized list. Provider-specific features such as moderation controls, reply, pins, predictions, channel emotes, and the composer stay in the existing components.

```ts
export interface ChatChannelPaneProps {
  readonly session: ChatSessionSnapshot;
  readonly showComposer: boolean;
}

// Added to both existing platform component props.
type ChatRenderMode = "standalone" | "view";
```

Standalone remains the default for the stream page and therefore preserves current callers. MultiView passes `mode="view"`. The session registry is the only code path allowed to call `acquire`, `connect`, `joinChannel`, or `release` for a MultiView chat channel.

### Playback planning

```ts
export interface PlaybackBudget {
  readonly maxActive: number;
}

export interface PlaybackPlanInput {
  readonly orderedSlotIds: readonly StreamSlotId[];
  readonly visibleSlotIds: readonly StreamSlotId[];
  readonly focusedSlotId: StreamSlotId | null;
  readonly requestedSlotId: StreamSlotId | null;
  readonly budget: PlaybackBudget;
}

export interface PlaybackPlan {
  readonly activeSlotIds: ReadonlySet<StreamSlotId>;
}

export function planPlayback(input: PlaybackPlanInput): PlaybackPlan;
```

The pure planner selects, in order, a focused slot, a user-requested slot, and visible slots in layout order until `maxActive` is full. It returns no hidden active players. The browser slot grid reports its visible ids after layout. A virtualized grid may unmount offscreen chrome, and the plan removes its playback ownership before that happens. The saved `orderedSlotIds` collection has no cap.

`MultiStreamGrid` owns one planner subscription. Each memoized `StreamSlotChrome` receives a stable `StreamSlotModel` and subscribes only to its boolean assignment. It does not call `useMultiStreamStore()` without a selector. The planner replaces both current startup stagger systems with a budget-aware queue.

```ts
export interface PlaybackStartQueue {
  reconcile(plan: PlaybackPlan): void;
  cancel(slotId: StreamSlotId): void;
  dispose(): void;
}

export function createPlaybackStartQueue(options: {
  readonly intervalMs: number;
  readonly start(slotId: StreamSlotId): Promise<void>;
  readonly stop(slotId: StreamSlotId): Promise<void>;
}): PlaybackStartQueue;
```

The queue starts at most one cold slot per interval, skips warm `useStreamPlayback` cache hits, and cancels work when the plan changes. `StreamSlot` supplies an `active` boolean to `useStreamPlayback`. The hook no longer derives a global mount order. `slotIndex * 350` and `activeInstances * 150` are deleted. Main receives the same resolved active set through `slot.setPlaybackBudget` and idempotent `createSlot` or `destroySlot` calls. `isWcvEnabled` is read once by a page-level `SlotRuntimeProvider` and exposed as immutable runtime configuration, not queried per slot.

### Category catalogue

```ts
export interface CategoryCatalogueSnapshot {
  readonly categories: readonly UnifiedCategory[];
  readonly cursors: Readonly<Record<Platform, string | null | undefined>>;
}

export interface CategoryCatalogue {
  readonly categories: readonly UnifiedCategory[];
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  loadMore(): Promise<void>;
  refetch(): Promise<void>;
}

export function useCategoryCatalogue(): CategoryCatalogue;
export function hydrateCategoryCatalogue(
  client: QueryClient,
  snapshot: CategoryCatalogueSnapshot
): void;
```

There is one `CATEGORY_KEYS.catalogue()` query shape. It contains the persisted merged seed and per-provider cursor progress. `useCategoryCatalogue` merges a provider response once at the mutation boundary and publishes an immutable ordered category array. The Categories page reads only that key. Detail lookup may read the same canonical catalogue. The bootstrap hydrator writes the same key. The old `top` and per-provider `infinite` keys are migrated together, then deleted. `VirtualizedCategoryGrid` receives a `canLoadMoreWhenEmpty` signal and calls `onLoadMore` once when a local filter produces no rows but the catalogue still has a provider cursor. It does not claim an exhaustive no-match result while more pages exist.

This surface is intentionally small. Callers know a channel reference, a chat tab, a playback assignment, or a category catalogue. They do not coordinate sockets, cache keys, page cursors, player stagger delays, service lifetimes, or provider event filters. The registry and planner hide those policies. This is a deep interface with short caller paths.

## Module map

| Module | Owns |
| --- | --- |
| `features/discovery/data/queries/category-catalogue.ts` | Canonical catalogue state, cursor merge, persistence adapter, and route hook. |
| `features/discovery/data/queries/browse-snapshot-bootstrap.ts` | Calls `hydrateCategoryCatalogue`. It no longer selects a cache key itself. |
| `features/multistream/data/playback-plan.ts` | Pure plan and tests. No React, IPC, or player imports. |
| `features/multistream/data/playback-start-queue.ts` | One cold-start cadence and cancellation. |
| `features/multistream/components/multistream/virtualized-multistream-grid.tsx` | Visible-range reporting, DnD adapter, and memoized slot chrome. It owns no playback policy. |
| `features/playback/data/useStreamPlayback.ts` | Cache and one channel request. It accepts scheduling from the caller and removes instance-order staggering. |
| `features/playback/data/slot-runtime-context.tsx` | Reads WCV configuration once and performs idempotent main-process reconciliation. |
| `features/chat/data/chat-session-registry.ts` | Per-channel session records, lifecycle, service event routing, and unread state. |
| `features/chat/components/chat/chat-channel-pane.tsx` | One visible platform chat view. It dispatches to existing `TwitchChat` or `KickChat` view mode. |
| `features/chat/components/chat/twitch/TwitchChat.tsx` | Existing Twitch visual and interaction surface. Session ownership moves behind `mode`. |
| `features/chat/components/chat/kick/KickChat.tsx` | Existing Kick visual and interaction surface. Session ownership moves behind `mode`. |
| `store/chat-store.ts` | Existing per-channel message buckets. Its channel-key helper becomes the implementation of `makeChatChannelRef`. |

## Migration sequence

1. Add the pure playback plan and tests. Replace index-derived `playbackActive` with its output, while keeping the current nonvirtual grid.
2. Add the single playback-start queue. Delete both old stagger mechanisms and add page-level WCV configuration. Measure the six-slot cold start before and after.
3. Extract `ChatChannelSession` from one provider, starting with Twitch. Keep `TwitchChat mode="standalone"` on the existing path. Add `mode="view"` tests against the same message bucket and interaction tests for reply, moderation, and composer.
4. Extract Kick using the same registry contract. Verify one Pusher subscription per `chatroomId`, retained history, and no duplicate event writes.
5. Add `MultiStreamChatRail` and tab state. Reconcile all MultiView channels through the registry. Mount only the selected `ChatChannelPane`.
6. Introduce the canonical category catalogue. Bootstrap it from existing persisted `top` records for one release, then write only the new snapshot. Remove the old cache paths after migration telemetry shows no legacy reads.
7. Add the virtualized MultiView grid after planner correctness is stable. Keep its persistent ordered data in the store. Virtualization is presentation only and never truncates `orderedSlotIds`.

Each step has an independent rollback boundary. The old standalone chat and old Categories query stay available until their replacement passes route-level tests.

## Test and measurement seams

- `planPlayback` has table tests for focus, explicit activation, budget one, budget changes, reordering, and offscreen slots. Its assertion is `activeSlotIds.size <= maxActive`.
- `PlaybackStartQueue` uses a fake clock. Tests prove at most one cold start per interval, no second delay, and cancellation before fetch when a slot leaves the plan.
- A render-counter test changes mute, chat selection, and one stream volume. It asserts unaffected slot chrome and players do not rerender. A Playwright trace records scripting time and mounted player count while scrolling 100 saved slots.
- `ChatSessionRegistry` tests two same-slug channels across providers, two channels on one provider, removal during a pending join, duplicate reconciliation, and a tab switch. Service fakes assert one acquire and join per channel, one listener route, and no message written to another channel key.
- DOM tests assert one `ChatMessageList` or `Virtuoso` exists in the rail while every tab's unread count increments from incoming messages. Existing Twitch and Kick interaction suites run in `mode="view"` and `mode="standalone"`.
- `hydrateCategoryCatalogue` tests a cold renderer cache. It asserts persisted categories render before provider IPC resolves, then page-one deduplicates without changing order. Filter tests assert an empty local result calls `loadMore` once when cursors remain.
- Instrument `multiview.playback.active`, `multiview.playback.start_queue_wait_ms`, `multiview.slot_renders`, `multiview.chat.sessions`, `multiview.chat.visible_lists`, and `categories.persisted_first_paint_ms`. Keep signed URLs and message bodies out of measurements.

## Rationale

The shared chat services are already the transport boundary. A registry above them would be redundant. A registry beside their current visual consumers is necessary because the current components own both lifetime and display. Moving baseline per-channel work into one session record removes the cross-channel race without replacing provider transports. The existing per-channel `messagesByChannel` map is the correct storage model and remains the read boundary for the merged feed and channel tabs.

The playback plan is pure because decoder selection depends on three changing inputs that must agree. Storing an independently synchronized `isActive` flag in every slot would make focus, virtualization, and budget changes race. Deriving one plan prevents that state split. The start queue owns timing, so `useStreamPlayback` only fetches and caches one channel.

The category catalogue makes the persisted and route cache representations one domain object. The route is no longer responsible for translating a persistence key into two pagination keys.

The choices follow `principle-model-the-domain` for channel, playback, and catalogue data. `principle-separate-before-serializing-shared-state` changes session ownership from component instances to one record per channel. `principle-minimize-reader-load` keeps callers out of provider lifecycles and duplicate cache structures. `principle-make-operations-idempotent` shapes reconciliation and leases.

## Tradeoffs accepted

- We accept a controlled extraction from two large chat components in exchange for retaining their mature platform features and one provider transport.
- We accept a virtualized MultiView chrome grid in exchange for unbounded saved layouts with bounded DOM and player work.
- We accept one page-level start cadence in exchange for predictable cold playback. It may start the last budgeted stream later, but it no longer pays two unrelated delays.
- We accept fetching the first provider page after a persisted category paint in exchange for a current cursor and live reconciliation. Deduplication happens in the catalogue owner.
- We accept retaining chat session data for channels still in the MultiView layout in exchange for accurate unread badges and merged live chat. Message retention remains bounded by the existing per-channel limit.

## Alternatives considered

- Mount a hidden `ChatPanel` for every channel. It loses because it exposes the renderer to every `Virtuoso`, composer, and visual effect while hiding no lifecycle complexity.
- Keep only the active `ChatPanel` mounted. It loses because inactive channels leave the provider and cannot contribute to merged chat or unread tabs. Callers would need to invent a second message source later.
- Add a MultiView-specific chat socket manager. It loses because it duplicates the provider services' connection, reference-counting, reconnection, and channel join policies.
- Seed the existing provider infinite query keys directly from the merged category snapshot. It loses because the persisted winner and cross-platform fields cannot faithfully reconstruct provider pages or cursors. It leaks pagination representation into persistence.
- Keep both current playback staggers and tune their constants. It loses because two schedulers still control one resource and global hook order remains unrelated to the layout plan.

## Open questions and risks

- Does product want inactive MultiView chats to receive only messages, or all costly decorations such as predictions and channel emotes before their tab is opened?
- Should merged chat ordering use local receipt order or provider timestamps with a bounded reorder window? Receipt order is safer for live responsiveness. Timestamp ordering is more intuitive across providers but needs an explicit lateness policy.
- Which DnD behavior must remain available once the grid is virtualized? Cross-window drag needs a virtualizer-aware adapter before that migration step.
- How long should an inactive channel session survive after a stream is removed but a user still has its tab selected? The safe default is to release immediately and select the next tab.

## Next implementation step

Add and test `planPlayback` first, then replace grid index checks with the plan without changing transport or UI structure.
