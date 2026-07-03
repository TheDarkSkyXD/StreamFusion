Status: done

# Persist real Live Notification history and replace mock dropdown

## Parent

.scratch/grill-with-docs/2026-06-30-live-stream-notifications/prd.md

## What to build

Replace the top-nav mock notification rows with a real persisted Live Notification history. The dropdown should render the most recent real Live Notifications, cap history at 50, show an explicit empty state when no notifications exist, and support dismiss-one plus clear-all actions.

## Acceptance criteria

- [x] The notification dropdown no longer contains or renders hard-coded mock Stream data.
- [x] Real Live Notifications are stored locally and survive app restart.
- [x] Only the 50 most recent Live Notifications are retained.
- [x] The dropdown renders persisted notifications with Channel, Platform, Stream title, and relative time.
- [x] Dismissing one notification removes only that notification from persisted history.
- [x] Clear-all removes all persisted Live Notifications.
- [x] The dropdown shows an explicit empty state when history is empty.
- [x] Tests cover persistence, capping, dismiss-one, clear-all, mock-data removal, and empty state behavior.

## Blocked by

None - can start immediately

## Comments

Closed on 2026-07-02.

Implemented a persisted `useNotificationStore` with a 50-item cap, newest-first ordering, duplicate replacement, dismiss-one, and clear-all actions. Rewired `NotificationsDropdown` to render persisted Live Notifications instead of demo rows and show an explicit empty state.

Verification:

- `npm test -- --run tests/store/notification-store.test.ts tests/components/TopNavBar/NotificationsDropdown.test.tsx`
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- Manual Electron MCP check: seeded `streamfusion-live-notification-store` with a version 1 persisted Live Notification, reloaded the app, opened the notification dropdown, and verified the persisted channel/title/relative time rendered. Then cleared notifications and verified the empty state plus persisted `notifications: []`.
- Screenshots: `.scratch/images/issue-01-notifications-dropdown-seeded.png`, `.scratch/images/issue-01-notifications-dropdown-after-clear-click.png`
