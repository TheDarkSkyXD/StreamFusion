# StreamFusion features

This map groups code by user outcome. Paths are repository-relative. Read the linked source and its nearest `AGENTS.md` before editing.

## Product shell and navigation

The shell owns window chrome, global navigation, route loading, recovery, notifications, and global dialogs.

- Entry and routes: `apps/desktop/src/App.tsx`, `apps/desktop/src/routes/router.tsx`
- Layout: `apps/desktop/src/components/layout/`, `apps/desktop/src/components/TopNavBar/`
- Global state: `apps/desktop/src/store/app-store.ts`, `notification-store.ts`, `update-store.ts`
- Main boundary: `apps/desktop/src/backend/ipc/handlers/system-handlers.ts`, `update-handlers.ts`, `connectivity-handlers.ts`
- Tests: `apps/desktop/tests/App*.test.tsx`, layout and update handler tests

## Discover streams and channels

Home, Following, Categories, category detail, sidebar follows, and unified Search help users find Twitch and Kick content.

- Routes: `/`, `/following`, `/categories`, `/categories/$platform/$categoryId`, `/search`
- Pages: `apps/desktop/src/pages/Home/`, `Following/`, `Categories/`, `CategoryDetail/`, `SearchResults/`
- UI: `apps/desktop/src/components/discovery/`, `stream/`, `search/`, `layout/SidebarFollows.tsx`
- Queries: `apps/desktop/src/hooks/queries/`
- IPC: `category-handlers.ts`, `channel-handlers.ts`, `search-handlers.ts`, `stream-handlers.ts`
- Platform reads: `apps/desktop/src/backend/api/unified/platform-reader.ts`, `platforms/{twitch,kick}/endpoints/`
- State: `apps/desktop/src/store/follow-store.ts`
- Tests: matching page, query, IPC handler, and Platform endpoint tests under `apps/desktop/tests/`

## Watch live streams, videos, and clips

The watch path resolves provider content, plays HLS media, exposes controls, tracks progress, and shows related videos and clips.

- Routes: `/stream/$platform/$channel`, `/video/$platform/$videoId`
- Pages: `apps/desktop/src/pages/Stream/`, `apps/desktop/src/pages/Video/`
- Players: `apps/desktop/src/components/player/`, with provider branches in `player/twitch/` and `player/kick/`
- Related content: `apps/desktop/src/components/stream/related-content/`
- IPC: `stream-handlers.ts`, `video-handlers.ts`
- Platform resolution: `twitch-stream-resolver.ts`, `kick-stream-resolver.ts`, provider video and clip endpoints
- State: `volume-store.ts`, `playback-position-store.ts`, `pip-store.ts`, `seek-interval-store.ts`, `adblock-store.ts`
- Main services: Twitch manifest and playlist services, stream proxy, network ad blocking, VAFT patterns
- Tests: player, Stream, Video, stream handler, and video handler suites

## Chat, emotes, and engagement

Each stream can open Platform chat, render badges and third-party emotes, send eligible messages, replay VOD chat, and expose polls, predictions, pins, and room state where supported.

- UI: `apps/desktop/src/components/chat/`
- Renderer hooks: chat, emote, room-state, poll, prediction, pin, and replay hooks in `apps/desktop/src/hooks/`
- Contracts: `apps/desktop/src/shared/chat-types.ts`, `ipc-channels.ts`, `electron-api-types.ts`
- IPC: `chat-handlers.ts`, `chat-eligibility-handlers.ts`, `chat-replay-handlers.ts`, `kick-chat-handlers.ts`, `twitch-api-handlers.ts`
- Services: `apps/desktop/src/backend/services/chat/`, `services/emotes/`, `chat-replay-service.ts`
- Platform capabilities: Twitch Helix polls, predictions, moderation and EventSub. Kick predictions, pin mutations, chat endpoints, and Pusher chat.
- State: `chat-store.ts`, `room-state-store.ts`, `emote-store.ts`, `chat-cosmetics-store.ts`, `persisted-chat-history.ts`
- Tests: chat components, hooks, services, IPC handlers, parsers, and capability adapters

## Authentication, follows, and live notifications

Users can authenticate independently with Twitch and Kick, follow channels, retain guest follows, and receive live alerts.

- UI and provider: `apps/desktop/src/components/auth/`, `AuthProvider`
- Renderer hooks: auth, follow, account reconciliation, and live-notification hooks
- IPC: `auth-handlers.ts`, `storage-handlers.ts`, `token-status-handlers.ts`, `twitch-api-handlers.ts`
- Auth core: `apps/desktop/src/backend/auth/`
- Follow services: Twitch and Kick follow write services plus Kick reconciliation and metadata repair
- Notifications: `live-notification-service.ts`, provider notification sources, `use-live-notification-bridge.ts`
- State: `auth-store.ts`, `follow-store.ts`, `notification-store.ts`
- Worker: `apps/worker/src/index.ts` handles Kick token exchange, refresh, and rate limits only
- Tests: auth, follow, notification, storage, and worker tests

## Multistream

Multistream lets users load, reorder, focus, mute, and remove up to the configured MultiviewCap of StreamSlots.

- Route: `/multistream`
- Page and UI: `apps/desktop/src/pages/MultiStream/`, `apps/desktop/src/components/multistream/`
- State: `apps/desktop/src/store/multistream-store.ts`
- Main ownership: `apps/desktop/src/backend/api/unified/slot-controller.ts`, `slot-host.ts`, `slot-retry-policy.ts`, and `backend/ipc/handlers/slot-controller-handlers.ts`
- Contracts: slot IPC channels and preload methods
- Player integration: StreamSlot presence drives player quality, buffering, audio, and lifecycle
- Tests: MultiStream page, multistream components and store, slot controller and stream-slot tests

## Downloads, recordings, and history

Users can download clips and videos, record live streams, recover interrupted recordings, and revisit watched content.

- Routes: `/downloads`, `/history`
- Pages: `apps/desktop/src/pages/Downloads/`, `History/`
- UI: `apps/desktop/src/components/recording/`, download confirmation dialog
- IPC: `download-handlers.ts`, `stream-recording-handlers.ts`
- Services: download queue and media services, FFmpeg and direct-file download services, stream recording services and session store
- State: `history-store.ts`, `download-duplicate-confirmation-store.ts`
- Tests: Downloads, History, recording UI, download handlers and services, recording handlers and services

## Moderation dashboard

Authenticated moderators can choose a managed channel, review engagement and retention, inspect moderation history, and perform provider-supported moderation actions.

- Routes: `/mod`, `/mod/twitch/$channel`, `/mod/kick/$channel`
- Pages: `apps/desktop/src/pages/Mod/`
- Hooks: moderation, banned users, moderators, VIPs, unban requests, polls, predictions, and mod-log hooks
- IPC: `modlog-handlers.ts`, `timeout-moderation-handlers.ts`, `twitch-api-handlers.ts`
- Platform operations: Twitch Helix moderation modules and Kick mod mutation adapters
- State: `moderated-channels-store.ts`, `dev-mod-override-store.ts`
- Persistence: `mod-log-writer.ts`, moderation authorization and retention services
- Tests: Mod page and component suites, moderation hooks, IPC, services, and provider adapters

## Settings, diagnostics, captions, and maintenance

Settings controls appearance and behavior, auth, chat preferences, proxy and ad-blocking options, local captions, logs, updates, diagnostics, bug reports, and destructive storage actions.

- Route: `/settings`
- Page: `apps/desktop/src/pages/Settings/`
- UI: `apps/desktop/src/components/settings/`, `components/dev/DeveloperConsole.tsx`
- Diagnostics renderer: `apps/desktop/src/renderer/diagnostics/`, `use-diagnostics-workspace.ts`
- IPC: diagnostics, local-caption, log, proxy, ad-block, bug-report, update, storage, and system handlers
- Main services: `backend/diagnostics/`, `services/captions/`, logging, proxy, ad-block, update, and storage services
- State: app, auth, chat, update, ad-block, and diagnostic view state
- Tests: Settings, diagnostics, captions, logging, proxy, ad-block, update, storage, and bug-report suites

## Cross-cutting boundaries

- Renderer to main: `apps/desktop/src/shared/ipc-channels.ts` to shared request and response types to `apps/desktop/src/preload/` to `apps/desktop/src/backend/ipc/`
- Lazy loading: `apps/desktop/src/preload/ipc-feature-loader.ts` and `apps/desktop/src/backend/ipc/lazy-feature-loader.ts`
- Platform-neutral reads: `apps/desktop/src/backend/api/unified/`
- Provider adapters: `apps/desktop/src/backend/api/platforms/twitch/` and `kick/`
- Persistence: Zustand stores in the renderer, `electron-store` and SQLite services in main
- Reliability: recovery boundaries, PlatformHealth, network banners, typed IPC validation, and diagnostics
- Verification: Vitest projects under `apps/desktop/tests/`, Storybook stories beside UI, Worker tests under `apps/worker/`
