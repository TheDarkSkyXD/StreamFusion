# Candidate C: capability-driven raid handoff boundary

## Problem

StreamFusion needs a source-channel raid popup that defaults to joining, lets the viewer stay or rejoin, and moves only the affected viewing surface. The platform contracts do not line up. Twitch documents the viewer experience but not the pre-raid transport. Kick exposes a usable Pusher event only through its current web client. Incoming raid notices are separate events and must remain chat messages. The design must make unsupported data impossible to mislabel, keep undocumented wire shapes out of React, and fail by leaving playback unchanged.

## Usage (caller's view)

The page caller wraps a live viewing surface. It does not subscribe to Twitch PubSub, Kick Pusher, run a timer, or interpret counts.

```tsx
<RaidHandoffBoundary
  surface={{
    kind: "single",
    id: "stream-page",
    source: {
      platform: routePlatform,
      channelId,
      slug: channelName,
    },
  }}
  move={(target) =>
    router.navigate({
      to: "/stream/$platform/$channel",
      params: { platform: target.platform, channel: target.slug },
      replace: true,
    })
  }
>
  {livePlayer}
</RaidHandoffBoundary>
```

Each multiview slot gets an independent boundary. A raid replaces only that slot. The other players, chat selection, audio state, and layout stay intact.

```tsx
<RaidHandoffBoundary
  surface={{
    kind: "multiview",
    id: streamId,
    source: { platform, channelId, slug: channelName },
  }}
  move={(target) =>
    replaceStreamSource(streamId, {
      platform: target.platform,
      channelName: target.slug,
    })
  }
>
  <StreamSlotPlayer {...playerProps} />
</RaidHandoffBoundary>
```

The boundary portals its popup into the app overlay layer. The popup remains visible above both renderer players and WebContentsView-backed multiview slots. A viewer who clicks **Stay here** gets a compact banner with **Join raid** until the launch closes. Closing the expanded popup has the same local meaning as **Stay here** and keeps the compact rejoin control.

The developer simulator injects domain signals, not copied wire JSON. Raw fixture replay belongs to adapter tests.

```tsx
<RaidHandoffSimTool
  emit={(surfaceId, signal) => raidHandoffDebugPort.emit(surfaceId, signal)}
  scenarios={[
    "kick-offer-deadline",
    "twitch-offer-go",
    "platform-cancel",
    "transport-lost",
    "missing-avatar-and-count",
  ]}
/>
```

## Shape

### Domain types

```ts
type RaidPlatform = "twitch" | "kick";
type RaidOfferId = string & { readonly __raidOfferId: unique symbol };
type RaidSurfaceId = string & { readonly __raidSurfaceId: unique symbol };

interface RaidChannelRef<P extends RaidPlatform> {
  platform: P;
  channelId: string;
  slug: string;
  displayName?: string;
  avatarUrl?: string;
}

type RaidAudienceFact =
  | { kind: "raid-party"; viewers: number; final: boolean }
  | { kind: "source-audience"; viewers: number }
  | { kind: "target-audience"; viewers: number };

type RaidProgress =
  | {
      kind: "deadline";
      startedAtMs: number;
      deadlineAtMs: number;
      provenance: "platform-payload" | "observed-client-profile";
    }
  | { kind: "indeterminate" };

type RaidLaunchAuthority =
  | { kind: "platform-go" }
  | {
      kind: "deadline";
      deadlineAtMs: number;
      provenance: "platform-payload" | "observed-client-profile";
    };

interface RaidOfferFor<P extends RaidPlatform> {
  id: RaidOfferId;
  source: RaidChannelRef<P>;
  target: RaidChannelRef<P>;
  audience?: RaidAudienceFact;
  progress: RaidProgress;
  launch: RaidLaunchAuthority;
  observedAtMs: number;
  contractProfile: RaidContractProfileId;
}

type RaidOffer = RaidOfferFor<"twitch"> | RaidOfferFor<"kick">;

type RaidHandoffSignal =
  | { kind: "offer"; offer: RaidOffer }
  | {
      kind: "update";
      offerId: RaidOfferId;
      audience?: RaidAudienceFact;
      progress?: RaidProgress;
    }
  | {
      kind: "go";
      offerId: RaidOfferId;
      authority: "documented-eventsub" | "observed-platform-event";
      occurredAtMs: number;
    }
  | { kind: "cancel"; offerId: RaidOfferId; reason: "platform" | "source-ended" }
  | { kind: "signal-lost"; source: RaidChannelRef<RaidPlatform> };

type RaidParticipation = "joining" | "staying";

type RaidHandoffState =
  | { phase: "idle" }
  | {
      phase: "active";
      offer: RaidOffer;
      participation: RaidParticipation;
      presentation: "expanded" | "compact";
    }
  | {
      phase: "waiting-for-go";
      offer: RaidOffer;
      participation: RaidParticipation;
      presentation: "expanded" | "compact";
    }
  | { phase: "staying"; reason: "cancelled" | "signal-lost" | "invalid-target" };

type RaidHandoffCommand =
  | { kind: "receive"; signal: RaidHandoffSignal }
  | { kind: "choose"; participation: RaidParticipation }
  | { kind: "collapse" }
  | { kind: "clock"; nowMs: number }
  | { kind: "source-changed"; source: RaidChannelRef<RaidPlatform> };

type RaidHandoffEffect =
  | { kind: "move"; target: RaidChannelRef<RaidPlatform>; offerId: RaidOfferId }
  | { kind: "record"; event: RaidHandoffTelemetry };

interface RaidReduction {
  state: RaidHandoffState;
  effects: readonly RaidHandoffEffect[];
}
```

`RaidOfferFor<P>` makes cross-platform raids unrepresentable after parsing. `RaidAudienceFact` makes the label semantic part of the data. The presenter can say "218 viewers are joining" only for `raid-party`, "1.4K watching the target" only for `target-audience`, and nothing when the count is absent. It never uses the word "chatters" because neither platform reports chat membership.

Progress and launch authority are separate. A Twitch update can drive a determinate bar without authorizing navigation. When its visual countdown reaches zero, the state becomes `waiting-for-go`. Only `go` moves the surface. Kick's dated contract profile can use an observed-client deadline because the current Kick client starts its own eight-second timer. The provenance stays on the value so telemetry and UI diagnostics can distinguish platform data from mirrored client behavior.

### Capability profiles and boundary parsers

```ts
type RaidContractProfileId =
  | "twitch-raid-pubsub-v2-2026-09-01"
  | "kick-chat-move-2026-09-01";

interface RaidContractProfile {
  id: RaidContractProfileId;
  platform: RaidPlatform;
  stability: "documented" | "observed-first-party";
  featureGuard: "raidHandoff.twitchObservedV2" | "raidHandoff.kickObserved20260901";
  defaultEnabled: boolean;
  launchMode: "platform-go" | "observed-client-deadline";
}

interface RaidSignalAdapter<P extends RaidPlatform> {
  readonly profile: RaidContractProfile;
  watch(
    source: RaidChannelRef<P>,
    emit: (signal: RaidHandoffSignal) => void
  ): () => void;
}

function parseTwitchRaidFrame(
  raw: unknown,
  source: RaidChannelRef<"twitch">,
  receivedAtMs: number
): RaidHandoffSignal | null {
  throw new Error("not implemented");
}

function parseKickChatMove(
  raw: unknown,
  source: RaidChannelRef<"kick">,
  receivedAtMs: number
): RaidHandoffSignal | null {
  throw new Error("not implemented");
}
```

The parsers own every undocumented field and validate it once, per `principle-boundary-discipline`. They reject a missing target, invalid slug, source-target equality, wrong source channel, non-finite count, negative count, or unsupported event type. They normalize empty avatars to `undefined`. React and the reducer never see Pusher or Twitch PubSub objects.

The Twitch adapter maps `raid_update_v2`, `raid_cancel_v2`, and `raid_go_v2` from `raid.<channelId>`. Its profile uses `platform-go`. A documented `channel.raid` event for the source can also normalize to `go` and takes precedence when available. The adapter never calls unsupported `joinRaid` or `leaveRaid` GraphQL mutations.

The Kick adapter maps `App\Events\ChatMoveToSupportedChannelEvent` from `channel.<channelId>`. It uses `hosted.slug`, `hosted.username`, `hosted.profile_pic`, and `hosted.viewers_count`. The count becomes `target-audience`. The profile creates an eight-second `observed-client-deadline`. No field is presented as a raid-party count.

Both profiles sit behind independent runtime guards. A parser mismatch records the profile ID and a reason, ignores the event, and opens no popup. Repeated mismatches disable only that profile for the current app session. Disconnection during an active offer produces `signal-lost`, cancels the timer, and leaves the source playing. This is the graceful fallback. Unknown data never becomes navigation.

### Per-surface controller

```ts
interface RaidSurface<P extends RaidPlatform = RaidPlatform> {
  kind: "single" | "multiview";
  id: RaidSurfaceId;
  source: RaidChannelRef<P>;
}

interface RaidHandoffBoundaryProps {
  surface: RaidSurface;
  move: (target: RaidChannelRef<RaidPlatform>) => void;
  children: React.ReactNode;
}

function reduceRaidHandoff(
  state: RaidHandoffState,
  command: RaidHandoffCommand
): RaidReduction {
  throw new Error("not implemented");
}

function useRaidHandoffController(args: {
  surface: RaidSurface;
  move: (target: RaidChannelRef<RaidPlatform>) => void;
  clock?: { nowMs: () => number };
}): RaidHandoffViewModel {
  throw new Error("not implemented");
}

function RaidHandoffBoundary(props: RaidHandoffBoundaryProps): React.ReactElement {
  throw new Error("not implemented");
}
```

Each boundary owns one reducer and one clock for one surface. The transport service may ref-count one platform subscription for duplicate source watchers, but it fans immutable normalized signals to independent surface controllers. One tile cannot change another tile's participation choice. This follows `principle-separate-before-serializing-shared-state`.

Reducer transitions are idempotent. A duplicate offer replaces only fresher presentation data for the same offer ID. Duplicate `go` effects are suppressed by the completed offer ID. A late update after cancel does nothing. Source changes invalidate the old offer before a navigation effect can run, per `principle-make-operations-idempotent`.

The boundary is the only public React component. It hides the adapter, subscription, reducer, timer, progress derivation, portal, avatar fallback, and effect execution. The caller supplies only the source surface and the operation that replaces it. That is a deep interface and keeps the call chain within the boundary, controller, and adapter.

### View model and copy

```ts
interface RaidHandoffViewModel {
  visible: boolean;
  mode: "expanded" | "compact";
  title: string;
  target: {
    displayName: string;
    avatarUrl?: string;
    fallbackInitial: string;
  };
  audienceLabel?: string;
  progress:
    | { kind: "determinate"; fractionRemaining: number; secondsRemaining: number }
    | { kind: "indeterminate" };
  primaryAction: { label: "Stay here" | "Join raid"; run: () => void };
  secondaryAction?: { label: "Join raid"; run: () => void };
  close: () => void;
}
```

The expanded default says "We're raiding {name}" and shows the target avatar through `ProxiedImage`. Missing or failed images use the target initial. The default action is **Stay here** because the state already defaults to `joining`. After opt-out, the compact banner says "Staying here" and offers **Join raid**. Rejoining before launch restores `joining`. The controller ignores choices after it consumes the launch signal.

An indeterminate bar is honest when the adapter has a pending offer but no defensible clock. A `platform-go` offer with a deadline can show progress, but zero changes the copy to "Waiting for Twitch" rather than moving early.

### Navigation ownership

The single-stream page passes a route replacement callback. The multiview slot passes a new `replaceStreamSource(streamId, target)` action. That store action atomically replaces `platform` and `channelName`, preserves the stream ID, mute, volume, focus, and chat selection, and clears only source-specific recovery state owned by the slot remount. Adding platform and channel to the existing `updateStream` partial update would permit half-updated sources, so the replacement gets a dedicated operation per `principle-model-the-domain`.

The coordinator never writes the router or multiview store itself. Navigation remains owned by the surface caller, while the boundary owns the decision of when to invoke it. This avoids a global raid store that would need to know every navigation mode.

### Module map

```text
apps/desktop/src/shared/raid-handoff-types.ts
  Normalized domain signals used by services, simulator, and renderer.

apps/desktop/src/backend/services/raid-handoff/
  raid-contract-profiles.ts
    Dated capability registry and runtime guard keys.
  twitch-raid-signal-adapter.ts
    Ref-counted raid topic subscription and Twitch boundary parser.
  kick-raid-signal-adapter.ts
    Reuses the existing Kick Pusher client and parses channel move events.
  raid-handoff-service.ts
    One watch(source, emit) facade. It selects and supervises the adapter.

apps/desktop/src/frontend/features/raid-handoff/
  raid-handoff-reducer.ts
    Pure state transitions and effects.
  use-raid-handoff-controller.ts
    Per-surface subscription, clock, and effect runner.
  RaidHandoffBoundary.tsx
    Deep caller interface and portal ownership.
  RaidHandoffPopup.tsx
    Accessible popup, compact rejoin state, avatar, labels, and progress.
  raid-handoff-presenter.ts
    Pure state-to-copy and progress derivation.
  RaidHandoffPopup.stories.tsx
    Deterministic visual states.

apps/desktop/src/frontend/features/multistream/data/multistream-store.ts
  Adds replaceStreamSource(streamId, target).

apps/desktop/src/frontend/components/dev/RaidHandoffSimTool.tsx
  Emits normalized scenarios only in development.
```

The platform adapters reuse the existing Twitch and Kick realtime clients. They do not open a second WebSocket per channel. Incoming `UserNotice.type="raid"` remains in the chat services. The outgoing handoff service never converts an incoming notice into a navigation signal.

### Simulator and tests

The verification set is:

1. Boundary parser fixtures for every accepted raw event and malformed field. The fixture metadata records platform, event name, capture date, and redaction status.
2. Reducer table tests for default joining, opt-out, rejoin, cancel, duplicate events, late go, source change, signal loss, deadline authority, and platform-go authority.
3. Fake-clock component tests for progress width, zero behavior, compact rejoin copy, avatar fallback, and accessible actions.
4. Storybook states for Twitch determinate, Twitch waiting for go, Kick target-audience label, missing count, missing avatar, opted out, cancelled, and transport lost.
5. Single-page integration proof that one go replaces the route once.
6. Multiview integration proof that one raid replaces only its stream ID and preserves every other slot plus mute, volume, focus, and selected chat.
7. Dev simulator proof for offer, update, cancel, go, local deadline, and signal loss without a live raid.
8. A manual controlled-channel run for each platform before enabling its dated contract profile by default.

The simulator proves UI and state behavior. It does not claim that an undocumented upstream contract still works. Raw capture replay and one controlled live run cover that separate risk.

## Synthesis decision

Candidate C chooses a per-surface `RaidHandoffBoundary` over a global raid store. The capability profile and normalized signal union isolate unstable platform behavior, while the caller-provided `move` operation lets the same state machine support a route and a multiview slot. This candidate should be the base if the arena values fail-closed transport handling, accurate copy, and low caller knowledge over the smallest initial diff.

## Tradeoffs accepted

- We accept one local reducer per viewing surface in exchange for isolation between multiview tiles.
- We accept dated Kick behavior in exchange for a usable Kick handoff, with a kill switch and fail-closed parser.
- We accept no Twitch popup when its observed contract is disabled or malformed in exchange for never redirecting from guessed data.
- We accept local-only **Stay here** and **Join raid** choices in exchange for avoiding unsupported platform mutations.
- We accept an indeterminate or waiting state in exchange for keeping progress separate from launch authority.
- We accept a dedicated `replaceStreamSource` store action in exchange for making an atomic platform and channel replacement explicit.

## Alternatives considered

### One global Zustand raid store

A global store makes the popup easy to mount once, but it must learn route navigation, multiview replacement, surface lifetime, and which tile owns an offer. Its interface leaks every viewing mode. The per-surface boundary hides more policy behind fewer caller inputs.

### Extend `UserNotice` with countdown fields

This reuses existing chat plumbing but combines an incoming target notice with an outgoing source handoff. Callers would need to infer direction, authority, and navigation semantics from optional fields. It also breaks when chat is closed while playback remains active.

### Navigate on stream offline or incoming raid notice

An offline event has no reliable target, and an incoming notice belongs to the target channel. This shape hides almost no complexity and can move the wrong surface. It is not viable.

### Call Twitch `joinRaid` and `leaveRaid`

These native GraphQL mutations could mirror Twitch enrollment, but Twitch does not publish them for third-party use. Exposing them would make unsupported authentication and mutation errors part of every caller's flow. Local participation keeps that risk inside StreamFusion.

## Open questions and risks

- Can a controlled Twitch capture establish the current `raid_update_v2` fields, countdown semantics, and anonymous authorization before its profile ships enabled?
- Should the Kick observed profile start enabled after fixture and live verification, or remain behind an explicit experimental setting?
- Does the app overlay portal render above every WebContentsView configuration, or must main temporarily inset a slot while the popup is active?
- Should a dismissed compact banner remain until launch for every viewer, or should accessibility preferences allow it to stay expanded?
- Can the documented Twitch `channel.raid` source subscription serve as the preferred go authority in the current desktop token model?

## Next implementation step

Build the normalized domain types, pure reducer, and dated adapter fixture parsers before mounting any popup or navigation effect.
