# Android parity record: `stream-recording`

- Capability ID: `stream-recording`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Playback stream-recording section
- Observed `main` at branch start: `4d6681de3031cd6dae8edb1aa9ea6e73fa6cf28e`
- Android owner: Mobile `media-jobs` plus `streamfusion-native-contracts` MediaJobEngine
- Progress: `implemented`
- Delivery: `adapted`
- Adaptation: No Desktop live-player recording chrome. Live Watch offers Record with a stable job id. Diagnostics compressed cutoff proves the four-hour warning/cutoff contract in 12s. Stop finalizes a playable partial. Storage-pressure, process death, and reboot recover through the same Media Job engine.
- Freshness: `current` at `verification/evidence/issue-165-recording.json` on APK `sha256:ad65396d3a0f63b21c8143b5a2c7cf9a487c49d8d065be9d55be2e4d5fad67ee`

## Desktop outcome

Record a live stream, recover interrupted recording work, and open completed files from the live player.

## Android outcome

Live Watch offers Record. Diagnostics exposes `streamfusion-fixture://recording`, `?cutoff=compressed`, and `?storage-pressure` on the Media Job engine. Compressed cutoff completes with "Stopped at the four-hour limit. Partial recording saved." Stop completes with "Stopped. Partial recording saved." Recover restores jobs after process death and reboot. Activity Jobs lists recordings. Guest signed-out reads stay `{ kind: "guest" }`.

## Required evidence

- `change-gate`
- `lowest-device`
- `four-hour-soak`
- `process-death`
- `reboot`
- `storage-pressure`
- `partial-artifact`

M01 still owns `api30-device` and `activity-reconciliation` on this capability.

## Evidence residuals

TalkBack was not driven. Four-hour soak used the compressed 12s cutoff, not a wall-clock four-hour run. The 8s warning window was not photographed separately because the cutoff status also contains "four-hour limit". Open on the fixture `.bin` did not launch a viewer. Fixture bytes are dummy recording output, not a live HLS segment file.

## Blocking for public release

OAuth stays on #145 and #146.
