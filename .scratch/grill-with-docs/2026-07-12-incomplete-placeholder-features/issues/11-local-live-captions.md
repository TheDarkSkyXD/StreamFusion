# Deliver keyless on-demand local captions on live streams

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Deliver an always-selectable Local live captions track that transcribes captured stream audio on-device with an isolated streaming recognizer. Platform-authored captions remain preferred when selected, while local captions provide the real fallback when Twitch or Kick supplies no Timed Text Track. StreamFusion must not require a user API key and must not bundle speech-language models in the installer. On first use, the user explicitly downloads only the selected, curated model pack; after verification and installation under the app's user-data directory, that pack works offline without sending audio to a server.

## Acceptance criteria

- [x] Subtitles/CC always offers Off and Local live captions on supported Twitch and Kick live players, independent of manifest tracks.
- [x] When no compatible model is installed, selecting Local live captions offers an explicit keyless download showing language coverage, exact download and installed sizes, source, and license; it never reports the feature as generically Unavailable.
- [x] No speech-language model is present in the packaged application, and no user or shared vendor API key is required to download or use local captions.
- [x] A model download is resumable and pinned to an allowlisted revision; StreamFusion preserves revision-matched partials only for retriable network interruption, validates Range responses before appending, verifies SHA-256 and the exact file manifest before atomic activation under `userData/models`, and removes cancelled, integrity-failed, catalog-mismatched, or terminally failed staging data.
- [x] Selecting an installed Local live captions model starts an isolated on-device recognizer and renders incremental captions in the existing overlay.
- [x] The UI exposes honest downloading-progress, starting, ready-offline, integrity-error, retry, and remove-model states.
- [x] Captions Off stops audio capture and recognition; platform tracks do not run the local recognizer.
- [x] Audio and transcription messages are bounded and carry session, generation, sequence, and media-time identity.
- [x] One supervisor lease permits at most one active local recognizer; mounting multiple live players never starts one recognizer per player or multistream slot.
- [x] Focused tests cover download/model lifecycle, recognizer lifecycle, error recovery, cancellation, integrity rejection, and the complete settings-to-overlay path.

## Blocked by

- [Prove local live audio capture on Twitch and Kick](10-prove-local-live-audio-capture.md)

## Comments

- Rewritten after the no-bundle/no-user-key research decision. Anonymous hosted transcription is not a secure production baseline: cloud vendors require credentials, while embedding a shared key in Electron would expose it. Local model downloads may use a public, rate-limited artifact endpoint, but recognition remains entirely on-device.
- App-specific runtime review selected `sherpa-onnx-node` in one Electron utility process for the first vertical slice. The first candidate is the Apache-2.0 English streaming Zipformer 20M pack pinned at revision `d42f2d9f7ca24806fb667456a18a9f1b60f70d16` (45,202,074 required bytes), pending complete SHA-256 cataloguing and real noisy-stream accuracy proof.
- Completed 2026-07-15. The first-use UI anonymously downloaded and verified the exact 45,202,074-byte English pack under a temporary Electron user-data directory; the repository and packaged application scan contained no speech-model weights.
- Real Electron proof used two talk-heavy live streams. Kick `DeenTheGreat` rendered incremental local text over the live player (`.scratch/images/issue11-kick-deen-live-local-captions-clean.png`). Twitch `vanillamace` also rendered local text while the channel was live (`.scratch/images/issue11-twitch-vanillamace-live-local-captions.png`). No user or vendor API key was configured, and recognizer output stayed on-device.
- The live run processed 1,000 bounded 16 kHz PCM batches through one utility-process lease and emitted repeated partial/final recognizer results. Temporary boundary diagnostics were removed after proof.
- Verification: 52 focused caption tests passed; scoped Biome, TypeScript, and the production build passed. SentencePiece word-boundary and ellipsis literals were made encoding-safe after the proof review.
