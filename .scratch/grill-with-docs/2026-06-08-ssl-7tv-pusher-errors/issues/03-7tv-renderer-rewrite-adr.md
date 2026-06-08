Status: ready-for-agent

## Parent

PRD #62: https://github.com/TheDarkSkyXD/StreamFusion/issues/62

## What to build

Flip the renderer-side 7TV emote provider over from `ky`-via-browser-fetch to the main-process IPC seam introduced in slice 2a. After this slice lands, the renderer no longer issues any direct HTTP call to `7tv.io`, so Chromium's DevTools Network panel stops surfacing the red `Failed to load resource: ... 404` line for the 7TV user endpoint, and the `Lib:ApiClient request failed` `[error]` log line stops firing for that call.

The work has three parts:

1. Expose the new IPC channels on the preload `electronAPI` surface as `electronAPI.emotes.get7TVUserByConnection(platform, identifier)` and `electronAPI.emotes.get7TVGlobalEmoteSet()`. Add the type declarations in the shared electron-api-types module.

2. Rewrite `apps/desktop/src/backend/services/emotes/7tv-emotes.ts` (despite the folder name, this module runs in the renderer — its own header comment documents that) to use `electronAPI.emotes.*` instead of `api.get(...).json()`. The 404 path treats the sentinel returned by the main service as "no linked account" and returns `[]` after logging at `info` (mirroring today's behaviour, minus the `[error]` line from ApiClient). The transform from 7TV JSON to internal `Emote` stays in the renderer.

3. Migrate `apps/desktop/tests/backend/services/emotes/7tv-emotes.test.ts` from ky/nock mocks to `electronAPI.emotes.*` mocks. The test must still cover: 200 returns transformed emotes; 404 returns `[]` with no `[error]` log; network failure returns `[]` with a `warn` log.

Also write `docs/adr/0004-7tv-rest-in-main-process.md`. The ADR documents the architectural decision (main + IPC vs renderer fetch vs preload-only) and the rationale: DevTools cannot see main-process Electron `net` traffic; the codebase already has a strong IPC pattern; preload should stay thin; KickTalk validates this pattern. Follow the format established by `0001-do-not-split-twitch-adblock-service.md`, `0002-platform-health-tracker.md`, and `0003-webcontentsview-per-stream-slot.md`.

## Acceptance criteria

- [ ] `electronAPI.emotes.get7TVUserByConnection` and `electronAPI.emotes.get7TVGlobalEmoteSet` exist on the preload surface with correct typings in the shared electron-api-types module.
- [ ] Renderer-side `7tv-emotes.ts` no longer imports `@/lib/api-client`. Its 7TV calls go through `electronAPI.emotes.*`.
- [ ] The 404 path is the sentinel from slice 2a (not a thrown exception), so the renderer never hits ApiClient's `afterResponse` `[error]` hook for that case.
- [ ] `apps/desktop/tests/backend/services/emotes/7tv-emotes.test.ts` no longer mocks `ky`; it mocks `electronAPI.emotes.*` and asserts the observable behaviour: 200 returns transformed emotes; 404 returns `[]` with no error log; network failure returns `[]` and logs at `warn`.
- [ ] `docs/adr/0004-7tv-rest-in-main-process.md` exists and follows the project's ADR format. Captures the decision drivers listed in PRD #62 implementation decision A.
- [ ] Manual verification with a Kick channel that has no linked 7TV account: DevTools Network panel shows zero red `404` entries for the 7TV user endpoint when the channel loads; session log shows zero `Lib:ApiClient request failed` lines for that URL.
- [ ] Lint, type-check, and build pass.
- [ ] `/deslop` run on the diff before committing.

## Blocked by

Slice 2a: `.scratch/grill-with-docs/2026-06-08-ssl-7tv-pusher-errors/issues/02-7tv-main-service-ipc.md` (the IPC channels and main-side service must exist before this slice can call them).

## Comments
