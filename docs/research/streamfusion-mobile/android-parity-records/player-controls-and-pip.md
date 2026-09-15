# Android parity record: `player-controls-and-pip`

- Capability ID: `player-controls-and-pip`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Playback player-controls section
- Observed `main` at branch start: `7f3dea77f89f6109d9b22644fb34acb14ae3e111`
- Android owner: Mobile `watch` plus `streamfusion-native-contracts`
- Progress: `implemented`
- Delivery: `direct`
- Adaptation: Equivalent. One focused session owns transport, quality, mute, fullscreen, in-app mini-player, and Android PiP. Desktop slots and Electron PiP are not ported.
- Freshness: `current` for player chrome via `verification/evidence/issue-153-player-controls.json`; Settings visibility and seek intervals via `verification/evidence/issue-167-settings.json`

## Desktop outcome

Control playback quality, volume, fullscreen, mini player, and picture-in-picture behavior on Live and VOD.

## Android outcome

Watch plays one focused live or recorded session. Pause, Mute, Quality, Fullscreen, and Picture in Picture act on that session. Settings can hide Quality, Volume, and Fullscreen and change rewind/fast-forward intervals. Leaving Watch keeps the same session in a draggable in-app mini-player. System PiP pins the same surface. Expand restores Watch. Dismiss ends the session. Process death returns to Start watching instead of silent resume.

## Required evidence

- `change-gate`
- `api30-device`
- `background-pip`
- `process-death`
- `gesture-accessibility`

## Evidence residuals

TalkBack was not driven. Volume uses the native session, not a separate on-screen slider matching Desktop.

## Blocking for public release

OAuth stays on #145 and #146. Chat on Watch stays on W05–W08.
