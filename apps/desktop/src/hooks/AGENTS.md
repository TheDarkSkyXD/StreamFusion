# REACT HOOKS

**Read this file before adding or modifying hooks in this directory.**

## Purpose
Owns all reusable React hooks for the renderer process. Hooks here bridge Zustand stores, IPC/`window.electronAPI`, Twitch/Kick platform services, and TanStack Query. Does NOT own store definitions (see `store/`), backend services (see `backend/`), or UI component logic.

## FILE INVENTORY

### Auth
| File | What it does |
|------|-------------|
| `useAuth.ts` | All auth selectors: `useTwitchAuth`, `useKickAuth`, `useAuthStatus`, `useIsAuthenticated`, `useIsGuest`, `useUserInfo`, `useFollowsManager`, `usePreferences`, `useAuthError`, `useAuthInitialize`. All read from `useAuthStore`. `useAuthInitialize` must be called once at app root. |

### Electron / App lifecycle
| File | What it does |
|------|-------------|
| `useElectron.ts` | IPC wrappers for OS integration: version info, system theme, window controls, `openExternal`, desktop notifications, and `useElectronStore<T>` (key-value persistence via main-process store). |
| `use-app-shutdown.ts` | Mounts once in `App.tsx`. Subscribes to `electronAPI.onBeforeQuit`, tears down chat sockets and chat-store batching, sets `window.__shuttingDown`. Main hard-kills after 3 s. |
| `useUpdater.ts` | Full update lifecycle (`check`, `download`, `install`) + settings (`allowPrerelease`, `autoCheckEnabled`, `checkFrequency`). Reads/writes `useUpdateStore` and subscribes to `electronAPI.updater` IPC events. `useUpdateSettings` is a lighter variant for settings-only surfaces. |

### Chat
| File | What it does |
|------|-------------|
| `useChatRoomState.ts` | Read-only selector over `useRoomStateStore`. Returns `DEFAULT_ROOM_STATE` when `channelId` is null — callers never null-check. |
| `useChatSettingsSync.ts` | Owns the full chat-settings sync lifecycle for one mounted chat component: initial HTTP fetch → WS `roomState` events → optimistic mod-strip writes, all last-write-wins into `useRoomStateStore`. AbortController + module-scoped `inFlight` Set guard against stale fetches across channel switches and React StrictMode double-mounts. Re-fetches on reconnect. Exports `chatSettingsToPatch` for unit testing. |
| `useChatSettingsSync.test-helpers.ts` | Test-only. Exposes `getProvenance`, `resetProvenance`, `isInFlight`, `resetInFlight`. **Never import in production code.** |
| `useStickyDismissedPrediction.ts` | Sticky-dismiss gate: once a prediction banner is dismissed, all status-flip updates for the same prediction id are suppressed. Resets automatically when a new prediction id arrives. |

### Moderation
| File | What it does |
|------|-------------|
| `useIsTwitchMod.ts` | `true` when signed-in user moderates the channel (from `useModeratedChannelsStore`) OR is the broadcaster. Honors `useDevModOverrideStore.forceModRole`. Read-only — does not trigger hydration. |
| `useIsKickMod.ts` | `true` only when signed-in user IS the broadcaster (Kick has no public "channels I moderate" API). Honors `forceModRole`. |
| `useRequireModScopes.ts` | Reads the persisted Twitch token via IPC, checks for `moderator:manage:chat_messages` + `user:read:moderated_channels`. Exposes `promptReconnect(options?)` to open the re-consent dialog. Honors `useDevModOverrideStore.forceModScopes`. |
| `useModLog.ts` | Queries `window.electronAPI.modLog.query(...)` (SQLite in main process). Accepts `refreshCounter` — increment it after a mod action to force a read-after-write. |

### Platform integration
| File | What it does |
|------|-------------|
| `useTwitchEventSub.ts` | Renderer consumer of `TwitchEventSubClient`. Lazily instantiates the singleton, subscribes `(eventType, channelId)`, reads listener through a ref (no teardown on inline fn changes). Returns `connectionState`. Idles when `accessToken` or `channelId` is absent. |
| `useHelixPoll.ts` | Visibility-aware generic Helix polling: fires immediately on mount, pauses when document is hidden, re-fires on return to foreground, exposes `refresh()` for manual trigger. Uses `useInterval`. |
| `useResolveTwitchChannel.ts` | Resolves Twitch `broadcaster_login` → `{ id, login, displayName }` via Helix `/users?login=`. Returns `undefined` while loading, `null` on failure. Honors `useDevModOverrideStore.forceResolvedTwitchBroadcasterId`. |
| `useStreamPlayback.ts` | Fetches HLS/DASH/MP4 playback URLs via `electronAPI.streams.getPlaybackUrl`. Module-level ref-counted LRU cache (90 s TTL, deferred 100 ms eviction). Stagger delay (150 ms × instance order) avoids GQL thundering herd in multistream. Max 3 reload attempts before surfacing a hard error. |

### Ad-blocking
| File | What it does |
|------|-------------|
| `use-adblock.ts` | Reads adblock status + stats from main process via IPC. Exposes `toggle({ network?, cosmetic? })` — refreshes state from main on failure to keep UI consistent. |
| `use-ad-element-observer.ts` | DOM `MutationObserver` that hides known Twitch ad overlay selectors (`[data-test-selector="ad-banner-default-text"]`, `.player-ad-overlay`, etc.). Purely cosmetic; driven by `enabled` flag. |

### TanStack Query — `queries/`
All query hooks call `window.electronAPI.*` inside `queryFn`. None carry their own loading/error state — consumers use TanStack's returned `{ data, isLoading, error }`.

| File | Hooks | Cache config |
|------|-------|-------------|
| `useStreams.ts` | `useTopStreams`, `useStreamsByCategory`, `useFollowedStreams`, `useStreamByChannel` | `byChannel`: 30 s interval; `followed`: 60 s interval + 30 s staleTime |
| `useInfiniteStreams.ts` | `useInfiniteTopStreams`, `useInfiniteStreamsByCategory`, `useInfiniteFollowedStreams` | Cursor-based; empty page → `undefined` nextCursor (no infinite-scroll loop) |
| `useCategories.ts` | `useTopCategories`, `useCategoryById`, `useCategoryMetadata`, `useUnifiedCategoryLink` | `top`: 5 min stale / 30 s refetch; metadata: Twitch-only (Kick tags arrive in bulk fetch) |
| `useChannels.ts` | `useFollowedChannels`, `useChannelByUsername` | 5 min staleTime |
| `useSearch.ts` | `useSearchChannels`, `useSearchCategories`, `useSearchAll` | Infinite queries for channels/categories; AbortSignal stub via `throwIfAborted` |
| `usePrefetch.ts` | `usePrefetchChannel`, `usePrefetchCategory` | Warm React Query cache on hover (30 s / 60 s staleTime) |

### Utilities
| File | What it does |
|------|-------------|
| `useDebounce.ts` | Delays value propagation by `delay` ms. |
| `useInterval.ts` | Declarative `setInterval`; `delay = null` pauses. Callback is ref-stable — no teardown on every render. |
| `useTimeout.ts` | Declarative one-shot `setTimeout`; `delay = null` cancels. |
| `useManagedTimeout.ts` | Imperative `{ start(ms), clear() }` — dynamic delays, restart-on-event (e.g. player auto-hide). Stable object safe to list in deps. |
| `useSearchHistory.ts` | Persists last 10 search terms to `localStorage` under `streamfusion_search_history`. No IPC. |

## CONTRACTS & INVARIANTS

- `useAuthInitialize` — call exactly once at `App.tsx` root before any auth-dependent hook.
- `useAppShutdown` — call exactly once at `App.tsx` root. Sets `window.__shuttingDown` for other teardown paths.
- `useChatSettingsSync` — one instance per mounted chat component (`platform` + `channelId`). Multiple mounts for the same key share the `inFlight` dedup set, so only one HTTP fetch runs at a time.
- `useIsTwitchMod` / `useIsKickMod` — read-only; do NOT call them to trigger hydration. Auth hydration is `AuthProvider`'s job.
- `useRequireModScopes` — async; check `loading` before acting on `hasModScopes`.
- `useStreamPlayback` — `playbackCache` is module-level and survives re-renders. Calling `reload()` more than 3 times sets a hard error state — callers must surface this rather than looping.
- All `queries/` hooks — require `QueryClientProvider` to be present in the tree.
- `useElectronStore` — `isLoading: true` while main-process `store.get` is in flight; render placeholder or skip writes until it resolves.

## PATTERNS

### IPC calls
All IPC goes through `window.electronAPI.*`. Hooks guard with `if (!window.electronAPI) return` or `useIsElectron()` before calling. Never import Electron modules directly in the renderer.

### Zustand selectors
Use granular primitive selectors to avoid unnecessary re-renders:
```typescript
// Good
const user = useAuthStore((s) => s.twitchUser);
// Bad — new object every render
const { user, loading } = useAuthStore((s) => ({ user: s.twitchUser, loading: s.twitchLoading }));
```
Memoize multi-field returns with `useMemo`.

### Stale closure prevention
Timer-based hooks (`useInterval`, `useTimeout`, `useManagedTimeout`, `useHelixPoll`) store callbacks in refs so the interval/timeout fires the latest version without being rescheduled.

### Cancellation
Effects that fire async work use either an `AbortController` or a `cancelled` boolean flag checked before state writes. Both patterns are in use — prefer `AbortController` for fetch-based work, `cancelled` flag for Promise chains that can't accept a signal.

### Query key factories
Exported as `STREAM_KEYS`, `CATEGORY_KEYS`, `CHANNEL_KEYS`, `SEARCH_KEYS`. Always use the factory when constructing keys for `queryClient.invalidateQueries` or `prefetchQuery` — never hand-roll a key string.

### Dev overrides
`useDevModOverrideStore` provides `forceModRole` and `forceModScopes` flags that short-circuit real auth checks. All mod-gating hooks must honor these. They are off by default and have no production impact.

## ANTI-PATTERNS

- **Don't import `useChatSettingsSync.test-helpers.ts` in production code.** It exists solely to expose internal state for tests.
- **Don't call `useIsTwitchMod` / `useIsKickMod` to trigger mod-channel hydration.** Hydration is owned by `AuthProvider`; these hooks are pure read.
- **Don't bypass the `playbackCache` in `useStreamPlayback`.** Call `reload()` to force a fresh fetch — direct `playbackCache.delete()` outside the hook is a bug.
- **Don't add a new TanStack query hook outside `queries/`.** Keep all React Query logic co-located there.
- **Don't use `localStorage` in new hooks** (except extending `useSearchHistory`). Persistent data belongs in `useElectronStore` (main-process store) or a Zustand persist store.
- **Don't skip the `inFlight` guard in `useChatSettingsSync`** — it prevents duplicate Helix fetches during StrictMode double-mounts and rapid channel toggles.
