# Android app updates

The Updates page checks public GitHub Android releases on launch and when the selected foreground interval expires. **Check now** bypasses that interval. The release channel and check time remain in Product settings.

An available release opens the update dialog. **Download** starts an Android foreground service. The dialog shows transferred bytes and percentage. **Hide** closes the dialog while the transfer continues. **Cancel download** stops the transfer and removes its partial APK. **Later** postpones that release until the next day. **Open update** in Settings reopens it at any time.

The Android updater owns one operation at a time. It fetches the release's `android-update.json` from the canonical GitHub asset path and checks the tag, version, asset name, length, and SHA-256 against the selected release. It then streams the APK into app-private storage. Before **Install**, it checks the APK signature, installed package and signer, version code, minimum SDK, and published metadata. The production package also checks the pinned production certificate. The Android installer requires user approval. Installation is complete only after Android reports a newer installed version.

The native operation journal survives JavaScript reloads and process replacement. An interrupted transfer can restart from the beginning. A verified APK remains available after installation permission is denied. The development package has a different application ID, so the public production APK cannot update a development client.

The public release requires an APK asset named `StreamFusion-<tag>.apk`, an `android-update.json` asset, and the APK asset's GitHub `sha256:<digest>` and byte-size fields. The manifest schema is version 1 and contains `releaseTag`, `versionName`, `versionCode`, `assetName`, `sha256`, `byteLength`, and `minSdk`. The native updater accepts only the fixed StreamFusion GitHub release path and validated HTTPS asset redirects.
