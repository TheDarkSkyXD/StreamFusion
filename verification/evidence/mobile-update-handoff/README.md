# Android update handoff verification

Verified on 2026-10-08. The reported phone failure remains unconfirmed. The official production update from 0.1.4-alpha.1 to 0.1.5-alpha.1 succeeded on Android 11, 15, and 16 before this change.

The confirmed UI regression hid a rejected native Install command in the update popup. Commit `f1adbf3` records the failing session-to-dialog test. The fix shows that error, preserves the Install action, and clears the error on retry.

Xtra starts installation after download. StreamFusion now continues after APK verification while the same Activity stays foregrounded. Android still requires approval. Background completion and process restoration wait for an explicit Install action.

## Observed checks

| Check | Result |
| --- | --- |
| Mobile suite | 180 Vitest files, 1,038 tests passed; Node tests and architecture import proof passed |
| Native updater suite | 10 tests passed in the isolated proof project |
| Changed React UI | React Doctor 100/100, no issues; TypeScript and targeted ESLint passed |
| Android 15 foreground completion | Android approval opened without a second app Install tap |
| Android 15 cancelled approval | Visible install-blocked phase; retry reopened approval using the retained APK |
| Android 15 background completion | Ready phase remained after reopening; explicit Install opened approval |
| Android 11 denied permission | Verified APK remained in permission-needed with Install available |
| Android 11 process restoration | Granting permission after process termination did not auto-install; explicit Install opened approval |
| Android 11 and 15 replacement | Version code changed from 1 to 2; private marker survived |

The [proof build script](../../scripts/build-mobile-updater-native-proof.ps1) copies the production updater classes into an isolated Android app. Its test-only Activity injects a local file transport through the private constructor. It uses the real journal, APK verifier, foreground service, PackageInstaller, receiver, and consent Activity. The APKs use one proof signing key and an isolated package. This proves native handoff and replacement, while the official APK checks above exercise GitHub downloads.

Windows Robolectric cannot replace an existing file through the Android framework's `File.renameTo` implementation. The proof script substitutes only that private rename with `Files.move(REPLACE_EXISTING)` in test sources. Neither APK includes this shadow. The normal Expo module unit-test task also fails to compile existing internal Kotlin tests in this environment; the isolated project compiles and runs those same assertions.

## Screenshots

The popup screenshot renders the production React Native component in Storybook. The native screenshots show the isolated proof app on Android emulators.

- [Popup with visible command error](popup-action-error.png)
- [Android 11 installed version and retained data](android11-installed.png)
- [Android 15 installed version and retained data](android15-installed.png)
- [Android 15 background completion waiting for Install](android15-background-ready.png)
- [Android 11 restored permission request waiting for Install](android11-restored-permission.png)

Comparison source: [Xtra update download and installation](https://github.com/crackededed/Xtra/blob/a3cbb0325f3330573a6738f7d36a2c5b785f4d1c/app/src/main/java/com/github/andreyasadchy/xtra/ui/settings/SettingsViewModel.kt#L335-L417).
