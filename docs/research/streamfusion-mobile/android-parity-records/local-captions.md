# Android parity record: `local-captions`

- Capability ID: `local-captions`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Playback local-captions section
- Observed `main` at branch start: `6c4653783dca0920535033003bcbe2e829247614`
- Android owner: Mobile `local-captions` plus `streamfusion-native-contracts` CaptionSessionOwner
- Progress: `implemented`
- Delivery: `adapted`
- Adaptation: No HuggingFace 43.11 MiB ONNX download in proof. Diagnostics installs a fixture pack that still displays 43.11 MiB and verifies pinned SHA-256. One focused caption session tees local PCM from playback. API 30 recognition is an on-device energy-gated decoder, not sherpa-onnx. Watch shows caption controls and privacy copy on a live Stream.
- Freshness: `current` at `verification/evidence/issue-166-captions.json` on APK `sha256:5f76b6c1daa85339f23583a88ebb8592a04e80b4712d761e1056958b6aaab572`

## Desktop outcome

Download a local caption model and show live captions for supported playback.

## Android outcome

Watch offers Captions with the 43.11 MiB English model size, install, start, stop, and remove. Diagnostics exposes `streamfusion-fixture://captions`, `?pcm`, `?constrained`, and `?integrity-fail`. Fixture install reports sha256 verified. A second session is rejected with "One caption session is already running on the focused Stream." Integrity-fail reports unverified SHA-256. Constrained start reports resource pressure. Proof stays `uploads 0` and `mic not requested`. Guest signed-out reads stay `{ kind: "guest" }`.

## Required evidence

- `change-gate`
- `lowest-device`
- `model-integrity`
- `one-session-limit`
- `no-upload`
- `degradation-proof`

## Evidence residuals

TalkBack was not driven. Product HuggingFace ONNX weights were not downloaded so the APK payload did not grow. Cues fire only when local PCM is processed. Home live catalog failed once on the API 30 emulator; Watch captions were proven on a guest Twitch live session after retry. Live player copy still says theater and stats are unshipped.

## Blocking for public release

OAuth stays on #145 and #146.
