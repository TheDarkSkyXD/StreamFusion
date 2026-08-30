# Preload — Electron Context Bridge (Security Boundary)

## Purpose

This directory contains the single preload script (`index.ts`) that Electron
injects into the renderer process before any renderer code runs. It executes
with Node.js access but bridges into the renderer's sandboxed world via
`contextBridge.exposeInMainWorld`. It is the **only** legal path from the
renderer to the main process.

The renderer runs with `nodeIntegration: false` and `contextIsolation: true`.
Without this bridge the renderer is a plain browser page with no system
access — which is intentional and must stay that way.

## How the Bridge Works

```
Renderer (sandboxed)          Preload (privileged)          Main Process
  window.electronAPI   <-->   contextBridge.expose   <-->   ipcMain.handle
                              ipcRenderer.invoke()
                              ipcRenderer.send()
                              ipcRenderer.on()
```

1. `index.ts` builds a plain `electronAPI` object containing typed wrapper
   functions.
2. `contextBridge.exposeInMainWorld("electronAPI", electronAPI)` copies that
   object into the renderer's `window` scope. Electron deep-clones it; no
   live references to `ipcRenderer` (or any Node API) bleed through.
3. The renderer calls `window.electronAPI.someMethod(args)`, which invokes
   `ipcRenderer.invoke(IPC_CHANNELS.SOME_CHANNEL, args)` in the preload layer.
4. The matching `ipcMain.handle` in `backend/ipc/handlers/` executes the real
   logic and resolves the promise.

Push events from main to renderer use `ipcRenderer.on(channel, handler)`.
Every `on` registration returns a cleanup function (`() => ipcRenderer.removeListener(...)`) that callers must invoke to prevent listener leaks.

## Contracts and Invariants

- **Single export name**: the bridge is always `window.electronAPI`. The
  TypeScript type is `ElectronAPI` (re-exported from `index.ts`) and re-used
  in `frontend/electron.d.ts` to type `window.electronAPI` globally.
- **Channel constants only**: every `ipcRenderer.invoke / send / on` call uses
  a constant from `IPC_CHANNELS` (`shared/ipc-channels.ts`). String literals
  are never used inline.
- **No general raw-token reads**: `auth.getToken` is Kick-only and
  `auth.tokenStatus` returns metadata. The sole Twitch raw-token exception is
  `auth.getValidTwitchToken`, reserved for renderer-owned IRC/Hermes sockets;
  Helix, EventSub, emotes, and account work must stay behind main-process IPC.
- **Error surfacing**: `invoke`-based methods that can fail structurally
  (OAuth, device-code flow) throw rather than returning `{ success: false }`,
  so callers use normal `try/catch` instead of inspecting result shapes.
- **Listener cleanup**: every `ipcRenderer.on` wrapper returns a `() => void`
  unsubscribe function. Callers are responsible for calling it (typically in a
  React `useEffect` cleanup).

## Namespace Map

| Namespace     | Covers                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| _(top-level)_ | `getVersion`, `getVersionInfo`, `getName`, window controls, `openExternal`, `showNotification`, `onBeforeQuit` |
| `store`       | Generic key-value store (deprecated — prefer typed namespaces)                                                 |
| `auth`        | OAuth flows, device-code flow, token management, user data, push events                                        |
| `follows`     | Local follow CRUD                                                                                              |
| `preferences` | User preferences get/update/reset                                                                              |
| `proxy`       | Outbound proxy apply + credentials (write-only)                                                                |
| `streams`     | Top/followed/by-category/by-channel/playback-url                                                               |
| `categories`  | Top/by-id/search/metadata                                                                                      |
| `search`      | Channel and unified search                                                                                     |
| `channels`    | By-id/by-username/followed                                                                                     |
| `videos`      | VOD listing, playback URLs, metadata, by-livestream-id                                                         |
| `clips`       | Clip listing and playback URLs                                                                                 |
| `chat`        | Kick and Twitch chat history snapshots                                                                         |
| `kickChat`    | Kick send-window IPC (ensure-ready / send / dispose)                                                           |
| `emotes`      | 7TV / BTTV / FFZ REST bridges and Kick user subscriptions                                                      |
| `adblock`     | Status, toggle, stats, cosmetic injection, VAFT patterns                                                       |
| `updater`     | Check/download/install, settings, push progress events                                                         |
| `env`         | Runtime-environment snapshot (`isDev`, platform, app/electron/node versions)                                   |
| `bugReports`  | Bug-report capture (write / open-folder / get-dir / list)                                                      |
| `logs`        | Renderer→main log write + log-folder open / current-path / noise-path / network-path / tail                    |
| `modLog`      | Mod-log insert/query/sweep                                                                                     |
| `retention`   | Retention-scope get/set                                                                                        |

## Adding a New IPC Bridge Method

1. **Define the channel constant** in `shared/ipc-channels.ts`.
2. **Register the handler** in the appropriate file under
   `backend/ipc/handlers/` using `ipcMain.handle(IPC_CHANNELS.YOUR_CHANNEL, ...)`.
   Register it in the main-process setup (see existing handler registration
   in `backend/`).
3. **Add the wrapper** to the correct namespace object in `electronAPI` inside
   `index.ts`:
   ```ts
   yourMethod: (params: YourParams): Promise<YourResult> =>
     ipcRenderer.invoke(IPC_CHANNELS.YOUR_CHANNEL, params),
   ```
4. For **push events** from main → renderer:
   ```ts
   onYourEvent: (callback: (data: YourData) => void): (() => void) => {
     const handler = (_event: Electron.IpcRendererEvent, data: YourData) =>
       callback(data);
     ipcRenderer.on(IPC_CHANNELS.YOUR_EVENT, handler);
     return () => ipcRenderer.removeListener(IPC_CHANNELS.YOUR_EVENT, handler);
   },
   ```
5. The `ElectronAPI` type is inferred from `typeof electronAPI`, so TypeScript
   picks up the new method automatically — no manual type editing needed.

## Anti-Patterns — Never Do These

- **Never expose `ipcRenderer` directly.** `contextBridge.exposeInMainWorld("ipcRenderer", ipcRenderer)` would let renderer code invoke any channel with any payload, bypassing all validation.
- **Never expose raw Node.js APIs** (`fs`, `path`, `child_process`, etc.) to the renderer. If the renderer needs file I/O, add a typed IPC handler in main.
- **Never use inline string channel names.** Always use `IPC_CHANNELS.*` so typos are caught at compile time and refactors stay consistent.
- **Never return sensitive values** (token strings, passwords, secrets) from any bridge method. Return metadata/booleans only.
- **Never skip the cleanup return** on `ipcRenderer.on` wrappers. Orphaned listeners cause memory leaks and can fire callbacks on unmounted components.
- **Never add business logic here.** The preload is a thin translation layer. Validation, side effects, and data transformation belong in `backend/ipc/handlers/`.

## Related Files

| File                                            | Role                                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/shared/ipc-channels.ts`       | All `IPC_CHANNELS` constants + shared payload types (`AuthStatus`, `TokenStatusResult`, `ProxyApplyConfig`, `VersionInfo`, `CheckFrequency`, …) |
| `apps/desktop/src/frontend/electron.d.ts`       | Global `window.electronAPI: ElectronAPI` declaration consumed by the renderer                                                                   |
| `apps/desktop/src/shared/auth-types.ts`         | Domain types used in bridge signatures (`AuthToken`, `KickUser`, `TwitchUser`, `Platform`, `UserPreferences`, `LocalFollow`)                    |
| `apps/desktop/src/shared/mod-log-types.ts`      | `ModLogEntry`, `ModLogQueryFilters`, `RetentionScope`                                                                                           |
| `apps/desktop/src/backend/ipc/handlers/`        | One handler file per domain area — the main-process side of every channel exposed here                                                          |
| `apps/desktop/src/backend/ipc/sender-origin.ts` | Origin validation helper used by handlers to reject IPC from unexpected senders                                                                 |
