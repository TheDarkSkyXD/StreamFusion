# UI Components

## Purpose
All React UI components for the desktop app. This directory owns visual rendering only — business logic, API calls, and persistence live in `src/hooks/`, `src/store/`, and `src/backend/`. Components read from stores and call hooks; they do not import from `src/backend/` directly.

## Subsystem Map

- **Chat** (`chat/AGENTS.md`) — Full chat panel: message list, input, emote/mention autocomplete, badges, platform-specific banners (pins, predictions), mod tools (user popout, inline mod strip, mod log tab), and tooltips. Covers both Twitch and Kick via platform subdirs.
- **Player** (`player/AGENTS.md`) — Video playback: HLS player core, platform-specific wrappers (`kick/`, `twitch/`), controls (volume, quality selector, progress bar, seek preview, settings menu), PiP mini player, and all player hooks (fullscreen, keyboard, adaptive quality, background throttle, video lifecycle).

## Other Areas

| Directory | Purpose |
|-----------|---------|
| `auth/` | Auth lifecycle: `AuthProvider` (initializes auth + follows + moderated-channels on mount), `LoginDialog`, `ProfileDropdown`, `AccountConnect`, `GuestMode`, and `ReconnectForModDialog` (prompts moderators to re-auth with mod scope). |
| `channel/` | Placeholder — channel card/list components are stubbed out, nothing exported yet. |
| `dev/` | Development-only tooling: `DebugPanel` (draggable overlay, hidden in production via `import.meta.env.DEV`), `PerfTool`, `ChatSimTool`, `useRenderCount` hook, and `interval-tracker`. Never import in production code paths. |
| `discovery/` | Browse/discover UI: `CategoryGrid` (responsive grid with skeleton loading), `VirtualizedCategoryGrid`, `CategoryCard`, `CategoryCardSkeleton`, and `CategoryFilterBar`. Consumes `UnifiedCategory` from the backend API. |
| `icons/` | SVG icon components: `TwitchIcon`, `KickIcon`, `SevenTVIcon`, `KickEmoteIcon`. Thin wrappers; no logic. |
| `layout/` | App shell: `AppLayout` (title bar + top nav + collapsible sidebar + main content area + persistent `MiniPlayer`), `TitleBar` (Electron window controls), `SidebarFollows` (live followed channels list). |
| `multistream/` | Multi-stream view: `MultiStreamGrid` (dnd-kit drag-to-reorder grid and focus mode), `SortableStreamSlot`, `StreamSlot`, and `AddStreamDialog`. Reads from `multistream-store`. |
| `search/` | `UnifiedSearchInput` — cross-platform search input that queries both Twitch and Kick. |
| `settings/` | `ChatSettingsSection` — settings UI for chat display preferences (appearance, emotes, events, behavior). Exports `SettingRow`, `SwitchRow`, `RangeRow` primitives and `useChatDisplay` hook for reuse by the in-chat quick-settings gear. |
| `stream/` | Stream cards and info: `StreamCard`, `StreamCardSkeleton`, `StreamGrid`, `StreamInfo`, `FeaturedStream`, `RelatedContent` (clips/videos tabs). Platform-specific subdirs (`twitch/`, `kick/`) and `related-content/` for clip dialog. |
| `TopNavBar/` | App-wide top bar: brand link, sidebar toggle, `SearchBar`, `NotificationsDropdown`, mod nav link (gated on `moderatedChannelsStore`), and `ProfileDropdown`. |
| `ui/` | Design primitives: `Button`, `Card`, `Dialog`, `ScrollArea`, `Select`, `Switch`, `Tooltip`, `Skeleton`, `LoadingSpinner`, `Progress`, `FollowButton`, `PlatformAvatar`, `ProxiedImage` (handles `kick-image://` and `twitch-image://` custom protocols for CDN header spoofing and 403 swallowing), `VisuallyHidden`. |
| `ToastRoot.tsx` | Mounts the global Sonner toast container. Drop it once in the app root; do not instantiate per-page. |

## Contracts & Invariants

- **Platform-agnostic root, platform-specific subdirs**: shared/agnostic code lives at the directory root; Twitch- or Kick-specific code goes in `twitch/` or `kick/` subdirs. Do not add platform-specific branches to root components.
- **`ProxiedImage` for all external images**: any `<img>` pointing at Kick CDN (`files.kick.com`, `images.kick.com`, `kick.com/img/`) or Twitch profile images (`static-cdn.jtvnw.net/jtv_user_pictures/`) must go through `<ProxiedImage>` — direct `<img src>` will 403.
- **`DebugPanel` is dev-only**: `DebugPanel` returns `null` when `import.meta.env.DEV` is false. Never import `dev/` modules from production component trees.
- **Store reads via selectors**: subscribe to individual store fields (not the whole store object) to avoid unnecessary re-renders. See `TopNavBar` and `AppLayout` for the established pattern.
- **`channel/` is a stub**: nothing is exported from `channel/index.ts` yet. Do not add an import that depends on it.

## Anti-patterns

- Do not call Electron IPC (`window.electronAPI`) from inside `ui/` primitives — that belongs in hooks or platform-specific components.
- Do not import chat or player internals from outside their subsystem without going through the subsystem's `index.ts`.
- Do not add CSS `display:none` / `hidden` to a `<ProxiedImage>` while it is loading — the browser's lazy-load IntersectionObserver requires the element to occupy layout space or it will never fire `onLoad`.
- Do not place business logic (API calls, store mutations) inside `layout/` shell components; `AppLayout` calls `useAuthInitialize()` as a deliberate exception for one-time app-root initialization only.
