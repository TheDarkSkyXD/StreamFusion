# Android local caption recognition proof

On October 5, 2026, the production caption recognizer and model store passed a
spoken PCM test on an Android 11 emulator with the x86_64 ABI. The recognizer
loaded Vosk Android 0.3.75 and the official small English 0.15 model. Installation
downloaded 41,205,931 bytes, checked the pinned archive SHA256, extracted only the
allowed model files, and checked all 14 file digests. Actual recognition produced
the literal phrase `one zero zero zero one` from the upstream spoken WAV fixture.

Run the test from the repository root with an attached Android device:

```powershell
Push-Location apps/mobile
npx expo prebuild --platform android --no-install
Pop-Location
./verification/scripts/verify-mobile-captions-native.ps1
```

The proof script takes `AndroidSdk`, `JavaDirectory`, and `ProofRoot` parameters.
It copies the exact production caption Kotlin files into a small Android test
application. This avoids the React Native and Expo CMake dependency build. The
instrumented test downloads the real model; it needs internet access for that
download. Recognition consumes PCM bytes without a microphone or an audio
upload call. The model store is removed in the test's `finally` path.

[recognition-proof.json](recognition-proof.json) records the input, archive,
compiled source hashes, and scope. [android-recognition.xml](android-recognition.xml)
contains the observed JUnit result. The emulator test took about 272 seconds,
including installation and recognition. This duration does not qualify caption
latency or physical-device performance.

The recorded hashes identify the source snapshot used for that recognition run.
Android memory and thermal checks and model-removal failure handling were added afterward. The final module compiles,
and [android-resource-pressure.xml](android-resource-pressure.xml) records three
passing tests with simulated Android service observations. Those tests reject a
start under low memory or severe thermal pressure and stop an active PCM pump
after a thermal change. The running pump samples these services every five seconds.

This test proves native offline speech recognition. It does not prove the complete
Media3 player, session-specific PCM tap, and Watch caption overlay together.
The module compile check and Kotlin conversion tests cover those typed interfaces
and PCM conversion separately. Full player integration still needs a native client
run with genuine stream audio.

The final native module compiled and passed 45 JVM tests. [android-playback-lifecycle.xml](android-playback-lifecycle.xml) records actual owner and ExoPlayer tests for caption teardown, terminal failures, replacement, and stale callbacks. [android-background-lifecycle.xml](android-background-lifecycle.xml) records four tests that keep only the PiP target playing while backgrounded. [android-pcm-tap-lifecycle.xml](android-pcm-tap-lifecycle.xml) records atomic, session-specific PCM teardown. These are Robolectric tests, not device PiP qualification.
