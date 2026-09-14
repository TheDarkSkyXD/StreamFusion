# Android parity record: `multistream`

- Capability ID: `multistream`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Multi-stream section
- Observed `main` at branch start: `9105d0cc4dbe58df2a50f0e700b0286f32829078`
- Android owner: Mobile `multistream` plus `streamfusion-native-contracts` multi-session ExoPlayer
- Progress: `implemented`
- Delivery: `direct`
- Adaptation: Equivalent Multistream room under More. Android measures active live decoders from hardware and RAM, keeps extra StreamSlots retained, and owns one audio session. Desktop Electron grid slots are not ported. Guest chat and captions stay visible gaps.
- Freshness: `current` at `verification/evidence/issue-160-multistream.json` on APK `sha256:93fb3c8ba298da84ca804930a37d21d8342353121098f75200db5cf650d576bd`

## Desktop outcome

Build and manage a multi-stream viewing layout with multiple StreamSlots, audio ownership, and layout persistence.

## Android outcome

More opens a capability-aware Multistream room. Guests can add live channels from Channel Detail. The API 30 emulator measured one concurrent live decoder from three hardware decoders and 1.9 GiB RAM, kept extra slots retained, and restored the configured layout after process death. One audio owner and system PiP act on the focused session. Chat and captions stay disconnected guest copy.

## Required evidence

- `change-gate`
- `lowest-device`
- `constrained-device`
- `tablet-foldable`
- `thermal-proof`
- `pip-handoff`

## Evidence residuals

TalkBack was not driven. Guest chat and captions stay on W05–W08. Landscape chrome was photographed; the three-slot grid was photographed in portrait.

## Blocking for public release

OAuth stays on #145 and #146. Chat on Multistream stays on W05–W08.
