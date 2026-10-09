# Android update dialog and installer evidence

The official 0.1.5-alpha.1 APK (version code 6) upgraded through StreamFusion to official 0.1.6-alpha.3 (code 9) after Android approval on Android 15 and Android 16. The Android 16 emulator uses the Google Play system image. Its installer log reports package replacement and retained data. Android returned to Home after replacement. Reopening the app showed the installed version.

The user subsequently confirmed that their Android 16 phone reached 0.1.6 after closing and reopening StreamFusion. The phone's original rejection and apparent dependency on closing the app were not reproduced on either emulator. No phone installer status was available.

Both published APKs have the pinned production certificate and increasing version codes. The 0.1.6 APK passes `zipalign -c -P 16 -v 4`. All 62 arm64 and x86_64 shared libraries have LOAD segment alignment of at least 16 KB. These checks do not establish the phone's cause.

The new presentation uses Xtra's offer copy, No and Yes text buttons, and title-free download progress with Cancel. It closes the app dialog at the verified handoff and suppresses it during source permission, staging, and Android approval. Settings and the global update notice preserve explicit recovery. Android continues to own approval and package replacement.

Android's failure callback now preserves its numeric status and a bounded message in the existing operation journal. Legacy journal and bridge payloads remain supported. This improves diagnosis without changing package installation mechanics.

Validation: 181 mobile test files passed, with 1,049 tests, plus Node tests and architecture import proof. Mobile lint and typecheck passed. The isolated native proof compiled the modified production updater source and passed all 22 updater tests. The full generated Android unit-test task remains blocked by existing Kotlin internal visibility errors.

Sources: [Xtra update flow](https://github.com/crackededed/Xtra/blob/a3cbb0325f3330573a6738f7d36a2c5b785f4d1c/app/src/main/java/com/github/andreyasadchy/xtra/ui/settings/SettingsActivity.kt), [Android installer status message](https://developer.android.com/reference/android/content/pm/PackageInstaller.html#EXTRA_STATUS_MESSAGE), and [Android page-size verification](https://developer.android.com/guide/practices/page-sizes).

Screenshots and `015-playstore-installer-result.txt` capture the published baseline upgrade. `016-elf-alignment.json` records the shared-library check.

`xtra-offer.png` and `xtra-download.png` show the production React Native components in Storybook at a 412 by 915 viewport. The approval story renders no StreamFusion dialog.

The original Android 16 emulator now runs Development 0.1.7, version code 10. Its SecureStore file has the same SHA-256 before and after replacement. `development-017-installed.png` shows the installed version in Settings.

The separate Android 16 Google Play emulator exercised a seeded debug handoff from Development 0.1.7 to a local 0.1.8 fixture, version code 11. This fixture is not a public release and does not test the network download. Android source permission led to its Update prompt with no StreamFusion approval dialog. Cancel produced status 3 and `INSTALL_FAILED_ABORTED: User rejected permissions`. Retry reused the verified APK and returned to Android approval. Tapping Update replaced the package without manually closing the app and retained a private marker. `fixture-installer-result.txt` records the installed journal and package version. The fixture screenshots show approval and cancellation recovery.
