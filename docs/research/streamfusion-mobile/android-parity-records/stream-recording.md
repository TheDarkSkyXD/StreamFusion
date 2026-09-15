# Android parity record: `stream-recording`

- Capability ID: `stream-recording`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Playback stream-recording section
- Observed `main` at branch start: `5ea4b9da49719f6e4320253b66d817368be46bd6`
- Android owner: Mobile `media-jobs` plus `streamfusion-native-contracts` MediaJobEngine
- Progress: `implemented`
- Delivery: `adapted`
- Adaptation: No Desktop live-player recording chrome on Watch yet. M01 delivers the shared recoverable job engine, the recording fixture URI, `activity/job-preview`, and Activity Jobs. Segmented live Stream recording, Stop, four-hour cutoff, and playable partial recovery remain M03.
- Freshness: `current` at `verification/evidence/issue-163-media-jobs.json` on APK `sha256:8261d6c65da465e9f9a3d548955383b1c08fae03a8aeccd98873e42f58db99e5`

## Desktop outcome

Record a live stream, recover interrupted recording work, and open completed files from the live player.

## Android outcome

Diagnostics exposes `streamfusion-fixture://recording` on the same Media Job engine as downloads. Commands, checkpoints, foreground-service ownership, Recover, process death, reboot, storage pressure, and Activity projection are the M01 engine proof. Live Watch recording stays on M03.

## Required evidence

- `change-gate`
- `api30-device`
- `process-death`
- `reboot`
- `storage-pressure`
- `activity-reconciliation`

## Evidence residuals

TalkBack was not driven. The driven fixture in job-preview was a download; recording uses the same engine and is listed on Diagnostics. Live segmented recording is M03.

## Blocking for public release

OAuth stays on #145 and #146. Live Watch recording stays on #165.
