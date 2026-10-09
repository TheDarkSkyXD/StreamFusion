# Android fullscreen and PiP return

Verified on Android 16, API 36, in `Medium_Phone_API_36.1` using the development app and the production Media3 player. The native APK was installed with `adb install -r`. The SecureStore file hash stayed `5f55c7c03a77573973dc1f4c2914cfc970ba859665d54f9e303dd822fa333264` before and after installation.

## Observed behavior

1. Entering fullscreen produces a 2400 × 1080 player surface without app navigation. See [fullscreen.png](fullscreen.png).
2. Home enters Android system PiP. Android reports the app task as `mode=pinned`. See [system-pip.png](system-pip.png).
3. Launching the app from PiP restores the player in portrait with bottom navigation. See [pip-return.png](pip-return.png).
4. Entering fullscreen again continues playback without restarting the app. See [fullscreen-after-pip.png](fullscreen-after-pip.png).
5. Tapping the player's exit-fullscreen button restores portrait and bottom navigation. See [exit-fullscreen-portrait.png](exit-fullscreen-portrait.png).
6. Opening Following keeps the portrait layout and floating mini-player. See [following-after-fullscreen.png](following-after-fullscreen.png).

The app PID stayed `6273` through the sequence. The crash buffer contained no new crash after installation of the corrected native build. Mobile MCP supplied hierarchy inspection, Home, app launch, navigation taps, and screenshots. ADB supplied player taps after the hierarchy round-trip outlasted the controls' three-second timeout. The development Tools bubble overlapped the exit button and was moved before testing that button.

Twitch source requests stalled during this run. Playback used the public Mux Big Buck Bunny HLS sample through a temporary development-only source override for the `fullscreenproof` channel. The screenshots therefore prove native presentation and lifecycle behavior, not Twitch provider availability. The override and temporary orientation logging were removed before committing. The floating Tools gear belongs to the development client.

## Regression checks

- The pre-fix focused-session test reproduced fullscreen conceal leaving the final orientation lock at landscape instead of portrait. The failing regression is committed before the fix.
- Full mobile tests passed: 181 Vitest files, 1,056 tests, the Node test suites, and architecture verification. Mobile lint and typecheck passed.
- The Android TLS instrumentation passed all three cases. See [native-tls-test-result.txt](native-tls-test-result.txt). It exercises idle connection eviction, an in-flight request, and cancellation before network start under main-thread StrictMode.
- The original playback teardown crashed with `NetworkOnMainThreadException` in `TwitchBackupHttp.cancel()` when OkHttp closed pooled TLS connections on the main thread. See [android-crash-before.txt](android-crash-before.txt).
- React Doctor scanned the changed mobile files and reported one existing concern: the large `AppShell` function's control-flow complexity. This change adds no suppression and does not refactor unrelated shell behavior.

## Native build

The successful development APK is version 0.1.7, code 10, built for the x86_64 emulator. Its SHA-256 is `6b2a3203eb11a7c80a27a91df5878fcf9df64a35120aaeb3b092ba75fbbcb3f9`. This is a local development build, not a published release.

The original long-path Expo CMake cache failed with `build.ninja still dirty after 100 tries`. A run-only Gradle init script set Expo's CMake staging directory to `F:/sf-pip-expo-cxx`. Expo JNI was rebuilt, then the complete app assembled with no excluded task. An earlier APK that skipped this CMake task reused incompatible JNI and was discarded.

The focused library instrumentation APK excluded two pre-existing Kotlin instrumentation sources using a run-only init script because their `internal` access fails compilation. It included the new Java test and current production transport. The library test exercises Android TLS independently of Expo JNI. The general Android instrumentation suite was not reported as passing.
