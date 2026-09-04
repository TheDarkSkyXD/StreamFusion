# Candidate A: transport-owned signals, slot-owned decisions

## Problem

StreamFusion already turns raids arriving at the watched channel into `UserNotice` chat rows. The requested feature is the opposite direction. It must detect that the watched channel is sending viewers to a same-platform target, show a reversible local join choice, and move only when the provider says the raid launched. Twitch exposes undocumented Hermes update, cancel, and go messages. Kick exposes an undocumented Pusher move event and its web client derives an eight-second deadline locally. These transports can change without notice, so malformed or unfamiliar input must leave the source stream untouched.

## Usage, caller's view

The stream page owns whole-page navigation. It does not know Hermes, Pusher, timers, or event names.

```tsx
const handoff = useRaidHandoff({
  source: {
    platform: routePlatform,
    channelId: channelData?.id,
    channelSlug: channelName,
  },
  onJoin: (target) =>
    navigate({
      to: "/stream/$platform/$username",
      params: { platform: target.platform, username: target.channelSlug },
      replace: true,
    }),
});

return (
  <>
    <Player />
    <RaidHandoffPopup {...handoff.popup} />
  </>
);
```

Each multiview slot owns an independent decision. A raid in slot A never replaces slot B or changes the selected chat tab.

```tsx
const handoff = useRaidHandoff({
  source: { platform, channelId, channelSlug: channelName },
  onJoin: (target) => replaceStream(streamId, target),
});

return <StreamSlotFrame overlay={<RaidHandoffPopup {...handoff.popup} />} />;
```

The popup has two reversible actions while the offer is pending.

```tsx
<button onClick={popup.stay}>Stay here</button>
<button onClick={popup.join}>Join raid</button>
```

Provider services keep their existing event-emitter contract. Consumers never see wire payloads.

```ts
const stop = await watchRaidHandoffs(source, (event) => controller.accept(event));
// stop() releases the provider subscription and the event listener.
```

## Shape

### Domain types

```ts
export interface RaidSource {
  platform: ChatPlatform;
  channelId?: string;
  channelSlug: string;
}

export interface RaidTarget {
  platform: ChatPlatform;
  channelId?: string;
  channelSlug: string;
  displayName: string;
  avatarUrl?: string;
}

export type RaidAudience =
  | { kind: "raid-party"; count: number }
  | { kind: "target-viewers"; count: number }
  | { kind: "unknown" };

export type RaidAdvance =
  | {
      kind: "provider-go";
      visualDeadlineAt?: number;
    }
  | {
      kind: "local-deadline";
      deadlineAt: number;
      basis: "kick-web-eight-second-window";
    };

export interface RaidOffer {
  raidId: string;
  source: RaidSource;
  target: RaidTarget;
  audience: RaidAudience;
  advance: RaidAdvance;
  receivedAt: number;
}

export type RaidHandoffEvent =
  | { phase: "pending"; offer: RaidOffer }
  | { phase: "cancelled"; source: RaidSource; raidId?: string; occurredAt: number }
  | { phase: "go"; source: RaidSource; raidId?: string; occurredAt: number };

export type RaidParticipation = "joining" | "staying";

export type RaidHandoffState =
  | { status: "idle" }
  | { status: "pending"; offer: RaidOffer; participation: RaidParticipation }
  | {
      status: "settled";
      raidId: string;
      outcome: "cancelled" | "joined" | "stayed";
      target?: RaidTarget;
    };
```

`RaidAudience` prevents Kick's `hosted.viewers_count` from being labelled as people joining the raid. Kick renders it as "N watching target". Twitch renders "N joining the raid" only when a captured fixture proves the proprietary field is a raid-party count. Otherwise the count is hidden.

`RaidAdvance` records the important provider difference. Twitch navigation waits for `raid_go_v2`; an optional 30-second visual window may fill the bar but cannot trigger navigation. Kick has no go event in the captured web flow, so the adapter derives `deadlineAt = receivedAt + 8_000` and the controller treats that deadline as go. The UI describes Kick's number as a countdown in StreamFusion, not as a deadline supplied in the Pusher payload.

The state union makes contradictory combinations impossible. There is no cancelled offer that can still be joining. Repeated pending updates for the same raid replace provider data while preserving the viewer's participation. This follows `principle-model-the-domain` and `principle-type-system-discipline`.

### Provider boundary signatures

```ts
// twitch-raid-event.ts
export function parseTwitchRaidNotification(
  raw: unknown,
  context: RaidSource,
  receivedAt: number
): RaidHandoffEvent | null;

// kick-parser.ts
export function parseKickChatMove(
  raw: unknown,
  context: RaidSource,
  receivedAt: number
): RaidHandoffEvent | null;
```

The Twitch parser accepts only `raid_update_v2`, `raid_cancel_v2`, and `raid_go_v2` from `raid.<channelId>`. Update builds the offer. Cancel and go identify the active source raid. Unknown versions, cross-platform targets, empty slugs, negative counts, and malformed images return `null`.

The Kick parser accepts only `App\\Events\\ChatMoveToSupportedChannelEvent` from `channel.<sourceChannelId>`. It reads `hosted.slug`, `hosted.username`, `hosted.profile_pic`, and `hosted.viewers_count`. The count becomes `target-viewers`, never `raid-party`. Validation stays at the network boundary per `principle-boundary-discipline`.

### Existing transport extensions

```ts
export interface ChatServiceEvents {
  // Existing events remain unchanged.
  raidHandoff: (event: RaidHandoffEvent) => void;
}

export interface RaidHandoffEventSource {
  watchRaidHandoffs(source: RaidSource): Promise<() => void>;
  on(event: "raidHandoff", listener: (event: RaidHandoffEvent) => void): void;
  off(event: "raidHandoff", listener: (event: RaidHandoffEvent) => void): void;
}

export function watchRaidHandoffs(
  source: RaidSource,
  listener: (event: RaidHandoffEvent) => void
): Promise<() => void>;
```

`TwitchChatService` owns a ref-counted Hermes entry per channel ID. `TwitchHermesClient` changes from one `subscriptionId` to `Map<subscriptionId, "prediction" | "raid">`, so predictions and `raid.<channelId>` share one socket. Chat mounts acquire prediction capability. Stream and slot mounts acquire raid capability. The final capability release stops the socket. The service forwards parsed raid events through `ChatServiceEvents.raidHandoff`. The existing tmi.js `notice` path also maps `msg-id=unraid` to cancellation as a compatibility fallback.

`KickChatService` keeps a separate ref count for source-channel raid watches. Its shared Pusher client subscribes to `channel.<broadcasterUserId>` once, binds `ChatMoveToSupportedChannelEvent`, and releases that channel after the last watcher. Chat users and raid watchers own separate leases. `maybeShutdown()` closes Pusher only when both counts reach zero. This lets raids work when chat is hidden without keeping every chatroom message subscription alive. It follows `principle-separate-before-serializing-shared-state`.

`watchRaidHandoffs` selects and lazily loads the existing provider service, installs the listener before acquiring the transport, and returns one idempotent cleanup function. That is the entire transport interface presented to React. It hides socket sharing, reconnects, Pusher channel names, and Hermes topic routing.

### Controller signatures

```ts
export interface UseRaidHandoffOptions {
  source: RaidSource;
  onJoin(target: RaidTarget): void | Promise<void>;
  now?: () => number;
}

export interface RaidHandoffPopupModel {
  visible: boolean;
  target?: RaidTarget;
  audienceText?: string;
  participation: RaidParticipation;
  progress: { kind: "timed"; startedAt: number; endsAt: number } | { kind: "waiting" };
  stay(): void;
  join(): void;
}

export function useRaidHandoff(options: UseRaidHandoffOptions): {
  popup: RaidHandoffPopupModel;
};

export function reduceRaidHandoff(
  state: RaidHandoffState,
  action:
    | { type: "provider"; event: RaidHandoffEvent }
    | { type: "participation"; value: RaidParticipation }
    | { type: "deadline"; raidId: string }
): RaidHandoffState;
```

The hook owns one controller instance per rendered stream. It filters global bus events by normalized platform and source slug, defaults a new offer to `joining`, and keeps `stay` and `join` reversible until settlement. It schedules only Kick's local deadline. Twitch remains pending until go or cancel.

The controller marks a raid settled before invoking `onJoin`. A handled-raid ID set scoped to the controller makes duplicate go frames, reconnect replay, React Strict Mode, and repeated deadline callbacks idempotent per `principle-make-operations-idempotent`. Provider errors and disconnects never call `onJoin`.

### Single-stream and multiview behavior

Single-stream mounts `useRaidHandoff` in `StreamPage`, outside the conditional chat rail. The feature therefore works when chat is hidden. A joined raid replaces the current same-platform route.

Each `StreamSlot` mounts its own hook. Only the slot whose normalized source matches the event shows a popup. Joining replaces that slot while preserving mute and volume. If the target already occupies another slot, `replaceStream` removes the raiding source and focuses the existing target rather than creating a duplicate.

```ts
replaceStream(streamId: string, target: RaidTarget): void;
```

`replaceStream` updates `focusedStreamId` and `chatStreamId` when IDs change. The caller does not coordinate those invariants. This gives the store one deep operation rather than three pass-through mutations, per `principle-minimize-reader-load`.

### Module map

| File | Ownership |
| --- | --- |
| `apps/desktop/src/shared/chat-types.ts` | Normalized handoff, audience, target, and event types. Adds `raidHandoff` to `ChatServiceEvents`. |
| `apps/desktop/src/backend/services/chat/twitch-raid-event.ts` | Pure validation and normalization of Twitch proprietary raid frames. |
| `apps/desktop/src/backend/services/chat/twitch-hermes-client.ts` | One Hermes socket with subscription-ID topic routing. |
| `apps/desktop/src/backend/services/chat/twitch-chat.ts` | Per-channel Hermes leases and IRC `unraid` fallback. |
| `apps/desktop/src/backend/services/chat/kick-parser.ts` | Pure Kick `ChatMoveToSupportedChannelEvent` parser. |
| `apps/desktop/src/backend/services/chat/kick-chat.ts` | Ref-counted `channel.<id>` Pusher watches sharing the existing client. |
| `apps/desktop/src/backend/services/chat/chat-service-loader.ts` | Lazy `watchRaidHandoffs` provider selection. |
| `apps/desktop/src/frontend/features/raid-handoff/raid-handoff-state.ts` | Pure state reducer, matching, progress, and honest audience copy. |
| `apps/desktop/src/frontend/features/raid-handoff/use-raid-handoff.ts` | Subscription lifecycle, clock, and one-shot navigation effect. |
| `apps/desktop/src/frontend/features/raid-handoff/RaidHandoffPopup.tsx` | Avatar, target name, count copy, progress, stay, and join controls. |
| `apps/desktop/src/frontend/pages/Stream/index.tsx` | Whole-route join action. |
| `apps/desktop/src/frontend/features/multistream/components/multistream/stream-slot.tsx` | Per-slot controller and popup. |
| `apps/desktop/src/frontend/features/multistream/data/multistream-store.ts` | Atomic `replaceStream`. |
| `apps/desktop/src/frontend/components/dev/ChatSimTool.tsx` | Emits normalized pending, update, cancel, and go fixtures. |

## Synthesis decision

Arena synthesis has not run. Candidate A chooses existing transport services plus local per-stream controllers. It rejects a global handoff store because single-stream and multiview decisions do not need shared mutable state. The shared fact is the normalized event bus. Each stream derives its own decision from events matching its source.

## Tradeoffs accepted

- We accept provider-specific lease bookkeeping inside the chat services in exchange for one Pusher client, one Hermes socket per Twitch channel, and raid detection when chat is hidden.
- We accept an undocumented Twitch topic behind a fail-closed parser in exchange for the only known pre-raid update, cancel, and go signals.
- We accept Kick's locally derived eight-second deadline in exchange for matching the first-party web behavior. The UI and tests record that provenance.
- We accept an indeterminate Twitch bar when no trustworthy timing field exists in exchange for never presenting an invented platform deadline.
- We accept no platform join or leave mutation in exchange for a reversible, reliable local navigation choice.

## Alternatives considered

- A global Zustand handoff store lost because it makes unrelated stream slots write one mutable object and requires cleanup rules for routes, slots, Home chat, and stale offers. Per-stream controllers expose less state and make multiview isolation structural.
- A new standalone raid WebSocket layer lost because it duplicates Pusher and Hermes lifecycle code that the chat transports already own.
- Reusing `UserNotice` lost because callers would need to infer direction and lifecycle from optional fields. It exposes provider ambiguity instead of hiding it.
- Stream-offline detection plus target lookup lost because an offline event is not proof of a raid and can move users incorrectly.

## Open questions and risks

- Does a current Twitch capture expose a trustworthy timestamp for `raid_update_v2`, or must the shipped Twitch progress remain indeterminate until `raid_go_v2`?
- Does Kick still deliver `ChatMoveToSupportedChannelEvent` without authentication on `channel.<id>` at release time?
- Should a viewer who chooses stay remain able to click a manual target link after the Kick eight-second deadline, or should the popup dismiss immediately?
- Which existing target-avatar lookup should fill a missing provider avatar without delaying the popup?
- Should Home's featured player intentionally ignore handoffs, as this candidate assumes?

## Tests and simulator

- Parser fixture tests replay redacted Twitch update, cancel, and go frames plus Kick move frames. Malformed, cross-platform, unknown-version, invalid-slug, and negative-count fixtures return `null`.
- Hermes tests assert both topic subscribe frames, subscription-ID routing, reconnect resubscription, and single-socket teardown.
- Kick service tests capture the `channel.<id>` binding, duplicate leases, reconnect rebinding, and final release without disturbing active chatroom subscriptions.
- Reducer tests use fake time for default joining, stay, rejoin, count update without decision reset, cancel, duplicate go, Kick deadline, and stale source mismatch.
- Single-stream tests assert only go plus joining navigates. Multiview tests assert only the matching slot changes and an existing target slot is focused instead of duplicated.
- `ChatSimTool` gains provider, phase, count-kind, and duration controls. Its default Twitch script sends update, count update, cancel or go. Its default Kick script sends one move event with an eight-second local deadline. Both use `ChatServiceEvents.raidHandoff`, not direct store insertion.

## Next implementation step

Add the shared discriminated types and pure reducer first, then lock their semantics with parser and fake-clock tests before touching sockets or UI.
