# Two-step Android update verification

Verified on 2026-10-08. The normal update requires one StreamFusion **Update** action and Android's installation approval. Android's first **Allow from this source** setup remains mandatory. Android 11 labels its final approval **Install**; Android 15 labels it **Update**.

The old engine reproduced an extra app Install step after background completion. Its journal reached `ready` with `installIntent=false`. The updated engine records the initial authorization durably and consumes it when staging starts. Denial, cancellation, and failure stop automatic continuation. Old unarmed journals retain explicit recovery.

## Observed behavior

| Check | Result |
| --- | --- |
| Android 15 download completes on Home, then app reopens | Android approval opens without an app Install tap. |
| Android 15 approval canceled, Home, app reopens | Remains failed/install-blocked with installIntent=false. Approval does not reopen. Explicit retry opens approval and replaces code 1 with code 2 while retaining the private marker. |
| Android 11 permission denied, Home, app reopens | Remains permission-needed with installIntent=false. Settings does not reopen. |
| Android 11 new update, grant permission, return | Android kills PID 3369 for REQUEST_INSTALL_PACKAGES changed. PID 5329 restores the operation and opens approval without an app Install tap. Approval replaces code 1 with code 2 and retains the marker. |
| Original emulator development app replacement | Installed 0.1.6-alpha.3, code 9, with install -r. SecureStore file hash is identical before and after replacement. The original production app remains installed. |
| Published production APK upgrade on Android 15 | Alpha.2 code 8 downloaded Alpha.3 from GitHub, verified it, and opened Android Update automatically. Approval installed code 9. Prereleases and return checks remain enabled; Weekly remains selected. |

The Android proof APK contains the exact production updater classes and an isolated file transport. It uses its own package and signing key. It proves native verification, permission recovery, Android approval, replacement, and data retention. It does not prove the reported phone failure or a GitHub download. The dialog screenshot renders the production React Native component in Storybook.

The final native engine has SHA-256 `01690740E8DEB84D9302B57619FF3E7B6833EAB69D47BFF081C8CDCF85D43F0F`. Both Android 11 and Android 15 checks use that final build. Review corrected a permission-launch race by preserving ready when no live Activity exists. That narrow race was traced in source; it was not reproduced on the emulator.

## Published release

[Android 0.1.6-alpha.3](https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.6-alpha.3) is published. The [release workflow](https://github.com/TheDarkSkyXD/StreamFusion/actions/runs/37868412648) completed successfully from commit `a70b99c62ee31463d5dcbebfb4bb7e9480754fef`.

Downloaded the published release files and verified all four SHA256SUMS entries. The APK is 227,160,666 bytes with SHA-256 `cc265c765f31bc70ad0dfd76da4617c3b1477d2ca7f0b15e8e1f28a6d451be51`. Android apksigner verification exits 0 and reports the pinned production certificate `e84285558899c9eef61d5c8cd28f5fdb59ff70240246e7a073cb622642ef3c57`. Manifest badging confirms package `com.thedarkskyxd.streamfusion`, version code 9, version name 0.1.6-alpha.3, target SDK 36, and arm64-v8a, armeabi-v7a, x86, and x86_64. Release metadata declares minimum SDK 30, Android 11.

The production upgrade above uses Alpha.2's existing initial Download label. The new Alpha.3 dialog labels that action Update. The isolated native proof exercises Alpha.3's new background and restored-permission behavior. The specific phone failure remains unconfirmed.

## Regression checks

The initial handoff regression suite against the old engine reports `11 tests completed, 5 failed`. After tightening the stale callback check, the final handoff suite against that old engine reports `11 tests completed, 6 failed`. The final engine passes all 18 native tests, including 11 handoff cases. Restored permission tests skip the first reconciliation of their deliberately invalid APK fixture, then assert that foreground continuation reaches the real checksum gate. Successful installation is proven separately above.

The stale callback regression now starts with authorized install intent and holds the worker until it checks the old foreground lease. Removing that lease guard makes the test fail. Restoring the guard passes all 18 native tests. The released production engine is unchanged by this test-only follow-up.

Mobile checks pass all 180 Vitest files and 1,040 tests, Node tests, architecture import proof, lint, typecheck, 15 release identity tests, and six release-set tests. React Doctor reports 100/100 with no issues. The exact-source native proof uses the Windows AtomicFile test shadow documented in [the previous verification](../mobile-update-handoff/README.md). The normal generated Expo module test task remains unqualified because its existing Kotlin internal visibility configuration does not compile those tests.

The [main CI run](https://github.com/TheDarkSkyXD/StreamFusion/actions/runs/37868408456) passes desktop, core, and mobile verification. Its complete dependency audit fails with the same 91 advisories reported by the [previous release's main CI run](https://github.com/TheDarkSkyXD/StreamFusion/actions/runs/37862632775). The Android release workflow separately passes its shipped dependency audit. This change does not claim a green complete repository CI run.

Rebuild native proof with `verification/scripts/build-mobile-updater-native-proof.ps1`. Tap Update, finish permission setup when required, then approve Android installation. For background completion, launch with chunkDelayMs 600, tap Update, press Home, wait for the journal to reach ready, and reopen. Android approval must open automatically.

## Screenshots

- [Initial Update action](update-action.png)
- [Old background completion waiting for Install](background-before.png)
- [Android 15 automatic approval](android15-automatic-approval.png)
- [Android 15 installed with retained data](android15-installed.png)
- [Android 15 approval canceled without a loop](android15-approval-canceled.png)
- [Android 11 denied permission without a loop](android11-permission-denied.png)
- [Android 11 approval after process replacement](android11-restored-approval.png)
- [Android 11 installed with retained data](android11-installed.png)
- [Updated development app and preserved preferences](development-updated.png)
- [Production version before the upgrade](production-before-upgrade.png)
- [Production Android approval opened automatically](production-android-approval.png)
- [Production Alpha.3 installation confirmed](production-installed.png)
- [Production preferences retained after upgrade](production-preferences-retained.png)

Xtra's source automatically commits the installer session when the download completes. Its first source-permission setup still depends on Android. [Xtra updater source](https://github.com/crackededed/Xtra/blob/a3cbb0325f3330573a6738f7d36a2c5b785f4d1c/app/src/main/java/com/github/andreyasadchy/xtra/ui/settings/SettingsViewModel.kt).
