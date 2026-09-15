# Android parity record: `ad-blocking`

- Capability ID: `ad-blocking`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Playback ad-blocking section
- Observed `main` at branch start: `b95980df6a08cfd1ccf8793b89a1f0e865e8dca4`
- Android owner: Mobile `ad-blocking` plus native `FilteringDataSource` playlist rewrite
- Progress: `implemented`
- Delivery: `adapted`
- Adaptation: Isolated compatibility capability. Twitch live playlists can strip known ad markers or run canary inside ExoPlayer. Desktop VAFT stays Desktop-owned. Kick has no approved filter and stays passthrough. Filter failure keeps the original playlist. Signed policy `no-valid-policy` enables filtering like playback compatibility. The Settings kill switch is independent.
- Freshness: `current` at `verification/evidence/issue-161-adblock.json` on APK `sha256:0b8e1dab209058f1448c255fee699e16f0a7a9546af1dcbcc2cc35b7616c105e`

## Desktop outcome

Block supported ads and retain safe stream playback when ad handling changes.

## Android outcome

More Settings hosts a live Ad Blocking panel. Guests can leave filtering on, switch to canary, or kill the filter. Twitch Watch discloses the effective method. Kick Watch discloses that this session is unfiltered. Empty-after-strip and native rewrite exceptions keep the original playlist inside the player.

## Required evidence

- `change-gate`
- `api30-device`
- `compatibility-canary`
- `kill-switch`
- `failure-containment`
- `diagnostics`

## Evidence residuals

TalkBack was not driven. Desktop VAFT pattern refresh is not on Mobile. M07 still owns the later Settings Ad blocking polish. Watch Kick title still names the Twitch canary method while the detail states Kick is unfiltered.

## Blocking for public release

OAuth stays on #145 and #146. Chat stays on W05–W08.
