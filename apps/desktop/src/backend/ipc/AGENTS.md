# IPC HANDLERS

**Read this before modifying any file in this directory.**

Parent context: [`../../../backend/AGENTS.md`](../../AGENTS.md)  
Channel constants: [`../../shared/ipc-channels.ts`](../../../shared/ipc-channels.ts)  
Sender-origin guard: [`./sender-origin.ts`](./sender-origin.ts)

---

## Purpose

This directory is the IPC bridge layer. Every `ipcMain.handle` (and the few `ipcMain.on`) registrations in the app live here, grouped by domain. Nothing in `handlers/` touches the DOM or any renderer concern — it receives a structured payload, calls a service or API client, and returns a structured response.

---

## File Inventory

| File                       | Channels handled                                                                                                                                           | Key dependencies                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `adblock-handlers.ts`      | `ADBLOCK_*`, `ADBLOCK_PATTERNS_*`                                                                                                                          | `networkAdBlockService`, `cosmeticInjectionService`, `twitchManifestProxy`, `vaftPatternService`                               |
| `auth-handlers.ts`         | `AUTH_*`, `AUTH_DCF_*`                                                                                                                                     | `storageService`, `kickAuthService`, `twitchAuthService`, `deviceCodeFlowService`, `tokenExchangeService`, `authWindowManager` |
| `category-handlers.ts`     | `CATEGORIES_GET_TOP`, `CATEGORIES_GET_BY_ID`, `CATEGORIES_GET_METADATA`, `CATEGORIES_SEARCH`                                                               | `twitchClient`, `kickClient`, `gqlGetGameMetadata`                                                                             |
| `channel-handlers.ts`      | `CHANNELS_GET_BY_ID`, `CHANNELS_GET_BY_USERNAME`, `CHANNELS_GET_FOLLOWED`                                                                                  | `twitchClient`, `kickClient`                                                                                                   |
| `chat-handlers.ts`         | `CHAT_GET_KICK_HISTORY`, `CHAT_GET_TWITCH_HISTORY`                                                                                                         | `getKickChannelHistory`, `getTwitchChannelHistory`                                                                             |
| `connectivity-handlers.ts` | `CONNECTIVITY_CHECK`                                                                                                                                       | `connectivity-service`, Electron `net.fetch`                                                                                   |
| `emote-handlers.ts`        | `EMOTES_*`                                                                                                                                                 | third-party emote services, Kick user-subscriptions service                                                                    |
| `kick-chat-handlers.ts`    | `KICK_CHAT_ENSURE_SEND_WINDOW_READY`, `KICK_CHAT_SEND_MESSAGE`, `KICK_CHAT_DISPOSE_SEND_WINDOW`                                                            | `kick-send-window` (main-only module)                                                                                          |
| `modlog-handlers.ts`       | `MODLOG_INSERT`, `MODLOG_QUERY`, `MODLOG_SWEEP_RETENTION`, `RETENTION_GET`, `RETENTION_SET`                                                                | `dbService` (SQLite)                                                                                                           |
| `proxy-handlers.ts`        | `PROXY_APPLY`, `PROXY_SET_CREDENTIALS`, `PROXY_HAS_CREDENTIALS`                                                                                            | `stream-proxy-service`, `storageService`, `isAllowedSender`                                                                    |
| `search-handlers.ts`       | `SEARCH_CHANNELS`, `SEARCH_ALL`                                                                                                                            | `twitchClient`, `kickClient`, `storageService`; in-file channel enrichment/verification cache                                  |
| `storage-handlers.ts`      | `STORE_GET/SET/DELETE`, `FOLLOWS_*`, `PREFERENCES_*`                                                                                                       | `storageService`                                                                                                               |
| `stream-handlers.ts`       | `STREAMS_GET_TOP`, `STREAMS_GET_BY_CATEGORY`, `STREAMS_GET_FOLLOWED`, `STREAMS_GET_BY_CHANNEL`, `STREAMS_GET_PLAYBACK_URL`                                 | `twitchClient`, `kickClient`, `TwitchStreamResolver`, `KickStreamResolver`, `storageService`                                   |
| `system-handlers.ts`       | `APP_GET_VERSION*`, `APP_GET_NAME`, `WINDOW_*`, `THEME_GET_SYSTEM`, `SHELL_OPEN_EXTERNAL`, `NOTIFICATION_SHOW`                                             | `electron` (`app`, `shell`, `Notification`, `nativeTheme`)                                                                     |
| `token-status-handlers.ts` | `AUTH_TOKEN_STATUS`                                                                                                                                        | `tokenExchangeService`, `storageService`, `isAllowedSender`                                                                    |
| `update-handlers.ts`       | `UPDATE_CHECK`, `UPDATE_DOWNLOAD`, `UPDATE_INSTALL`, `UPDATE_GET_STATUS`, `UPDATE_SET_ALLOW_PRERELEASE`, `UPDATE_SET_AUTO_CHECK`, `UPDATE_GET_SETTINGS`    | `update-service`, also calls `initUpdateService`                                                                               |
| `video-handlers.ts`        | `VIDEOS_GET_PLAYBACK_URL`, `VIDEOS_GET_METADATA`, `VIDEOS_GET_BY_CHANNEL`, `CLIPS_GET_BY_CHANNEL`, `CLIPS_GET_PLAYBACK_URL`, `VIDEOS_GET_BY_LIVESTREAM_ID` | `twitchClient`, `kickClient`, `TwitchStreamResolver`, `KickStreamResolver`                                                     |

---

## Contracts

### Registration signature

Every handler file exports one named function. Handlers that need the active renderer receive `MainRendererPort`; stateless ones take no arguments.

```typescript
export function registerXxxHandlers(renderer?: MainRendererPort): void {
  ipcMain.handle(IPC_CHANNELS.XXX_SOMETHING, async (_event, payload: PayloadType) => {
    // ...
  });
}
```

All registrations are called once from `../../ipc-handlers.ts`.

### Success response shape

Handlers that can fail return a discriminated object:

```typescript
// success
{ success: true, data: T }

// failure
{ success: false, error: string }
```

`void`-returning handlers (window controls, some storage mutations) are the exception — the caller does not inspect the return value.

### Push events (main → renderer)

Handlers push through `MainRendererPort`, which resolves the current window at send time and suppresses sends to destroyed, crashed, or detached frames:

```typescript
renderer.send(IPC_CHANNELS.XXX_CHANGED, payload);
```

Push channels in use: `AUTH_ON_CALLBACK`, `AUTH_FOLLOWS_SYNCED`, `AUTH_KICK_SESSION_EXPIRED`, `AUTH_TWITCH_AUTH_LOST`, `AUTH_DCF_STATUS`, `WINDOW_ON_MAXIMIZE_CHANGE`.

### Channel naming

All channel strings are defined in `../../shared/ipc-channels.ts` as `IPC_CHANNELS.*`. Never inline a raw string in a handler. The naming convention is `DOMAIN_ACTION` (e.g. `STREAMS_GET_TOP`, `AUTH_LOGOUT_KICK`).

### Sender-origin guard

Handlers that touch secrets or perform privileged mutations must validate the caller origin before acting:

```typescript
import { isAllowedSender } from "../sender-origin";

ipcMain.handle(IPC_CHANNELS.PROXY_APPLY, async (event, payload) => {
  if (!isAllowedSender(event)) {
    return REJECTED_RESULT; // benign no-op, do NOT throw
  }
  // ...
});
```

Currently enforced in: `proxy-handlers.ts`, `token-status-handlers.ts`.

### Lazy imports

API clients (`twitchClient`, `kickClient`) are imported lazily inside handler callbacks via `await import(...)` to avoid circular dependency issues at module load time. Services (`storageService`, `dbService`) are imported statically at the top of the file.

---

## How to Add a New Handler

1. Identify the domain. Add to an existing file if the domain matches; create a new `<domain>-handlers.ts` only when the domain is genuinely new.
2. Add the channel constant(s) to `../../shared/ipc-channels.ts` first.
3. Register with `ipcMain.handle`. Use the `{ success, data/error }` response shape.
4. If the handler touches secrets or performs privileged writes, add the `isAllowedSender` guard.
5. Export a `registerXxxHandlers` function and call it in `../../ipc-handlers.ts`.
6. Update the table above.

---

## Anti-patterns

- **Raw string channels** — always use `IPC_CHANNELS.*`.
- **`ipcMain.on` for request-response** — use `ipcMain.handle` (invoke pattern) so the renderer can await the result. `ipcMain.on` is only appropriate for fire-and-forget signals (window minimize/maximize/close).
- **Importing main-only modules in the renderer** — the reason `kick-chat-handlers.ts` exists: `kick-send-window` pulls in `better-sqlite3` transitively. Never import main-only modules directly from renderer code; always proxy through IPC.
- **Capturing a `BrowserWindow` in a process-lifetime handler** — use `MainRendererPort` so macOS window recreation cannot leave stale send targets.
- **Direct `webContents.send` for main-renderer events** — route through `MainRendererPort`; use an explicitly owned `WebContents` only for slot/view-specific events.
- **Skipping the sender-origin check on new privileged channels** — `webSecurity: false` is required for cross-origin video; any content the renderer loads could call unguarded channels.
- **Business logic in handlers** — handlers are thin. Extract non-trivial logic into services or API clients and unit-test it there (see `syncKickFollowsAfterLogin` in `auth-handlers.ts` as the model).
