# Candidate B. Two-tier Twitch playback routing

## Usage

The player receives one small live-playback model. It does not know how ordered source selection, `$channel` substitution, direct fallback, or custom ad-block suppression work.

```tsx
const playback = useTwitchLivePlayback(channelSlug);

return (
  <TwitchHlsPlayer
    src={playback.url}
    channelName={channelSlug}
    enableAdBlock={playback.enableCustomAdBlock}
    onPlaylistHttpFailure={playback.retryAfterPlaylistFailure}
  />
);
```

The settings page owns only source-list editing and probe presentation. It persists an entire replacement group with one preference update.

```tsx
const { replacement, save, refreshStatuses } = useTwitchPlaylistSources();

await save({
  mode: "source-list",
  sources: move(replacement.sources, sourceId, targetIndex),
});

await refreshStatuses();
```

The existing manual HTTP proxy remains a separate advanced transport setting. A user who wants both turns on the source list for Twitch live playback and configures the transport proxy independently.

```tsx
await updatePreferences({
  proxy: { enabled: true, host: "127.0.0.1", port: 8080, hasCredentials },
});
```

`TwitchHlsPlayer` reports only playlist HTTP failures. Decode errors, media errors, and application cancellation keep their existing recovery paths and do not advance a source.

## Named types

```ts
// shared/twitch-playlist-replacement-types.ts

declare const playlistSourceIdBrand: unique symbol;
export type PlaylistSourceId = string & { readonly [playlistSourceIdBrand]: "PlaylistSourceId" };

export interface TwitchPlaylistSource {
  readonly id: PlaylistSourceId;
  readonly urlTemplate: string;
  readonly enabled: boolean;
  readonly appendPlaybackParameters: boolean;
}

export type TwitchPlaylistReplacement =
  | { readonly mode: "direct"; readonly sources: readonly TwitchPlaylistSource[] }
  | { readonly mode: "source-list"; readonly sources: readonly TwitchPlaylistSource[] };

export type TwitchPlaylistSourceStatus =
  | { readonly kind: "unknown" }
  | { readonly kind: "online"; readonly checkedAt: number }
  | { readonly kind: "offline"; readonly checkedAt: number };

export interface TwitchPlaylistSourceStatusEntry {
  readonly sourceId: PlaylistSourceId;
  readonly status: TwitchPlaylistSourceStatus;
}

export type TwitchLiveRoute =
  | {
      readonly kind: "playlist-source";
      readonly sourceId: PlaylistSourceId;
      readonly url: string;
      readonly enableCustomAdBlock: false;
    }
  | {
      readonly kind: "direct";
      readonly enableCustomAdBlock: boolean;
    };

export interface TwitchLiveRouteCursor {
  readonly attemptedSourceIds: readonly PlaylistSourceId[];
}
```

The array is the ordering authority. `position` does not persist separately because two sources cannot then disagree about their order. `mode: "source-list"` remains meaningful when every source is disabled. That state still suppresses StreamFusion custom ad blocking, then falls back to direct Twitch playback.

The current `UserPreferences.proxy` shape remains unchanged for this migration. It represents a manual, session-wide HTTP transport and is not a `TwitchPlaylistSource` variant. The new durable field is:

```ts
interface UserPreferences {
  // Existing fields.
  proxy: ProxyPreferences;
  twitchPlaylistReplacement: TwitchPlaylistReplacement;
}

export const DEFAULT_TWITCH_PLAYLIST_REPLACEMENT: TwitchPlaylistReplacement = {
  mode: "direct",
  sources: [],
};
```

## Signatures

The pure planner owns source order, fallback, and URL construction. It is the sole place that knows about `$channel` and optional Twitch playlist query parameters.

```ts
// frontend/features/playback/data/twitch-live-route.ts

export function createInitialTwitchLiveRoute(
  replacement: TwitchPlaylistReplacement,
  channelSlug: string,
  customAdBlockEnabled: boolean
): { readonly route: TwitchLiveRoute; readonly cursor: TwitchLiveRouteCursor };

export function createNextTwitchLiveRoute(
  replacement: TwitchPlaylistReplacement,
  channelSlug: string,
  customAdBlockEnabled: boolean,
  cursor: TwitchLiveRouteCursor
): { readonly route: TwitchLiveRoute; readonly cursor: TwitchLiveRouteCursor };

export function buildTwitchPlaylistSourceUrl(
  source: TwitchPlaylistSource,
  channelSlug: string
): string;
```

`createNextTwitchLiveRoute` is total. It tries each enabled source once in persisted array order. It returns `{ kind: "direct" }` after the last enabled source. A direct route has no URL because the existing `useStreamPlayback("twitch", channelSlug)` path owns GQL token resolution and the signed direct URL.

The player-facing hook hides that split source acquisition strategy.

```ts
// frontend/features/playback/data/use-twitch-live-playback.ts

export interface TwitchLivePlayback {
  readonly url: string | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly enableCustomAdBlock: boolean;
  readonly retryAfterPlaylistFailure: () => void;
  readonly reload: () => void;
}

export function useTwitchLivePlayback(channelSlug: string): TwitchLivePlayback;
```

Its pseudocode is intentionally short.

```ts
const route = planner.current();
const directPlayback = useStreamPlayback("twitch", channelSlug, {
  enabled: route.kind === "direct",
});

return route.kind === "playlist-source"
  ? sourcePlayback(route)
  : directPlaybackWith(route.enableCustomAdBlock);
```

`sourcePlayback` means the resolved template URL. It does not create a second HLS engine. `TwitchHlsPlayer` keeps ownership of HLS.js construction and its existing non-ad-block recoveries.

The status probe is a narrow main-owned capability. It accepts domain source records and returns domain statuses. It never exposes raw `/ping` JSON or `Response` objects.

```ts
// shared/ipc-channels.ts
export interface TwitchPlaylistSourceProbeRequest {
  readonly sources: readonly TwitchPlaylistSource[];
}

export interface TwitchPlaylistSourceProbeResult {
  readonly statuses: readonly TwitchPlaylistSourceStatusEntry[];
}

// backend/services/twitch-playlist-source-status-service.ts
export async function probeTwitchPlaylistSources(
  sources: readonly TwitchPlaylistSource[]
): Promise<readonly TwitchPlaylistSourceStatusEntry[]>;

// backend/ipc/handlers/twitch-playlist-source-handlers.ts
export function registerTwitchPlaylistSourceHandlers(): void;
```

At the external boundary, the service derives the ping URL, fetches through an explicit Electron session method, parses untrusted JSON, and accepts only an object with a boolean `online`. Any request, parse, timeout, or schema failure becomes `{ kind: "offline", checkedAt }`. The UI decides when to refresh. Status is ephemeral and never persists in `UserPreferences`.

## Module map

| Module | Ownership | Responsibility |
| --- | --- | --- |
| `shared/twitch-playlist-replacement-types.ts` | Shared foundation | Durable source records, route variants, and probe result contracts. |
| `shared/ipc-channels.ts` | Shared transport contract | One source-status probe request and response. |
| `frontend/features/playback/data/twitch-live-route.ts` | Renderer domain logic | Pure route selection and URL construction. |
| `frontend/features/playback/data/use-twitch-live-playback.ts` | Renderer application flow | Combines planner output with the existing direct playback hook. |
| `frontend/features/settings/data/use-twitch-playlist-sources.ts` | Settings feature | Preference editing and status-query state. |
| `frontend/pages/Settings/index.tsx` | UI | Renders the ordered editor, source status, and the separate transport section. |
| `backend/services/twitch-playlist-source-status-service.ts` | Main adapter | Performs and parses external ping probes. |
| `backend/ipc/handlers/twitch-playlist-source-handlers.ts` | IPC transport | Validates app sender and forwards source probe requests. |
| `backend/preload/index.ts` | Restricted bridge | Exposes `twitchPlaylistSources.probe`. |
| `frontend/features/playback/components/player/twitch/twitch-live-player.tsx` | Player UI | Uses the single playback hook and hides all custom ad-block presentation when `enableCustomAdBlock` is false. |
| `frontend/features/playback/components/player/twitch/twitch-hls-player.tsx` | Player engine | Installs custom loaders only when the passed flag is true. |

Import direction remains renderer UI to renderer data and shared contracts. The renderer never imports Electron. Main IPC calls the status service. The status service owns Electron session access. No new directories are proposed in this candidate, so it needs no ESLint-boundary change.

## Migration

1. Add `twitchPlaylistReplacement` with `{ mode: "direct", sources: [] }` to shared defaults. The existing top-level preference hydration supplies the full new group to older installations.
2. Leave `preferences.proxy` and the encrypted `stream-proxy-credentials` store untouched. Existing manual HTTP proxy users keep their current behavior.
3. Add the source-list settings panel. Seed its sources from the Xtra list only on first hydration when the new group is absent. Persist the seed as normal preferences. Do not seed again after the user deletes all sources.
4. Move the current manual proxy panel under an Advanced transport section. Clarify that it is session-wide and affects more than playlist retrieval.
5. Replace `TwitchLivePlayer`'s current ad-block boolean derivation with `useTwitchLivePlayback`. A `source-list` route always passes `enableCustomAdBlock: false`, so the label, shield control, presentation cover, status subscription, and HLS loaders all disappear through one value.
6. Retain `useAdBlockStore.enableAdBlock`. Direct playback still uses it. Source-list mode overrides it at route construction without mutating the user’s saved preference.

The preference migration is idempotent. Once `twitchPlaylistReplacement` exists, hydration never reseeds it. Saving a reordered list replaces that one top-level preference group atomically through the existing preference update path.

## Fallback behavior

1. `mode: "direct"` starts the existing signed Twitch playback path and may enable the custom ad blocker according to `useAdBlockStore`.
2. `mode: "source-list"` selects the first enabled source, substitutes an encoded channel slug, and optionally adds the three documented playback parameters.
3. An HTTP playlist failure marks that source attempted for the current player lifetime and moves to the next enabled source.
4. After the final enabled source fails, the hook switches to direct playback. Custom ad blocking remains suppressed for that playback generation because replacement mode is still active.
5. A user-triggered reload creates a fresh cursor and retries the enabled sources in order. A route or channel change creates a fresh cursor too.
6. When there are no enabled sources, source-list mode begins at direct Twitch playback with custom ad blocking suppressed. The UI shows this as configuration, not as a failed source.

The manual HTTP proxy changes transport only. It may carry both source-list and direct requests if Chromium sends them through `defaultSession`, but it never participates in source ordering or source health. It is not a fallback candidate.

## Tests

- `tests/shared/auth-types.test.ts` checks default and old-install hydration of `twitchPlaylistReplacement`.
- `tests/frontend/features/playback/data/twitch-live-route.test.ts` checks ordering, disabled entries, template encoding, optional parameter handling, no duplicate retry, final direct fallback, and replacement-mode suppression.
- `tests/frontend/features/playback/data/use-twitch-live-playback.test.tsx` checks source selection, direct lazy fallback, reload cursor reset, and preservation of the saved ad-block preference.
- `tests/components/player/twitch/twitch-live-player-adblock-indicator.test.tsx` checks no label, shield control, or presentation cover in source-list mode, including direct fallback after every source fails.
- `tests/components/player/twitch/twitch-hls-player-adblock-status.test.tsx` checks that source-list mode never constructs custom ad-block loaders.
- `tests/backend/services/twitch-playlist-source-status-service.test.ts` checks `/ping` derivation, explicit-session fetch, JSON parsing, timeout behavior, and malformed responses becoming offline.
- `tests/backend/ipc/handlers/twitch-playlist-source-handlers.test.ts` checks sender-origin rejection and response serialization.
- A real Electron proxy integration test should demonstrate actual egress for both HLS renderer traffic and any main-process fetches that remain relevant. The existing manual-proxy tests only assert `session.setProxy` calls.

## Rationale

### Problem

StreamFusion needs Xtra-style ordered playlist sources that replace custom Twitch ad blocking, yet it already has a credentialed session-wide HTTP proxy. They are different jobs. Playlist sources choose a live HLS URL per stream and have probeable health. The manual proxy changes Chromium transport for a session and authenticates through Electron. Combining them would make source selection own credentials, session state, and traffic scope that it cannot explain to a player.

### Shape

This candidate models ordered playlist sources as a durable array plus one explicit replacement mode. The discriminated `TwitchLiveRoute` makes custom-ad-block state follow the selected route. It prevents the invalid combination of a source-list route with custom ad blocking still active. That applies type-system discipline and model-the-domain. The pure planner owns the cross-file selection rule. The player gets one hook and one boolean instead of coordinating a list, retries, template expansion, and multiple ad-block controls. That reduces reader load.

The probe service parses external data at a single main-process boundary. Its IPC handler retains the existing sender-origin protection. That follows boundary discipline. Source status is derived data, so it does not become a second persisted source of truth. Retry cursors are per player instance and reset on a new user action or channel. This avoids shared mutable source state and makes repeated reloads converge predictably.

The public interface stays small. The player imports one hook. Settings uses one save operation and one status operation. The public contracts do not mention Electron sessions, `Response`, `/ping` JSON, the HLS library, credential storage, or source-position bookkeeping. Those details stay inside their owners.

### Synthesis decision

Pending arena comparison. Candidate B recommends the two-tier shape because it keeps the manual transport proxy out of per-stream source selection and gives the player one replacement decision.

### Tradeoffs accepted

- We accept a new renderer playback hook in exchange for keeping source retries and direct fallback out of player components.
- We accept that source-list mode can reach direct Twitch when every source fails in exchange for a guaranteed final playback path.
- We accept source status as a snapshot, not continuous monitoring, in exchange for no background network loop or stale persisted health.
- We accept an explicit mode separate from per-source enabled flags in exchange for a reliable replacement switch that always suppresses custom ad blocking.
- We accept the current manual proxy’s independent lifetime in exchange for not mixing session-wide credentialed transport with playlist-source configuration.

### Alternatives considered

- A renderer-only playlist list lost because it would need direct external ping fetches, duplicate URL parsing in settings and playback, and an unclear place for trusted network policy. It exposes too much transport detail to callers.
- A single `ProxySource` union containing both playlist URLs and HTTP CONNECT endpoints lost because player fallback would have to understand session mutation, credentials, and app-wide side effects. Its interface is broad while hiding little.
- Removing the manual HTTP proxy lost because it is already persisted and credentialed. Replacing a global transport setting with playlist-only sources would silently remove an existing capability.

### Open questions and risks

- Should the initial Xtra source seed be shipped as a versioned built-in catalog so later releases can offer additions without overwriting user edits?
- Which HLS.js error fields reliably distinguish playlist HTTP failures from media decode failures in the current custom-loader path?
- Does an explicit Electron-session fetch for status probes honor the existing manual HTTP proxy as intended on every supported Electron version?
- Should a source with repeated offline probe results remain eligible for playback, or should status only inform the UI and leave user ordering authoritative?

### Next implementation step

Add the shared replacement types and pure route-planner tests before changing Settings or either Twitch player component.
