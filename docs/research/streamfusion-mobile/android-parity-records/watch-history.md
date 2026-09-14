# Android parity record: `watch-history`

- Capability ID: `watch-history`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Media library watch-history section
- Observed `main` at branch start: `b3157add70a9385679fcbcf1d6f0ea2435bba2df`
- Android owner: Mobile `media-library` plus Watch capture and Product Store schema v4
- Progress: `implemented`
- Delivery: `direct`
- Adaptation: Equivalent History surface under More. Android uses local SQLite Stream, Video, and Clip rows instead of Desktop `/history`. Reopening a row never autoplays. Resume seeks only after an explicit Start.
- Freshness: `current` at `verification/evidence/issue-155-watch-history.json` on APK `sha256:4f0d8310ca5bd128a2f6535706c4f5f5b61c333e7610e53e7b2aebabc88c0205`

## Desktop outcome

Review and manage local watch history. Open Stream, Video, and Clip rows with thumbnails, progress, resume, replay, and local search.

## Android outcome

More opens typed History. Rows keep 16:9 thumbnails, platform and kind badges, avatars, timestamps, and recorded progress. Stream Open has no media. Video and Clip Resume restore the saved position after Start. Replay starts at 0. Clear and Remove ask first. Search filters locally. Schema v4 adds thumbnail, avatar, channel, and duration columns. Guest signed-out reads stay `{ kind: "guest" }`. Offline History still lists saved rows.

## Required evidence

- `change-gate`
- `api30-journey`
- `process-death`
- `offline-proof`
- `migration-proof`

## Evidence residuals

TalkBack was not driven. Guest Search video and clip tabs stay empty; Channel Detail and Watch remain the capture path.

## Blocking for public release

OAuth stays on #145 and #146. Chat on Watch stays on W05–W08.
