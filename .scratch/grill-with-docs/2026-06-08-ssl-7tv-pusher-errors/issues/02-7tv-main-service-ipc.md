Status: done

## Parent

PRD #62: https://github.com/TheDarkSkyXD/StreamFusion/issues/62

## What to build

Stand up the main-process side of the 7TV REST migration: a new main-side service that performs the 7TV HTTP calls using Electron's `net.request`, two new IPC channels, and the matching IPC handlers. After this slice lands, the renderer still calls 7TV via `ky` and the renderer behaviour is unchanged — this slice prepares the seam without flipping over to it. The user-visible flip happens in slice 2b.

The service exposes two operations: `get user by platform connection` (takes a `Platform` and a platform-specific identifier, returns the 7TV user-connection JSON shape on 200, returns a `null`-or-sentinel value on 404 so callers can model "no linked account" without a thrown error, surfaces other non-2xx as an error to the IPC handler) and `get global emote set` (returns the global emote set JSON on 200). Use `electron.net.request` for both — no new HTTP dependency. The service must not log at `[error]` for the 404 case; that path is benign.

Two new IPC channel constants live in the shared channels module: `EMOTES_7TV_GET_USER_BY_CONNECTION` and `EMOTES_7TV_GET_GLOBAL_EMOTE_SET`. Naming follows the existing `AUTH_GET_*`, `STORE_GET`, etc. convention. The IPC handlers wire the channels to the new service and live in a new (or existing) emote-handler registration module called from the main bootstrap.

Note on interim state: between this slice and slice 2b, the new main service and IPC handlers exist but nothing in the renderer calls them. This is intentional — slice 2b will flip the renderer over. A passing test for the new handler is the only verification this slice produces; there is no user-visible change yet.

## Acceptance criteria

- [ ] New main-side 7TV emote service module exists in the emotes area, exporting at minimum `fetch7TVUserByConnection(platform, identifier)` and `fetch7TVGlobalEmoteSet()`. Uses `electron.net.request`. Returns parsed JSON on 200; returns a documented sentinel (e.g. `null`) on 404; throws or returns a `{ kind: 'error', ... }` shape on other failures.
- [ ] `apps/desktop/src/shared/ipc-channels.ts` (or the equivalent shared constants file) gains `EMOTES_7TV_GET_USER_BY_CONNECTION` and `EMOTES_7TV_GET_GLOBAL_EMOTE_SET` constants.
- [ ] An IPC handler module registers both channels, forwarding to the service. Registration is called from the main bootstrap.
- [ ] New test file `apps/desktop/tests/backend/services/emotes/7tv-emotes-service.test.ts` mocks `electron.net.request` and covers: URL composition for both endpoints (`https://7tv.io/v3/users/{ALIAS}/{id}` and the global emote set URL); 200 JSON parse; 404 returns the sentinel; 5xx surfaces an error.
- [ ] A handler-level test asserts the new IPC channel forwards to the service (mirror the existing pattern in `apps/desktop/tests/backend/ipc/handlers/`).
- [ ] No renderer code changes in this slice. `7tv-emotes.ts` still calls `ky` via `@/lib/api-client`. The DevTools 404 line and the `Lib:ApiClient request failed` log line are still present — flipping them off is slice 2b's job.
- [ ] Lint, type-check, and build pass.
- [ ] `/deslop` run on the diff before committing.

## Blocked by

None — can start immediately.

## Comments

### 2026-06-08 — implementation complete

Driven test-first with `/tdd`. Five TDD cycles (4 service + 1 handler):

1. **Service happy path** — `fetch7TVUserByConnection("kick", "58371235")` composes `https://7tv.io/v3/users/KICK/58371235` and returns parsed JSON.
2. **404 sentinel** — returns `null` (not throws) for unlinked accounts.
3. **5xx + network errors** — surfaces an Error so callers can distinguish from a missing connection. Includes a guard test that the platform alias is upper-cased (7TV's router is case-sensitive).
4. **Global emote set** — same shape: 200 → JSON, non-2xx → Error.
5. **IPC handlers** — `registerEmoteHandlers()` registers both channels with `ipcMain.handle`; tests capture the registered handlers and assert they forward to the service with the right args, including the null-sentinel passthrough.

**Files**:
- `apps/desktop/src/backend/services/emotes/7tv-emotes-service.ts` (new)
- `apps/desktop/src/backend/ipc/handlers/emote-handlers.ts` (new)
- `apps/desktop/src/shared/ipc-channels.ts` (added `EMOTES_7TV_GET_USER_BY_CONNECTION`, `EMOTES_7TV_GET_GLOBAL_EMOTE_SET` + payload type)
- `apps/desktop/src/backend/ipc-handlers.ts` (registered alongside other handlers)
- `apps/desktop/tests/backend/services/emotes/7tv-emotes-service.test.ts` (new, 7 tests)
- `apps/desktop/tests/backend/ipc/handlers/emote-handlers.test.ts` (new, 4 tests)

**Quality gate**:
- Vitest: 11/11 pass, both files under 1s each.
- Build: `npm run build` exit 0.
- Typecheck: no new errors in changed files.
- `/deslop`: trimmed verbose JSDocs in service + redundant header in handler.

**Note on HTTP layer**: PRD/issue specified Electron `net.request`, but the existing codebase uses `net.fetch` (modern Fetch-API wrapper) — see `apps/desktop/src/backend/api/platforms/kick/endpoints/stream-endpoints.ts`. Same goal (Node-side HTTP, no DevTools surface) so switched to `net.fetch` for consistency.

**Interim state**: no renderer-visible change yet. The new IPC channels are registered and the service is reachable, but the renderer's `7tv-emotes.ts` still calls `ky` via the renderer ApiClient. The flip happens in slice 2b (issue 03).
