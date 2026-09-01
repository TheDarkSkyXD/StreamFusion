# Outgoing raid handoffs use source-owned transport watches

## Problem

StreamFusion already renders incoming raid notices in chat. An outgoing raid is a separate viewer workflow. The app must observe a source Channel preparing to raid a same-Platform target, show a reversible default-join choice, and move only when the provider-specific launch authority fires. Detection must continue when chat is hidden and must not expose proprietary Hermes or Pusher payloads to React.

Twitch and Kick do not offer equivalent public viewer contracts. Twitch's first-party client uses the undocumented `raid.<channelId>` Hermes topic with `raid_update_v2`, `raid_cancel_v2`, and `raid_go_v2`. Kick's first-party client uses the undocumented `App\Events\ChatMoveToSupportedChannelEvent` on `channel.<broadcasterUserId>` and starts a local eight-second timer. These contracts can change without notice, so malformed input, disconnects, ambiguous correlation, and source changes must leave current playback untouched.

## Usage

The stream page and each MultiView StreamSlot acquire one source-scoped controller:

```tsx
const handoff = useRaidHandoff({
  source,
  isSourceCurrent,
  onJoin: replaceCurrentPlayback,
});

return handoff.popup ? <RaidHandoffPopup model={handoff.popup} /> : null;
```

The controller uses one deep transport operation:

```ts
const release = watchRaidHandoffs(source, acceptNormalizedEvent);
```

The returned release is synchronous and idempotent. Callers do not coordinate event listeners, transport subscription IDs, reconnects, or provider channel names.

## Shape

`shared/raid-handoff-types.ts` owns serialization-safe source, target, audience, progress, launch-authority, lifecycle, participation, and state unions. Twitch and Kick offers are separate union members, which makes a cross-Platform source and target unrepresentable.

The provider boundary validates `unknown` data and emits only `RaidHandoffEvent`. Twitch waits for a correlated `raid_go_v2`. It shows waiting UI when no validated payload deadline exists. Kick derives the absolute deadline from `receivedAt + 8_000` and records `observed-first-party-client` provenance. `hosted.viewers_count` is `target-viewers`, never raid-party members or chatters.

The transport watch registry is shared and source-scoped. It reuses `TwitchHermesClient` and the existing Kick Pusher singleton while maintaining leases independently from visible chat panels. Each rendered playback surface owns its participation and deadline state. Provider updates preserve that local decision.

Single-stream navigation replaces `/stream/$platform/$channel` only after a final route-source check. MultiView calls one result-bearing `replaceRaidSource` store action. That action replaces only the matching StreamSlot, preserves its order, mute, volume, focus, and chat selection, and merges into an already-open target instead of duplicating it.

## Synthesis decision

Use Candidate A's existing transport ownership and per-surface controllers. Graft dated contract profiles, session-local circuit breaking, signal-loss settlement, separate progress and launch authority, final source rechecks, absolute-clock progress, reduced-motion presentation, target preloading, and typed MultiView merge results.

Do not add a main-process IPC subsystem or app-wide raid coordinator. The relevant realtime clients already run in the renderer and can provide hidden-chat coverage through independent source leases.

## Tradeoffs accepted

- Both provider adapters depend on observed first-party behavior rather than a documented viewer API. Dated profiles, strict parsing, fail-closed behavior, and focused fixtures contain but do not remove that risk.
- Twitch may show an indeterminate waiting state. Accuracy is preferred over fabricating a 30-second deadline.
- **Stay here** changes only StreamFusion navigation. The app does not call unsupported Twitch join or leave mutations and does not claim the Platform recorded the choice.
- Kick's eight-second deadline matches the observed first-party client. It is not represented as a deadline supplied by the Pusher payload.
- A popup rendered in a StreamSlot's DOM may still composite below an enabled native `WebContentsView`. The implementation does not resize or hide native content because that would destabilize slot lifecycle. The legacy DOM player path and single-stream path are covered.

## Alternatives considered

- Reuse incoming `UserNotice.type = "raid"`: rejected because it describes a raid landing on the target and has no source-side countdown, cancellation, or participation state.
- Mount detection in `ChatPanel`: rejected because hidden chat and selective MultiView chat sessions would miss outgoing events.
- Add a global Zustand offer: rejected because concurrent StreamSlots need independent participation and timers.
- Add a main-process service, preload surface, and IPC snapshots: rejected because it duplicates existing renderer-owned Hermes and Pusher lifecycle without a security benefit.
- Call proprietary Twitch `joinRaid` or `leaveRaid` GraphQL mutations: rejected because they are unsupported third-party contracts.
- Label Kick's target viewer count as raiders or chatters: rejected because it misstates the payload's meaning.

## Open questions and risks

- A controlled Twitch capture must confirm current payload fields, authorization, and whether a trustworthy visual deadline exists before treating additional fields as stable.
- Kick's event name, public subscription behavior, and eight-second first-party timer must be rechecked before release.
- Native `WebContentsView` composition needs a dedicated visual proof before the popup can be guaranteed above every enabled MultiView slot.

## Next implementation step

Run a controlled source-to-target raid on each Platform, redact the observed boundary frames into fixtures, and confirm the dated profiles. Keep either provider path fail-closed if its live contract does not match the parser.
