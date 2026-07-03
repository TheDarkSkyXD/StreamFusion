Status: done

# Add Notifications Settings tab and preference model

## Parent

.scratch/grill-with-docs/2026-06-30-live-stream-notifications/prd.md

## What to build

Add a dedicated Notifications tab in Settings with the full notification control surface. Defaults should be notify-by-default, restart grace should default to off, and favorites-only should mean only Channels with per-channel notifications enabled can produce Live Notifications.

## Acceptance criteria

- [x] Settings includes a new Notifications tab in the existing Settings navigation.
- [x] Notification preferences include desktop notifications, Live Notifications, Twitch, Kick, Guest Follow notifications, sound, favorites-only, and restart grace.
- [x] Restart grace supports Off, 5 minutes, 15 minutes, and 30 minutes, with Off as the default.
- [x] Defaults are notify-by-default: desktop, Live Notifications, Twitch, Kick, Guest Follow notifications, sound, and new follow per-channel notifications on; favorites-only and restart grace off.
- [x] Per-channel notification controls are available for followed Channels.
- [x] When favorites-only is enabled, only Channels with per-channel notifications enabled are eligible to notify.
- [x] The tab exposes non-blocking desktop notification support status and a placeholder/status region for degraded notification coverage.
- [x] Tests cover preference defaults, persistence, restart grace changes, platform toggles, Guest Follow toggle, favorites-only behavior, and per-channel controls.

## Blocked by

None - can start immediately

## Comments

Closed on 2026-07-02.

Implemented the Settings -> Notifications tab and expanded the persisted notification preference model with Twitch, Kick, Guest Follow, restart grace, and per-channel notification overrides. Added a pure eligibility helper for later live-source services so favorites-only behavior and guest-follow eligibility have one contract.

Verification:

- `npm test -- --run tests/pages/Settings.test.tsx tests/lib/live-notification-preferences.test.ts tests/shared/auth-types.test.ts tests/backend/services/storage-service.test.ts`
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- Manual Electron MCP check: opened Settings -> Notifications, verified global toggles and restart grace, followed-channel controls, desktop support status, and degraded coverage placeholder/status region.
- Screenshots: `.scratch/images/issue-02-settings-notifications-tab.png`, `.scratch/images/issue-02-settings-notifications-scrolled.png`, `.scratch/images/issue-02-settings-notifications-coverage-filtered.png`
