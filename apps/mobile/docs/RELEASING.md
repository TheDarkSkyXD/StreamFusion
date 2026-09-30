# Releasing StreamFusion Mobile

StreamFusion Mobile distributes a signed Android APK from a GitHub Release. It is never published to Google Play. Android developer verification is enforced at install time against the **install source**, so a GitHub APK is verified exactly like a store APK. The package name and signing certificate must be registered in the Android Developer Console.

The desktop release path in `docs/RELEASING.md` is separate. Desktop tags are validated against `apps/desktop/package.json`; a mobile release never uses a `v*` tag on the desktop release workflow.

## Identity

`app.json` is the committed development identity and stays the single source of truth for it:

| Field | Development | Production |
| --- | --- | --- |
| Application ID | `com.thedarkskyxd.streamfusion.dev` | `com.thedarkskyxd.streamfusion` |
| Name | StreamFusion Development | StreamFusion |
| Deep-link scheme | `streamfusion-development` | `streamfusion` |
| Version | `0.1.0-alpha.1` | supplied at build time |
| versionCode | `2` | supplied at build time |

`app.config.js` selects between them. Production resolves only when `STREAMFUSION_RELEASE_CHANNEL` is exactly `production`. Every other value, including an unset variable, resolves the development identity. A production build additionally requires all four of these, and inherits none of them from the development identity:

| Variable | Meaning | Pattern |
| --- | --- | --- |
| `STREAMFUSION_PRODUCTION_EAS_PROJECT_ID` | StreamFusion Expo organization project | UUID |
| `STREAMFUSION_PRODUCTION_EAS_OWNER` | Expo account that owns it | `a-z0-9-` |
| `STREAMFUSION_PRODUCTION_VERSION` | Shipped `versionName` | `X.Y.Z` or `X.Y.Z-(alpha\|beta\|rc).N` |
| `STREAMFUSION_PRODUCTION_VERSION_CODE` | Shipped `versionCode` | positive integer |

The `production` EAS profile sets the channel variable and pins a named SDK 57 image. `autoIncrement` is off, so the release commit records the shipped `versionCode`.

Preview the resolved config before building:

```bash
npm run --workspace @streamfusion/mobile config:android
```

## Signing identity

`config/production-signing-certificate.json` pins the production certificate. The repository ships with `certificateSha256: null`, which fails every production build closed. An unpinned signer cannot be verified before publication, and Android accepts an update only when the certificate matches.

Generate the production key once. The script uses the JDK bundled with Android Studio, prompts for the password without echoing it, and passes it to `keytool` through the environment so it never reaches a command line or a log:

```powershell
./apps/mobile/scripts/generate-production-key.ps1
```

It writes to `~/.streamfusion/streamfusion-mobile-release.jks` by default, refuses to overwrite an existing keystore, and prints the SHA-256 fingerprint. The key is dedicated to StreamFusion Mobile and must never be reused from desktop or development. Back it up twice, encrypted, in separate physical locations, before pinning.

Record the fingerprint:

```bash
npm run --workspace @streamfusion/mobile verify:release -- --pin <sha256> <recorded-by>
```

Read the fingerprint from `keytool -list -v -keystore <keystore> -alias <alias>` or `eas credentials`. The script refuses to replace an existing pin, because a new signer strands every installed copy. Back up the keystore twice, encrypted, in separate locations before pinning.

Verify an artifact against the pin. Set `APKSIGNER_PATH` to the Android SDK build-tools `apksigner`:

```bash
npm run --workspace @streamfusion/mobile verify:release -- StreamFusion-android-v1.0.0.apk
```

The check fails on an unexpected signer, a foreign package name, or an unreadable signature.

## What is not built yet

A production build is not a release. The remaining work is tracked in [#175](https://github.com/TheDarkSkyXD/StreamFusion/issues/175), [#178](https://github.com/TheDarkSkyXD/StreamFusion/issues/178), and [#181](https://github.com/TheDarkSkyXD/StreamFusion/issues/181):

- the production Android signing key, its two offline backups, and a recovery drill
- Android Developer Console identity verification and package registration
- the `android-update.json`, `SHA256SUMS`, and `build-info.json` Release Set
- a protected promotion job that verifies signer, package, and `versionCode`
- GitHub release immutability enabled on the repository
- working Twitch and Kick sign-in ([#145](https://github.com/TheDarkSkyXD/StreamFusion/issues/145), [#146](https://github.com/TheDarkSkyXD/StreamFusion/issues/146))

Every Android parity record still blocks public release on OAuth. Do not tag a mobile version until those close.
