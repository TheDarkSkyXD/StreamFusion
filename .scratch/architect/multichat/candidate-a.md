# Candidate A. Registry-owned chat sessions and coordinator-owned playback

## Problem

The Categories page, MultiView playback, and chat each have two competing ownership paths. Categories persists `CATEGORY_KEYS.top(...)` while the page reads `CATEGORY_KEYS.infinite(...)`, so a valid cold-start catalog cannot render the page. MultiView lets every slot stagger and probe capabilities independently, while the page, grid, and slots subscribe to the whole Zustand store. Chat already shares one transport per platform, but every mounted `KickChat` or `TwitchChat` attaches a full listener set and owns channel lifecycle. Hidden panels for tabs or merged chat would therefore multiply event transformation, emote state, polling, and virtualized lists. The design must keep unlimited category and stream membership while using explicit resource budgets for expensive playback, and it must preserve every existing `ChatPanel` feature.

## Usage (caller's view)

### Categories page

```tsx
function CategoriesPage() {
  const [query, setQuery] = useState("");
  const catalog = useCategoryCatalog({ query });

  return (
    <VirtualizedCategoryGrid
      categories={catalog.categories}
      isLoading={catalog.status === "loading"}
      isSearching={catalog.searchStatus === "searching"}
      hasNextPage={catalog.hasNextPage}
      onLoadMore={catalog.loadMore}
      emptyMessage={catalog.emptyMessage}
    />
  );
}
```

`useCategoryCatalog` publishes the persisted catalog immediately from the same infinite-query keys that the page consumes. A local filter never decides whether pagination may continue. When a query has no match in loaded pages, the hook keeps fetching both providers until matches appear or both provider cursors are exhausted. Search results grow while the exhaustive scan continues, so a partial catalog never reports a false empty state.

### MultiView playback

```tsx
function MultiStreamGrid() {
  const streamIds = useMultiStreamStore(selectStreamIds, shallow);
  const playback = useMultiViewPlayback({ streamIds });

  return streamIds.map((streamId) => (
    <StreamSlot
      key={streamId}
      streamId={streamId}
      admission={playback.admissionFor(streamId)}
    />
  ));
}
```

The layout may contain any number of streams. `PlaybackBudget` limits simultaneous decoder ownership, not layout membership. `useMultiViewPlayback` performs one capability probe and one ordered admission schedule. `StreamSlot` contains no stagger timer and does not call `slot.isWcvEnabled()`.

### Existing single-channel chat

```tsx
function ChatPanel(props: ChatPanelProps) {
  const endpoint = useResolvedChatEndpoint(props);
  const session = useChatSession(endpoint);

  return <ChatSurface session={session} showComposer={props.showComposer} />;
}
```

`ChatSurface` retains messages, room settings, restrictions, moderation actions, pins, polls, predictions, badges, cosmetics, emotes, and the composer. Mounting another surface for the same channel does not add transport listeners or repeat event normalization.

### MultiView chat rail

```tsx
function MultiChatRail() {
  const streams = useMultiStreamStore(selectChatStreams, shallow);
  const view = useMultiStreamStore(selectMultiChatView);
  const workspace = useMultiChatWorkspace(streams, view);

  return view.kind === "merged" ? (
    <MergedChatSurface
      messages={workspace.mergedMessages}
      sendTarget={workspace.sendTarget}
      targets={workspace.channels}
      onSelectSendTarget={workspace.selectSendTarget}
      onSend={workspace.send}
    />
  ) : (
    <TabbedChatSurface
      channels={workspace.channels}
      activeChannelKey={view.activeChannelKey}
      session={workspace.activeSession}
      onSelect={workspace.selectTab}
    />
  );
}
```

Tabs change presentation only. Inactive channels remain acquired, keep receiving messages, and retain their buckets. Merged mode renders one virtualized list and one composer with an explicit target. It never mounts hidden `ChatPanel` trees.

## Shape

### Core identities

```ts
declare const channelKeyBrand: unique symbol;
export type ChannelKey = string & { readonly [channelKeyBrand]: true };

export function parseChannelKey(platform: ChatPlatform, channel: string): ChannelKey;

export type ChatEndpoint =
  | {
      readonly key: ChannelKey;
      readonly platform: "twitch";
      readonly channel: string;
      readonly broadcasterId: string;
    }
  | {
      readonly key: ChannelKey;
      readonly platform: "kick";
      readonly channel: string;
      readonly broadcasterId: string;
      readonly chatroomId: number;
      readonly kickChannelId?: string;
    };

export type MultiChatView =
  | { readonly kind: "merged"; readonly sendTargetKey: ChannelKey }
  | { readonly kind: "tabs"; readonly activeChannelKey: ChannelKey };
```

`parseChannelKey` trims and lowercases channel names. Stream IDs and persisted stream membership use the same canonical identity. The platform-specific `ChatEndpoint` union makes the Kick subscription fields available only when required. External IPC and wire payloads are parsed before they enter these types, per `boundary-discipline`.

### Scoped chat events

```ts
export type ScopedChatEvent =
  | { readonly kind: "message"; readonly channelKey: ChannelKey; readonly message: ChatMessage }
  | { readonly kind: "userNotice"; readonly channelKey: ChannelKey; readonly notice: UserNotice }
  | { readonly kind: "clearChat"; readonly channelKey: ChannelKey; readonly clear: ClearChat }
  | { readonly kind: "messageDeleted"; readonly channelKey: ChannelKey; readonly deletion: MessageDeletion }
  | { readonly kind: "pinChanged"; readonly channelKey: ChannelKey; readonly pin: NormalizedPinnedMessage | null }
  | { readonly kind: "pollChanged"; readonly channelKey: ChannelKey; readonly poll: KickPoll | null }
  | { readonly kind: "predictionChanged"; readonly channelKey: ChannelKey; readonly prediction: UnifiedPrediction | null }
  | { readonly kind: "roomStateChanged"; readonly channelKey: ChannelKey; readonly patch: RoomStatePatchEvent }
  | { readonly kind: "sendRestrictionChanged"; readonly channelKey: ChannelKey; readonly restriction: ViewerChatSendRestrictionEvent }
  | { readonly kind: "moderatorStateChanged"; readonly channelKey: ChannelKey; readonly state: ModeratorStateEvent };
```

Every channel-local event carries `ChannelKey`. This fixes the current unscoped pin, poll, and clear contracts and prevents a Kick message from being written into another Kick panel's explicit bucket. Channel scope becomes a compile-time requirement, per `encode-lessons-in-structure`.

### Deep registry interface

```ts
export interface ChatSessionRegistry {
  acquire(endpoint: ChatEndpoint): ChatSessionLease;
  reconcileWorkspace(
    owner: ChatWorkspaceOwner,
    endpoints: readonly ChatEndpoint[]
  ): MultiChatWorkspaceLease;
}

export interface ChatSessionLease {
  readonly channelKey: ChannelKey;
  getSnapshot(): ChatSessionSnapshot;
  subscribe(listener: () => void): () => void;
  send(draft: ChatDraft): Promise<ChatSendResult>;
  release(): void;
}

export interface MultiChatWorkspaceLease {
  getSnapshot(): MultiChatWorkspaceSnapshot;
  subscribe(listener: () => void): () => void;
  send(target: ChannelKey, draft: ChatDraft): Promise<ChatSendResult>;
  reconcile(endpoints: readonly ChatEndpoint[]): void;
  release(): void;
}
```

The registry owns these private structures:

```ts
interface SessionRecord {
  endpoint: ChatEndpoint;
  leaseCount: number;
  snapshot: ChatSessionSnapshot;
  listeners: Set<() => void>;
  emoteLease: EmoteChannelLease;
}

interface WorkspaceRecord {
  channels: Set<ChannelKey>;
  mergedMessages: MergedMessageIndex;
  listeners: Set<() => void>;
}

interface PlatformRouter {
  readonly platform: ChatPlatform;
  reconcile(endpoints: ReadonlyMap<ChannelKey, ChatEndpoint>): Promise<void>;
  dispose(): Promise<void>;
}
```

There is exactly one `PlatformRouter` and one lazily loaded transport singleton for Twitch, plus one of each for Kick. A router installs one service listener set, normalizes each event once, updates the correct channel bucket, and updates each interested workspace's compact merged index. `acquire` and `reconcileWorkspace` are idempotent. Repeating either operation converges on the same channel membership and transport joins, per `make-operations-idempotent`.

The registry interface is deliberately small. It hides transport joining, listener ownership, history hydration, room settings, pins, polls, predictions, emote leases, badge refresh, cosmetics, send routing, teardown grace, and merged indexing. Callers know only endpoints, snapshots, sending, and lease release. This is a deep module rather than a pass-through layer, per `minimize-reader-load`.

### Per-channel emote ownership

```ts
export interface EmoteChannelLease {
  readonly channelKey: ChannelKey;
  getNameMap(): ReadonlyMap<string, Emote>;
  getSnapshot(): ChannelEmoteSnapshot;
  release(): void;
}

export interface EmoteRegistry {
  acquire(endpoint: ChatEndpoint): EmoteChannelLease;
}
```

Emotes are indexed by `ChannelKey`. The process-global `activeChannelId` leaves the model. A session owns one reference-counted emote lease, so switching tabs cannot change another channel's substitution map and one surface unmount cannot clear emotes still in use.

### Merged message index

```ts
interface MergedMessageRef {
  readonly key: `${ChannelKey}:${string}`;
  readonly channelKey: ChannelKey;
  readonly messageId: string;
  readonly timestamp: number;
}

interface MergedMessageIndex {
  append(channelKey: ChannelKey, message: ChatMessage): void;
  removeChannel(channelKey: ChannelKey): void;
  snapshot(): readonly MergedMessageRef[];
}
```

The router appends a compact reference after it writes the canonical per-channel bucket. The merged surface resolves references against those buckets. It does not `flatMap().sort()` every set of retained messages on each 16 ms batch. Keys include channel identity because message IDs are unique only within a channel. Each channel bucket and each workspace index has one writer. They merge only at the read boundary, per `separate-before-serializing-shared-state`.

No user-visible content cap is introduced. Categories and MultiView membership remain exhaustive. Existing user-configured chat retention still protects memory, while virtualization controls render cost. Removing a channel from a workspace removes its references without deleting history still leased elsewhere.

### Playback coordinator

```ts
export type PlaybackAdmission =
  | { readonly kind: "admitted"; readonly generation: number; readonly useWcv: boolean }
  | { readonly kind: "queued"; readonly position: number }
  | { readonly kind: "suspended"; readonly reason: "budget" | "offscreen" | "background-off" };

export interface MultiViewPlaybackInput {
  readonly streams: readonly MultiStreamConfig[];
  readonly focusedStreamId: string | null;
  readonly visibleStreamIds: ReadonlySet<string>;
  readonly budget: PlaybackBudget;
  readonly backgroundQuality: BackgroundQuality;
}

export interface MultiViewPlaybackCoordinator {
  reconcile(input: MultiViewPlaybackInput): void;
  admissionFor(streamId: string): PlaybackAdmission;
  subscribe(streamId: string, listener: () => void): () => void;
  dispose(): Promise<void>;
}
```

`PlaybackBudget` is a branded positive integer parsed from persisted preferences. The coordinator prioritizes the focused stream, then visible streams, then layout order. It admits decoder starts through one short queue, probes WCV support once, and publishes per-slot snapshots. The existing `useStreamPlayback` request cache remains, but its process-global instance stagger is removed after callers migrate. `StreamSlot` receives one narrow admission and subscribes only to its own config. Whole-store subscriptions disappear from the page, grid, and slot. This preserves unlimited layout membership while making resource ownership explicit, per `model-the-domain` and `experience-first`.

### Category catalog

```ts
export interface CategoryCatalogOptions {
  readonly query: string;
}

export interface CategoryCatalogResult {
  readonly categories: readonly UnifiedCategory[];
  readonly status: "loading" | "ready" | "error";
  readonly searchStatus: "idle" | "searching" | "complete";
  readonly hasNextPage: boolean;
  readonly emptyMessage: string;
  loadMore(): void;
  retry(): void;
}

export function useCategoryCatalog(options: CategoryCatalogOptions): CategoryCatalogResult;
```

The hook uses only `CATEGORY_KEYS.infinite(platform)` as the catalog source of truth. Persisted platform catalogs hydrate those exact keys as one stale page with `cursor: null`, so they render immediately and refetch in the background. `useTopCategories` becomes a selector over the same catalog instead of a second fetch lifecycle. Page merging and normalized-name indexing are memoized by page identity rather than repeated on unrelated renders.

The search loop belongs to the catalog module. It serially requests remaining cursors from both providers while a non-empty query is incomplete. The virtual grid receives `searching` even when the filtered result is empty, so its empty branch cannot terminate pagination. A full catalog is persisted only after both provider cursors complete.

## Module map

```text
apps/desktop/src/frontend/features/chat/domain/channel-key.ts
  Canonical ChannelKey parser and platform endpoint types.

apps/desktop/src/frontend/features/chat/domain/scoped-chat-event.ts
  Channel-scoped event union and pure event reducers.

apps/desktop/src/frontend/features/chat/data/chat-session-registry.ts
  Session records, workspace records, platform routers, leases, teardown grace.

apps/desktop/src/frontend/features/chat/data/use-chat-session.ts
  useSyncExternalStore adapter for one ChatSessionLease.

apps/desktop/src/frontend/features/chat/data/use-multi-chat-workspace.ts
  Stream-to-endpoint resolution and one workspace lease.

apps/desktop/src/frontend/features/chat/data/emote-registry.ts
  Per-channel reference-counted emote ownership.

apps/desktop/src/frontend/features/chat/components/chat/ChatSurface.tsx
  Shared single-channel presentation built from existing chat UI pieces.

apps/desktop/src/frontend/features/chat/components/chat/MergedChatSurface.tsx
  One virtualized source-tagged feed and explicit send target.

apps/desktop/src/frontend/features/multistream/components/multistream/multi-chat-rail.tsx
  Merged and tab presentation owned by the MultiView feature.

apps/desktop/src/frontend/features/multistream/data/multiview-playback-coordinator.ts
  One decoder admission schedule and one WCV capability probe.

apps/desktop/src/frontend/features/discovery/data/queries/useCategoryCatalog.ts
  Exact-key persisted hydration, cursor ownership, exhaustive search.
```

The chat feature owns connection and event knowledge. The MultiView feature owns which channels belong to its workspace and how they are presented. Playback stays in MultiView because admission policy depends on focus, visibility, order, and background quality. Category catalog work remains in discovery. No new IPC layer is added. The current live chat services already run in the renderer and moving them solely to match the `backend/services` directory name would add latency without improving ownership.

## Migration

1. Add `ChannelKey`, normalize channel names, and scope every chat event. Update pins, polls, clears, notices, messages, room state, and predictions before changing lifecycle. Add the missing Kick channel filter as part of this contract migration.
2. Replace `activeChannelId` with per-channel emote leases. Keep existing `KickChat` and `TwitchChat` rendering while they consume channel-scoped maps.
3. Introduce `ChatSessionRegistry` behind the existing `ChatPanel` props. Move service acquisition and listener registration from platform components into one router per platform. Verify all current single-channel features before deleting the old component-owned listeners.
4. Add `MultiViewPlaybackCoordinator`. Remove both slot-level staggering and the `useStreamPlayback` instance stagger only after all MultiView callers use coordinator admission. Hoist WCV probing out of slots and narrow Zustand selectors.
5. Migrate persisted category snapshots into exact infinite query keys. Convert `useTopCategories` to a selector over the unified catalog. Remove the duplicate progressive query path after all callers migrate.
6. Bump `MULTISTREAM_STORE_VERSION`. Normalize and deduplicate persisted stream IDs case-insensitively. Persist `MultiChatView`, then reconcile missing active or send targets to the first current channel during hydration.
7. Add `MultiChatRail`. Acquire all unique endpoints once, render one merged surface or one active tab surface, and keep presentation switches independent from leases.
8. Delete obsolete panel-owned connection effects, global emote selection, unscoped events, duplicate category keys, and stagger code in the same migration wave as their final caller.

Each stage is independently verifiable and keeps the previous UI operational until its replacement owns the full invariant.

## Test and measurement seams

- `ChatSessionRegistry` accepts fake platform adapters and a fake clock. Tests assert one transport connect, one listener set, one channel join, and one event transformation across repeated acquire and reconcile calls.
- A routing matrix sends same-slug Twitch and Kick messages plus two Kick channels through every `ScopedChatEvent` variant. Each event must change only its target snapshot and bucket.
- Emote tests acquire the same channel twice, release once, and prove the remaining lease still resolves that channel's 7TV, BTTV, FFZ, and native emotes.
- Workspace tests switch merged to tabs to merged without transport, join, listener, bucket, or history churn. Removed streams release exactly once.
- Merged-feed tests use identical message IDs in two channels and assert stable composite keys and chronological order.
- Category tests hydrate only persisted snapshots, render useful cards before IPC resolves, search for an item on a later cursor, and prove the UI stays in `searching` until provider exhaustion.
- Playback tests use a fake admission clock. They prove unlimited layout membership, at most `PlaybackBudget` admitted decoders, focus priority, one WCV probe, and no duplicate stagger delay.
- React render-count probes assert that muting one slot, receiving one channel message, or switching one tab does not rerender unrelated slots or chat buckets.
- The Electron performance harness records cold Categories first useful content, four-stream first frame times, tab-switch latency, merged-feed frame cost, transport/listener counts, renderer CPU, and heap growth over a 30-minute authenticated soak.

Targets for acceptance are a persisted Categories first useful render within one animation frame after route commit, no artificial per-slot delay beyond the single coordinator queue, tab switches below 100 ms, no duplicate event normalization, and stable heap after retained-message trimming.

## Rationale

The first-class registry is the base because the current transports already support many channels. The missing abstraction is not another transport. It is one owner for channel leases, event routing, and channel-scoped session state. Moving that ownership out of mounted panels lets single chat, tabs, and merged chat share the same work. The domain is represented by canonical keys, endpoint unions, scoped events, leases, and a presentation union, per `foundational-thinking` and `model-the-domain`.

The public surface stays small. Callers acquire one session or reconcile one workspace, subscribe to snapshots, send, and release. Transport details, platform event APIs, polling, emote ownership, and teardown policy remain private. Category and playback coordinators follow the same ownership rule without being forced behind the chat registry. This avoids a god object and keeps each module deep around one body of knowledge, per `laziness-protocol`.

## Synthesis decision

Candidate A proposes the registry-owned session shape as its base. It deliberately leaves synthesis open for the arena. A useful graft would need to preserve canonical channel scope, one router per platform, presentation-independent leases, one playback admission owner, and exact category cache keys. A candidate that mounts hidden panels, exposes transport methods to React, or stores a second mutable list of workspace channels should be rejected.

## Tradeoffs accepted

- We accept a substantial extraction from `KickChat` and `TwitchChat` in exchange for one event-processing path that can support all chat presentations.
- We accept compact merged-message references in addition to canonical channel buckets in exchange for avoiding a full multi-bucket sort on every chat batch.
- We accept a central playback admission actor in exchange for removing two independent stagger systems and per-slot capability probes.
- We accept exhaustive background pagination during an incomplete category search in exchange for never showing a false empty result or silently capping content.
- We accept a persisted store migration in exchange for canonical stream identity and duplicate-free session leasing.

## Alternatives considered

- Mount one hidden `ChatPanel` per tab and concatenate store buckets. This is implementation-simple but shallow. It exposes lifecycle coordination to the page and multiplies listeners, pollers, cosmetics clients, emote mutation, and virtualized trees.
- Keep component-owned sessions and add channel filters to every listener. This fixes correctness but not duplicate event work. Every new event requires every panel to remember the same routing rule, so information leakage remains.
- Move all chat transports into the Electron main process. This provides one transport owner but adds IPC serialization to every high-volume message and still needs renderer session ownership. Its interface is broader while hiding no additional product complexity.
- Use `flatMap().sort()` for merged messages. This avoids an index but makes every 16 ms bucket publication proportional to all retained messages across all channels.
- Remove `PlaybackBudget` to honor unlimited streams literally. This confuses content membership with decoder ownership and causes resource collapse. Unlimited membership plus explicit admission gives the user every stream without pretending hardware is unlimited.

## Open questions and risks

- Should merged mode expose moderation actions inline, or should an action first select the source channel tab so the target is unmistakable?
- Should pins, polls, and predictions appear only for the selected send target in merged mode, or in a source-tagged workspace event rail?
- What retention policy should a paused merged feed apply when many channels are active, given that existing retention is per channel?
- Can existing Kick and Twitch room-state behavior be moved behind one `ChatSessionSnapshot` without temporarily regressing platform-specific banners?
- Does the optional WCV path still earn its complexity after a measured coordinator-only player run, or should it be removed if it provides no reproducible gain?

## Next implementation step

Add canonical `ChannelKey` and fully channel-scoped chat event contracts with routing tests before changing any component or transport lifecycle.
