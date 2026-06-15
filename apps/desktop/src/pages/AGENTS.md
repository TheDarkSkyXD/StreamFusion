# Pages Directory

## Purpose

Route-level page components. Each subdirectory maps to one top-level route registered in
`src/routes/router.tsx`. Pages are lazy-wrapped in `withSuspense` at the router level —
no page needs its own Suspense boundary. All routes live under the `_app` pathless layout
route which provides the `AppLayout` (sidebar, navbar).

## Page Inventory

| Directory       | Route                                      | What it does                                                                                                  |
|-----------------|--------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `Home/`         | `/`                                        | Landing page. Fetches top 25 streams via `useTopStreams`, shows a `FeaturedStream` hero + `LiveNowSection` grid. |
| `Following/`    | `/following`                               | Merges local follows (`useFollowStore`) + authenticated remote follows (Twitch/Kick). Splits into Live/Offline sections with platform filter + search. |
| `Categories/`   | `/categories`                              | Loads all categories via `useTopCategories`; client-side text filter; virtualized grid via `VirtualizedCategoryGrid`. |
| `CategoryDetail/` | `/categories/$platform/$categoryId`      | Dual-platform stream browser for one category. Infinite-loads streams from both platforms in parallel, merges/dedupes, applies tag/sort filters. IntersectionObserver sentinel drives pagination. |
| `SearchResults/`| `/search?q=`                               | Unified cross-platform search (channels, streams, videos, clips, categories). Tabs + platform filter + live-only toggle; clip playback via in-page Dialog. |
| `Stream/`       | `/stream/$platform/$channel`               | Primary live-stream viewer. Resolves HLS URL via `useStreamPlayback`, renders `KickLivePlayer` or `TwitchLivePlayer`, chat panel (draggable width, hideable), theater mode, PiP integration, offline screen. |
| `Video/`        | `/video/$platform/$videoId`                | VOD viewer. Fetches HLS URL via IPC (`videos.getPlaybackUrl`); accepts metadata via search params for fast load. Shows `KickVodPlayer`/`TwitchVodPlayer`, follow button, related-videos grid. |
| `MultiStream/`  | `/multistream`                             | Simultaneous multi-stream layout. Toolbar with grid/focus layout toggle and add-stream dialog; docked resizable chat panel (tied to one active stream). Uses `useMultiStreamStore`. |
| `Downloads/`    | `/downloads`                               | Download manager UI. Currently mock-only (no real IPC). Active and completed download sections with progress bars. |
| `History/`      | `/history`                                 | Watch history from `useHistoryStore`. Card grid with type-aware links (stream/video/clip). Clear-all and per-item remove. |
| `Settings/`     | `/settings?tab=`                           | Full-app settings hub. Sidebar-nav with 11 tabs: playback, player-controls, buffer, chat, adblock, proxy, predictions, integrations, api-tokens, updates, about. Deep-link via `?tab=`. |
| `Mod/`          | `/mod`, `/mod/$platform/$channel`          | Moderation admin console. Has its own `AGENTS.md` — see `Mod/AGENTS.md`. |

## Contracts

**Routing** — all pages use TanStack Router. Params come from `useParams`, search params from
`useSearch`. Route definitions (including `validateSearch` schemas) live in
`src/routes/router.tsx` — pages must stay in sync with the schema declared there.

**Data** — pages are thin orchestrators. Heavy data-fetching logic lives in
`src/hooks/queries/`. Pages compose hooks, pass data to components, and own UI state
(active tab, filter strings, sort order). Business logic belongs in hooks, not in pages.

**Stores accessed by pages:**
- `useAuthStore` — preferences, platform connection state, `updatePreferences`
- `useFollowStore` — local follow list, `upgradeFollowIfNeeded`
- `useHistoryStore` — watch history (read/write on Stream, Video, Clip, History pages)
- `useMultiStreamStore` — stream list and layout state for MultiStream
- `useAdBlockStore` — ad-block toggle (Settings)
- `useAppStore` — theater mode (`isTheaterModeActive`)
- `usePipStore` — picture-in-picture stream tracking

**IPC** — VideoPage and SettingsPage call `window.electronAPI` directly (video playback URL
resolution, proxy, token status). All other pages go through React Query hooks.

## Page Structure Conventions

1. One named export per `index.tsx` (e.g. `export function CategoriesPage()`).
2. Local sub-components that are page-specific live in a sibling `components/` folder
   (currently only `Home/components/`). Everything else is imported from `src/components/`.
3. All pages fill `h-full` from the AppLayout scroll container. Pages that scroll
   internally use `overflow-y-auto`; pages that need fixed-height (player, multistream)
   use `flex flex-col` with `overflow-hidden`.
4. Loading states are skeletons or inline spinners — never full-page spinners except for
   the router-level `PageLoader`.
5. Empty states are always explicit (no silent empty renders).
6. Design tokens are CSS variables (`var(--color-*)`) — no hardcoded hex in layout logic;
   platform-specific accent colors (#9146FF Twitch, #53FC18 Kick) are allowed inline where
   they are purely decorative.

## Anti-patterns

- Do not fetch data directly in a page component — wrap it in a `useQuery`/`useInfiniteQuery` hook in `src/hooks/queries/`.
- Do not import `better-sqlite3` or access IPC for mod-log from any page outside `Mod/`.
- Do not add global event listeners in a page without cleaning them up in the effect's return.
- Do not assume a page mounts only once — router cache may keep it mounted across navigations; reset derived state in the appropriate `useEffect`.
- Clips are dialog-only surfaces owned by `SearchResults/` and `components/stream/related-content`; do not add a standalone clip route/page.
- `DownloadsPage` is currently mock-only; do not build real features on top of its mock data shapes without replacing them first.

## Related Context

- `src/routes/router.tsx` — canonical route definitions and `validateSearch` schemas
- `src/components/` — shared UI, player, chat, stream, discovery components
- `src/hooks/queries/` — all React Query data hooks
- `src/store/` — Zustand stores consumed by pages
- `Mod/AGENTS.md` — moderation dashboard detail
- `DESIGN.md` — design system tokens and component conventions
