# Candidate A: the HLS player owns the source ladder

## Usage

Callers ask for one Twitch playback request. They do not select a proxy, inspect hosts, or coordinate fallback.

```tsx
const request = useTwitchPlaybackRequest(channelName);

<TwitchLivePlayer
  request={request}
  poster={poster}
  autoPlay
  onError={handleTerminalPlaybackError}
/>
```

The main page, mini-player, and each multistream slot use this shape. Each mounted player gets its own attempt cursor. Settings dispatch intentions to one hook, which persists ordered snapshots and probes status.

```tsx
const proxySettings = useTwitchProxySettings();

<ProxySourceList {...proxySettings.view} dispatch={proxySettings.dispatch} />
```

## Named data types

Durable types live in `shared/auth-types.ts`. Array order is authoritative. There is no `position` field to drift from the array.

```ts
export interface TwitchProxyPreferences {
  enabled: boolean;
  sources: TwitchProxySourcePreference[];
}
export interface TwitchProxySourcePreference {
  id: string;
  urlTemplate: string;
  addQueryParams: boolean;
  enabled: boolean;
}
export interface UserPreferences {
  // existing groups
  proxy: TwitchProxyPreferences;
}
```

Renderer playback types encode the three legal policies. Proxy replacement remains active after the ladder reaches direct Twitch, so the custom ad blocker cannot turn back on during fallback.

```ts
export type TwitchPlaybackMode =
  | { kind: "proxy-replacement"; sources: readonly ResolvedProxySource[] }
  | { kind: "custom-ad-block" }
  | { kind: "direct" };
export interface ResolvedProxySource {
  id: string;
  url: string;
}
export interface TwitchPlaybackRequest {
  channelName: string;
  mode: TwitchPlaybackMode;
  revision: number;
  resolveDirect: () => Promise<string>;
}
type PlaybackAttempt =
  | { kind: "proxy"; source: ResolvedProxySource }
  | { kind: "direct" };

export type ProxySourceStatus =
  | { kind: "checking" }
  | { kind: "online"; checkedAt: number }
  | { kind: "offline"; checkedAt: number };

export type ProxySettingsCommand =
  | { kind: "set-enabled"; enabled: boolean }
  | { kind: "add"; source: TwitchProxySourcePreference }
  | { kind: "edit"; id: string; changes: Pick<TwitchProxySourcePreference, "urlTemplate" | "addQueryParams"> }
  | { kind: "set-source-enabled"; id: string; enabled: boolean }
  | { kind: "move" | "delete" | "probe"; id: string; toIndex?: number };
```

## Signatures

```ts
export function resolveTwitchPlaybackMode(input: {
  proxy: TwitchProxyPreferences;
  customAdBlockEnabled: boolean;
  channelName: string;
}): TwitchPlaybackMode;
export function resolveProxyPlaylistUrl(
  source: TwitchProxySourcePreference,
  channelName: string
): ResolvedProxySource;
export function buildPlaybackAttempts(mode: TwitchPlaybackMode): readonly PlaybackAttempt[];

export function buildProxyPingUrl(urlTemplate: string): string;
export function parseProxyPing(payload: unknown): boolean;

export function useTwitchPlaybackRequest(channelName: string): TwitchPlaybackRequest;

export function useTwitchProxySettings(): {
  view: { enabled: boolean; sources: readonly ProxySourceRow[] };
  dispatch: (command: ProxySettingsCommand) => void;
};

export interface TwitchLivePlayerProps {
  request: TwitchPlaybackRequest;
  // existing presentation props, with streamUrl and enableAdBlock removed
}

export interface TwitchHlsPlayerProps {
  request: TwitchPlaybackRequest;
  // existing HLS and video callbacks, with src and enableAdBlock removed
}
```

`resolveProxyPlaylistUrl` adds `https://` when the template has no scheme, replaces `$channel`, and adds missing `allow_source=true`, `allow_audio_only=true`, and `fast_bread=true` only when `addQueryParams` is true. URL parsing rejects non-HTTP schemes and missing `$channel` during preference hydration.

`buildProxyPingUrl` replaces the path with `/ping` and clears the query and hash. `parseProxyPing` returns true when decoded JSON is an object with an `online` boolean. The boolean's value does not matter, matching Xtra. Network failure, timeout, or invalid JSON means offline.

## Module map

```text
shared/auth-types.ts
  Durable proxy preferences and the 12 seeded sources.
backend/services/storage-service.ts
  Hydrates and validates the new proxy group. Migrates the removed transport proxy.
frontend/features/settings/data/use-twitch-proxy-settings.ts
  Owns the settings reducer, whole-list persistence, status probes, and stale-result cancellation.
frontend/features/playback/utils/twitch-proxy-source.ts
  Pure template parsing, URL resolution, ping URL construction, and ping parsing.
frontend/features/playback/data/use-twitch-playback-request.ts
  Derives the explicit mode and supplies the cached direct-Twitch resolver.
frontend/features/playback/components/player/twitch/twitch-live-player.tsx
  Renders custom-ad-block presentation only for mode `custom-ad-block`.
frontend/features/playback/components/player/twitch/twitch-hls-player.tsx
  Owns the ordered attempt cursor, HLS reconstruction, HTTP failover, and final direct attempt.
```

The removed modules are `stream-proxy-service.ts`, `proxy-handlers.ts`, their IPC channels and preload methods, and the credential form. The main process no longer changes `session.defaultSession`, so proxy mode cannot affect chat, sign-in, Kick, or unrelated traffic.

## Migration

1. Change `UserPreferences.proxy` from `{ enabled, host, port, hasCredentials }` to `TwitchProxyPreferences`.
2. At hydration, detect the legacy group by `host` or `port`. Replace it with `{ enabled: false, sources: DEFAULT_TWITCH_PROXY_SOURCES }`. A transport host cannot be converted into a playlist URL template without inventing semantics.
3. Seed the 12 Xtra sources only when the new group is absent or legacy. Preserve an intentionally empty new list.
4. Remove startup `session.setProxy` application, proxy IPC, preload methods, hostname heuristics in `useStreamPlayback`, and `retryWithoutProxy`.
5. Clear the dedicated encrypted credential store in the storage migration. Record a migration version so cleanup is idempotent.
6. Keep the persisted `useAdBlockStore.enableAdBlock` value. Proxy mode overrides it only in the derived `TwitchPlaybackMode`.
7. Make `request` mandatory on both Twitch player components. The compiler then finds every main page, mini-player, multistream, story, and test caller that must migrate.

No compatibility adapter remains after this migration. Internal callers move in one wave, per `principle-migrate-callers-then-delete-legacy-apis`.

## Fallback behavior

For proxy replacement mode, `TwitchHlsPlayer` builds this per-instance ladder:

```text
enabled source 1 -> enabled source 2 -> ... -> direct Twitch
```

The player loads the first proxy immediately. It resolves direct Twitch lazily only when the ladder reaches the final attempt. A terminal HLS HTTP response of 400 or higher while a proxy attempt is active destroys that HLS instance, advances once, and constructs a new instance. The intermediate failure never escapes to page-level recovery.

Non-HTTP failures use the existing HLS recovery rules and do not consume a source. HTTP failure on the direct attempt follows the normal token-expired, offline, and terminal error flow. Manual refresh resets the cursor to the first enabled source. A channel or preference revision change also resets it.

Each player owns its cursor. One failed multistream slot cannot advance another slot or mutate durable source order. The source list is policy. Runtime failures are session state.

When proxy mode is enabled with zero enabled sources, the ladder contains direct Twitch only, but the mode remains `proxy-replacement`. The custom loaders, DOM observer, ad status subscription, fallback overlay, `Blocking ads` label, shield control, muted-opacity shield, and presentation covers all stay off. Turning proxy mode off restores the saved custom-ad-block preference.

## Tests

- Pure URL tests cover scheme insertion, `$channel` substitution, existing query parameters, idempotent Xtra parameters, invalid schemes, `/ping`, and the `online: false` compatibility rule.
- Storage tests cover legacy transport replacement, 12-source seeding, preservation of an empty new list, invalid-source removal, and idempotent credential cleanup.
- Settings tests cover enable, edit, delete, reorder, source toggle, stable IDs, whole-list persistence, checking, online, offline, and stale probe cancellation.
- `TwitchHlsPlayer` tests cover ordered proxy attempts, disabled-source omission, HTTP-only advancement, lazy direct resolution, direct final fallback, cursor reset, and isolated cursors across two players.
- `TwitchLivePlayer` tests assert that proxy replacement never mounts any custom-ad-block presentation or reports custom status, including during direct fallback.
- Existing ad-block tests remain for mode `custom-ad-block`; session proxy tests are deleted. Touched tests update their `// Guards:` lines.

## Rationale

The HLS player is the only module that sees authoritative playlist and fragment HTTP failures. Keeping fallback there removes the current page-level hostname guess and the non-functional `forceNoProxy` flag. Callers learn one request interface, while the module hides template resolution, attempt order, HLS teardown, lazy direct resolution, and custom-ad-block exclusion. That is a deep interface.

The explicit mode makes the illegal state "proxy replacement plus custom loaders" unrepresentable, per `principle-model-the-domain` and `principle-type-system-discipline`. Parsing templates and `/ping` JSON at entry points follows `principle-boundary-discipline`. Per-player cursors prevent shared mutable failover state. Whole-list preference writes and versioned credential cleanup converge when repeated, per `principle-make-operations-idempotent`.

This shape removes the transport proxy before adding playlist behavior, per `principle-subtract-before-you-add`. It also removes pass-through IPC and page-level fallback coordination, per `principle-laziness-protocol` and `principle-minimize-reader-load`.

## Tradeoffs accepted

- We accept HLS-specific policy inside `TwitchHlsPlayer` in exchange for making the module that observes failures own recovery.
- We accept per-player source cursors in exchange for isolation between multistream slots.
- We accept dropping the legacy transport configuration in exchange for one honest proxy concept.
- We accept lazy direct resolution during the last transition in exchange for starting proxy playback without first calling Twitch's token resolver.

## Alternatives considered

A main-process manager lost because it adds IPC around renderer HLS events. `useStreamPlayback` fallback lost because the hook cannot observe playlist and fragment failures. Keeping the transport proxy lost because it preserves two unrelated proxy concepts and session-wide side effects.

## Risks

- Do all supported HLS.js failures expose a reliable status, and do segment-only failures require a cooldown? Preference changes restart playback immediately in this candidate.
