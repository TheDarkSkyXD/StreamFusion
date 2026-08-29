# Android device support and capability policy

- Status: approved design for [Choose Android device support and constrained-capability policy](https://github.com/TheDarkSkyXD/StreamFusion/issues/108)
- Applies to: StreamFusion Mobile public Android releases and access-controlled development builds
- Verification owner: [Define Android verification and GitHub release evidence](https://github.com/TheDarkSkyXD/StreamFusion/issues/106)

## Decision

StreamFusion Mobile supports touchscreen phones, tablets, and foldables that run Android 11, API level 30, or newer on `arm64-v8a` hardware. Public GitHub APKs support this physical-device ABI. Development and CI builds may also support `x86_64` Android emulators.

Android TV, ChromeOS desktop mode, Android Automotive, Wear OS, 32-bit ARM, and public x86 builds are outside this effort.

Meeting the API, ABI, and form-factor floor makes a device installable. A device enters the public support contract only after it passes the lowest runtime profile. StreamFusion calls such a device a Parity-Qualified Device.

## Qualification policy

The lowest runtime profile proves that a device can sustain all constrained outcomes under the controlled conditions defined by the verification policy:

- Two simultaneous live videos with one explicit audio owner.
- One focused stream and one real-time session with the current English 43.11 MiB local-caption model.
- User-started segmented recording.
- App-private downloads with explicit export.
- Android-native diagnostics and recovery.
- Stable operation within the performance, memory, dropped-frame, and thermal thresholds defined by the verification policy.

A device that fails the lowest profile remains installable but is not a Parity-Qualified Device. The app must state that result and provide a diagnostic-report path. The app must not present missing outcomes as Android Outcome Parity.

Static device facts do not establish qualification. A model allowlist, RAM amount, Android version, codec-reported instance count, and Media Performance Class may inform a test, but none can replace measured admission results. Android documents the codec instance count as an upper-bound hint whose usable value can fall with available resources.

The locally stored Capability Profile records the measured active-video limit from two through six and the other admission results. StreamFusion requalifies the profile after a native app update, an Android system update, or a material device-profile change.

Temporary heat, memory pressure, battery-saving state, network change, or storage pressure does not revoke qualification. It starts visible Runtime Degradation and recovery. A repeatable failure during controlled requalification moves the device outside public support until a later app or system change passes qualification.

## Runtime degradation contract

Every Parity-Qualified Device retains all constrained user outcomes. Runtime Degradation may reduce concurrency, quality, or duration. It may not remove Multistream layout management, recording with recovery, downloads with export, local captions, or diagnostics.

Every Runtime Degradation must:

1. Preserve the focused user task and each recoverable artifact.
2. Follow the deterministic order in this policy.
3. Explain an active limit before the limit destroys work or hides an outcome.
4. Provide a recovery or retry path.
5. Record local diagnostic evidence.
6. Never discard a recording segment, download, caption session, or configured Multistream slot without notice.

StreamFusion may reduce a workload immediately to protect the device or an artifact. The app increases the workload only after stable health evidence. The verification policy defines the hysteresis that prevents rapid changes between levels.

## Multistream

- Users can configure, reorder, focus, mute, and remove up to six slots on every Parity-Qualified Device.
- The lowest profile sustains two active videos. A measured Capability Profile may allow three through six.
- Exactly one slot owns audio.
- StreamFusion first lowers non-focused quality, then reduces non-focused refresh work, and then pauses the least important non-focused decoders. Paused slots remain visible as periodically refreshed live thumbnails.
- The focused stream, configured slots, and layout controls remain available.
- StreamFusion restores paused slots gradually after memory and thermal health stabilize.

The two-to-six active-video range is an approved Adaptation of the Desktop Multistream outcome. It is not a promise that every supported device decodes six videos at once.

## Recording

- Every Parity-Qualified Device supports user-started recording in recoverable segments.
- The certified background window is four hours for each user-started recording session on every supported Android version.
- A visible foreground-service notification shows recording state and controls.
- Before the certified window ends, StreamFusion warns the user and safely finalizes the current segment.
- Recording may continue while the app is in the foreground and device health and storage permit. A user who returns to the foreground can explicitly continue a finalized session.
- User stop, force-stop, process death, reboot, network loss, storage exhaustion, and an operating-system timeout preserve completed segments and an honest job state.

For apps that target Android 15 or newer, Android limits `dataSync` and `mediaProcessing` foreground services to six background hours per service type in each 24-hour period. The four-hour contract reserves time for safe finalization, retries, and other media work.

[Define Android persistence, background, and notification behavior](https://github.com/TheDarkSkyXD/StreamFusion/issues/105) owns the journal, restart, continuation, and lifecycle mechanics.

## Downloads

- StreamFusion stores offline media in app-private storage by default.
- Users can open, retry, cancel, remove, and resume eligible jobs.
- Export creates a portable copy through the Android Storage Access Framework or MediaStore with an explicit user destination or consent.
- StreamFusion does not request broad all-files storage access.
- Low storage pauses or blocks new work and explains the required space. StreamFusion does not delete completed media without notice.

The lifecycle decision owns persistence and process-death mechanics. The Platform integration policy owns provider-specific download eligibility.

## Local captions

- One local-caption session may run at a time, matching the Desktop single-caption owner.
- The lowest profile runs the current English 43.11 MiB model in real time with one focused stream.
- Admission may lower focused playback quality and pause non-focused Multistream decoders before captions start.
- Caption audio comes from decoded program PCM. StreamFusion does not request microphone permission or upload program audio.
- If a Parity-Qualified Device becomes constrained, StreamFusion reduces other media work before it interrupts captions. The app explains any interruption.

A device that cannot pass the lowest caption profile is not a Parity-Qualified Device. Cloud transcription is not a fallback in this effort.

## Diagnostics

Android diagnostics preserve the Desktop support outcome through Android-owned evidence and recovery. They include:

- StreamFusion-owned structured and redacted file logs.
- App memory, storage, network, battery, and thermal state available to StreamFusion.
- Media3 decoder, dropped-frame, playback, caption, recording, and download-job health.
- ANR and historical StreamFusion process-exit evidence available on the API floor.
- The Capability Profile and active Runtime Degradation reasons.
- Redacted bug-report bundles and app-owned recovery actions.

Diagnostics do not promise inspection of processes that belong to other Android UIDs, arbitrary process signaling, or production logcat access. Android added `ApplicationExitInfo` in API level 30, which makes historical app-exit reasons part of the supported floor.

## Policy handoffs

- [Prototype Android navigation and parity interactions](https://github.com/TheDarkSkyXD/StreamFusion/issues/104) owns the visible unsupported-device, Runtime Degradation, recovery, storage, and job interactions.
- [Define Android persistence, background, and notification behavior](https://github.com/TheDarkSkyXD/StreamFusion/issues/105) owns durable state and lifecycle mechanics.
- [Define Android verification and GitHub release evidence](https://github.com/TheDarkSkyXD/StreamFusion/issues/106) owns exact thresholds, representative devices, benchmark procedures, evidence age, and release checks.
- [Choose the Platform integration support policy for Android](https://github.com/TheDarkSkyXD/StreamFusion/issues/109) owns provider availability, risk, and removal rules.
- The Android parity manifest binds the approved device-policy digest to every affected Android Parity Record and Public Android Release.

## Sources

- [Continuous Android parity contract](./continuous-parity-contract.md)
- [Desktop parity inventory](./desktop-parity-inventory.md)
- [Android feasibility for Desktop capability parity](./android-full-parity-feasibility.md)
- [Android `ApplicationExitInfo`](https://developer.android.com/reference/android/app/ApplicationExitInfo)
- [Android codec concurrent-instance limits](<https://developer.android.com/reference/android/media/MediaCodecInfo.CodecCapabilities#getMaxSupportedInstances()>)
- [Android foreground-service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout)
- [Android Storage Access Framework](https://developer.android.com/guide/topics/providers/document-provider)
