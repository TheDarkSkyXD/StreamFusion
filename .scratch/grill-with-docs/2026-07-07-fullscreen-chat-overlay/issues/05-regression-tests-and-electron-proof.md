Status: done
Type: AFK
Blocked by: 01-render-fullscreen-chat-rail.md, 02-toggle-fullscreen-chat-from-player-controls.md, 03-close-fullscreen-chat-from-chat-header.md, 04-respect-preferences-and-narrow-viewports.md

# Regression Tests And Electron Proof

## Parent

../prd.md

## What to build

Prove the `Fullscreen Chat Rail` behavior with code-level regression coverage and running-app visual verification. Extend existing Stream page/player/chat tests where practical, then verify the desktop app using Electron MCP only.

## Acceptance criteria

- [x] Unit/component tests cover fullscreen chat default visibility, toggle behavior, global hidden preference behavior, narrow viewport behavior, and header `X` behavior.
- [x] Lint, type-check, and build pass.
- [x] The running StreamFusion desktop app is visually verified with Electron MCP only.
- [x] Verification evidence is recorded under `.scratch/` using the project's scratch hygiene rules.

## Blocked by

- 01-render-fullscreen-chat-rail.md
- 02-toggle-fullscreen-chat-from-player-controls.md
- 03-close-fullscreen-chat-from-chat-header.md
- 04-respect-preferences-and-narrow-viewports.md

## Comments

- Closed 2026-07-07: focused tests passed for `Stream`, player controls, `ChatPanel`, `KickChat`, and `TwitchChat`; `npm run typecheck`, feature-scope `biome check`, and `npm run build` passed. Full `npm run lint` is currently blocked by unrelated formatting issues in `src/backend/services/download-queue-service.ts` and `src/shared/download-types.ts`.
- Electron MCP proof captured with `caedrel` live stream: `.scratch/images/fullscreen-chat-rail-open.png` and `.scratch/images/fullscreen-chat-rail-hidden.png`.
