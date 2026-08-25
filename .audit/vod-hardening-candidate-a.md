# VOD Watch Live hardening, candidate A

## Problem

`VideoPage` uses `useChannelByUsername` for the canonical follow identity and avatar fallback. That query uses the `followedChannelList` policy, which keeps data fresh for five minutes and retains data while its key changes. `UnifiedChannel.isLive` is therefore useful channel metadata, but it cannot prove that the channel is live now. The VOD CTA must survive a cached `isLive: true`, a route change, a failed lookup, and a stream that ends while the VOD page stays open. Existing `useChannelByUsername` callers must keep their contract. The existing `streams.getByChannel` IPC path already asks the platform for stream status. Kick explicitly requests `freshStatus: true` in that handler.

## Usage (caller's view)

`VideoPage` keeps `useChannelByUsername` for the follow button and avatar. It asks one VOD-only hook whether the live route is currently valid.

```tsx
const liveLinkState = useVodLiveLink(channelName, routePlatform, {
	enabled: hasResolvedChannelName,
});

{liveLinkState.kind === "available" && (
	<Link
		to="/stream/$platform/$channel"
		params={{ platform: routePlatform, channel: channelName }}
		search={{ tab: "home" }}
	>
		<Button size="sm">Watch Live</Button>
	</Link>
)}
```

The same component stays closed while the first check is in flight. It also stays closed after a transport failure.

```tsx
const liveLinkState = useVodLiveLink(channelName, routePlatform, {
	enabled: hasResolvedChannelName,
});

const showWatchLive = liveLinkState.kind === "available";
```

When the user changes from one VOD to another, the new route gets a new status key. A late response for the old route cannot make the new route show its CTA.

```tsx
// route A: twitch/ninja. Then route B: twitch/shroud.
// The hook returns "checking" for B until B has a successful, route-matched
// status result. A's cached or late result is never "available" for B.
useVodLiveLink(channelName, routePlatform, { enabled: hasResolvedChannelName });
```

## Shape

Add `apps/desktop/src/hooks/queries/useVodLiveLink.ts`. The module owns the VOD CTA's meaning. `VideoPage` imports its one hook. The module uses `window.electronAPI.streams.getByChannel`, not `channels.getByUsername`, and it keeps the result under a VOD-only React Query key.

```ts
export const VOD_LIVE_LINK_KEYS = {
	byChannel: (username: string, platform: Platform) =>
		["vod-live-link", platform, username.trim().toLowerCase()] as const,
};

export type VodLiveLinkState =
	| { kind: "checking" }
	| { kind: "available" }
	| { kind: "unavailable" };

export interface UseVodLiveLinkOptions {
	enabled?: boolean;
}

export function useVodLiveLink(
	username: string,
	platform: Platform,
	options?: UseVodLiveLinkOptions
): VodLiveLinkState;

function isCurrentLiveStream(
	stream: UnifiedStream | null | undefined,
	username: string,
	platform: Platform
): boolean;
```

`isCurrentLiveStream` is the boundary predicate. It returns `true` only when the response has `isLive === true`, the platform equals the route platform, and normalized `stream.channelName` equals the route username. `null`, an offline stream, a response for another channel, and malformed values all mean `false`.

The hook configures one foreground-only query with these facts.

```ts
{
	queryKey: VOD_LIVE_LINK_KEYS.byChannel(username, platform),
	queryFn: fetchStreamByChannel,
	enabled: options.enabled ?? true,
	staleTime: 0,
	gcTime: 60_000,
	refetchOnMount: "always",
	refetchOnWindowFocus: "always",
	refetchInterval: 30_000,
	refetchIntervalInBackground: false,
	retry: false,
}
```

Do not use `placeholderData`. The hook returns `checking` until React Query reports a fetch after this observer mounted. It returns `unavailable` on an error or a completed non-live result. It returns `available` only after a completed, current-route live result. A completed polling result of `null` changes `available` to `unavailable`.

The hook does not alter `CHANNEL_KEYS`, `useChannelByUsername`, `useStreamByChannel`, or `streamChannelDetail`. The existing channel query remains the source for canonical channel metadata. The VOD-only query is the source for a live-navigation claim.

The public interface is deliberately one discriminated value. It hides React Query state, the IPC response, cache freshness, matching rules, and the polling policy. `VideoPage` only learns whether a live link is safe to render. This is a deep module rather than a query wrapper, per model-the-domain, boundary-discipline, and minimize-reader-load.

## Synthesis decision

Not synthesized. Candidate A recommends the VOD-only polling hook for comparison with the other candidates. It rejects a channel-query change because that would alter every `useChannelByUsername` caller and still mixes long-lived metadata with current stream status.

## Tradeoffs accepted

- We accept one foreground request per open VOD every 30 seconds in exchange for removing the CTA within one polling interval after the stream ends.
- We accept a temporarily hidden CTA while the route's first status check runs in exchange for never advertising a live stream from cache alone.
- We accept one VOD-specific query key in exchange for preventing VOD status from sharing `keepPreviousData` behavior with the Stream page.
- We accept a false negative during a status outage in exchange for fail-closed navigation.

## Alternatives considered

`useChannelByUsername` with an invalidation or a shorter shared cache time lost. It exposes live-status policy to every channel caller, and it leaves the page dependent on a metadata model that can be stale.

One fresh status request on VOD mount lost. It hides initial cache mistakes, but it cannot remove the CTA when the stream ends later. The component would need another mechanism to stay correct.

`VideoPage` calling `useStreamByChannel` directly lost. That hook already polls, but its shared `streamChannelDetail` policy keeps prior data during key changes. The page would then own query freshness and route-matching rules that belong with the VOD CTA.

## Open questions and risks

- Does the Twitch `getStreamByLogin` adapter ever return a non-null stream with `isLive: false`? The predicate handles that value as offline, but the implementation test should pin the adapter behavior.
- Does TanStack Query's installed version report `isFetchedAfterMount` as false until an `always` mount refetch settles when a matching VOD-only query remains in cache? Confirm this with a focused hook test before relying on it.
- Is 30 seconds the desired visible-page freshness bound for both platforms? The current shared stream query uses 30 seconds for Twitch and 10 seconds for Kick. Candidate A chooses the cheaper common interval because this CTA is navigation metadata, not playback control.

## Next implementation step

Add `useVodLiveLink` with the VOD-only key and then replace the `channelData?.isLive` gate in `VideoPage` with `liveLinkState.kind === "available"`.

## Verification contract

Add focused page tests for these observable cases.

- A fresh cached `CHANNEL_KEYS.byUsername` value with `isLive: true` and a fresh stream result of `null` never renders **Watch Live**.
- A cached VOD-only live result remains hidden until the mount refetch returns a matching live stream.
- A route switch from channel A to channel B does not render A's CTA after A resolves late. B stays hidden until B's matching result resolves.
- A lookup error keeps the CTA hidden.
- A live result renders the CTA. The next polling result of `null` removes it.

Run the focused `Video.test.tsx` file with fake timers for the polling case. The implementation must also retain the existing offline and live CTA tests.
