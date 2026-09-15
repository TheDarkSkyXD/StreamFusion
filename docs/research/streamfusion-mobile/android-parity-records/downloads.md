# Android parity record: `downloads`

- Capability ID: `downloads`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Media library downloads section
- Observed `main` at branch start: `81f4e6c1c63b818112816c3f75ecbcf3dc85673c`
- Android owner: Mobile `media-jobs` plus `streamfusion-native-contracts` MediaJobEngine
- Progress: `implemented`
- Delivery: `adapted`
- Adaptation: No standalone Downloads screen. Watch Videos and Twitch Clips start a recoverable job from the Watch bar. Diagnostics HTTP range proof, pause/resume with `Range`, network-loss, storage-pressure, Activity Jobs, and SAF export with hash verification are M02. Kick clips stay unsupported. Live Watch hides download.
- Freshness: `current` at `verification/evidence/issue-164-downloads.json` on APK `sha256:8cf9501a8ac417156a9db54dfd01546ef996160005609c6410a006ce12735990`

## Desktop outcome

Download, retry, remove, reveal, and open local video and clip files from `/downloads`.

## Android outcome

Watch offers Download on Videos and Twitch Clips. Job preview shows phase, progress, Pause/Resume, Open, Export, Delete, and service ownership. Resume continues with HTTP Range. SAF export copies the app-private artifact and reports Export verified when hashes match. Activity Jobs lists the same jobs. Network-loss and storage-pressure fail retryably. Guest signed-out reads stay `{ kind: "guest" }`. Kick clips remain unavailable.

## Required evidence

- `change-gate`
- `api30-device`
- `range-resume`
- `network-loss`
- `storage-pressure`
- `export-integrity`

M01 still owns `process-death`, `reboot`, and `activity-reconciliation` on this capability.

## Evidence residuals

TalkBack was not driven. HTTP range proof uses a local 262144-byte payload, not a live VOD. Network-loss and storage-pressure fixtures write dummy bytes; the preview status line can still say Preparing while the phase is Failed, retryable. Kick clips stay unsupported. OAuth stays on #145 and #146.

## Blocking for public release

OAuth stays on #145 and #146. Live recording stays on #165.
