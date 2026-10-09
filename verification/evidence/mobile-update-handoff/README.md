# Android update handoff verification

Verified on 2026-10-08. The reported phone failure remains unconfirmed. The official production update from 0.1.4-alpha.1 to 0.1.5-alpha.1 succeeded on Android 11, 15, and 16 before this change.

The confirmed UI regression hid a rejected native Install command in the update popup. Commit `f1adbf3` records the failing session-to-dialog test. The fix shows that error, preserves the Install action, and clears the error on retry.

Xtra starts installation after download. StreamFusion now continues after APK verification while the same Activity stays foregrounded. Android still requires approval. Background completion and process restoration wait for an explicit Install action.

## Observed checks

| Check | Result |
| --- | --- |
| Mobile suite | 180 Vitest files, 1,038 tests passed; Node tests and architecture import proof passed |
| Native updater suite | 11 tests passed in the isolated proof project |
| Changed React UI | React Doctor 100/100, no issues; TypeScript and targeted ESLint passed |
| Android 15 foreground completion | Android approval opened without a second app Install tap |
| Android 15 cancelled approval | Visible install-blocked phase; retry reopened approval using the retained APK |
| Android 15 background completion | Ready phase remained after reopening; explicit Install opened approval |
| Android 11 denied permission | Verified APK remained in permission-needed with Install available |
| Android 11 process restoration | Granting permission after process termination did not auto-install; explicit Install opened approval |
| Android 16 foreground completion | Permission return opened Android approval without a second app Install tap |
| Android 16 Play Protect block | Unfamiliar proof signing key triggered a system block; rejection appeared as install-blocked and kept retry available |
| Android 11, 15, and 16 replacement | Version code changed from 1 to 2; private marker survived. Android 16 required per-app approval for the unfamiliar proof developer |

The [proof build script](../../scripts/build-mobile-updater-native-proof.ps1) copies the production updater classes into an isolated Android app. Its test-only Activity injects a local file transport through the private constructor. It uses the real journal, APK verifier, foreground service, PackageInstaller, receiver, and consent Activity. The APKs use one proof signing key and an isolated package. This proves native handoff and replacement, while the official APK checks above exercise GitHub downloads.

Windows Robolectric cannot replace an existing file through the Android framework's `File.renameTo` implementation. The proof script substitutes only that private rename with `Files.move(REPLACE_EXISTING)` in test sources. Neither APK includes this shadow. The normal Expo module unit-test task also fails to compile existing internal Kotlin tests in this environment; the isolated project compiles and runs those same assertions.

## Screenshots

The popup screenshot renders the production React Native component in Storybook. The native screenshots show the isolated proof app on Android emulators.

- [Popup with visible command error](popup-action-error.png)
- [Android 11 installed version and retained data](android11-installed.png)
- [Android 15 installed version and retained data](android15-installed.png)
- [Android 16 installed version and retained data](android16-installed.png)
- [Android 15 background completion waiting for Install](android15-background-ready.png)
- [Android 11 restored permission request waiting for Install](android11-restored-permission.png)

Comparison source: [Xtra update download and installation](https://github.com/crackededed/Xtra/blob/a3cbb0325f3330573a6738f7d36a2c5b785f4d1c/app/src/main/java/com/github/andreyasadchy/xtra/ui/settings/SettingsViewModel.kt#L335-L417).

The focused popup regression first reported `Tests 1 failed | 3 passed (4)` against the old host. With the fix, the same test and retry check pass. The complete suite reports `Tests 1038 passed (1038)`.

The unpublished 0.1.6-alpha.1 candidate made lifecycle callbacks acquire the updater work lock. A focused contention test reproduced callbacks waiting behind that lock with `1 test completed, 1 failed`. The 0.1.6-alpha.2 fix restores the volatile Activity reference and consumes permission return through an atomic reference. The same test passes, and all 11 native tests pass. APK verification remains serialized on the worker. The first candidate's release workflow was canceled before publication.

The final native engine has SHA-256 `7236768D2DA57FDF5B437E836B834CC7AC2FFDB6CCCBAF2005368904F1541C52`. On Android 15, the rebuilt proof repeated foreground download, permission return, automatic approval, and replacement with the private marker retained. The Android 11 and 16 screenshots record the preceding candidate's broader permission and failure checks.
