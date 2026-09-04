# Candidate B: App-shell raid coordinator

## Problem

StreamFusion needs to observe an outgoing raid from any stream it is currently playing, show a reversible default-join prompt, and move the correct player when the provider says the raid starts. Detection cannot depend on `ChatPanel`, because chat can be closed and multiview only mounts chat sessions selectively.

The provider signals are not equivalent. Twitch exposes undocumented web-client events with explicit update, cancel, and go phases. Kick exposes an undocumented Pusher move event and its first-party client derives an eight-second handoff locally. The design must preserve those differences without leaking raw provider payloads into the renderer.

## Usage

### App shell

The app owns one coordinator for every route and player arrangement. It is mounted inside `QueryProvider`, next to the router, so avatar hydration and route preloading remain available while the prompt survives stream page remounts.

```tsx
<QueryProvider>
  <LiveNotificationBridge />
  <RaidHandoffCoordinator />
  <RouterProvider router={router} />
</QueryProvider>
```

`RaidHandoffCoordinator` has no props. It observes the exported router and `useMultiStreamStore`, publishes the canonical set of active source channels to the main process, and renders the pending prompt stack.

### Main-process bootstrap

```ts
const raidHandoffService = createRaidHandoffService({
  sources: {
    twitch: createTwitchRaidSource(twitchSession),
    kick: createKickRaidSource(kickRealtimeClient),
  },
  clock,
});

registerRaidHandoffHandlers(ipcMain, raidHandoffService);
```

The service receives normalized lifecycle signals from private provider adapters. IPC consumers never see Twitch PubSub/PubSub-like topics, Kick Pusher event names, or provider payload shapes.

### Developer Console

```ts
await window.electronAPI.dev.raids.replay({
  fixture: "kick-outgoing-move",
  source: { platform: "kick", channelName: "source_channel" },
  overrides: { targetChannelName: "target_channel", delayMs: 8_000 },
});
```

The dev command enters the same service ingestion boundary as a real adapter. It does not insert renderer state directly. Existing chat simulation for an incoming raid notice remains separate.

## Shape

### Shared domain types

The source and target share one platform field. A cross-platform target is therefore unrepresentable in the public model.

```ts
type RaidPlatform = "twitch" | "kick";
type RaidSessionId = string;

interface RaidWatchSource {
  platform: RaidPlatform;
  channelName: string;
}

interface RaidChannelRef {
  channelId?: string;
  channelName: string;
  displayName: string;
  avatarUrl?: string;
}

type RaidAudienceMetric =
  | { kind: "raid-party"; count: number }
  | { kind: "target-viewers"; count: number }
  | { kind: "unknown" };

interface RaidCountdown {
  startedAtMs: number;
  endsAtMs: number;
  provenance:
    | "platform-payload"
    | "documented-platform-behavior"
    | "observed-first-party-client";
}

type RaidLaunchPolicy =
  | { kind: "provider-go"; countdown?: RaidCountdown }
  | { kind: "deadline"; countdown: RaidCountdown };

interface RaidOffer {
  id: RaidSessionId;
  platform: RaidPlatform;
  source: RaidChannelRef;
  target: RaidChannelRef;
  audience: RaidAudienceMetric;
  launch: RaidLaunchPolicy;
  observedAtMs: number;
}

interface RaidHandoffSnapshot {
  revision: number;
  offers: readonly RaidOffer[];
}
```

Provider diagnostics and wire versions stay in main-process logs. They do not become renderer state or UI copy.

### Main-process public boundary

```ts
interface RaidHandoffAPI {
  watch(sources: readonly RaidWatchSource[]): Promise<RaidHandoffSnapshot>;
  onChanged(listener: (snapshot: RaidHandoffSnapshot) => void): () => void;
}
```

`watch` atomically replaces the source lease for the calling `webContents` and returns the current snapshot. Returning the snapshot closes the subscribe-then-fetch race. Repeating the same source set is idempotent. `watch([])` releases all sources, and destroyed renderer owners are released automatically.

Main resolves canonical names into provider-specific IDs. In particular, the renderer does not choose between Kick channel IDs and broadcaster user IDs.

The service owns lifecycle state per provider and per source:

```ts
interface RaidHandoffService {
  watch(ownerId: number, sources: readonly RaidWatchSource[]): Promise<RaidHandoffSnapshot>;
  subscribe(ownerId: number, listener: (snapshot: RaidHandoffSnapshot) => void): () => void;
  release(ownerId: number): void;
}
```

Provider adapters have a smaller private contract:

```ts
type PublishRaidSignal = (signal: RaidLifecycleSignal) => void;

interface RaidSourceAdapter {
  reconcile(sources: readonly ResolvedRaidSource[]): Promise<void>;
  close(): Promise<void>;
}

type RaidLifecycleSignal =
  | { kind: "offer"; offer: RaidOffer }
  | { kind: "update"; id: RaidSessionId; patch: RaidOfferPatch; observedAtMs: number }
  | { kind: "cancel"; id: RaidSessionId; observedAtMs: number }
  | { kind: "go"; id: RaidSessionId; observedAtMs: number };
```

Adapters are constructed with `PublishRaidSignal`. They validate and normalize at the transport boundary. The service alone folds signals into snapshots, deduplicates replayed events, rejects stale updates, and makes cancel/go terminal.

### Renderer state and orchestration

Provider truth and local choice are intentionally separate.

```ts
type RaidParticipation = "joining" | "staying";

interface RaidHandoffUIState {
  offersById: Readonly<Record<RaidSessionId, RaidOffer>>;
  participationById: Readonly<Record<RaidSessionId, RaidParticipation>>;
  replaceSnapshot(snapshot: RaidHandoffSnapshot): void;
  setParticipation(id: RaidSessionId, choice: RaidParticipation): void;
  dismissLocal(id: RaidSessionId): void;
}
```

Every new offer defaults to `joining`. Selecting **Don't join** changes only StreamFusion behavior. It does not call Twitch's proprietary join/leave mutations and does not claim to change platform participation. The same control becomes **Join raid**, allowing the user to reverse the local choice until execution.

The prompt has no ambiguous close button. Cancel from the provider removes it. Leaving the source before execution dismisses that source's offer. Parser failure, transport disconnect, an unknown event version, or a stale source never navigates.

Navigation is selected by a pure policy:

```ts
type ActivePlaybackContext =
  | { kind: "single"; source: RaidWatchSource }
  | { kind: "multiview"; sources: readonly RaidWatchSource[] };

type RaidHandoffEffect =
  | { kind: "none" }
  | { kind: "navigate"; platform: RaidPlatform; channelName: string }
  | {
      kind: "replace-multiview-source";
      source: RaidWatchSource;
      targetChannelName: string;
    };

function decideRaidHandoffEffect(
  offer: RaidOffer,
  participation: RaidParticipation,
  context: ActivePlaybackContext,
  trigger: "provider-go" | "deadline",
): RaidHandoffEffect;
```

For a single stream, the coordinator executes:

```ts
router.navigate({
  to: "/stream/$platform/$channel",
  params: { platform, channel: targetChannelName },
  search: { tab: "home" },
  replace: true,
});
```

It warms `channelByUsernameQueryOptions`, `getStreamByChannelQueryOptions`, and `preloadStreamExperience` when an offer arrives. `PlatformAvatar` renders the payload avatar immediately and naturally updates when the channel query supplies a better image.

Multiview uses one atomic store operation:

```ts
type ReplaceRaidSourceResult =
  | { kind: "replaced"; targetStreamId: string; wasFocused: boolean }
  | {
      kind: "merged-existing";
      targetStreamId: string;
      removedSourceId: string;
      wasFocused: boolean;
    }
  | { kind: "source-not-found" };

interface MultiStreamRaidActions {
  replaceRaidSource(input: {
    source: RaidWatchSource;
    targetChannelName: string;
  }): ReplaceRaidSourceResult;
}
```

Replacement preserves slot index, mute, volume, playback-budget position, focus, and active-chat selection. If the target is already open, it removes the source and focuses the existing target instead of creating a duplicate. Multiple source channels may raid concurrently, so the UI state is keyed by raid ID rather than represented as one global `activeRaid`.

### Provider behavior

#### Twitch

`TwitchRaidSource` subscribes only to validated `raid.<sourceChannelId>` topics. Its private decoder recognizes the captured proprietary message families `raid_update_v2`, `raid_cancel_v2`, and `raid_go_v2`.

- `raid_update_v2` creates or updates an offer only after the source topic, source identity, target identity, and required field types agree.
- `raid_cancel_v2` terminates the matching offer.
- `raid_go_v2` is the authoritative execution signal.
- A determinate countdown is shown only when a captured payload provides a validated deadline or duration. Otherwise the prompt says the raid is starting soon and uses no fake progress percentage.
- The documented 30-second Twitch viewer experience is context, not sufficient evidence to invent a local deadline for an undecoded payload.

IRC raid notices and public EventSub `channel.raid` are not input to this feature. They describe an incoming or already-landed raid and are too late for this handoff.

#### Kick

`KickRaidSource` listens on the validated source channel `channel.<sourceChannelId>` for `App\\Events\\ChatMoveToSupportedChannelEvent`.

- It accepts `hosted.slug` as the canonical target name after shape and platform validation.
- It may use `hosted.username` and `hosted.profile_pic` for initial display.
- It creates `endsAtMs = receivedAtMs + 8_000` with provenance `observed-first-party-client`, matching the researched first-party web behavior.
- The deadline is the execution trigger because this event family has no separate go event.
- A provider cancel, if a validated contract is later captured, terminates the offer. Until then, local stay/join remains the reversible control.

`hosted.viewers_count` is represented as `{ kind: "target-viewers" }`. The prompt may say “1,234 watching now.” It must not say “1,234 raiders” or “1,234 joined.” If no true participant metric exists, the raid-party count is omitted.

### Deadline and progress behavior

The coordinator derives remaining time from `endsAtMs - Date.now()`. It never decrements a counter as the source of truth, so background throttling and renderer pauses do not extend the deadline. A small interval only refreshes presentation.

With reduced motion enabled, the progress bar jumps to the current semantic value without interpolation. Time still advances and execution still occurs. For Twitch offers without a validated countdown, the UI shows an indeterminate or static status and waits for `raid_go_v2`.

### Source validation

Three checks protect navigation:

1. The main process subscribes only to the renderer's current canonical source lease.
2. Each adapter validates that the transport topic and decoded source identity match the resolved watched source.
3. Immediately before execution, the renderer rechecks that the source still exists in the current single-stream route or multiview store.

Failure at any level produces `none`. The currently playing stream stays open.

### Module map

```text
apps/desktop/src/shared/
  raid-handoff-types.ts                    Stable normalized IPC domain
  electron-api-types.ts                    RaidHandoffAPI and dev-only replay surface
  ipc-channels.ts                          Watch and snapshot channel constants

apps/desktop/src/backend/services/raids/
  raid-handoff-service.ts                  Per-owner leases and lifecycle reducer
  raid-source-adapter.ts                   Private adapter contract
  twitch/twitch-raid-source.ts             Subscription ownership and reconnect
  twitch/twitch-raid-wire.ts               Runtime validation of proprietary payloads
  kick/kick-raid-source.ts                 Pusher subscription and eight-second policy
  kick/kick-raid-wire.ts                   Runtime validation of proprietary payloads
  dev/dev-raid-source.ts                   Fixture replay into the same reducer

apps/desktop/src/backend/ipc/handlers/
  raid-handlers.ts                         Owner-scoped watch and snapshot bridge

apps/desktop/src/backend/preload/
  index.ts                                 Narrow raids API exposure

apps/desktop/src/frontend/features/shell/data/
  raid-handoff-store.ts                    Snapshot plus local participation state
  raid-handoff-policy.ts                   Pure navigation decision

apps/desktop/src/frontend/features/shell/components/
  RaidHandoffCoordinator.tsx               Watch-set, timer, hydration, and effects
  RaidHandoffPrompt.tsx                    Accessible presentational prompt
  RaidHandoffPrompt.stories.tsx            Visual states and reduced-motion state

apps/desktop/src/frontend/features/multistream/data/
  multistream-store.ts                     Atomic replaceRaidSource action

apps/desktop/src/frontend/components/dev/
  ChatSimTool.tsx                          Separate outgoing raid simulation controls

apps/desktop/tests/
  backend/raids/raid-handoff-service.test.ts
  backend/raids/twitch-raid-wire.test.ts
  backend/raids/kick-raid-wire.test.ts
  fixtures/raids/*.json                    Redacted captured boundary payloads
  RaidHandoffCoordinator.integration.test.tsx
  MultiStream.raid-handoff.integration.test.tsx
  components/dev/ChatSimTool.raid-handoff.test.tsx
```

### Verification shape

- Wire tests replay redacted captured payloads and reject wrong topics, source mismatches, missing fields, unknown versions, and malformed counts.
- Service tests cover duplicate update, update after cancel, go after cancel, duplicate go, reconnect replay, owner release, and independent simultaneous source raids.
- Coordinator tests use a fake clock for deadline execution, participation toggling, source departure, provider cancel, provider go, and reduced-motion rendering.
- Router integration verifies a same-platform target and `{ tab: "home" }` with replacement history.
- Multiview integration verifies position and media settings, existing-target merge, focus, active chat, and playback-budget preservation.
- Developer Console tests prove fixture replay takes the real service path. The existing incoming `UserNotice.type = "raid"` simulation stays unchanged.
- Storybook covers Twitch with countdown, Twitch without a known deadline, Kick target-viewer wording, unknown count, joining, staying, cancel disappearance, long names, and missing avatar.
- A real end-to-end proof still requires controlled Twitch and Kick source channels because both outgoing signals are proprietary.

## Synthesis decision

Candidate B deliberately centralizes ownership in an app-shell coordinator and main-process source service. It does not attach detection to a visible chat component or player instance. Arena synthesis is pending, so no graft decisions are claimed here.

## Tradeoffs accepted

- The coordinator observes both router and multiview state. This is broader than a page-local hook, but it is the only lifecycle that covers closed chat, route transitions, persistent playback, and multiple players.
- Provider adapters rely on proprietary contracts. Isolation, runtime validation, redacted fixtures, diagnostic logging, and fail-closed behavior contain that risk but cannot make those contracts stable.
- Kick's eight-second deadline reflects observed first-party behavior, not a documented platform guarantee. Its provenance remains explicit in the domain.
- Twitch can have a useful prompt without a visual countdown until its update payload timing is captured. Accuracy is preferred over a fabricated timer.
- Local participation does not attempt proprietary platform join/leave mutations. “Don't join” guarantees only that StreamFusion will not navigate.

## Alternatives considered

### Detect raids in `ChatPanel`

Rejected. Chat can be hidden, single-stream chat can remount, and multiview activates chat sessions selectively. A raid listener there would miss valid source events.

### Treat an incoming `UserNotice.type = "raid"` as the trigger

Rejected. It represents the target channel receiving an already-landed raid. It cannot provide the source viewer's countdown or cancellation window.

### Put provider wire events directly in Zustand

Rejected. It leaks unstable payloads into UI code, duplicates lifecycle reduction, and makes malformed messages capable of influencing navigation.

### Keep one global active raid

Rejected. Multiple multiview sources can raid at nearly the same time. Keyed offers preserve independent choices and deadlines.

### Always use a 30-second Twitch timer

Rejected. Twitch documents the viewer experience but the local proprietary signal timing is not yet validated. Execution remains tied to `raid_go_v2`.

### Show Kick's `hosted.viewers_count` as raiders

Rejected. The field is the target channel's current audience. Relabeling it would misrepresent the data.

## Open questions and risks

- Capture and redact current Twitch `raid_update_v2`, `raid_cancel_v2`, and `raid_go_v2` payloads to determine whether a trustworthy countdown field exists.
- Confirm the auth and reconnect requirements for Twitch's proprietary `raid.<channelId>` topic in the Electron main process.
- Capture Kick cancel or replacement behavior, if any, during the eight-second window.
- Decide the prompt stacking limit when several multiview sources raid concurrently. The state must preserve all offers even if the UI serializes them.
- Confirm how an embedded web-content-view slot reports focus so the atomic multiview replacement can preserve it.
- Product copy must make the local scope of “Don't join” clear without exposing implementation detail.

## Next implementation step

Build the shared normalized types, private runtime decoders, and fixture-based lifecycle reducer first. Prove fail-closed parsing and idempotent transitions before wiring IPC, renderer prompts, or navigation.

## Design red-flag screen

- The public renderer boundary has two operations. Provider transports stay private.
- State is split per provider and per raid session, then merged by one service.
- The coordinator consumes snapshots and produces navigation effects. It does not proxy raw events.
- Each layer changes abstraction from wire payload, to lifecycle signal, to offer snapshot, to UI choice, to playback effect.
- Parsing, reconciliation, presentation, and navigation are grouped by owned state rather than by chronological implementation phase.
- The atomic multiview operation hides slot bookkeeping from the raid coordinator.
- No general event bus, provider-shaped global store, or pass-through wrapper is introduced.
