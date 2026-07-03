Status: done

# Build app-lifetime Live Notification service with polling MVP

## Parent

.scratch/grill-with-docs/2026-06-30-live-stream-notifications/prd.md

## What to build

Build the main-process Live Notification service and prove the end-to-end path with polling sources. The service should run while StreamFusion is open, seed current live/offline state silently, detect later offline-to-online transitions, respect notification preferences, include Guest Follows, persist in-app notifications, and show desktop notifications when supported.

## Acceptance criteria

- [x] The Live Notification service starts during app startup after storage/auth/platform clients are available.
- [x] The service stops during app shutdown and does not imply notification delivery after the app is quit.
- [x] Startup seeds current live/offline state silently without desktop notification bursts.
- [x] Auth login, logout, and auth-lost events reconcile sources silently without desktop notification bursts.
- [x] Guest Follows are eligible notification inputs wherever public Platform lookup supports them.
- [x] Offline-to-online transitions after startup create persisted Live Notifications.
- [x] Desktop notifications are shown only when desktop notifications and Live Notifications are enabled and OS support is available.
- [x] If OS desktop notifications are unsupported or blocked, in-app Live Notification history still records the notification.
- [x] Platform, Guest Follow, sound, favorites-only, per-channel, and restart grace preferences are respected.
- [x] Restart grace defaults off, so every observed offline-to-online restart can notify unless the user configures a grace period.
- [x] Tests cover startup seed, transition emission, preference gating, Guest Follows, auth reconciliation, OS unsupported fallback, duplicate prevention, and restart grace behavior.

## Blocked by

- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/01-real-notification-history.md
- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/02-notifications-settings-tab.md

## Comments

- Implemented `LiveNotificationService` in `apps/desktop/src/backend/services/live-notification-service.ts` with silent startup seeding, app-lifetime polling, stop-on-shutdown, duplicate prevention, Guest Follow/public lookup support, preference gates, desktop notification gating, sound/silent handling, and restart grace cooldown.
- Wired main process lifecycle in `apps/desktop/src/main.ts`, auth silent reconciliation in `apps/desktop/src/backend/ipc/handlers/auth-handlers.ts`, main-to-renderer push channel in `apps/desktop/src/shared/ipc-channels.ts` and `apps/desktop/src/preload/index.ts`, and renderer persistence via `apps/desktop/src/hooks/use-live-notification-bridge.ts` mounted in `apps/desktop/src/App.tsx`.
- Verification: focused notification/auth tests passed (`tests/backend/services/live-notification-service.test.ts`, `tests/hooks/use-live-notification-bridge.test.tsx`, `tests/store/notification-store.test.ts`, `tests/shared/auth-types.test.ts`, `tests/backend/ipc/handlers/auth-handlers.test.ts`); `npm run typecheck` passed; `npm run lint` passed; `npm run build` passed with existing chunk-size warnings; full `npm test` passed 344 files / 4408 tests.
