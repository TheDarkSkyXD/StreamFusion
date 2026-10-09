# Android app updates

The Updates page checks public GitHub Android releases on launch and when the selected foreground interval expires. **Check now** bypasses that interval. The release channel and check time remain in Product settings.

Public Android releases use plain versions such as **0.1.7**, with tags such as `android-v0.1.7`. These releases are stable and do not require **Allow prerelease updates**. Existing alpha tags remain available for upgrade history.

An available release opens **Update available**, with **Download latest update?** and **Yes** and **No** buttons. Tap **Yes**, then approve **Update** in Android's installation prompt. The first action starts an Android foreground service that downloads and verifies the APK. **Downloading update…** shows transferred and total bytes with a progress bar and **Cancel**. Cancel or Back stops the transfer and removes its partial APK. **No** postpones that release until the next day. **Open update** in Settings reopens the offer.

The download dialog closes when the verified APK passes to Android. If the download finishes in the background, reopening the app continues to Android approval automatically. Settings and the update notice retain **Install**, **Open settings**, or **Continue install** when an interrupted handoff needs recovery. Android owns the approval prompt and replaces the old app process after approval.

The Android updater owns one operation at a time. It fetches the release's `android-update.json` from the canonical GitHub asset path and checks the tag, version, asset name, length, and SHA-256 against the selected release. It then streams the APK into app-private storage. Before handing it to Android, it checks the APK signature, installed package and signer, version code, minimum SDK, and published metadata. The production package also checks the pinned production certificate. The Android installer requires user approval. Installation is complete only after Android reports a newer installed version.

Android requires a one-time **Allow from this source** setup if StreamFusion does not have installation permission. Returning after granting permission continues automatically, including when Android restarts the app. Returning without granting it stops automatic continuation and retains **Open settings** for an explicit retry. Android approval remains mandatory.

The native operation journal survives JavaScript reloads and process replacement. It records the user's Update intent with the operation and generation. A restored verified update continues on foreground while that intent remains active. Cancellation, permission refusal, installer failure, and staging consume or clear it. Legacy ready records without that intent retain the manual **Install** recovery action. An interrupted transfer can restart from the beginning. The development package has a different application ID, so the public production APK cannot update a development client.

The public release requires an APK asset named `StreamFusion-<tag>.apk`, an `android-update.json` asset, and the APK asset's GitHub `sha256:<digest>` and byte-size fields. The manifest schema is version 1 and contains `releaseTag`, `versionName`, `versionCode`, `assetName`, `sha256`, `byteLength`, and `minSdk`. The native updater accepts only the fixed StreamFusion GitHub release path and validated HTTPS asset redirects.

If Android rejects an installation, the failure dialog retains its supplied status message and code for diagnosis. Older native clients can show only the generic failure. Closing a dialog never substitutes for Android approval.
