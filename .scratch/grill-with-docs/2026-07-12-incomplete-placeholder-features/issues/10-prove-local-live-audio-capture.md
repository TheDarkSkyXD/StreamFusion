# Prove local live audio capture on Twitch and Kick

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Prove that StreamFusion can capture the decoded audio from its real live Twitch and Kick players locally, convert it into bounded mono PCM batches suitable for speech recognition, and safely reset that capture when the stream changes. This establishes the real input path for local captions without downloading a second copy of the stream.

## Acceptance criteria

- [x] A real talk-heavy Twitch stream produces non-silent PCM measurements from the playing video in Electron.
- [x] A real talk-heavy Kick stream produces non-silent PCM measurements from the playing video in Electron.
- [x] Capture follows the decoded program audio when the player is muted and does not create audible duplicate output.
- [x] Switching Twitch to Kick stops the old capture, starts one generation of new capture, and rejects late data from the old stream.
- [x] Focused automated tests cover continuous resampling, bounded batching, failure cleanup, source refresh, teardown, and generation cancellation.

## Blocked by

None - can start immediately

## Comments

- Electron MCP proof on real Twitch `finamenon`: the dev-safe proof output matched `AUDIO LIVE twitch`, `16k`, `MUTED`, and a non-zero RMS selector.
- Electron MCP proof after switching to real Kick `nickwhite`: the output matched `AUDIO LIVE kick g1`, `16k`, `MUTED`, and non-zero RMS; no Twitch proof output remained in the DOM.
- Native `HTMLMediaElement.muted` also mutes `captureStream()` by specification. The implementation therefore keeps decoding natively unmuted and applies the user's mute/volume to a single Web Audio presentation gain. The PCM analysis branch is attenuated to an inaudible level and never downloads another stream copy.
- Focused tests: `local-audio-capture.test.ts` (5) plus `use-volume.test.ts` (4), all 9 green. Lint, typecheck, production build, and scoped `git diff --check` passed.
- Reopened after release review. The W3C capture specification says media-element mute/volume do not affect captured audio, so forcing native audio through a second presentation graph is unnecessary and risky. The current ScriptProcessor/analyser implementation is deprecated/lossy, lacks continuous resampling across chunks, leaks on failures, has no source-refresh ownership, and no longer has a production proof caller. Replace it with an AudioWorklet-backed continuous tap and repeat the real Electron evidence before closing.
- Final implementation uses one `MediaElementAudioSourceNode` hub per video. The hub has one presentation-gain path to the destination and an AudioWorklet analysis tap, so user mute does not interrupt PCM and no second stream download or duplicate native output path exists.
- Fresh Electron dev-build proof on real Twitch `carolinekwan`: `AUDIO LIVE twitch g1 16k RMS 0.0004 AUDIBLE worklet ctx-running media-element`; after muting it remained generation `g1` and produced `RMS 0.0148 MUTED`; after unmuting it returned to `RMS 0.0132 AUDIBLE` without creating a new generation.
- Electron MCP proof after switching to real talk-heavy Kick `NickLee`: `AUDIO LIVE kick g1 16k RMS 0.0001 AUDIBLE worklet ctx-running media-element`; the Twitch proof output was absent.
- Focused automated result: 35 tests green across the audio capture, proof hook, player wiring, and volume integration suites. Scoped Biome and TypeScript checks passed.
