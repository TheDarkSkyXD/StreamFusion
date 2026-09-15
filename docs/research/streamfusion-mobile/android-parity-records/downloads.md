# Android parity record: `downloads`

- Capability ID: `downloads`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Media library downloads section
- Observed `main` at branch start: `5ea4b9da49719f6e4320253b66d817368be46bd6`
- Android owner: Mobile `media-jobs` plus `streamfusion-native-contracts` MediaJobEngine
- Progress: `implemented`
- Delivery: `adapted`
- Adaptation: No standalone Downloads screen. M01 delivers the recoverable job engine, Diagnostics fixtures, `activity/job-preview`, and Activity Jobs projection. Contextual Watch download and Android export remain M02.
- Freshness: `current` at `verification/evidence/issue-163-media-jobs.json` on APK `sha256:8261d6c65da465e9f9a3d548955383b1c08fae03a8aeccd98873e42f58db99e5`

## Desktop outcome

Download, retry, remove, reveal, and open local video and clip files from `/downloads`.

## Android outcome

Diagnostics starts a fixture download. Job preview shows phase, progress, Pause/Resume, service ownership, and partial artifacts. Activity Jobs lists the same job. Recover after process death and reboot restores stable ids. Storage pressure fails retryably. Guest signed-out reads stay `{ kind: "guest" }`. Real VOD/clip download and export stay on M02.

## Required evidence

- `change-gate`
- `api30-device`
- `process-death`
- `reboot`
- `storage-pressure`
- `activity-reconciliation`

## Evidence residuals

TalkBack was not driven. Fixtures write dummy bytes. Watch download buttons are M02. The storage-pressure preview showed Failed, retryable with Retry; the status line still said Preparing.

## Blocking for public release

OAuth stays on #145 and #146. Watch download UX stays on #164.
