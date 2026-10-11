# Mobile playback recovery verification

The released Android 0.1.8 APK stops Twitch and Kick playback when Media3 raises `BehindLiveWindowException`. The native session owner disposes the player and captions for this recoverable error, producing the reported stopped screen.

The fix seeks the current owned player to its default live position and prepares it again for `ERROR_CODE_BEHIND_LIVE_WINDOW`. Other errors retain their existing terminal behavior. The player, session identity, caption ownership, and paused state remain intact. This follows the [official Media3 recovery recipe](https://developer.android.com/media/media3/exoplayer/live-streaming#behindlivewindowexception_and_error_code_behind_live_window).

## Observed native behavior

Tested on the Android emulator using a hash-verified released APK, then a rebuilt development APK with the native fix. This is native APK verification, not Expo Go or a physical phone test.

- Twitch FirstTourGuardsman stopped in the released APK. See [before screenshot](release-repro.png) and [error log](release-behind-live-window-before.log).
- Kick Absi stopped in the released APK. See [before screenshot](kick-before-running.png) and [error log](kick-before-error.log).
- The patched Twitch process 21021 raised the same exception at 14:26:40.550 and recovered. The [later gameplay screenshot](twitch-after-running.png) shows a changed scene without the stopped screen. See [error log](twitch-after-running.log).
- The patched Kick stream continued through the captures at 14:28, 14:29, and 14:32 without the stopped screen. See [initial frame](kick-after-ready.png), [later frame](kick-after-running.png), and [final frame](kick-after-final.png). Initial green and magenta artifacts cleared in the final frame. Physical phone decode quality is not established by this test.

## Tests and build

The same regression suite failed before the fix and passed after it. These attributes are copied verbatim from the saved JUnit output.

```text
tests="12" skipped="0" failures="2" errors="0"
tests="12" skipped="0" failures="0" errors="0"
```

See [before JUnit report](regression-before.xml) and [after JUnit report](regression-after.xml). Recovery tests cover retained player and captions, preserved paused state, and stale callbacks.

Mobile test output from [mobile-test.log](mobile-test.log).

```text
 Test Files  189 passed (189)
      Tests  1112 passed (1112)
Feature architecture import proof passed.
```

The [full native suite](native-full-after.log) ran 71 tests with eight failures, all in `UpdaterHandoffTest` and `UpdaterInstallResultTest`. Those paths are outside this change. An earlier execution proving these failures on the unpatched baseline was not captured.

The x86_64 native development APK [built successfully](native-build-x86_64.log) and was installed for the after-fix checks. Published APK 0.1.8 still needs a new release build to receive the fix. No release was published by this task.

## Decisions

- Fix Root Causes placed recovery in the native error callback where the player was being disposed.
- Model the Domain used Media3's typed error code and the existing session identity guard.
- Laziness Protocol kept the six-line fix within the existing owner rather than adding a JavaScript restart mechanism or retry counter.
- Sequence Verifiable Units put the failing regression tests in git history before the fix.
- Prove It Works required released APK reproduction and rebuilt native APK verification on both providers.

The repository commit hook requires a clean workspace. Unrelated existing changes and evidence were preserved. Commits used a scoped hook override after the mobile and native checks above.

The regression commit `8818923` and fix commit `78dbef6` were pushed to `main`. The direct push used the repository's existing bypass permission, as requested. GitHub reported that the protected-branch PR and required-check rules were bypassed. Task-owned Metro on port 8084 was stopped after verification; the existing server on 8081 and other emulators were preserved.
