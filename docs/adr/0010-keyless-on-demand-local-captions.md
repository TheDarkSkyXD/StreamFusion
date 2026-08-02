# Local live captions use keyless on-demand model packs

StreamFusion will use on-device speech recognition as the fallback when Twitch or Kick does not provide a usable timed-text track. Speech-language models are not bundled in the application. The Subtitles/CC menu remains available, and first use offers an explicit download of only the selected, allowlisted model pack. Verified packs are cached under Electron's `userData` directory and work offline after installation.

The model catalog records a pinned artifact revision, languages, compressed and installed sizes, source, license, exact file manifest, and SHA-256 hashes. Downloads preserve revision-matched partials for retriable network interruption, validate Range responses before appending, clean terminal or untrusted staging states, verify every file before atomic activation, and remain removable from Settings. Recognition runs outside the renderer behind an engine adapter; audio and recognition events are bounded and carry session, generation, sequence, and media-time identity.

The first engine is `sherpa-onnx-node` in one Electron utility process. The first candidate pack is the Apache-2.0 English streaming Zipformer 20M repository at revision `d42f2d9f7ca24806fb667456a18a9f1b60f70d16`; its four required runtime files total 45,202,074 bytes. It is not eligible for the production allowlist until every file has a recorded SHA-256 and real noisy Twitch and Kick streams prove useful accuracy. StreamFusion packages only the native runtime for the current target architecture and no model weights.

This keeps the installer free of language-model weight while also keeping local captions free of user API keys and recurring transcription fees. It additionally prevents stream audio from leaving the device. Platform-authored captions remain the preferred source when the user selects them.

**Consequences**

- A fresh installation cannot perform local recognition until the user approves and completes a model download.
- The UI must present Download, Downloading, Ready offline, Retry, integrity failure, and Remove states instead of calling the feature Unavailable.
- Each model and license must be reviewed and measured before it is added to the allowlist.
- The recognizer adapter must expose partial/final revisions and token or word timing when available; the overlay falls back to phrase highlighting when trustworthy word timing is unavailable.
- A supervisor grants at most one local-recognizer lease at a time. Multistream must never restore one recognizer per slot; a focused-slot design is required before local captions are offered there.
- Operating-system speech engines may be added as optional accelerators, but cannot be the cross-platform baseline.

**Considered Options**

- Bundle every supported language model: rejected because it permanently increases every installer and update, including for languages a user never selects.
- Embed a shared cloud API key: rejected because Electron packages and process memory cannot keep a distributed vendor credential secret.
- Require each user to bring an API key: rejected because Subtitles/CC is an app feature, not a developer integration.
- Run an anonymous StreamFusion cloud relay: rejected as the default because it creates recurring per-audio-hour cost, abuse and denial-of-wallet risk, account and quota infrastructure, and cloud-audio privacy obligations.
- Depend on Web Speech or operating-system dictation: rejected as the baseline because current Electron and OS implementations differ in availability, language packs, network use, permissions, and support for arbitrary decoded PCM.
