# Proxy ad-block replacement grounding

## User outcome

- Port Xtra's newer proxy-source behavior from `reference/Xtra For-Twitch-Better-Functions-etc-master`.
- Proxy mode replaces StreamFusion's custom Twitch ad blocker.
- Enabling proxy mode must disable every custom-ad-block code path and suppress its `Blocking ads` label, shield control, and presentation cover.
- Settings must show an ordered, editable proxy list with per-source status like Xtra.

## Xtra facts

- `CustomProxy` is `{ url, addQueryParams, position, enabled }`.
- Xtra seeds 12 playlist proxy URLs in `MainViewModel.updateProxies`.
- The settings list supports enable, edit, delete, ordering, and status.
- Status probes replace the URL path with `/ping`; any JSON `online` boolean means reachable.
- Playback substitutes `$channel`, optionally adds `allow_source=true`, `allow_audio_only=true`, and `fast_bread=true`, then loads the proxy playlist directly.
- It selects enabled sources by position and advances after HTTP playback failures. Direct Twitch is the final fallback.
- Xtra's separate `StreamProxy` HTTP CONNECT list has no Online/Offline probe. StreamFusion already has one manual session-wide HTTP proxy with encrypted credentials.

## StreamFusion facts

- `/settings` lives in `apps/desktop/src/frontend/pages/Settings/index.tsx`.
- Proxy preferences are currently a single `{ enabled, host, port, hasCredentials }` group in `apps/desktop/src/shared/auth-types.ts`.
- The existing proxy IPC and `stream-proxy-service.ts` apply a session-wide Electron proxy. Main-process global `fetch` coverage is unproven.
- Twitch live playback flows through `TwitchLivePlayer` and `TwitchHlsPlayer`.
- `TwitchLivePlayer` derives `effectiveEnableAdBlock`, owns the visible `Blocking ads` label and custom presentation cover, and passes ad-block status into controls.
- `TwitchHlsPlayer` installs the custom HLS loaders only when `enableAdBlock` is true.
- `useAdBlockStore` is persisted local user preference. Preserve the preference while proxy replacement mode is active rather than destroying it.
- `useAuthStore.preferences` owns durable settings from Electron storage.

## Required boundaries

- UI only renders and collects intentions.
- New durable proxy-source types belong in shared preferences.
- External `/ping` data is parsed at its boundary.
- Renderer must not import Electron or Node.
- Prefer a pure URL resolver and an explicit playback mode over scattered booleans.
- Do not expose the custom ad-block label or status when proxy mode is active.
- Preserve unrelated dirty working-tree changes.

## Closest tests

- `apps/desktop/tests/pages/Settings.test.tsx`
- `apps/desktop/tests/components/player/twitch/twitch-live-player-adblock-indicator.test.tsx`
- `apps/desktop/tests/components/player/twitch/twitch-hls-player-adblock-status.test.tsx`
- `apps/desktop/tests/backend/services/stream-proxy-service.test.ts`
- `apps/desktop/tests/backend/ipc/handlers/proxy-handlers.test.ts`

## Design question

Choose a shape that delivers the playlist proxy source list and replacement playback with the smallest coherent public interface. Decide whether the existing manual HTTP proxy stays as a separate advanced transport, is represented as a second source variant, or is removed. The chosen design must explain migration and fallback behavior.
