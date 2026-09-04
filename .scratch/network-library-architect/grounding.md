# Network library setting grounding

## User outcome

Add the useful desktop equivalent of Xtra's root Settings `Network library` control. Do not duplicate StreamFusion's existing API / Tokens or Proxy panels.

## Current Xtra behavior

- Xtra persists one of `HttpEngine | Cronet | OkHttp`, default `OkHttp`.
- Availability is device-filtered.
- The choice affects OAuth, Helix/GQL, images, and ExoPlayer HTTP loads, but not Java-socket WebSockets.
- Evidence is recorded in `docs/research/2026-09-02-xtra-network-api-proxy-settings.md`.

## Current StreamFusion behavior

- Renderer fetch, HLS media, `electron.net.fetch`, and `Session.fetch` use Chromium networking.
- Some main-process requests still use Node global `fetch`, including `http-client.ts` and parts of `twitch-manifest-proxy.ts`.
- `session.defaultSession.setProxy` only covers Chromium requests in that session. Existing Settings copy currently overstates coverage for Node global fetch paths.
- API / Tokens is already implemented as metadata-only validation. Raw tokens must not cross the preload boundary.
- HTTP proxy is already implemented with safeStorage credentials, origin-checked IPC, startup application, and a single default-session endpoint.

## Constraints

- A selectable value must change real behavior and state its scope honestly.
- Default behavior must preserve current successful playback and authentication.
- Proxy-enabled traffic must not silently bypass the configured proxy.
- Renderer HLS and WebSockets cannot be swapped to Node fetch by a main-process preference.
- Do not add Android-only library names or dependencies to Electron.
- Prefer one deep request boundary over per-call branching.
- Keep raw tokens and proxy credentials main-owned.
- The resulting design must be testable without public services.

## Candidate artifact

Produce a design package with caller-first usage, named data shape, function signatures, module map, rollout/migration sequence, tests, rationale, alternatives, and risks. No product-code edits.

## Rubric

1. The Settings choice has at least two meaningful desktop behaviors or explicitly proves why a selector cannot yet ship.
2. The design accurately covers named request classes and never claims control of fixed Chromium HLS/WebSocket paths.
3. The existing session proxy remains effective and cannot be silently bypassed by the selected transport.
4. Token and credential security boundaries remain intact.
5. The migration is incremental, defaults safely, and has deterministic tests for routing and fallback.
6. The public interface is small and hides transport selection rather than spreading preference branches across callers.
