# Candidate C. Playlist sources owned by the HLS player

## Problem

Replace the session-wide Electron HTTP proxy with an ordered list of Twitch playlist proxy URLs. The list must not leak into IPC or the ad-block loader. `TwitchHlsPlayer` already owns the live HLS lifecycle, so it should also own URL resolution, source advancement, and the final direct fallback.

## Caller usage

`TwitchLivePlayer` decides the playback mode once. A proxy-enabled preference suppresses legacy ad blocking even when `useAdBlockStore` remains enabled.

```ts
const playbackMode: TwitchPlaybackMode = preferences.playlistProxy.enabled
  ? { kind: "playlist-proxy", sources: preferences.playlistProxy.sources }
  : { kind: "legacy-adblock", enabled: useAdBlockStore.getState().enableAdBlock };

<TwitchHlsPlayer
  channelName={channelName}
  directStreamUrl={streamUrl}
  playbackMode={playbackMode}
  {...playerProps}
/>
```

`TwitchLivePlayer` uses `playbackMode.kind === "legacy-adblock"` as the only condition for the legacy label, shield control, presentation cover, observer, and `enableAdBlock` behavior. It never selects a playlist URL.

## Shape

```ts
// shared/auth-types.ts
export interface PlaylistProxySource {
  id: string;
  urlTemplate: string;
  enabled: boolean;
  addQueryParameters: boolean;
}

export interface PlaylistProxyPreferences {
  enabled: boolean;
  sources: PlaylistProxySource[];
}

export type TwitchPlaybackMode =
  | { kind: "playlist-proxy"; sources: readonly PlaylistProxySource[] }
  | { kind: "legacy-adblock"; enabled: boolean };

export type PlaylistProxyStatus = "checking" | "reachable" | "unreachable";

// frontend/features/playback/components/player/twitch/playlist-proxy.ts
export function resolvePlaylistProxyUrl(
  source: PlaylistProxySource,
  channelName: string,
): string | null;

export function probePlaylistProxy(
  source: PlaylistProxySource,
  signal: AbortSignal,
): Promise<PlaylistProxyStatus>;
```

The persisted list order is the source priority. `position` is deliberately absent. Array order cannot drift from the order the settings editor renders. Each source owns the URL template, enabled state, and query-parameter policy. The preference owns only the global mode switch and its ordered sources.

`resolvePlaylistProxyUrl` is pure. It rejects malformed URLs, replaces `$channel`, and, when requested, appends only missing `allow_source=true`, `allow_audio_only=true`, and `fast_bread=true` values. It returns `null` for an unusable source.

`probePlaylistProxy` replaces the template path with `/ping`, uses renderer `fetch`, parses JSON at that boundary, and returns `reachable` when `online` is any JSON Boolean. This matches Xtra's handling of `as.luminous.dev`. Status is transient UI state. It never changes source ordering, `enabled`, or playback selection.

`TwitchHlsPlayer` receives `TwitchPlaybackMode`, filters enabled resolvable sources internally, and starts index zero. On a fatal playlist-proxy HLS network error, it advances one index, destroys that HLS instance, and starts the next source. After the last source, it creates the normal direct `directStreamUrl` player. It makes one forward pass only. A direct-stream error stays on the existing direct error path.

When `playbackMode.kind` is `"playlist-proxy"`, `TwitchHlsPlayer` does not initialize the VAFT service, custom HLS loaders, ad-block callbacks, presentation shielding, or ad-block recovery watchdog. The mode type makes this a single branch at player setup rather than a cluster of proxy booleans.

## Module map

| Path | Ownership |
| --- | --- |
| `apps/desktop/src/shared/auth-types.ts` | `PlaylistProxySource`, `PlaylistProxyPreferences`, defaults, and the twelve Xtra seed URLs. |
| `apps/desktop/src/frontend/features/playback/components/player/twitch/playlist-proxy.ts` | URL resolution and `/ping` response parsing. No React or Electron imports. |
| `apps/desktop/src/frontend/features/playback/components/player/twitch/twitch-hls-player.tsx` | Local active-source index, HLS restart, direct fallback, and legacy-loader exclusion. |
| `apps/desktop/src/frontend/features/playback/components/player/twitch/twitch-live-player.tsx` | Builds `TwitchPlaybackMode` and hides all legacy ad-block presentation while proxy mode is active. |
| `apps/desktop/src/frontend/pages/Settings/index.tsx` | Ordered source editor, add, edit, remove, enable, drag reorder, and transient row status. |
| existing preferences storage | Persists `playlistProxy` through the existing preferences path. No dedicated proxy bridge is added. |

`DEFAULT_PLAYLIST_PROXY_SOURCES` contains the Xtra seed templates, all initially enabled. They are `eu.luminous.dev`, `eu2.luminous.dev`, `eu3.luminous.dev`, `as.luminous.dev`, `lb-eu`, `lb-eu2`, `lb-eu3`, `lb-eu4`, and `lb-eu5` under `cdn-perfprod.com`, plus `lb-na`, `lb-sa`, and `lb-as`. The final three have `addQueryParameters: false`. `playlistProxy.enabled` defaults to false because these URLs send playback to third parties.

## Migration and deletion

1. Add `playlistProxy` to `UserPreferences` with the seed list. The normal preferences migration preserves users' `useAdBlockStore.enableAdBlock` value unchanged.
2. Remove `ProxyPreferences`, `DEFAULT_PROXY_PREFERENCES`, and the old `preferences.proxy` card fields. Do not map a host and port into a playlist source. They describe a different transport.
3. Delete `stream-proxy-service.ts`, `proxy-handlers.ts`, proxy IPC constants and payloads, preload methods, Electron API declarations, proxy startup application, and their tests.
4. Add one startup storage migration that deletes the old encrypted `stream-proxy-credentials` record and the obsolete `preferences.proxy` group. The new app never calls `session.setProxy`, so a new Electron session starts direct.
5. Keep `useAdBlockStore` and its persisted value. Proxy mode masks it at playback time. Turning proxy mode off restores the saved legacy choice.

## Settings behavior

The Proxy page becomes "Playlist proxy sources." Its master switch controls proxy mode. Each row shows the source host, a transient Loading, Online, or Offline state, enable switch, edit action, delete action, and drag handle. Editing exposes the URL template and the add-query-parameters switch. Initial mount and a source edit trigger `/ping` probes. The UI does not disable an Offline source or reorder it.

## Tests

- Unit-test `resolvePlaylistProxyUrl` for `$channel`, missing query parameters, existing parameters, malformed templates, and disabled sources.
- Unit-test `probePlaylistProxy` for `online: true`, `online: false`, malformed JSON, timeout, and network failure.
- Extend `twitch-hls-player-adblock-status.test.tsx` to prove proxy mode installs no VAFT loader, shield, recovery callback, or ad-block status.
- Add a player test that proves source A then source B then direct Twitch are loaded after fatal failures, with no retry after direct fallback.
- Extend `Settings.test.tsx` for source ordering, row status display, and persistence through the existing preferences save.
- Remove `stream-proxy-service.test.ts` and `proxy-handlers.test.ts` with the deleted feature.

## Tradeoffs

- We accept browser-visible playlist source URLs in exchange for no privileged transport or IPC surface. Source URLs are not credentials.
- We accept a linear first-failure fallback in exchange for deterministic ordering. Reachability probes remain presentation, not routing policy.
- We accept retaining the legacy ad-block implementation while proxy mode is off in exchange for preserving each user's existing setting and a reversible rollout.
- We reject treating the old HTTP proxy as a second source variant. Its session-wide Electron behavior has different credentials, scope, and failure semantics.

## Next implementation step

Add the shared preference types and pure `playlist-proxy.ts` tests first, then move the HLS player to `TwitchPlaybackMode` before replacing the settings UI.
