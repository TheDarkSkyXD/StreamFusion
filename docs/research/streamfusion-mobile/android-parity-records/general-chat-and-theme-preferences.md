# Android parity record: `general-chat-and-theme-preferences`

- Capability ID: `general-chat-and-theme-preferences`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Settings appearance and playback sections
- Observed `main` at branch start: `06ddd3f`
- Android owner: Mobile `settings` plus Watch, Multistream, and ExoPlayer LoadControl
- Progress: `implemented` for Appearance, Playback, Player controls, Buffer, and Multiview
- Delivery: `adapted`
- Adaptation: Appearance is dark-only. Light and system patches are rejected and coerced to dark. Native `Appearance.setColorScheme('dark')` plus `StatusBar.setBarStyle('light-content')` stay forced. Density scales Settings spacing. Language stays English and rejects other locales without overwriting the saved value. Restore-session gates shell restoration. Resume-playback never autoplays Watch. Default quality, captions, HEVC, seek intervals, and buffer knobs apply to the focused native session. Multiview cap is `min(6, preference)`. Background quality applies to unfocused Multistream slots. Notifications, Ad blocking, Proxy, Updates, Diagnostics, Logs, Report a bug, and About search from the same Settings workspace. Chat, predictions, integrations, and tokens remain later tickets.
- Freshness: `current` at `verification/evidence/issue-167-settings.json`

## Desktop outcome

Searchable Settings panels persist appearance, playback, player chrome, buffer, and multiview choices that apply to live sessions.

## Android outcome

More Settings searches and persists those five panels plus Notifications, Proxy, Ad blocking, Updates, Diagnostics, Logs, Report a bug, and About. Theme stays dark-only. Captions, quality, seek, buffer, HEVC, and slot cap survive process death and feed Watch and Multistream.

## Required evidence

- `change-gate`
- `api30-journey`
- `local-search`
- `process-death`
- `font-scale`
- `accessibility`

## Evidence residuals

TalkBack was not enabled. Font scale used `settings put system font_scale`. Chat Settings stays on M06.

## Blocking for public release

OAuth stays on #145 and #146. Chat Settings stays on #168.
