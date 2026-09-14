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

Guest Home works signed-out without Relay or an app token. More lists Home first. Combined Twitch and Kick recommendation cards use 16:9 thumbs, live state, and viewer counts. Twitch guest reads GQL. Kick guest reads public featured livestreams. Stale cache shows cached recommendations with age copy.

Channel Detail keeps Home, Videos, and Clips. Twitch videos and clips load from GQL. Kick videos load from the public catalog. Kick clips stay explained-unavailable. Follow uses `channel-follow`. Guest Follow writes a local channel follow. Watch opens the guest live player when a playback URL exists. OAuth stays on #145 and #146.

## Required evidence

- `change-gate`
- `api30-journey`
- `offline-cache`
- `tablet-layout`
- `live-platforms`
- `accessibility`

## Evidence residuals

`tablet-layout` and `accessibility` stay residual on this APK. TalkBack, large text, and a tablet AVD were not driven. Live guest Twitch and Kick Home now succeed without Relay; later W03 frames supersede the 2026-09-12 degrade copy.

## Blocking for public release

OAuth stays on #145 and #146.
