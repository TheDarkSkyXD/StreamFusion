# Backend (Electron main process)

Read this file before modifying backend code. The main process owns privileged Electron work, IPC registration, provider credentials, persistence, and runtime bootstrap. It never owns renderer components, browser-safe socket lifecycles, React state, or page routing.

## Feature layout

Feature-owned main-process code lives in `features/<feature>/`:

```text
routes/          thin IPC and transport entry points
components/      feature UI, empty in the main process
domain/          pure workflows and feature policy
capabilities/    provider-neutral ports
adapters/        Electron, Node, and provider implementations
data/            feature persistence queries and mappers
utils/           feature-private pure helpers
composition/     dependency wiring only
tests/           feature-owned tests
```

Keep the existing `main/`, `preload/`, `startup/`, `ipc/`, `api/`, `services/`, and `utility/` paths only for runtime roots or genuinely cross-feature infrastructure. Do not add feature behavior back to their flat legacy directories.

## IPC and process boundaries

Routes parse payloads, validate sender origin for privileged operations, call a workflow, and map its result. Put channel constants and cross-process contracts in `shared/`; renderer callers use the allowlisted preload bridge. Never import a main adapter into frontend code, and never import a browser-safe frontend service into backend code.

Use `MainRendererPort` for main-to-renderer notifications. Keep `WebContentsView` slot bridges narrow. `shared/` must not import Electron, backend, or frontend modules.

## Persistence and providers

SQLite and electron-store drivers remain shared infrastructure. Feature repositories own SQL, keys, serializers, and mappers in their `data/` directories. Provider adapters implement feature capabilities; domain modules never depend on Electron, a provider SDK, or concrete persistence.

Keep OAuth tokens and secrets in main. The only raw-token exception is the explicitly allowlisted Twitch IRC/Hermes bridge. Do not return credentials through general IPC APIs.
