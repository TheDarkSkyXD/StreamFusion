# Twitch playlist proxy synthesis

## Decision

Use Candidate B as the migration-safe base and keep StreamFusion's existing authenticated session transport proxy as an Advanced setting. Add Xtra's ordered Twitch playlist-source proxy as a separate replacement mode.

## Grafts

- Keep the retry cursor private to each `TwitchHlsPlayer` instance so concurrent players fail over independently.
- Resolve `$channel`, Xtra query parameters, and `/ping` through one pure utility.
- Try enabled sources once in list order, then fall back to direct Twitch while the replacement mode remains active.
- Suppress every custom-ad-block surface immediately while replacement mode is active, including loaders, observers, labels, controls, and an already-visible presentation cover.
- Probe source status in the renderer. The probes are advisory UI state, and the project already intentionally permits renderer network access.

## Rejections

- Do not remove the current credentialed transport proxy. Playlist routing does not replace its broader transport use case.
- Do not expose retry bookkeeping to pages or add proxy-mode props to every player caller. The HLS player is the deepest common owner, including the featured preview.
- Do not add main/preload IPC only for status probes. It would widen the process boundary without adding security in the current renderer configuration.
- Do not persist health status. It is time-sensitive external state and must be refreshed.

## Verification sketch

- Pure tests cover defaults, normalization, templating, query idempotence, ping resolution, ordering, and direct fallback.
- Player tests cover HTTP-only failover, independent instances, and custom-ad-block suppression during proxy mode.
- Settings tests cover list status states, enablement, editing, deletion, ordering, and restoration.
- Existing transport-proxy tests remain unchanged and green.
