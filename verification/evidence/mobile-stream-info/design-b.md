# Candidate B: unified watch presentation

## Usage (caller's view)

`WatchSessionRoute` owns remote data and provider actions. It creates one presentation controller for the current target.

```tsx
const ui = useWatchPresentation({
  holds: watchControlHolds({ playing, qualityMenuOpen, toolSheet }),
  targetKey: watchTargetKey(target),
  targetKind: target.media ? "recorded" : "live",
});
<WatchScreen
  inspection={inspection.data ?? null}
  onBack={onBack} onFollow={() => channelFollow.toggle()}
  onOpenChannel={() => onOpenChannel(target)}
  onPlayerStagePress={ui.stagePress} presentation={ui.view} target={target}
/>
```

`WatchScreen` keeps the player and conversation mounted. Card expansion changes layout only.

```tsx
<PlayerControls visible={presentation.controlsVisible} onStagePress={onPlayerStagePress} />
<WatchStreamInfoCard info={inspection?.info ?? null} mode={presentation.cardMode} />
<WatchConversation tab={presentation.tab} />
```

Player actions call `ui.controlUsed()` before invoking the existing playback session. Fullscreen and Picture-in-Picture still come from `WatchPeek`, outside this state.

## Problem

The current player tap selects the `"info"` tab, so `WatchTabs` unmounts `ChatPanel`. The same route separately coordinates `controlsVisible`, a three-second timer, the selected tab, and forced visibility from pause, quality, and tool sheets. The target expands stream metadata with player controls, then returns to a compact action row while chat stays below both states.

## Shape

```ts
export type WatchConversationTab = "chat" | "comments";
export type WatchCardMode = "compact" | "expanded";
export type WatchControlHold = "paused" | "quality-menu" | "tool-sheet";
type WatchControls =
  | { readonly kind: "hidden"; readonly generation: number }
  | { readonly kind: "transient"; readonly generation: number }
  | { readonly kind: "held"; readonly generation: number; readonly holds: readonly [WatchControlHold, ...WatchControlHold[]] };

export type WatchPresentationState = {
  readonly card: WatchCardMode;
  readonly controls: WatchControls;
  readonly tab: WatchConversationTab;
  readonly targetKey: string;
};
export type WatchPresentationEvent =
  | { readonly kind: "target-changed"; readonly targetKey: string; readonly targetKind: "live" | "recorded" }
  | { readonly kind: "stage-pressed" }
  | { readonly kind: "control-used" }
  | { readonly kind: "holds-reconciled"; readonly holds: readonly WatchControlHold[] }
  | { readonly kind: "idle-expired"; readonly generation: number };

export function createWatchPresentation(input: { readonly targetKey: string; readonly targetKind: "live" | "recorded" }): WatchPresentationState;
export function reduceWatchPresentation(state: WatchPresentationState, event: WatchPresentationEvent): WatchPresentationState;
export function createWatchPresentationStore(initial: WatchPresentationState): StoreApi<WatchPresentationStore>;
export function useWatchPresentation(input: WatchPresentationInput): WatchPresentationController;
```

`domain/watch-presentation.ts` owns the pure state machine. `components/use-watch-presentation.ts` owns a route-scoped Zustand store, runtime reconciliation, and the timer. `components/watch-stream-info-card.tsx` renders the compact row or expanded avatar, name, verification, title, category, and horizontal tag list. `components/watch-conversation.tsx` owns the always-mounted live chat or recorded comments. `watch-screen.tsx` composes these pieces and hides the portrait region for fullscreen or Picture-in-Picture without changing its keys.

The controller exposes `{ view, stagePress, controlUsed }`. Its view contains only `cardMode`, `controlsVisible`, and `tab`. The hook hides timer generations, hold reconciliation, and Zustand. `WatchInfo`, follow state, and navigation callbacks still enter from `WatchSessionRoute`. The card has no provider client and no `Subscribe` prop. It renders only existing back, channel, and follow actions.

`stage-pressed` expands the card and starts a fresh transient control generation when controls are hidden. A second press collapses both. `idle-expired` acts only on the matching generation. Holds pin controls but do not force the card open. Releasing the final hold starts a new transient generation. A target change resets the card and chooses `chat` or `comments` from the target kind.

## Synthesis decision

Use this candidate when the implementation should encode the interaction as a first-class Watch concept. It replaces five coordinated route states and callbacks with one route-scoped controller. It does not merge fullscreen or Picture-in-Picture into this model because the focused playback session already owns those states.

## Tradeoffs accepted

- We accept a small state machine and store factory in exchange for one owner of card, controls, tab, target reset, and stale timer behavior.
- We accept independent card and control substates in exchange for valid compact-card states while pause, quality, or tools keep controls visible.
- We accept moving `InfoPane` out of `WatchTabs` in exchange for keeping chat and recorded comments mounted.

## Alternatives considered

Deriving `cardMode` from the existing `controlsVisible` flag loses because forced control visibility would also force card expansion. It also keeps tab selection and timer invalidation spread across the route. A single union that pairs every card, control, and tab combination loses because it multiplies valid states without hiding more policy.

## Practical tests

- Reducer tests cover initial live and recorded tabs, tap, second tap, matching and stale expiry, overlapping holds, final hold release, and target reset with literal states.
- A component test proves expanded metadata and `watch-chat` exist together, then advances fake timers and proves the compact row and the same chat mount remain.
- Mount counters prove one `PlayerSurface` and one conversation instance survive card transitions, fullscreen entry and exit, and Picture-in-Picture return.
- Callback tests cover back, channel, follow, fullscreen, and Picture-in-Picture. Recorded playback keeps `watch-comments` and playback synchronization.
- Use the captured pre-change baseline, then compare the one-second expanded and six-second compact geometry against the supplied Twitch images. Dynamic video, text, avatars, and chat stay outside exact pixel claims.

## Open questions and risks

- Where should the existing related-stream pane move so it stays reachable without sitting between the card and chat? The implementation must resolve this before deleting the `info` tab.
- Does hiding the mounted portrait region with React Native layout styles preserve focus and accessibility on every supported Android version? The runtime proof must check this in fullscreen and Picture-in-Picture.

## Next implementation step

Capture the current Watch state matrix, then add reducer tests and the route-scoped store before changing component layout.
