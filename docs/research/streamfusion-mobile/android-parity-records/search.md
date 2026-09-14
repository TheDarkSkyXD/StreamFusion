# Android parity record: `search`

- Capability ID: `search`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Search section
- Observed `main` at branch start: `4cfd300d`
- Android owner: Mobile `discovery`
- Progress: `implemented`
- Delivery: `direct`
- Adaptation: Equivalent. Search is a primary destination with a bottom field, not a top navigation bar.
- Freshness: `current` for APK `9d56c5eada18488281df9cb0d8ac15c2ace3e11e8dac56a4bfe6dd36d4820456` via `verification/evidence/issue-149-search.json`

## Desktop outcome

Search channels, streams, videos, clips, and categories across Twitch and Kick. Desktop All caps channels, streams, and categories at 12 and videos and clips at 6. Live-only hides videos and clips.

## Android outcome

Guest Search works signed-out without Relay. The Search destination shows a bottom dock, typed ten-entry history, All / Channels / Streams / Videos / Clips / Categories tabs, All / Twitch / Kick plus Live-only filters, and typed result cards. Guest Twitch channel search uses GQL. Kick guest uses official public catalog reads. Guest Search video and clip tabs stay empty. Channel Detail owns videos and clips for Watch.

Local history is Product Store `search-history.v1`. Repeat, remove, and confirmed clear apply only to the current history scope. All, Channels, Videos, and Clips record under `channels`. Streams and Categories keep their own scopes.

## Required evidence

- `change-gate`
- `api30-journey`
- `live-platforms`
- `offline-history`
- `keyboard-insets`
- `accessibility`

## Evidence residuals

`offline-history` and `keyboard-insets` stay residual on this APK. A typed history mutation and IME inset were not captured on this APK after the guest catalog landing. Guest Search video and clip tabs stay empty by design.

## Blocking for public release

OAuth stays on #145 and #146. Typed Watch History stays on #155.
