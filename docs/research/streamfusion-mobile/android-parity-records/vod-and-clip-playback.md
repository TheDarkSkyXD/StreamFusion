# Android parity record: `vod-and-clip-playback`

- Capability ID: `vod-and-clip-playback`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Playback VOD and clip section
- Observed `main` at branch start: `7f3dea77f89f6109d9b22644fb34acb14ae3e111`
- Android owner: Mobile `watch` plus guest discovery Channel Detail
- Progress: `implemented`
- Delivery: `direct`
- Adaptation: Equivalent Watch surface for videos and clips. Android uses the existing Watch route with `mediaKind` instead of Desktop `/video/$platform/$videoId`. Kick clips stay explained-unavailable.
- Freshness: `current` for APK `4f0d8310ca5bd128a2f6535706c4f5f5b61c333e7610e53e7b2aebabc88c0205` via `verification/evidence/issue-154-vod-clips.json`

## Desktop outcome

Open and seek Twitch and Kick VODs and clips from Search, Category Detail, History, and channel content tabs.

## Android outcome

Guest Channel Detail lists Twitch videos and clips from GQL and Kick videos from the public catalog. Watch plays Twitch VOD HLS, Kick VOD HLS, and Twitch clip MP4 with seek, progress, Details, Related, and a Comments placeholder. Kick Clips show that Kick does not publish clips on the official public API. Deep-link entry uses allowlisted `watch-channel` extras (`mediaKind`, `mediaId`, `duration`, `title`). Guest Search video and clip tabs stay empty; Channel Detail is the playback path.

## Required evidence

- `change-gate`
- `api30-device`
- `live-platforms`
- `compatibility-canary`
- `seeking`
- `accessibility`

## Evidence residuals

TalkBack was not driven. A dedicated deep-link screenshot was not retained; the clip slug path was exercised on device. Guest Search still returns empty videos and clips arrays.

## Blocking for public release

Kick clip playback stays blocked on an official public clip contract. OAuth stays on #145 and #146. Typed Watch History stays on #155.
