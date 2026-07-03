Status: done

# Wire notification click navigation

## Parent

.scratch/grill-with-docs/2026-06-30-live-stream-notifications/prd.md

## What to build

Clicking a Live Notification should focus/open StreamFusion and navigate to the relevant Stream page without removing the notification from persisted history. This behavior should apply to both desktop notifications and in-app dropdown rows.

## Acceptance criteria

- [x] Clicking an in-app Live Notification opens the matching Stream page.
- [x] Clicking a desktop Live Notification focuses or opens the StreamFusion window and opens the matching Stream page.
- [x] Clicking either notification type does not remove the notification from persisted history.
- [x] Dismiss and clear-all remain the only removal actions.
- [x] Navigation works for both Twitch and Kick Channels.
- [x] Tests cover in-app click navigation, desktop click navigation plumbing, and history retention after click.

## Blocked by

- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/01-real-notification-history.md
- .scratch/grill-with-docs/2026-06-30-live-stream-notifications/issues/03-live-notification-service-polling-mvp.md

## Comments

- Implemented in-app notification row navigation in `apps/desktop/src/components/TopNavBar/NotificationsDropdown.tsx`; click opens `/stream/$platform/$channel` and does not mutate persisted notification history.
- Added desktop notification click plumbing in `apps/desktop/src/backend/services/live-notification-service.ts` via `showLiveDesktopNotification`, which restores/shows/focuses the main window and pushes `notification:open-stream` to the renderer. The preload bridge and `useLiveNotificationBridge` now subscribe to that push and navigate without removing history.
- Verification: focused issue tests passed (`tests/components/TopNavBar/NotificationsDropdown.test.tsx`, `tests/hooks/use-live-notification-bridge.test.tsx`, `tests/backend/services/live-notification-service.test.ts`); `npm run typecheck` passed; `npm run lint` passed; `npm run build` passed with existing chunk-size warnings; full `npm test` passed 344 files / 4411 tests.
