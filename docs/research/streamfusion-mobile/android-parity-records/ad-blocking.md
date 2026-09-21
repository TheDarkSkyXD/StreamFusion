# Android parity record: `ad-blocking`

- Capability ID: `ad-blocking`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Playback ad-blocking section
- Observed `main` at branch start: `b95980df6a08cfd1ccf8793b89a1f0e865e8dca4`
- Android owner: Mobile `ad-blocking` plus native `FilteringDataSource` playlist rewrite
- Progress: `implemented`
- Delivery: `adapted`
- Adaptation: Isolated compatibility capability. Twitch live playlists can strip known ad markers or run canary inside ExoPlayer. Desktop VAFT stays Desktop-owned. Kick has no approved filter and stays passthrough. Native rewrite exceptions fail closed with unsafe-hold when ads were detected (desktop continuity rule). Interstitial-only / no-`,live`-after-strip uses desktop unsafe-hold (header-only, no media) instead of re-serving the commercial slate. Mixed playlists that still carry explicit `,live` segments after strip continue those live segments. Signed policy `no-valid-policy` enables filtering like playback compatibility. The Settings kill switch is independent.
- Freshness: `current` at `verification/evidence/issue-161-adblock.json` on APK `sha256:0b8e1dab209058f1448c255fee699e16f0a7a9546af1dcbcc2cc35b7616c105e`

## Desktop outcome

Block supported ads and retain safe stream playback when ad handling changes.

## Android outcome

More Settings hosts a live Ad Blocking panel. Guests can leave filtering on, switch to canary, or kill the filter. Twitch Watch discloses the effective method. Kick Watch discloses that this session is unfiltered. Native rewrite exceptions fail closed (hold) when ads were detected. Interstitial-only midrolls and SCTE35 / X-TV-TWITCH-AD windows without remaining `,live` media hold without media (desktop unsafe-hold) so the commercial slate does not play. Mixed playlists that retain explicit `,live` after strip continue those segments.

## Required evidence

- `change-gate`
- `api30-device`
- `compatibility-canary`
- `kill-switch`
- `failure-containment`
- `diagnostics`

## Evidence residuals

TalkBack was not driven. Desktop VAFT pattern refresh is not on Mobile. Watch Kick title still names the Twitch canary method while the detail states Kick is unfiltered.

### Intentional gap: no mobile ULW / backup stream

Desktop midroll continuity primarily uses ULW backup streams (alternate GQL `playerType` tokens, `parent_domains` strip, usher remaster, verified-clean media swap) and only falls back to `holdUnsafeTwitchMediaPlaylist` when no clean backup is ready. Mobile Watch binds ExoPlayer to a single resolver usher URL and rewrites media playlists inside `FilteringDataSource` — there is no session-level backup orchestrator, GQL playerType rotation, or mid-break source swap on this seam. Porting ULW would require a new FocusedPlaybackSessionOwner backup pipeline (token fetch, multi-playerType probe, ExoPlayer media-item replace) outside the playlist-filter adapter; that remains Desktop-owned. Closest desktop-equivalent without ULW: strip known markers, then unsafe-hold whenever no explicit `,live` media remains so the commercial slate never appends. Kick stays passthrough.

## Blocking for public release

OAuth stays on #145 and #146. Chat stays on W05–W08.
