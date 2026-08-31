# StreamFusion features

This map groups code by user outcome. Paths are repository-relative. Read the linked source and its nearest `AGENTS.md` before editing.

Renderer capability code lives under `apps/desktop/src/frontend/features/<feature>/`. Each feature owns `components`, `data`, `routes`, and `utils`. `apps/desktop/src/frontend/routes/router.tsx` composes the feature route exports.

## Product shell and navigation

The shell owns window chrome, global navigation, route loading, recovery, notifications, and global dialogs.

- Entry and routes: `apps/desktop/src/frontend/App.tsx`, `apps/desktop/src/frontend/routes/router.tsx`
- Feature: `apps/desktop/src/frontend/features/shell/`
- Global state: `apps/desktop/src/frontend/store/app-store.ts`, `notification-store.ts`, `update-store.ts`
- Main boundary: `apps/desktop/src/backend/ipc/handlers/system-handlers.ts`, `update-handlers.ts`, `connectivity-handlers.ts`
- Tests: `apps/desktop/tests/App*.test.tsx`, layout and update handler tests

## Discover streams and channels

Home, Following, Categories, category detail, sidebar follows, and unified Search help users find Twitch and Kick content.

- Routes: `/`, `/following`, `/categories`, `/categories/$platform/$categoryId`, `/search`
- Feature: `apps/desktop/src/frontend/features/discovery/`
- Sidebar integration: `apps/desktop/src/frontend/features/shell/components/layout/SidebarFollows.tsx`
- IPC: `category-handlers.ts`, `channel-handlers.ts`, `search-handlers.ts`, `stream-handlers.ts`
- Platform reads: `apps/desktop/src/backend/api/unified/platform-reader.ts`, `platforms/{twitch,kick}/endpoints/`
- State: `apps/desktop/src/frontend/store/follow-store.ts`
- Tests: matching page, query, IPC handler, and Platform endpoint tests under `apps/desktop/tests/`

## Watch live streams, videos, and clips

The watch path resolves provider content, plays HLS media, exposes controls, tracks progress, and shows related videos and clips.

- Routes: `/stream/$platform/$channel`, `/video/$platform/$videoId`
- Feature: `apps/desktop/src/frontend/features/playback/`
- Players: `apps/desktop/src/frontend/features/playback/components/player/`, with provider branches in `player/twitch/` and `player/kick/`
- Related content: `apps/desktop/src/frontend/features/playback/components/related-content/`
- IPC: `stream-handlers.ts`, `video-handlers.ts`
- Platform resolution: `twitch-stream-resolver.ts`, `kick-stream-resolver.ts`, provider video and clip endpoints
- State: `volume-store.ts`, `playback-position-store.ts`, `pip-store.ts`, `seek-interval-store.ts`, `adblock-store.ts`
- Main services: Twitch manifest and playlist services, stream proxy, network ad blocking, VAFT patterns
- Tests: player, Stream, Video, stream handler, and video handler suites

## Chat, emotes, and engagement

Each stream can open Platform chat, render badges and third-party emotes, send eligible messages, replay VOD chat, and expose polls, predictions, pins, and room state where supported.

- Feature: `apps/desktop/src/frontend/features/chat/`
- Contracts: `apps/desktop/src/shared/chat-types.ts`, `ipc-channels.ts`, `electron-api-types.ts`
- IPC: `chat-handlers.ts`, `chat-eligibility-handlers.ts`, `chat-replay-handlers.ts`, `kick-chat-handlers.ts`, `twitch-api-handlers.ts`
- Services: `apps/desktop/src/backend/services/chat/`, `services/emotes/`, `chat-replay-service.ts`
- Platform capabilities: Twitch Helix polls, predictions, moderation and EventSub. Kick predictions, pin mutations, chat endpoints, and Pusher chat.
- State: `chat-store.ts`, `room-state-store.ts`, `emote-store.ts`, `chat-cosmetics-store.ts`, `persisted-chat-history.ts`
- Tests: chat components, hooks, services, IPC handlers, parsers, and capability adapters

## Authentication, follows, and live notifications

Users can authenticate independently with Twitch and Kick, follow channels, retain guest follows, and receive live alerts.

- Feature: `apps/desktop/src/frontend/features/auth/`
- IPC: `auth-handlers.ts`, `storage-handlers.ts`, `token-status-handlers.ts`, `twitch-api-handlers.ts`
- Auth core: `apps/desktop/src/backend/auth/`
- Follow services: Twitch and Kick follow write services, Kick follow identity resolution, and metadata refresh
- Notifications: `live-notification-service.ts`, provider notification sources, `use-live-notification-bridge.ts`
- State: `auth-store.ts`, `follow-store.ts`, `notification-store.ts`
- Worker: `apps/worker/src/index.ts` handles Kick token exchange, refresh, and rate limits only
- Tests: auth, follow, notification, storage, and worker tests

## Multistream

Multistream lets users load, reorder, focus, mute, and remove any number of StreamSlots. A separate PlaybackBudget limits concurrent decoders; overflow slots stay visible but suspended until activated.

- Route: `/multistream`
- Feature: `apps/desktop/src/frontend/features/multistream/`
- State: `apps/desktop/src/frontend/features/multistream/data/multistream-store.ts`
- Main ownership: `apps/desktop/src/backend/api/unified/slot-controller.ts`, `slot-host.ts`, `slot-retry-policy.ts`, and `backend/ipc/handlers/slot-controller-handlers.ts`
- Contracts: slot IPC channels and preload methods
- Player integration: StreamSlot presence drives player quality, buffering, audio, and lifecycle
- Tests: MultiStream page, multistream components and store, slot controller and stream-slot tests

## Downloads, recordings, and history

Users can download clips and videos, record live streams, recover interrupted recordings, and revisit watched content.

- Routes: `/downloads`, `/history`
- Feature: `apps/desktop/src/frontend/features/media-library/`
- IPC: `download-handlers.ts`, `stream-recording-handlers.ts`
- Services: download queue and media services, FFmpeg and direct-file download services, stream recording services and session store
- State: `history-store.ts`, `download-duplicate-confirmation-store.ts`
- Tests: Downloads, History, recording UI, download handlers and services, recording handlers and services

## Moderation dashboard

Authenticated moderators can choose a managed channel, review engagement and retention, inspect moderation history, and perform provider-supported moderation actions.

- Routes: `/mod`, `/mod/twitch/$channel`, `/mod/kick/$channel`
- Feature: `apps/desktop/src/frontend/features/moderation/`
- IPC: `modlog-handlers.ts`, `timeout-moderation-handlers.ts`, `twitch-api-handlers.ts`
- Platform operations: Twitch Helix moderation modules and Kick mod mutation adapters
- State: `features/moderation/data/moderated-channels-store.ts`, `store/dev-mod-override-store.ts`
- Persistence: `mod-log-writer.ts`, moderation authorization and retention services
- Tests: Mod page and component suites, moderation hooks, IPC, services, and provider adapters

## Settings, diagnostics, captions, and maintenance

Settings controls appearance and behavior, auth, chat preferences, proxy and ad-blocking options, local captions, logs, updates, diagnostics, bug reports, and destructive storage actions.

- Route: `/settings`
- Feature: `apps/desktop/src/frontend/features/settings/`
- Developer console: `apps/desktop/src/frontend/components/dev/DeveloperConsole.tsx`
- IPC: diagnostics, local-caption, log, proxy, ad-block, bug-report, update, storage, and system handlers
- Main services: `backend/diagnostics/`, `services/captions/`, logging, proxy, ad-block, update, and storage services
- State: app, auth, chat, update, ad-block, and diagnostic view state
- Tests: Settings, diagnostics, captions, logging, proxy, ad-block, update, storage, and bug-report suites

## Cross-cutting boundaries

- Renderer to main: `apps/desktop/src/shared/ipc-channels.ts` to shared request and response types to `apps/desktop/src/backend/preload/` to `apps/desktop/src/backend/ipc/`
- Lazy loading: `apps/desktop/src/backend/preload/ipc-feature-loader.ts` and `apps/desktop/src/backend/ipc/lazy-feature-loader.ts`
- Platform-neutral reads: `apps/desktop/src/backend/api/unified/`
- Provider adapters: `apps/desktop/src/backend/api/platforms/twitch/` and `kick/`
- Persistence: capability-owned Zustand stores live in feature `data/`; cross-cutting renderer stores remain in `src/store/`; `electron-store` and SQLite services remain in main
- Reliability: recovery boundaries, PlatformHealth, network banners, typed IPC validation, and diagnostics
- Verification: Vitest projects under `apps/desktop/tests/`, Storybook stories beside UI, Worker tests under `apps/worker/`
