# BACKEND (Main Process)

## OVERVIEW
Electron main process: IPC handlers, platform APIs, auth, persistence.

## STRUCTURE

```
backend/
├── ipc-handlers.ts          # Registers all IPC handlers
├── window-manager.ts        # BrowserWindow creation
├── ipc/handlers/            # Modular handlers by domain
│   ├── auth-handlers.ts     # Token ops, OAuth callbacks
│   ├── stream-handlers.ts   # Live stream resolution
│   ├── video-handlers.ts    # VODs, clips (largest file)
│   ├── search-handlers.ts   # Unified search
│   ├── category-handlers.ts # Browse categories
│   └── storage-handlers.ts  # Preferences
├── auth/                    # OAuth implementations
│   ├── twitch-auth.ts       # Twitch OAuth2
│   ├── kick-auth.ts         # Kick OAuth2
│   ├── device-code-flow.ts  # Twitch DCF (TV-style)
│   └── protocol-handler.ts  # streamfusion:// handler
├── api/                     # Platform clients
│   └── platforms/           # (see platforms/AGENTS.md)
└── services/
    ├── storage-service.ts   # electron-store wrapper
    └── database-service.ts  # SQLite (better-sqlite3)
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| New IPC operation | `ipc/handlers/*.ts` | Group by domain |
| Token storage | `services/storage-service.ts` | Uses `safeStorage` encryption |
| Local follows | `services/database-service.ts` | SQLite schema |
| Window settings | `window-manager.ts` | frame:false, contextIsolation |

## CONVENTIONS

### Handler Registration
```typescript
export function registerXxxHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.XXX, async (_event, payload) => {
    // ...
  });
}
```

### Platform Branching
Handlers use `if (platform === 'twitch') {} else {}` pattern. Consider refactoring to strategy pattern.

### Error Handling
Return `{ success: false, error: { code, message } }` for failures.

## ANTI-PATTERNS

- **video-handlers.ts** (660 lines) - High complexity, candidate for splitting
- **search-handlers.ts** - Duplicated verification logic for Twitch/Kick
- Kick client mixes transport with business logic (God Object)

## NOTES

- Handlers are registered once in `registerIpcHandlers(mainWindow)`
- All handlers use `ipcMain.handle` (invoke pattern, not send/on)
- Token refresh handled transparently in requestors
