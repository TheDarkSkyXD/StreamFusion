# Watch CC without model download - research (2026-09-23)

## Decision
NOT FEASIBLE now in Expo Go. Ship Watch CC as Coming soon (no Install/Download model on Watch).

## Why
- Twitch: streamer CEA-608/708 only; no third-party auto-caption API; rare HLS WebVTT.
- Kick: no native captions.
- expo-video subtitle APIs need tracks we do not get; mobile has no expo-video.
- OS STT (expo-speech-recognition) not in Expo Go.
- Cloud STT: privacy/cost/latency; needs audio extraction.
- Local ONNX packs forbidden on Watch UI.

## Shipped
- Mobile WatchCaptionBar: Coming soon.
- Settings copy: Coming soon / preference saved.
- Desktop player Settings: Coming soon; no mid-stream download.
