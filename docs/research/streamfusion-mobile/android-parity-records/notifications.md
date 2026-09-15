# Android parity record: `notifications`

- Capability ID: `notifications`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Notifications section
- Observed `main` at branch start: `5cc4ea6`
- Android owner: Mobile Settings plus `LiveNotificationStore` (`live-notifications.v1`)
- Progress: `implemented` for searchable Settings preferences, permission status, denial recovery, native FCM registration, local channels, in-app banners, and ended-stream routing
- Delivery: `adapted`
- Adaptation: Guest Follow live-alert preferences persist in the Product Store. Android 13+ requests `POST_NOTIFICATIONS` when Android notifications are turned on. API 30 reports platform-granted posting and still exposes Open system settings plus a retry path for later OS denials. Offline saves stay local. Native FCM tokens register with the Integration Relay using installation Bearer auth. Missing Play Services or google-services fails closed without disabling Activity. Topic fanout waits for N02. Appearance stays dark-only.
- Freshness: `current` at native FCM registration on N01; Settings journey evidence remains `verification/evidence/issue-169-settings.json`; native presentation evidence is `verification/evidence/issue-172-notifications.json`

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
- `n01-change-gate`
- `api30-device`
- `native-token-rotation`
- `n01-permission-denial`
- `foreground-background`
- `notification-entry`

## Evidence residuals

TalkBack was not enabled. API 30 has no runtime notification prompt, so denial recovery is unit-tested with an injected denied snapshot plus an always-visible system-settings control. Native FCM token rotation is unit-tested. Emulators without google-services fail closed to unavailable while Activity and local proof still work. Topic fanout stays N02.

## Blocking for public release

OAuth stays on #145 and #146. Topic fanout and public-release delivery stay on #173 and #174.
