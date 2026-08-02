---
concept: twitch-live-offline-authority
summary: Touch Twitch status, StreamPage gating, playback identity, or watchdog recovery and stale route data can keep an expired HLS player alive or suppress the current channel. Preserve current-route Twitch authority, identity-scoped playback, and asynchronous watchdog outcomes; skip for VOD or controls that never affect live status.
files:
  - { path: apps/desktop/src/pages/Stream/index.tsx, role: owns live status authority offline rendering and recovery }
  - { path: apps/desktop/src/hooks/queries/useStreams.ts, role: defines the nullable polled stream status contract }
  - { path: apps/desktop/src/hooks/useStreamPlayback.ts, role: prevents playback state from leaking across route identities }
  - { path: apps/desktop/src/components/player/twitch/twitch-hls-player.tsx, role: emits offline signals when Twitch manifests expire }
  - { path: apps/desktop/tests/pages/Stream.test.tsx, role: guards live to offline transitions and Check Again recovery }
---

# twitch-live-offline-authority

## Load this concept when

- Changing how `StreamPage` decides whether Twitch is live or whether its player should mount.
- Changing `useStreamByChannel` caching, placeholder behavior, or nullable response semantics.
- Changing playback state resets when the platform or channel route changes.
- Changing Twitch HLS offline detection, retry handling, or the offline screen's **Check Again** action.

## The scar

`useStreamByChannel` polls live status every 30 seconds, while channel metadata can keep
`isLive: true` for much longer. The page once combined both values with an OR. When Twitch
returned a successful `null` after a broadcast ended, the stale channel flag won and left the
old player mounted.

The paused player still held an expired HLS manifest. Pressing Play restarted HLS.js against
dead playlist and segment URLs, producing repeated Twitch CDN 403 and 404 responses instead of
showing the offline screen.

Those HLS failures were a consequence, not the source of truth. Treating every manifest failure
as proof of offline would misclassify transient token, CDN, or ad-block recovery failures.

## Rules that prevent a repeat

1. A successful non-placeholder Twitch stream query is authoritative only when its stream
   matches the current route, or when the result is `null`. Current-route `null` means offline;
   a matching stream is live only when its explicit `isLive` field is true.
2. Do not infer Twitch live status from `startedAt`. That field is nullable even when live
   status is known.
3. Placeholder data remains pending and is never authoritative. Successful data for another
   route is a retryable status mismatch, not evidence for the current channel. A failed status
   query is also not proof of offline; preserve valid current-route live evidence during a
   transient refresh and show a retryable status error when no such evidence remains.
4. Playback state is scoped to the current `platform:identifier` identity. On a route change,
   mask the previous URL, error, proxy flag, revision, and reload count synchronously instead of
   waiting for an effect to reset them.
5. Use the same derived live-status value for both playback URL resolution and player/offline
   rendering. Updating only the JSX can hide the player while stale HLS resolution continues.
6. Keep Twitch authority Twitch-specific. Kick `null` is ambiguous when upstream status
   sources degrade. For Kick, valid playback wins stale channel-only offline metadata; show
   offline only from settled, route-matched offline evidence with no contradictory valid player.

## Watchdog recovery

An HLS watchdog signal is a hint to verify status, not immediate offline authority. For each
playback revision, allow one asynchronous Twitch stream-status refetch and suppress duplicate
signals while it is unresolved.

- A matching live result reloads playback once so the player remounts with a fresh source.
- A successful `null` result follows normal authority and transitions to the offline screen.
- An errored refetch preserves the existing evidence and clears the attempt gate so a later
  watchdog signal can try again.

## Offline recovery

**Check Again** must refetch channel and stream metadata. It must not directly reload playback
while the Twitch playback identifier is intentionally empty. Doing so dismissed the offline
screen and left a permanent loading spinner with no video element.

Keep the offline screen mounted during that metadata refresh. If the refreshed status becomes
live, the existing offline-to-live transition reloads playback with a valid channel identifier.

## Regression seam

The page test must model a mounted live Twitch player followed by a successful stream result of
`null` while cached channel metadata still says live. It should prove all of these outcomes:

- playback resolution receives an empty Twitch identifier;
- the live player unmounts;
- the offline screen appears;
- **Check Again** refetches both metadata queries;
- playback reload is not called while status remains offline.

Also guard rapid route changes and each asynchronous watchdog outcome: matching live reloads
once, `null` renders offline, and an error releases the gate without declaring offline.
