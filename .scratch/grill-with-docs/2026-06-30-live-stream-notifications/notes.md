# Live Stream Notifications: Grilling Session Notes
Date: 2026-06-30 · Goal: Define how StreamFusion should replace mock notification data with real live stream notifications and expose desktop notification settings.

## PRD

- [prd.md](./prd.md)

## Issues

- [01-real-notification-history.md](./issues/01-real-notification-history.md)
- [02-notifications-settings-tab.md](./issues/02-notifications-settings-tab.md)
- [03-live-notification-service-polling-mvp.md](./issues/03-live-notification-service-polling-mvp.md)
- [04-notification-click-navigation.md](./issues/04-notification-click-navigation.md)
- [05-twitch-eventsub-live-source.md](./issues/05-twitch-eventsub-live-source.md)
- [06-kick-bounded-polling-relay-ready-source.md](./issues/06-kick-bounded-polling-relay-ready-source.md)
- [07-degraded-notification-coverage-status.md](./issues/07-degraded-notification-coverage-status.md)
- [08-plan-hosted-kick-webhook-relay.md](./issues/08-plan-hosted-kick-webhook-relay.md)

## Implementation status

- Done: issues 01-07 are implemented, checked off, and closed in markdown.
- Human follow-up: issue 08, hosted Kick webhook relay plan, remains `ready-for-human`.
- Latest recorded quality gates after issue 07: focused coverage/service/Settings tests passed, `npm run typecheck` passed, `npm run lint` passed, `npm run build` passed with existing chunk-size warnings, and full `npm test` passed 346 files / 4429 tests.

## Summary / key decisions

Codebase baseline:
- The top-nav notifications dropdown currently owns hard-coded mock live notifications locally in `NotificationsDropdown.tsx`.
- Electron desktop notifications already exist through `notification:show` and `window.electronAPI.showNotification(title, body)`.
- User preferences already include `notifications.enabled` and `notifications.liveAlerts`, but Settings does not appear to expose a notification toggle yet.
- The app already resolves live followed streams through `STREAMS_GET_FOLLOWED`, combining Twitch remote followed streams, Twitch local follows via GQL, Kick account/local follows, and Kick public slug checks.
- `useFollowedStreams()` polls the followed stream status every 60 seconds while active, with background refetch disabled.
- The existing Twitch EventSub client is a reusable WebSocket + Helix subscription manager, but its typed event union currently only includes `channel.moderate`.
- Twitch's current EventSub docs define `stream.online` and `stream.offline` as broadcaster-user-id subscriptions with no extra authorization scope beyond being able to create the EventSub subscription.
- Main startup already creates the main window, registers IPC handlers, starts process/follow metadata services, and stops long-lived services in `before-quit`. The preferences model has `minimizeToTray`, but no tray controller implementation was found in the current code search.
- Current Kick docs describe Events as webhook delivery. `livestream.status.updated` covers stream started/ended, but webhook setup requires a publicly accessible URL; localhost does not work unless exposed through a tunnel or similar relay.

Decisions:
- Live notifications should be app-lifetime capable, not limited to the Following page or notification dropdown being open.
- The preferred architecture combines an always-on main-process notification service with platform-native push where available: Twitch EventSub plus polling/fallback where push is unavailable.
- The live notification service should run while StreamFusion is open, including when minimized to tray, and stop when the app fully quits.
- Twitch live notifications should subscribe to both `stream.online` and `stream.offline`, with polling as a resilience fallback.
- Kick should use main-process polling now and also plan for a hosted webhook relay path.
- Guest Follows should be first-class notification inputs; users should receive live notifications for followed channels even when not authenticated to that Platform.
- On app startup, the notification service should seed current live/offline state silently and not emit desktop notifications for channels that were already live.
- Duplicate prevention should notify once per stream session with cooldown protection, but must still handle real streamer restart scenarios without hiding the stream from the user.
- By default, every observed offline -> online transition after startup should be eligible to notify, so users do not miss streams during streamer connection issues. Users should be able to configure a restart grace/cooldown in Settings if they prefer fewer repeat notifications.
- Settings should include a notification panel that starts with the focused controls needed for this feature and is structured to support the fuller notification preferences surface.
- The first implementation should include the full notification settings surface: platform toggles, Guest Follow notifications, sound, favorites-only behavior, and per-channel controls.
- `favoriteChannelsOnly` should use the per-channel notification toggle as its marker. No separate Favorite concept is introduced.
- Notification defaults should be notify-by-default: desktop/live/platform/guest/sound enabled, favorites-only off, new follows per-channel notifications enabled, and restart grace off.
- In-app notifications should be real-only, persisted locally, clearable, and capped to the 50 most recent Live Notifications.
- Clicking a desktop or in-app Live Notification should open/focus the stream page but keep the notification in history until explicitly dismissed or cleared.
- Close-to-tray behavior is out of scope for this feature. Notifications run while the StreamFusion app process is open; closing/quitting the app stops notifications.
- The hosted Kick webhook relay should be a planned follow-up issue/ADR path, not part of the first live-notifications build.
- If OS desktop notifications are unsupported or blocked, Live Notifications should still be recorded in-app and Settings should expose a non-blocking desktop notification status.
- Auth changes should silently reconcile notification sources. Logging in, logging out, or auth loss should not create desktop notification bursts; Guest Follow coverage remains active where public lookups support it.
- Users with many follows should be handled through bounded batching and degraded coverage status, not aggressive unbounded subscriptions/polls or silent hard caps.
- Notification settings should live in a new `Notifications` tab in Settings.

## Q&A log

### Codebase research — existing notification and live-following paths
- Captured: Mock notification data lives in the renderer dropdown. Real live followed stream data already exists behind the unified `STREAMS_GET_FOLLOWED` IPC path. Desktop notifications can already be shown by the main process, but there is no app-level live notification service or settings UI wired to `NotificationPreferences`.
- Doc updates: none
- Flags: whether live notifications should be renderer-page scoped or app-lifetime/background scoped -> user

### Q1 — notification source of truth
- Asked: What should count as the source of truth for “real live notifications”?
- Captured: User chose both an always-on main-process notification service and platform-native push where possible. This rules out a renderer-page-only followed-streams poll as the target design.
- Doc updates: none
- Flags: exact split between Twitch EventSub, Kick polling, and poll fallback behavior -> user + codebase research

### Codebase research — Twitch EventSub reuse
- Captured: `twitch-eventsub-client.ts` already manages one WebSocket session, subscription refcounts, reconnects, keepalive, and Helix POST/DELETE. It can be extended for `stream.online`/`stream.offline`; the current `TwitchEventSubEventType` union and POST body are shaped around `channel.moderate`, so the implementation needs event-specific condition/version handling.
- Doc updates: none
- Flags: whether live notification service should subscribe to both online and offline or online-only with poll reconciliation -> user

### Q2 — service lifetime
- Asked: When should the live notification service run?
- Captured: User chose app-lifetime service. It should stay active while StreamFusion is open, including minimized/tray states, and stop only when the app fully quits.
- Doc updates: none
- Flags: hook point for app lifecycle/tray behavior -> codebase research

### Codebase research — app lifecycle hook
- Captured: The live notification service should be started from main-process app startup after auth/storage/platform clients are available, not from a renderer page. It should be disposed in `before-quit` alongside `stopKickFollowMetadataRefresh()` and other app-lifetime services. Because no tray controller is currently implemented, the service should not depend on tray state yet.
- Doc updates: none
- Flags: actual tray behavior may need separate implementation if the user expects close-to-tray semantics in the same feature

### Q3 — Twitch EventSub event coverage
- Asked: For Twitch, should the service subscribe to both `stream.online` and `stream.offline`?
- Captured: User chose online + offline EventSub with poll fallback. Online events should trigger notifications quickly. Offline events should update service memory so future online transitions can notify again.
- Doc updates: none
- Flags: EventSub subscription fan-out and rate/cost behavior for many followed channels -> implementation planning

### Codebase and docs research — Kick live event feasibility
- Captured: StreamFusion currently detects Kick followed live status by scanning followed slugs with `getPublicStreamBySlug`, in-flight dedupe, failure cache, last-known-good cache, and a 90s positive/offline poll-hit TTL. Current Kick official docs expose `livestream.status.updated`, but only through webhooks that require a publicly accessible endpoint. A desktop-only implementation cannot receive Kick webhook events directly without a relay/tunnel/cloud component.
- Doc updates: none
- Flags: whether to build a Kick webhook relay now or use polling now with a later relay path

### User checkpoint — edge cases
- Asked: User asked whether the plan covers edge cases.
- Captured: Edge cases have not been fully grilled yet. They must be covered before close-out, especially missed events, duplicate notifications, app startup state, auth loss, many follows/rate limits, offline flapping, notification permission/support, and settings changes while the service is running.
- Doc updates: none
- Flags: edge-case policy decisions -> user

### Q4 — Kick live notification source and guest follows
- Asked: How should Kick “live” notifications work?
- Captured: User chose both polling now with relay-ready design and planning a hosted webhook relay. User also explicitly required notifications for Guest Follows: following a channel in guest mode should still produce live notifications without platform auth.
- Doc updates: `CONTEXT.md` added `Guest Follow` and `Live Notification`.
- Flags: hosted relay scope, authless source coverage, and rollout sequencing -> user

### Q5 — startup state
- Asked: What should happen on app startup if channels are already live?
- Captured: User chose silent startup seed. The real in-app notification list/live state may show current live channels, but desktop notifications should only fire for new offline -> live transitions after service startup.
- Doc updates: none
- Flags: none

### Q6 — duplicate and spam prevention
- Asked: How should we prevent duplicate or spammy notifications?
- Captured: User chose once per stream session plus cooldown, then raised a restart edge case: if a streamer has connection issues and restarts several times, the user should not miss the stream because dedupe/cooldown suppressed every later live event.
- Doc updates: none
- Flags: define restart grace/cooldown policy that balances spam prevention with not missing real restarts -> user

### Q7 — restart grace policy
- Asked: What restart policy should we use?
- Captured: User prefers always re-notifying after any observed offline -> online transition by default, to avoid missing streams during streamer connection trouble. Add a Settings control so users can configure a restart grace/cooldown if they want repeat restart notifications suppressed for a chosen duration.
- Doc updates: none
- Flags: exact settings control shape and default restart grace value -> user

### Q8 — notification settings surface
- Asked: What notification settings should we add?
- Captured: User chose both the focused on/off + restart grace settings and the fuller notification panel direction. Interpret as: add a Settings notification panel now with desktop notifications, live notifications, and restart grace; design/store it so fuller controls such as per-platform/favorites/sound can fit naturally rather than being bolted on later.
- Doc updates: none
- Flags: exact full-panel controls that are in scope for the first implementation -> user

### Q9 — full panel first-slice scope
- Asked: Which “full panel” controls are in scope for the first implementation?
- Captured: User chose everything now: platform toggles, Guest Follow notifications, sound, favorites-only, and per-channel toggles should be included in the first implementation rather than deferred.
- Doc updates: none
- Flags: define per-channel notification semantics and what “favorite” means in the existing Follow model -> user

### Q10 — favorites-only semantics
- Asked: What should “favorites-only” mean?
- Captured: User chose per-channel notification toggle as the favorite marker. If `favoriteChannelsOnly` is on, only followed channels with per-channel notifications enabled can produce Live Notifications. No separate Favorite model should be added.
- Doc updates: none
- Flags: defaults for global and per-channel notification toggles -> user

### Q11 — notification defaults
- Asked: What should the defaults be?
- Captured: User chose notify-by-default. Desktop notifications, live notifications, Twitch, Kick, Guest Follow notifications, sound, and new follows' per-channel notification toggles should default on. Favorites-only defaults off. Restart grace defaults off, meaning notify every observed restart unless the user configures a cooldown.
- Doc updates: none
- Flags: none

### Q12 — in-app notification persistence
- Asked: Should in-app notifications persist after app restart?
- Captured: User chose persisted recent notifications. The top-nav dropdown should remove all mock data and show the last 50 real Live Notifications stored locally, with dismiss and clear-all behavior.
- Doc updates: none
- Flags: click/open behavior for desktop and in-app notifications -> user

### Q13 — notification click behavior
- Asked: What should happen when the user clicks a notification?
- Captured: User chose opening the stream while keeping the notification in history. Desktop notification click should focus/open StreamFusion and navigate to the stream page. Dropdown click should do the same. Neither click should remove the notification from the persisted history.
- Doc updates: none
- Flags: none

### Q14 — close-to-tray behavior
- Asked: Should this feature include real close-to-tray behavior?
- Captured: User chose minimized/open-app only. The feature should not implement close-to-tray behavior. Notifications run while the app process is open and stop when StreamFusion is closed or quit.
- Doc updates: none
- Flags: none

### Q15 — Kick hosted webhook relay rollout
- Asked: For the Kick hosted webhook relay, is it part of the first build or a planned follow-up?
- Captured: User chose follow-up issue. First build should use Kick polling now, but the live-notification service contract should allow a future hosted Kick webhook relay to augment or replace polling.
- Doc updates: none
- Flags: none

### Q16 — desktop notification support failures
- Asked: What should happen when desktop notifications are unsupported or blocked by the OS?
- Captured: User chose in-app fallback plus Settings status. The service should continue recording real in-app Live Notifications when desktop delivery is unavailable, and Settings should show a non-blocking status/warning for desktop notification support.
- Doc updates: none
- Flags: none

### Q17 — auth changes during runtime
- Asked: What should happen when auth changes while the app is running?
- Captured: User chose silent reconcile on auth changes. Login should sync/merge account follows with Guest Follows and seed newly discovered live state silently. Logout or auth loss should stop auth-only subscriptions while keeping Guest Follow polling active where possible. No desktop notification bursts should be produced by login/logout reconciliation.
- Doc updates: none
- Flags: none

### Q18 — many follows and rate limits
- Asked: How should we handle users with lots of follows?
- Captured: User chose bounded batching plus degraded status. Twitch EventSub should subscribe in bounded batches and fall back to polling if subscriptions fail or hit limits. Kick polling should use bounded concurrency/staggering and caches. Settings/logs should expose degraded notification coverage rather than silently overpromising.
- Doc updates: none
- Flags: none

### Q19 — settings location
- Asked: Where should notification settings live?
- Captured: User chose a new `Notifications` tab in Settings. The notification controls should not be buried under integrations or playback/app settings.
- Doc updates: `docs/adr/0006-main-process-live-notifications.md` created for the main-process service + Twitch EventSub + Kick polling architecture.
- Flags: none

## Open flags (pending input)

- None.
