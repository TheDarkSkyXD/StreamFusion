# shared/ — Cross-Process Contract Layer

This directory is the single source of truth for the contract between the
Electron **main process** (backend) and the **renderer process** (React UI).
Nothing here may import from `backend/` or `frontend/`. Both sides depend on
this layer; it must remain free of process-specific dependencies.

---

## File Inventory

| File                       | Role                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ipc-channels.ts`          | Central registry of every IPC channel string constant (`IPC_CHANNELS`), payload types (`IpcPayloads`), and response types (`AuthStatus`, `TokenStatusResult`, `UpdateState`, etc.). **The single place to name a new channel.**       |
| `auth-types.ts`            | Core auth and preferences domain types: `Platform`, `AuthToken`, `TwitchUser`, `KickUser`, `LocalFollow`, `UserPreferences` and all its sub-groups, `StorageSchema`, default value constants.                                         |
| `chat-types.ts`            | Unified chat domain types used by both the renderer chat components and the backend chat services: `ChatMessage`, `ContentFragment`, `ChatServiceEvents`, `NormalizedPinnedMessage`, `UnifiedPrediction`, `RoomStatePatchEvent`, etc. |
| `adblock-types.ts`         | VAFT ad-block types: `AdBlockConfig`, `StreamInfo`, `AdBlockStatus`, `AdPatternUpdate`, `StoredAdPatterns`, default config constants.                                                                                                 |
| `mod-log-types.ts`         | Mod-log IPC shapes: `ModLogEntry`, `ModLogQueryFilters`, `RetentionScope`. Mirrors DB types without importing `better-sqlite3`.                                                                                                       |
| `browser-event-emitter.ts` | Vite-safe `EventEmitter` polyfill (Node's `node:events` is unavailable in the renderer bundle). Used by chat services. Exported as both `BrowserEventEmitter` and `EventEmitter`.                                                     |
| `utils/`                   | Runtime-neutral timer and logging helpers consumed by both backend and frontend code.                                                                                                                                                 |

---

## Contracts and Invariants

### IPC Channel Naming

Channels follow the pattern `"domain:action"` (kebab-case noun, kebab-case verb):

```
"app:get-version"
"auth:save-token"
"adblock:patterns-refresh"
"kick-chat:send-message"
```

- All channel strings live in `IPC_CHANNELS as const`. Never use a bare string
  literal in a handler or caller; always reference the constant.
- The `IpcChannel` union type (`(typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]`)
  is the exhaustive type for valid channel strings.

### Push Channels (main → renderer)

Some channels are one-way pushes from main to renderer. They are distinguished
by naming and usage: main calls `webContents.send(channel, payload)`, renderer
calls `ipcRenderer.on(channel, handler)`. Current push channels:

- `APP_BEFORE_QUIT` — app shutdown signal; renderer tears down sockets.
- `AUTH_ON_CALLBACK` — OAuth callback result from the auth window.
- `AUTH_KICK_SESSION_EXPIRED` — Kick session expiry notification.
- `AUTH_FOLLOWS_SYNCED` — post-login bulk follow sync complete.
- `AUTH_DCF_STATUS` — Device Code Flow polling status updates.
- `WINDOW_ON_MAXIMIZE_CHANGE` — window maximize state change.
- `UPDATE_ON_STATUS_CHANGE` / `UPDATE_ON_PROGRESS` — auto-update progress.

### Payload Types

`IpcPayloads` maps channel constants to their request payload shape. If a
channel is not listed in `IpcPayloads`, it takes no structured payload.
Response types are declared separately (e.g., `AuthStatus`, `ProxyApplyResult`,
`TokenStatusResult`).

### Security Invariants

- **Credentials remain in main, with one narrow chat exception.** `AUTH_GET_TOKEN`
  is Kick-only and `AUTH_TOKEN_STATUS` returns metadata (validity, expiry,
  scopes), never a raw Twitch token. `AUTH_GET_VALID_TWITCH_TOKEN` exists only
  for renderer-owned Twitch IRC/Hermes sockets and must not be reused by Helix,
  EventSub, emotes, or account features. `ProxyPreferences.hasCredentials` is an advisory boolean;
  the username/password only flow through `PROXY_SET_CREDENTIALS` (write-only).
- **Sender origin is checked.** Privileged handlers in
  `backend/ipc/sender-origin.ts` validate `event.senderFrame.url` before
  acting. This is an enforcement detail in the backend, but the shape of
  sensitive channels here reflects that constraint.

---

## Patterns

### Adding a New IPC Channel

1. Add the constant to `IPC_CHANNELS` in `ipc-channels.ts`:
   ```ts
   MY_DOMAIN_DO_THING: "my-domain:do-thing",
   ```
2. If the call carries a structured payload, add an entry to `IpcPayloads`:
   ```ts
   [IPC_CHANNELS.MY_DOMAIN_DO_THING]: { param: string };
   ```
3. If the response has a non-trivial shape, declare a typed interface here:
   ```ts
   export interface MyDomainResult { ... }
   ```
4. Wire the handler in `backend/ipc/handlers/` using the constant.
5. Expose the method through `preload/index.ts` using `ipcRenderer.invoke(IPC_CHANNELS.MY_DOMAIN_DO_THING, payload)`.

### Adding a New Shared Type

- Auth / preferences / user data → `auth-types.ts`
- Chat message events / chat UI data → `chat-types.ts`
- Ad-block / VAFT state → `adblock-types.ts`
- Mod-log / retention → `mod-log-types.ts`
- New domain → new file following the `*-types.ts` naming convention

---

Runtime-neutral utilities used by both processes live under `utils/`. They may
coordinate generic concerns such as timing or logging, but must not contain
feature policy or import a process-specific dependency.

---

## Anti-Patterns

- **Do not import from `backend/`** (e.g., `better-sqlite3`, `electron`,
  `node:*` built-ins, service classes). This directory is bundled into the
  renderer by Vite; Node-only imports will break the renderer build.
- **Do not import from `frontend/`** or any React component. This layer is
  consumed by both processes; renderer-specific imports create a circular
  dependency in the build graph.
- **Do not add feature business logic.** Default constants (e.g.,
  `DEFAULT_USER_PREFERENCES`) are acceptable because they prevent duplication.
  Validation, transformation, or service logic belongs in the backend or
  renderer layer, not here.
- **Do not use bare string channel literals anywhere outside this file.**
  Always import and reference `IPC_CHANNELS.WHATEVER`.
- **Do not add a raw `accessToken` / `token` field to any IPC response type.**
  Token values are main-process-only (R28). The `TokenStatusResult` shape
  is the template for what auth-probe channels may return.

---

## Related Context

- **IPC handlers (main side):** `apps/desktop/src/backend/ipc/handlers/`
- **Preload bridge:** `apps/desktop/src/backend/preload/index.ts` — wraps every
  channel in a typed function and exposes the result as `window.electronAPI`.
- **Sender-origin guard:** `apps/desktop/src/backend/ipc/sender-origin.ts`
- **Frontend bridge type:** `frontend/electron.d.ts` sources `ElectronAPI` from
  `backend/preload/index.ts` and exposes it as `window.electronAPI`.
