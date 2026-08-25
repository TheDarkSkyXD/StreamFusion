# Desktop App Source (`src/`)

## Architecture

StreamFusion is an **Electron application** with a strict two-process boundary:

- **Main process** (`main.ts` → `backend/`) — Node.js context. Owns window lifecycle, auth, IPC handlers, platform API clients, services (ad-block, manifest proxy, database, storage), and crash-resistant runtime flags. Never imported by the renderer.
- **Renderer process** (`renderer.tsx` → React app) — Chromium context. React + TanStack Router + Zustand. Communicates with the main process exclusively through the `contextBridge` API exposed by the preload script. Never imports Electron directly.
- **Preload script** (`preload/index.ts`) — Privileged bridge. Exposes `window.electronAPI` to the renderer via `contextBridge`. The only file that imports from both `electron` and renderer-side types.
- **Shared contracts** (`shared/`) — Types and IPC channel constants imported by both processes. Zero runtime code — types and string constants only.

The renderer entry point is `renderer.tsx`. The React tree root is `App.tsx`, which wraps the app in `QueryProvider`, `TooltipProvider`, `AuthProvider`, and `RouterProvider`.

## Intent Layer

**Before modifying code in a subdirectory, read its AGENTS.md first.**

| Directory | AGENTS.md | Responsibility |
|---|---|---|
| `backend/` | `backend/AGENTS.md` | Main process: IPC handlers, auth, platform API clients, services, window manager |
| `backend/ipc/` | `backend/ipc/AGENTS.md` | IPC handler registration and routing |
| `backend/auth/` | `backend/auth/AGENTS.md` | OAuth flows for Kick and Twitch, token storage |
| `backend/api/platforms/` | `backend/api/platforms/AGENTS.md` | Platform-specific API clients (Kick, Twitch) |
| `backend/services/chat/` | `backend/services/chat/AGENTS.md` | Chat WebSocket connections and message routing |
| `backend/services/emotes/` | `backend/services/emotes/AGENTS.md` | Emote fetching, caching, and provider management |
| `shared/` | `shared/AGENTS.md` | IPC channel constants and types shared across the process boundary |
| `preload/` | `preload/AGENTS.md` | contextBridge surface — the only code that straddles both processes |
| `store/` | `store/AGENTS.md` | Zustand global state stores (auth, chat, UI) |
| `components/` | `components/AGENTS.md` | All React UI components |
| `components/chat/` | `components/chat/AGENTS.md` | Chat panel, message list, input, emote picker |
| `components/player/` | `components/player/AGENTS.md` | Video player components |
| `components/stream/` | `components/stream/AGENTS.md` | Stream metadata, stream cards, browse UI |
| `hooks/` | `hooks/AGENTS.md` | React hooks (auth, chat, queries, ad-blocking, shutdown) |
| `pages/` | `pages/AGENTS.md` | Route-level page components |
| `pages/Mod/` | `pages/Mod/AGENTS.md` | Moderation log page |
| `providers/` | _(no AGENTS.md)_ | React context providers (`QueryProvider`) |
| `routes/` | _(no AGENTS.md)_ | TanStack Router route definitions |
| `lib/` | _(no AGENTS.md)_ | Small stateless utility functions |
| `assets/` | _(no AGENTS.md)_ | Static images and SVGs — do not import from main process |

## Global Invariants

- **Process boundary is strict.** Renderer code must never `import` from `electron` or Node built-ins. Main process code must never `import` React components or hooks. Violations break the build.
- **IPC channels are the only cross-process communication path.** Use constants from `shared/ipc-channels.ts` — never hardcode channel name strings. All handler registration goes through `registerIpcHandlers()` in `backend/ipc-handlers.ts`.
- **`shared/` is import-safe for both processes.** Files under `shared/` must contain only TypeScript types and string/number constants — no runtime logic, no platform-specific imports.
- **`preload/index.ts` is the sole contextBridge surface.** Do not add a second preload script or call `contextBridge.exposeInMainWorld` elsewhere. The exposed shape is `window.electronAPI`.
- **Memory limits are enforced at startup.** V8 heap is capped at 350 MB per process via `--max-old-space-size`. Avoid large in-memory data structures in long-running services; prefer streaming or lazy loading.
- **Custom URL schemes are registered before `app.ready`.** `kick-image://` and `twitch-image://` are privileged schemes registered in `main.ts`. Do not add new schemes without registering them in the same `protocol.registerSchemesAsPrivileged` call.
- **Emote providers initialize lazily.** Emote provider setup runs on first `ChatPanel` mount via `ensureEmoteProvidersInitialized()` — do not eagerly initialize in `App.tsx` or at module load time.
- **Dev and production use separate `userData` directories.** Dev appends ` (Dev)` to the path so both can run simultaneously. Do not hardcode userData paths.
- **`webSecurity: false` is intentional.** Required for cross-origin video stream playback. Do not remove without validating Twitch and Kick playback in the packaged app.
