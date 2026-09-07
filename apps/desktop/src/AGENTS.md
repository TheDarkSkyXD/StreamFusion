# Desktop App Source (`src/`)

## Architecture

StreamFusion is an Electron application organized into three source roots:

- `backend/` owns the Electron main entry, preload bridge, IPC handlers, platform clients, persistence, and privileged services.
- `frontend/` owns the renderer entry, React pages, feature UI, routes, browser state, and presentation utilities.
- `shared/` owns serialization-safe contracts and process-neutral primitives used across the Electron boundary.

The main entry is `backend/main.ts`. The preload entry is `backend/preload/index.ts`. The renderer entry is `frontend/renderer.tsx`, and its React root is `frontend/App.tsx`.

## Intent Layer

Before modifying code in a subdirectory, read its nearest `AGENTS.md` first.

| Directory              | AGENTS.md                       | Responsibility                                                         |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `backend/`             | `backend/AGENTS.md`             | Main process, IPC, auth, platform adapters, persistence, and services  |
| `backend/preload/`     | `backend/preload/AGENTS.md`     | Narrow `contextBridge` surface                                         |
| `frontend/features/`   | `frontend/features/AGENTS.md`   | Renderer feature roots; see the nine-folder target and migration rules |
| `backend/features/`    | `backend/AGENTS.md`            | Main-owned feature routes, workflows, adapters, persistence, and tests |
| `frontend/components/` | `frontend/components/AGENTS.md` | Capability-neutral UI primitives and developer tools                   |
| `frontend/hooks/`      | `frontend/hooks/AGENTS.md`      | Cross-cutting React hooks                                              |
| `frontend/routes/`     | _(none)_                        | TanStack Router composition and shared route infrastructure            |
| `shared/`              | `shared/AGENTS.md`              | IPC contracts and process-neutral types                                |

## Global Invariants

- Renderer code must never import `electron` or Node built-ins. Privileged work crosses the allowlisted preload/IPC bridge.
- Main-process code must never import React pages, components, or hooks.
- Use constants from `shared/ipc-channels.ts`; do not hardcode IPC channel strings.
- `backend/preload/index.ts` is the sole full-app `contextBridge` surface. It exposes `window.electronAPI`.
- `shared/` must remain framework-independent and safe to import from main, preload, and renderer.
- V8 heap limits, development `userData` isolation, and `webSecurity: false` are intentional runtime constraints.
- Register privileged URL schemes in `backend/main.ts` before `app.ready`.
- Initialize emote providers lazily on first chat use, not in `frontend/App.tsx` or at module load.
- Feature screens, presentation hooks, and view state belong in the feature's `components/`; pure workflows and ports belong in `domain/` and `capabilities/`.
- Feature-owned tests live in `features/<feature>/tests/` and follow `../tests/AGENTS.md` relative to this source root. Shared fixtures and cross-feature runtime tests remain in the desktop test directory.
