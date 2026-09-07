# Playback extraction review — 2026-09-06

Scope: `hls-playback-session.ts`, `twitch-hls-session.ts`, the HLS wrappers, playback capabilities, and Electron playback source. Compared the current sessions with the HEAD wrapper implementations saved in `.scratch/review-head-*.tsx`.

## Result

No extraction regression found.

- The generic session preserves source reuse (`detachMedia`, `loadSource`, `attachMedia`) for live playback and retains the mount-only destroy path. Its VOD cleanup remains fresh-instance behavior.
- The generic input fragment watchdog remains in `HlsPlayer`; the shared decoder-output stall recovery remains in `useLivePlaybackStallRecovery`. Both are still wired to the same HLS ref and cleanup state.
- Both sessions preserve stale async work protection: effect-local active flags plus `playRequestIdRef`; Twitch also clears managed timeout actions and increments its request id on cleanup.
- Twitch retains HLS release, media listener removal, memory-cleanup cancellation, ad-block recovery cleanup, presentation-generation invalidation, shielding, and clean-frame reveal behavior.
- All capability modules are free of adapter/component/composition imports. The reviewed sessions do not import components or composition; the Electron source implements only the capability.
- The reused generic HLS session removes the same event set before re-registering it as HEAD. Its omission of `LEVEL_SWITCHED` was already present in HEAD, so it is not an extraction regression.

## Evidence

- `npm exec vitest run` on HLS player, stall watchdog, source-reuse, and Twitch ad-block-status tests: 4 files, 65 tests passed.
- Scoped normal ESLint on the two sessions, Electron source, three capabilities, and both wrappers passed.