# stream/ — Stream Browsing & Channel Display Components

## Purpose

Platform-agnostic components for browsing live streams (grid/cards), featuring a highlighted stream, and displaying a channel's full info with VODs and clips. All components consume `UnifiedStream` / `UnifiedChannel` from the backend unified API, so Twitch and Kick data flow through identical props.

---

## File Inventory

### Root (`stream/`)

| File | Role |
|---|---|
| `stream-card.tsx` | Single stream tile used inside a grid. `React.memo`. Hover-prefetches channel + stream queries via a 150 ms debounced timer. |
| `stream-card-skeleton.tsx` | Loading placeholder that mirrors the StreamCard layout (aspect-video + avatar + text rows). |
| `stream-grid.tsx` | Responsive 1→2→3→4-col grid. Shows skeletons when `isLoading`, empty state with message, or stagger-animates the first batch of cards. Uses `getStreamElementKey` for stable keys. |
| `featured-stream.tsx` | Hero banner for the highest-priority stream. Left side: title/category/CTA. Right side: clickable 16:9 thumbnail. Background is a blurred, scaled copy of the thumbnail. |
| `stream-info.tsx` | Full channel header used on the `/stream/:platform/:channel` page. Shows avatar, title, category (cross-platform link via `useUnifiedCategoryLink`), live tags, viewer count, uptime (isolated `UptimeCounter` memo), follow button, and optional mod shortcut for Twitch/Kick mods. |
| `related-content.tsx` | Thin re-export shim kept for backward compatibility; real implementation is in `related-content/`. |
| `index.ts` | Barrel export for all public components and types. |

### `stream/related-content/`

| File | Role |
|---|---|
| `index.tsx` | `RelatedContent` — the full VOD/clip browser for a channel page. Owns all state: active tab, sort, time-range filter, pagination cursors, clip dialog. Calls `window.electronAPI.videos` / `window.electronAPI.clips` directly. |
| `types.ts` | `VideoOrClip` (unified shape for VODs and clips), `ClipPlayerProps`, `RelatedContentProps`. |
| `utils.ts` | `formatTimeAgo(dateString)` and `formatViews(views)` — pure formatting helpers local to this subsystem. |
| `ContentTabs.tsx` | Sticky tab bar with Home / Videos / Clips links. Tab state travels via URL search param `?tab=`. |
| `VideoCard.tsx` | Memoized card for a VOD or live record. Routes to `/video/$platform/$videoId` (VOD) or `/stream/$platform/$channel` (live) based on `isLive` + `duration !== "0:00"` heuristic. Hides itself when its proxied thumbnail returns a 403. |
| `ClipCard.tsx` | Memoized clip tile. Fires an `onClick` to open the `ClipDialog` rather than navigating. |
| `ClipDialog.tsx` | Full-screen modal for clip playback. Uses `TwitchVodPlayer` / `KickVodPlayer` when a direct URL is available; falls back to the Twitch iframe embed on failure. Handles "Watch Full Video" — Twitch navigates directly via `vodId`; Kick must first call `electronAPI.videos.getByLivestreamId` to resolve the VOD id. |
| `ClipPlayer.tsx` | Custom `<video>` wrapper with HLS.js support, persistent volume (via `useVolumeStore`), progress bar, volume slider, and fullscreen. Used indirectly inside `ClipDialog` via the platform VOD players. |

### `stream/kick/` and `stream/twitch/`

Both are empty placeholder index files. Platform-specific stream embed/chat components are meant to go here when created.

---

## Contracts & Invariants

- **`UnifiedStream`** props are required (never nullable) in `StreamCard` and `FeaturedStream`. Callers must guard before passing.
- **`StreamGrid`** accepts an undefined `streams` array; it renders skeletons when `isLoading` and empty state otherwise — callers do not need to branch.
- **`RelatedContent`** requires `channelData?.id` to be truthy before it will fire any IPC fetch. During loading, it renders skeletons silently.
- **Tab state** is URL-first (`?tab=home|videos|clips`) and defaults to `home` when the URL has no tab. Do not use saved tab preference as a stream-page fallback; every stream should open on Home unless deep-linked otherwise.
- **Clip playback** fetches a URL via `electronAPI.clips.getPlaybackUrl` after selection. Twitch silently falls back to iframe on any error; Kick shows an error state.
- **`VideoCard` self-hides** (`return null`) when `onProxyError` fires — no parent intervention needed.
- **Prefetch delay** on `StreamCard` is 150 ms. The `useManagedTimeout` hook clears the timer on `mouseLeave`, so fast scroll-past does not cause spurious queries.
- **Infinite scroll sentinel** is only rendered when there are already items and `hasMore*` is true, preventing premature load-more calls.

---

## Patterns

- **Memoization at card boundaries.** `StreamCard`, `VideoCard`, and `ClipCard` all use `React.memo` / `memo()`. Do not remove — grids can contain 50+ cards.
- **Isolated ticker.** `UptimeCounter` inside `stream-info.tsx` uses `useInterval` at 1 s and is a separate memo so the parent does not re-render every second.
- **Platform color constants** are inline hex strings (`#9146FF` for Twitch, `#53FC18` for Kick). Use the same values for any new platform-branded UI in this directory.
- **IPC calls** in `RelatedContent` go through `(window as any).electronAPI`. Do not introduce TanStack Query for VOD/clip data inside this component — the cursor-based pagination state is owned locally.
- **Stagger animation.** `StreamGrid` applies the `stagger-container` class only on the first render batch via a `useRef` flag. Do not add animation classes to cards added via infinite scroll.
- **`getStreamElementKey`** from `@/lib/id-utils` produces stable, cross-platform unique keys. Always use it instead of `stream.id` alone.

---

## Anti-patterns

- Do not query the Electron IPC directly from `StreamCard` or `StreamGrid` — they receive props only and must stay pure presentational components.
- Do not lift `RelatedContent` state (sort, cursor, clip selection) into a parent. It is intentionally self-contained.
- Do not add platform branches (`if platform === "twitch"`) inside `stream-card.tsx` or `stream-grid.tsx`. Any platform-specific variation belongs in `stream/twitch/` or `stream/kick/`.
- Avoid non-`ProxiedImage` `<img>` tags for any stream or channel thumbnails — the proxy is required to bypass CDN CORS restrictions.
- Do not call `window.location.reload()` for retry logic in new code; the existing call in `related-content/index.tsx` is a known tech-debt item.

---

## Related Context

- **Types:** `UnifiedStream`, `UnifiedChannel` — `apps/desktop/src/backend/api/unified/platform-types.ts`
- **Query keys:** `STREAM_KEYS`, `CHANNEL_KEYS` — `apps/desktop/src/hooks/queries/`
- **Volume persistence:** `useVolumeStore` — `apps/desktop/src/store/volume-store.ts`
- **Platform players:** `KickVodPlayer`, `TwitchVodPlayer` — `apps/desktop/src/components/player/`
- **Routing:** all stream links use TanStack Router route `/stream/$platform/$channel` with `?tab=` search param
- **Category linking:** `useUnifiedCategoryLink` normalises cross-platform category IDs so the same game on Kick and Twitch points to the same merged category page
