# Candidate A, portrait card derives from control visibility

## Usage

WatchScreen places one card between the existing player stage and WatchTabs. It supplies the resolved control visibility already received from WatchRoute.

```tsx
import { WatchChannelCard } from "./watch-channel-card";
<WatchChannelCard
	info={inspection?.info ?? null} target={target}
	expanded={controlsVisible} followed={followed} followBusy={followBusy}
	{...(onFollow === undefined ? {} : { onFollow })}
	{...(onBack === undefined ? {} : { onBack })}
	{...(onOpenChannel === undefined ? {} : { onOpenChannel })}
/>
```

WatchRoute retains the existing `controlsForcedVisible || controlsVisible` calculation. Its WatchScreen call retains `controlsVisible={showControls}` and the existing `onToggleControls`. Delete its `onPlayerTap={() => setTab("info")}` prop.

```tsx
// Active player call inside WatchScreen. Existing control props remain.
<PlayerControls {...existingControlProps} onToggleVisible={onToggleControls} />
// Non-control player-stage fallback. Guard on callback presence as today.
<Pressable onPress={onToggleControls} testID="watch-player-tap" />
```

The player tap has exactly one visibility transition. PlayerControls currently calls `onPlayerTap` before `onToggleVisible`, so replacing the former with `revealControls` would conflict with the toggle.

## Problem and grounding

The inspected `twitch-tap-1s.png` shows identity, title, category, and horizontal tags above uninterrupted chat. `twitch-tap-6s.png` removes those details and keeps one action row. Colors remain StreamFusion's dark tokens, as the user requested the interaction rather than the white Twitch theme.

`watch-route.tsx` owns query data, playback subscriptions, chat connection, follow behavior, and a 3,000 ms controls timer. Paused or non-active playback, quality menus, and tool sheets force controls visible. `watch-screen.tsx` owns presentation and currently renders a 36 px identity row plus a separate title. `watch-tabs.tsx` conditionally mounts chat or comments only outside the info tab. Player tap selects that info tab, which removes ChatPanel. The new card owns no timer, query, follow operation, or chat session.

## Shape

```ts
import type { ReactElement } from "react";
import type { WatchInfo, WatchTarget } from "../capabilities/watch";
export type WatchChannelCardProps = {
	readonly info: WatchInfo | null;
	readonly target: WatchTarget;
	readonly expanded: boolean;
	readonly followed: boolean;
	readonly followBusy: boolean;
	readonly onFollow?: () => void;
	readonly onBack?: () => void;
	readonly onOpenChannel?: () => void;
};
export function WatchChannelCard(props: WatchChannelCardProps): ReactElement {
	throw new Error("not implemented");
}
```

Reuse `WatchInfo` and exhaust its live, recorded, ended, and unavailable discriminants. Null means inspection pending. Live details use the channel avatar, display name, verification, stream title, categoryName, language, and tags. Recorded details use the channel and recording title, never a live category or tag assumption. Ended details show the channel's offline copy. Pending and unavailable details use `target.channelName` plus localized status copy. No duplicate remote model is necessary, per Foundational Thinking and Type System Discipline.

Expanded layout has a 64 px avatar at the left. The right column uses an 18 px name, 14 px title over at most two lines, and 14 px category. A horizontal ScrollView holds MobileTag pills with deduplicated language and all tags, without the shared helper's four-label cap. Use local styles based on mobile tokens. Card padding is 12 px. The collapsed card hides metadata and leaves one compact row with Back, Open channel, and the real follow action. Open channel uses a truncated channel name with existing viewer count and uptime below it inside the same row. Preserve the existing uptime formatter and interval rather than introduce playback-control props for those values.

Card visibility never changes the WatchTabs key or tab. Live keeps chat, recorded keeps comments, and explicit info callers retain existing behavior. Hide the card for fullscreen and PiP using the existing WatchScreen guard. Leave the `player-stage` key and PlayerSurface position unchanged. Per Model the Domain, `expanded` is a projection of the existing controls state, not synchronized local state. Per Boundary Discipline, provider parsing remains in the inspection reader and follow writes remain in the route's existing capability.

## Module map

- `watch/components/watch-channel-card.tsx` owns metadata variants, horizontal pills, and the persistent action row.
- `watch/components/watch-screen.tsx` replaces its compact identity row and standalone title with the card. Move its metadata formatting helpers with their consumer.
- `watch/components/watch-route.tsx` removes the automatic info-tab callback. Preserve timer, query, and session ownership.
- `watch/components/player-controls.tsx` removes `onPlayerTap` after the sole production caller migrates. Its tap only calls `onToggleVisible`.
- `watch/tests/watch-channel-card.test.ts` covers content variants and callable actions. `watch/tests/watch-controls-card.test.ts` covers mounted behavior and timer coupling.
- `watch/components/watch-tabs.tsx` retains recorded comments, chat sessions, related navigation, and explicit info compatibility. No new registration or ESLint layer is needed.

## Synthesis decision

This is the candidate supplied for synthesis. Its public contract hides variant rendering and tag layout while exposing only existing typed content, control visibility, and already-authorized actions.

## Tradeoffs accepted and alternatives

- We accept resizing the chat viewport in exchange for the reference's metadata expansion. We preserve the same chat instance and composer state.
- A metadata modal or overlay avoids viewport resizing but covers chat and adds dismissal state independent of the player timer. It exposes more coordination to WatchScreen.
- A controller owning both player chrome and metadata could centralize all behavior, but it moves mature playback timing into a new abstraction for one derived boolean.
- Subscription purchase is absent from inspected mobile capabilities. `FollowingSession.openProviderPage` opens a channel page only. Omit Subscribe. A future explicitly labeled provider handoff requires a supported subscription destination and error behavior.

## Proof plan and concrete risks

1. Use real React act/createRoot and fake time with WatchRoute and WatchScreen, following the existing fullscreen mount suite. Avoid the watch-screen suite's mocked hooks for lifetime assertions. Mount a traced PlayerSurface and the actual subscribed chat component with deterministic session data. Enter a composer draft and receive a message before toggles. Assert the same player and chat host nodes, unchanged draft, one surface mount, one chat subscription, and zero disconnects across reveal, expiry, and repeat taps.
2. Advance to 2,999 ms and assert metadata and controls visible. Advance one more millisecond and assert both hidden while action row and chat remain. Reveal after hiding, wait 2,500 ms, hide and reveal again, and prove the new deadline starts at the latest reveal. Hold paused, quality menu, and each tool sheet past 3,000 ms. Close or resume and prove the ordinary deadline returns.
3. Exercise Follow, Unfollow, busy state, Open channel, Back, unavailable inspection, long name, long title, and more than four tags. Assert live uses chat and recorded uses comments. Metadata must not show stale live tags for a recording.
4. Run native portrait captures at one and six seconds after a tap, with chat visible and a composer draft. Test 320 px width, large text, fullscreen return, and PiP return. Confirm horizontal tag scrolling does not steal chat gestures. Native keyboard and viewport resizing can move the chat anchor even when React nodes remain mounted.
5. Run mobile typecheck, lint, feature Vitest suites, and the architecture verifier. Existing vitest.config.mts already discovers feature-owned `.test.ts` files.

Action targets need the mobile 48 px minimum or equivalent hit slop. Large text may require shortening the Open channel label to keep one row. Collapsed metadata must leave the accessibility tree, so screen readers do not focus hidden elements. The card must follow controls forced visible during pause and menus even if the timer's stored boolean is false. Preserve current 3,000 ms policy rather than infer a six-second timer from the screenshot filenames.

## Next implementation step

Build WatchChannelCard with deterministic fixtures and then replace the existing metadata blocks while removing the automatic info-tab tap callback.
