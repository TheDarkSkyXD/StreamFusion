# ZUSTAND STORES

**Read this file before modifying code in this directory.**

## Purpose
Owns all Zustand global state stores: auth, chat, emotes, follows, volume, multistream, history, room state, etc. Does NOT own: React Query caches, IPC handler logic, or backend services.

## OVERVIEW
Client state management with IPC backend sync and localStorage persistence.

## STRUCTURE

```
store/
├── auth-store.ts         # Auth state, IPC bridge (458 lines)
├── follow-store.ts       # Local follows, optimistic updates
├── volume-store.ts       # Global audio, persisted
├── history-store.ts      # Watch history (max 200 items)
├── multistream-store.ts  # Multi-stream layout config
├── playback-position-store.ts  # VOD resume positions
├── pip-store.ts          # Picture-in-Picture state
└── app-store.ts          # UI state (sidebar, theater mode)
```

## WHERE TO LOOK

| Task | Store |
|------|-------|
| Auth status | `auth-store.ts` |
| Follow/unfollow | `follow-store.ts` |
| Volume control | `volume-store.ts` |
| Resume playback | `playback-position-store.ts` |
| Sidebar state | `app-store.ts` |

## CONVENTIONS

### Store Pattern
```typescript
interface XxxState {
  // state
  items: Item[];
  // actions
  addItem: (item: Item) => void;
}

export const useXxxStore = create<XxxState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (item) => set({ items: [...get().items, item] }),
    }),
    { name: 'xxx-storage' }
  )
);
```

### Naming
- File: `xxx-store.ts`
- Hook: `useXxxStore`
- Interface: `XxxState`

### Selectors (avoid re-renders)
```typescript
// Good - primitive
const volume = useVolumeStore((s) => s.volume);

// Bad - creates new object each render
const user = useAuthStore((s) => ({ name: s.name, id: s.id }));
```

### Backend Sync
Stores bridge to main process via `window.electronAPI.*` calls.
Some require `hydrate()` on app start (e.g., follow-store).

## ANTI-PATTERNS

- `auth-store.ts` is large (458 lines) - consider splitting
- Dual source of truth (Zustand + backend) requires careful sync

## NOTES

- Persistence: Zustand middleware → localStorage (renderer)
- Sensitive data: `StorageService` → electron-store with `safeStorage`
- High-volume data: `DatabaseService` → SQLite
