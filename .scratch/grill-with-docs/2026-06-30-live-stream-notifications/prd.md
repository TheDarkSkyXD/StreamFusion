# Live Stream Notifications PRD

## Problem Statement

StreamFusion currently shows mock notification data in the top navigation instead of real stream activity. Users who follow Channels on Twitch or Kick, including Guest Follows created without Platform auth, need reliable Live Notifications when a followed Channel starts a Stream. They also need control over desktop notifications, restart spam, platform coverage, Guest Follow coverage, sound, favorites-only behavior, and per-channel notification eligibility.

## Solution

Build an app-lifetime Live Notification system owned by the main process. The service runs while StreamFusion is open, seeds current live/offline state silently on startup, listens for new offline-to-online transitions, records real in-app notification history, and shows desktop notifications when enabled and supported by the OS.

Twitch should use EventSub `stream.online` and `stream.offline` where possible, with a polling fallback for missed or degraded push coverage. Kick should use bounded main-process polling for the first build because Kick live events require webhook delivery through a public callback URL. The implementation should be relay-ready so a future hosted Kick webhook relay can feed the same notification pipeline without changing the user-facing model.

The top-nav notification dropdown should remove all mock data and show the 50 most recent persisted Live Notifications. Clicking a notification opens/focuses the relevant stream page but keeps the notification in history until the user dismisses it or clears all notifications. Settings should add a dedicated Notifications tab with the full notification controls.

## User Stories

1. As a StreamFusion user, I want the notification dropdown to show real Live Notifications, so that I am not misled by mock stream activity.
2. As a StreamFusion user, I want desktop notifications when followed Channels go live, so that I can join Streams without manually checking the app.
3. As a StreamFusion user, I want Guest Follows to produce Live Notifications, so that I can use notifications without logging in to Twitch or Kick.
4. As a Twitch user, I want StreamFusion to use Twitch live events when available, so that Twitch Live Notifications arrive quickly.
5. As a Kick user, I want StreamFusion to notify me for followed Kick Channels, so that Kick live activity is covered even before a hosted relay exists.
6. As a user with many follows, I want notification coverage to degrade visibly instead of silently failing, so that I know when some follows may not be monitored.
7. As a user opening StreamFusion, I do not want desktop notification spam for Channels already live at startup, so that launch stays quiet.
8. As a user whose streamer has connection issues, I want restart notifications by default, so that I do not miss a Stream that had to restart.
9. As a quieter user, I want a configurable restart grace period, so that repeated restarts can be suppressed for a chosen duration.
10. As a user, I want to turn desktop notifications on or off, so that StreamFusion respects my attention preferences.
11. As a user, I want to turn Live Notifications on or off separately, so that notification history and desktop delivery can be controlled at the feature level.
12. As a user, I want Twitch and Kick notification toggles, so that I can disable one Platform without disabling the other.
13. As a user, I want to turn Guest Follow notifications on or off, so that unauthenticated local follows can be included or excluded.
14. As a user, I want sound control, so that desktop notification sound matches my preference and OS support.
15. As a user, I want favorites-only behavior, so that only follows with per-channel notifications enabled can alert me.
16. As a user, I want per-channel notification toggles, so that some followed Channels can notify while others stay quiet.
17. As a user, I want new follows to notify by default, so that I do not have to opt in one Channel at a time.
18. As a user, I want notification history to persist after restart, so that I can review recent Stream activity later.
19. As a user, I want to dismiss one notification, so that I can clean up notification history without clearing everything.
20. As a user, I want to clear all notifications, so that I can reset the notification list.
21. As a user, I want clicking a desktop notification to focus StreamFusion and open the Stream page, so that I can immediately watch.
22. As a user, I want clicking an in-app notification to open the Stream page without deleting history, so that the dropdown remains an activity log.
23. As a user whose OS blocks desktop notifications, I want in-app notification history to keep working, so that the feature is still useful.
24. As a user, I want Settings to show desktop notification support status, so that I understand why OS notifications may not appear.
25. As a user logging in, logging out, or losing auth, I want notification sources to reconcile silently, so that auth changes do not create notification bursts.
26. As a user quitting StreamFusion, I expect notifications to stop, so that the app does not imply background behavior it does not provide.
27. As a future maintainer, I want the Kick relay path captured as a follow-up, so that the first build stays shippable without blocking on cloud infrastructure.

## Implementation Decisions

- Add an app-lifetime main-process Live Notification service. It starts during app startup after storage/auth/platform clients are available and stops during app shutdown.
- Do not implement close-to-tray behavior in this feature. Notifications run while the app process is open and stop when StreamFusion is closed or quit.
- Extend the existing Twitch EventSub seam to support `stream.online` and `stream.offline` subscriptions. The service should update live/offline memory from both events and use polling as a fallback.
- Use Kick polling for the first build. Polling must use bounded concurrency, staggering, existing cache behavior, and degraded coverage reporting.
- Keep the notification pipeline source-agnostic so a future Kick webhook relay can feed Live Notifications without changing Settings, persistence, or dropdown behavior.
- Include Guest Follows as first-class notification inputs. Public/authless lookup paths should cover them where Platform APIs support it.
- Seed current live/offline state silently on startup and after auth reconciliation. Only post-startup offline-to-online transitions are eligible for desktop notification delivery.
- Default restart grace is off, meaning every observed offline-to-online restart can notify. Users can choose a restart grace of Off, 5 minutes, 15 minutes, or 30 minutes.
- Prevent duplicates by tracking Channel/Stream state and source delivery identity where available. EventSub duplicates and polling overlap must not create duplicate notifications for the same observed live transition.
- Persist the 50 most recent real Live Notifications locally. Remove mock notification rows entirely.
- Notification click behavior opens/focuses the stream page and keeps the notification in persisted history.
- Add dismiss-one and clear-all actions for notification history.
- Add a new Settings tab named Notifications.
- Settings must include desktop notifications, Live Notifications, Twitch, Kick, Guest Follow notifications, sound, favorites-only, restart grace, per-channel controls, and desktop notification support/degraded coverage status.
- Treat `favoriteChannelsOnly` as "only Channels with per-channel notifications enabled." Do not introduce a separate Favorite model.
- Defaults are notify-by-default: desktop notifications on, Live Notifications on, Twitch on, Kick on, Guest Follow notifications on, sound on when supported, favorites-only off, new follows per-channel notifications on, restart grace off.
- If OS desktop notifications are unsupported or blocked, keep in-app Live Notifications working and expose a non-blocking Settings status.
- Auth changes reconcile silently. Login may add account follows and seed live state without notifications; logout/auth loss stops auth-only subscriptions while preserving eligible Guest Follow monitoring.
- Users with many follows should see degraded coverage status when EventSub subscription setup or polling limits prevent full coverage.
- Record the architecture decision in ADR 0006: main-process service, Twitch EventSub, Kick polling, and relay-ready design.

## Testing Decisions

- Tests should assert externally visible behavior at service, IPC/preload, store, and UI seams rather than private timer internals.
- Add service-level tests for startup silent seed, offline-to-online notification emission, duplicate suppression, restart grace behavior, auth reconciliation, Guest Follow inclusion, Platform toggles, and degraded coverage status.
- Add Twitch EventSub tests for `stream.online` and `stream.offline` subscription handling, notification dispatch, revocation/failure fallback behavior, and duplicate EventSub delivery.
- Add Kick polling tests for bounded scan behavior, cache usage, offline-to-online detection, transient failure handling, and degraded coverage reporting.
- Add persistence tests for capping notification history at 50, dismiss-one, clear-all, and retaining clicked notifications.
- Add Settings tests for the Notifications tab defaults, preference updates, restart grace selection, per-channel controls, OS desktop notification status, and degraded coverage status.
- Add dropdown tests that verify mock data is gone, real persisted notifications render, empty state renders when history is empty, click opens the stream while retaining history, dismiss removes one row, and clear-all empties history.
- Add integration coverage around auth login/logout/auth-lost reconciliation so account follows and Guest Follows do not create notification bursts.
- UI work should be manually verified in the Electron app, including desktop notification delivery when supported, denied/unsupported status, notification click navigation, and responsive Settings layout.

## Out of Scope

- Implementing close-to-tray behavior.
- Sending notifications after the StreamFusion process is closed or quit.
- Building the hosted Kick webhook relay in the first implementation.
- Creating a separate Favorite model distinct from per-channel notification toggles.
- Showing mock/demo notifications in production UI.
- Guaranteeing desktop notification delivery when the OS blocks or disables notifications.

## Further Notes

- The follow-up Kick relay should be tracked separately. It should preserve the same Live Notification pipeline and only replace or augment the Kick source adapter.
- `Guest Follow` and `Live Notification` are now glossary terms in `CONTEXT.md`.
- ADR 0006 captures the main architectural choice for future maintainers.
