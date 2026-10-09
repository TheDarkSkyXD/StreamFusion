# Two-step Android update verification

Verified on 2026-10-08. The normal update requires one StreamFusion **Update** action and Android's installation approval. Android's first **Allow from this source** setup remains mandatory. Android 11 labels its final approval **Install**; Android 15 labels it **Update**.

The old engine reproduced an extra app Install step after background completion. Its journal reached `ready` with `installIntent=false`. The updated engine records the initial authorization durably and consumes it when staging starts. Denial, cancellation, and failure stop automatic continuation. Old unarmed journals retain explicit recovery.

## Observed behavior

| Check | Result |
| --- | --- |
| Android 15 download completes on Home, then app reopens | Android approval opens without an app Install tap. Approval replaces code 1 with code 2 and retains the private marker. |
| Android 11 permission denied, Home, app reopens | Remains permission-needed with installIntent=false. Settings does not reopen. |
| Android 11 new update, grant permission, return | Android kills PID 3369 for REQUEST_INSTALL_PACKAGES changed. PID 5329 restores the operation and opens approval without an app Install tap. Approval replaces code 1 with code 2 and retains the marker. |
| Original emulator development app replacement | Installed 0.1.6-alpha.3, code 9, with install -r. SecureStore file hash is identical before and after replacement. The original production app remains installed. |

The Android proof APK contains the exact production updater classes and an isolated file transport. It uses its own package and signing key. It proves native verification, permission recovery, Android approval, replacement, and data retention. It does not prove the reported phone failure or a GitHub download. The dialog screenshot renders the production React Native component in Storybook.

The final native engine has SHA-256 `01690740E8DEB84D9302B57619FF3E7B6833EAB69D47BFF081C8CDCF85D43F0F`. Android 11 uses that final build. The initial Android 15 check used the preceding `018CFF30A2C34858BAE10FE3A9D322440A1EE8606B5A690B3132E59FE564C89D` build. Review subsequently corrected a permission-launch race by preserving ready when no live Activity exists. That narrow race was traced in source; it was not reproduced on the emulator.

## Regression checks

The same handoff tests against the old engine report `11 tests completed, 5 failed`. The final engine passes all 18 native tests, including 11 handoff cases. Restored permission tests skip the first reconciliation of their deliberately invalid APK fixture, then assert that foreground continuation reaches the real checksum gate. Successful installation is proven separately above.

Mobile checks pass all 180 Vitest files and 1,040 tests, Node tests, architecture import proof, lint, typecheck, 15 release identity tests, and six release-set tests. React Doctor reports 100/100 with no issues. The exact-source native proof uses the Windows AtomicFile test shadow documented in [the previous verification](../mobile-update-handoff/README.md). The normal generated Expo module test task remains unqualified because its existing Kotlin internal visibility configuration does not compile those tests.

Rebuild native proof with `verification/scripts/build-mobile-updater-native-proof.ps1`. Tap Update, finish permission setup when required, then approve Android installation. For background completion, launch with chunkDelayMs 600, tap Update, press Home, wait for the journal to reach ready, and reopen. Android approval must open automatically.

## Screenshots

- [Initial Update action](update-action.png)
- [Old background completion waiting for Install](background-before.png)
- [Android 15 automatic approval](android15-automatic-approval.png)
- [Android 15 installed with retained data](android15-installed.png)
- [Android 11 denied permission without a loop](android11-permission-denied.png)
- [Android 11 approval after process replacement](android11-restored-approval.png)
- [Android 11 installed with retained data](android11-installed.png)

Xtra's source automatically commits the installer session when the download completes. Its first source-permission setup still depends on Android. [Xtra updater source](https://github.com/crackededed/Xtra/blob/a3cbb0325f3330573a6738f7d36a2c5b785f4d1c/app/src/main/java/com/github/andreyasadchy/xtra/ui/settings/SettingsViewModel.kt).
