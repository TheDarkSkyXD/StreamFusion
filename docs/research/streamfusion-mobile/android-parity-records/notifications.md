# Android parity record: `notifications`

- Capability ID: `notifications`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Notifications section
- Observed `main` at branch start: `5cc4ea6`
- Android owner: Mobile Settings plus `LiveNotificationStore` (`live-notifications.v1`)
- Progress: `implemented` for searchable Settings preferences, permission status, and denial recovery
- Delivery: `adapted`
- Adaptation: Guest Follow live-alert preferences persist in the Product Store. Android 13+ requests `POST_NOTIFICATIONS` when Android notifications are turned on. API 30 reports platform-granted posting and still exposes Open system settings plus a retry path for later OS denials. Offline saves stay local. Remote FCM registration and background delivery wait for N01. This build does not claim Expo Push or relay topic subscription.
- Freshness: `current` at `verification/evidence/issue-169-settings.json` on APK `sha256:b13cd849694b15e45d369601d69092c7737695040191af66a977237c81c55c92`

## Desktop outcome

Receive live notifications and open the matching stream from the notification action. Notification preferences persist.

## Android outcome

More Settings hosts a searchable Notifications panel with Android posting, Activity history, in-app banners, sound, Twitch, Kick, Guest Follow coverage, favorites-only, and restart grace. Denial keeps Activity active and shows Retry permission. Ad blocking and Proxy remain searchable siblings with their own Product Store keys.

## Required evidence

- `change-gate`
- `api30-journey`
- `local-search`
- `offline-proof`
- `permission-denial`
- `accessibility`

## Evidence residuals

TalkBack was not enabled. API 30 has no runtime notification prompt, so denial recovery is unit-tested with an injected denied snapshot plus an always-visible system-settings control. FCM native registration is N01.

## Blocking for public release

OAuth stays on #145 and #146. Remote push stays on #172.
