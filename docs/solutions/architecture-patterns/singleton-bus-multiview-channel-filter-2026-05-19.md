---
title: Singleton chat-service event bus — channelId on payload + handler-side filter
module: apps/desktop/backend/services/chat
date: 2026-05-19
category: architecture-patterns
problem_type: architecture_pattern
component: service_object
severity: high
related_components:
  - twitch-hermes-client
  - kick-pusher-client
  - PredictionBanner
  - TwitchChat
  - KickChat
  - ChatSimTool
applies_when:
  - Multiple chat panels are mounted at once (multiview / multi-channel UI)
  - A backend service is a process-wide singleton with an event-emitter API
  - Each event semantically belongs to one channel / room / tab
  - You are adding a new per-channel event type to twitchChatService or kickChatService
  - You are refactoring a service that started single-instance and is now mounted N times
tags:
  - singleton-bus
  - multiview
  - event-bus
  - channel-scoping
  - twitch
  - kick
  - hermes
  - cross-channel-leak
  - predictions
---

# Singleton chat-service event bus — channelId on payload + handler-side filter

## Context

StreamForge runs chat through two process-wide singletons —
`twitchChatService` and `kickChatService` (in
`apps/desktop/src/backend/services/chat/`) — that expose a single event bus
shared by every mounted chat panel. The Hermes WebSocket client parses
incoming Twitch prediction frames and emits them via
`twitchChatService.emit("predictionUpdate", payload)`; each
`<TwitchChat channelId={...}/>` and `<KickChat channelId={...}/>` instance
subscribes its own handler to that same bus.

The failure mode is multiview. When 2+ chat panels are mounted side by side
(e.g. xQc + Pokimane), a prediction starting in xQc's channel fires the
handler in **every** panel, so Pokimane's chat also pops a prediction
banner that has nothing to do with what's happening there. The event
payload had no ownership field, so handlers couldn't distinguish their
channel's events from anyone else's. This generalizes to every future
per-channel event (polls, hype-trains, raids) that gets bolted onto the
same bus.

## Guidance

**Rule:** Any event flowing through a singleton chat-service bus MUST carry
the owner `channelId` on the payload, and every subscriber MUST filter on
it before mutating UI.

### Shape the payload with ownership

Required field, documented at the type so reviewers see *why*:

```ts
// apps/desktop/src/shared/chat-types.ts
export interface UnifiedPrediction {
  id: string;
  platform: "twitch" | "kick";
  /**
   * Channel that owns this prediction. Required so multiview consumers can
   * filter incoming events to the channel rendered in each chat panel —
   * `twitchChatService` / `kickChatService` are singletons whose event bus
   * fans out to every mounted listener, so unfiltered handlers would render
   * a prediction in channels other than the one it came from.
   */
  channelId: string;
  // ...
}
```

### Stamp ownership at the emitter

The emitting client (Hermes WebSocket, Kick Pusher, future Helix poll, etc.)
knows its channel at construction time. Thread that through every parser
and emit; never assume a downstream handler can recover the channel from
context.

```ts
// apps/desktop/src/backend/services/chat/twitch-hermes-client.ts
export function parsePredictionEvent(
  inner: unknown,
  channelId: string,
): UnifiedPrediction | null {
  // ...parsing...
  return { id, platform: "twitch", channelId, /* ... */ };
}

// inside TwitchHermesClient — channelId was passed at construction
private handleNotification(frame: Record<string, unknown>): void {
  // ...extract inner pubsub...
  const prediction = parsePredictionEvent(inner, this.channelId);
  if (prediction) this.emitter.emit("prediction", prediction);
}
```

### Filter at every handler

The pattern, with the dev-sentinel exception:

```tsx
// TwitchChat.tsx
const handlePredictionUpdate = (prediction: UnifiedPrediction) => {
  // Multiview gate: twitchChatService is a singleton, so a prediction
  // emitted for channel A also fires this handler in the chat panel for
  // channel B. Drop everything that doesn't match the channel rendered
  // here. An empty `prediction.channelId` ("") is the dev-injection
  // path (ChatSimTool has no current-channel context) — accept those
  // so the dev tool stays useful.
  if (
    channelId &&
    prediction.channelId &&
    prediction.channelId !== channelId
  ) {
    return;
  }
  // ...sticky-dismiss + setActivePrediction...
};
```

For Kick, key off `kickRoomKey = channelId ?? String(chatroomId)` — Kick
channels carry two numeric IDs (`user_id` vs `channel.id`) and stale follow
rows can hold the old one, so falling back to `chatroomId` keeps the filter
from missing legitimate events. (auto memory [claude])

### Dev sentinel — accept everywhere when the source has no channel

`ChatSimTool` injects synthetic events but doesn't know which panel is
focused. Set `channelId: ""` on dev emits and have every handler skip the
filter when either side of the comparison is falsy. Without the sentinel
the dev tool stops being useful the moment the rule lands.

```ts
// apps/desktop/src/components/dev/ChatSimTool.tsx
return {
  id, platform: p,
  // Dev sentinel — empty channelId tells the chat handlers to accept the
  // event into whichever channel is currently rendered, since the sim
  // tool has no view of the active channel id.
  channelId: "",
  // ...
};
```

## Why This Matters

**Blast radius if violated:**

- **Cross-channel UI leak.** Users see a prediction banner in a channel
  where nothing was predicted — confusing, undermines trust in the data.
- **Downstream data confusion.** Anything that follows the event
  (analytics, mod-log writes, prediction-history persistence keyed by
  current chat panel) silently records data against the wrong channel.
  This is the worst class: silent bad data, not an error you can spot.
- **Sticky-dismiss collisions.** Dismissing a banner in channel B that
  originated in channel A creates dismiss state for the wrong channel, so
  when the real banner *should* later appear it's already suppressed.

**Why this fix is minimum-radius:**

- Filtering inside the Hermes client itself was rejected: other emitters
  (dev injection, the planned Kick Pusher path) would have to reimplement
  the same gate. Filtering at the boundary — emitter stamps, handler
  filters — lets every emitter reuse one rule.
- Making the chat service per-channel instead of singleton was rejected:
  too large a refactor; `message` / `userNotice` / `clearChat` / pinned
  handlers all hang off the same bus. Adding an owner ID to event payloads
  is dramatically less invasive and ships now.
- Routing predictions through React Context was rejected: the chat service
  already owns the dispatcher pattern; layering Context on top adds
  re-render churn for an event that fires every few minutes at most.

## When to Apply

Apply this rule **any time you add a per-channel event to a singleton
chat-service bus.**

Next candidate events that will need the same treatment:

- **Polls** — same structural pattern as predictions; will leak identically.
- **Hype trains** — single-channel scoped, fan out the same way.
- **Raids (incoming/outgoing)** — channel-specific by definition.
- **Goal updates, shoutouts, charity milestones** — anything channel-owned.

Apply the rule even for events that are nominally broadcast (server-wide
announcements, platform-wide notifications): stamp them with a sentinel
like `channelId: "*"` and have handlers explicitly opt in. Don't let
"broadcast" mean "unfiltered" by accident — the next refactor that narrows
the event will reintroduce the leak.

**Don't apply this** to events that genuinely fan out to all panels by
design (e.g. global app-level theme changes). Those should live on a
different bus, not the chat-service bus, so the multiview-leak failure
mode can't be mistaken for intent.

## Examples

**Before — leaks across channels:**

```tsx
// TwitchChat.tsx
useEffect(() => {
  const handle = (prediction: UnifiedPrediction) => {
    // No filter — every panel runs this for every channel's event.
    setActivePrediction(prediction);
  };
  twitchChatService.on("predictionUpdate", handle);
  return () => twitchChatService.off("predictionUpdate", handle);
}, [channelId]);
```

**After — gated by ownership, dev-sentinel preserved:**

```tsx
// TwitchChat.tsx
useEffect(() => {
  const handle = (prediction: UnifiedPrediction) => {
    if (
      channelId &&
      prediction.channelId &&
      prediction.channelId !== channelId
    ) {
      return; // belongs to another panel
    }
    setActivePrediction(prediction);
  };
  twitchChatService.on("predictionUpdate", handle);
  return () => twitchChatService.off("predictionUpdate", handle);
}, [channelId]);
```

**Emitter side — stamp at construction:**

```ts
// twitch-hermes-client.ts
class TwitchHermesClient {
  constructor(private readonly channelId: string) { /* ... */ }
  private onPredictionFrame(inner: unknown) {
    const pred = parsePredictionEvent(inner, this.channelId);
    if (pred) this.emitter.emit("prediction", pred);
  }
}
```

## Related fixes from the same review

These shipped alongside the multiview fix and are worth knowing if you're
touching Hermes / banner code:

- **Hermes reconnect storm.** `reconnectAttempts = 0` was being reset in
  `ws.onopen`, so a half-open TCP socket (TCP up, no Hermes welcome frame)
  reset backoff to 1s and triggered a connect loop. Moved the reset into
  `handleWelcome` so backoff only clears after a real handshake. Note: the
  upstream Xtra Android `HermesWebSocket.kt` has the same bug.
- **Auto-dismiss timer reset.** `<PredictionBanner>` had `onAutoDismiss`
  in a `useEffect` dep array; inline-arrow parents bounced the 60s timer
  every re-render. Fix: stash the callback in a ref, depend only on
  `[isEnded, prediction.id]`.
- **`parseOutcome` `null as never` anti-pattern** replaced with a typed
  `parseTopPredictor` helper plus a typed-predicate filter — kills an
  `as never` cast and surfaces malformed outcomes properly.
- **`EndedPanel` winner visibility.** For 3+ outcome predictions, the
  winning outcome is now hoisted into the visible pair instead of
  potentially being clipped.
- **Sticky-dismiss extraction.** Logic that tracks "user dismissed this
  prediction, don't re-pop it" was duplicated across `TwitchChat` and
  `KickChat`; now a shared `useStickyDismissedPrediction` hook in
  `apps/desktop/src/hooks/`.

## Related

- `docs/solutions/integration-issues/twitch-viewer-prediction-read-discovery-2026-05-18.md`
  — Upstream investigation that established the Hermes → `twitchChatService.emit`
  emit path this doc patches. That doc spec'd the wiring; this one captures
  the multiview leak it inadvertently introduced and the channelId-on-payload
  fix.
- `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md`
  — Background on Kick's `user_id` vs `channel.id` duality, which informs
  the `kickRoomKey` fallback used by the Kick handler filter.
