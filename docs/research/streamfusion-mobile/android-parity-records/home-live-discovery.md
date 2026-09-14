# Android parity record: `home-live-discovery`

- Capability ID: `home-live-discovery`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Home live discovery section
- Observed `main` at branch start: `aa0e52ab71030daa48f72d5cea1d250e8be07cd8`
- Android owner: Mobile `discovery`
- Progress: `implemented`
- Delivery: `direct`
- Adaptation: Equivalent. Home lives under More. Channel Detail is a stacked destination with Home, Videos, and Clips.
- Freshness: `current` for APK `1596d999e5ca19d5404bcfc89a5c182bad55d6397c5cb1946eb5550022844d5e` via `verification/evidence/issue-148-d05-home-channel.json`

## Desktop outcome

Browse live streams, channel cards, and current platform availability from Home. Open a channel to Home, Videos, and Clips without breaking the player on an ended channel.

## Android outcome

Guest Home works signed-out. More lists Home first. Combined Twitch and Kick recommendation cards use 16:9 thumbs, live state, and viewer counts. Twitch without Relay or an app token reports `guest-unavailable` with Retry. It does not require Sign in. Stale cache shows cached recommendations with age copy.

Channel Detail keeps Home, Videos, and Clips. Kick videos and clips show first-class unsupported copy. Follow uses `channel-follow`. Guest Follow writes a local channel follow. Watch opens the guest live player when a playback URL exists. OAuth stays on #145 and #146.

## Required evidence

- `change-gate`
- `api30-journey`
- `offline-cache`
- `tablet-layout`
- `live-platforms`
- `accessibility`

## Evidence residuals

`tablet-layout`, `live-platforms`, and `accessibility` stay residual on this APK. Live catalog success still needs Relay credentials or official app tokens. TalkBack, large text, and a tablet AVD were not driven. The 2026-09-12 frames predate Guest Follow (#225) and guest Watch (#227). Those PNGs still show the earlier degrade copy.

## Blocking for public release

Live Twitch and Kick catalog success still depends on Relay credentials or official app tokens. OAuth stays on #145 and #146.
