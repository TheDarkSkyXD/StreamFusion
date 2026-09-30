# Releasing StreamFusion Mobile

StreamFusion Mobile distributes a signed Android APK from a GitHub Release. It is never published to Google Play. Android developer verification is enforced at install time against the **install source**, so a GitHub APK is verified exactly like a store APK. The package name and signing certificate must be registered in the Android Developer Console.

The desktop release path in `docs/RELEASING.md` is separate. Desktop and Android version independently and never share a tag namespace.

## Tag namespaces

| Product | Tag format | Version source | Release workflow |
| --- | --- | --- | --- |
| Desktop | `v1.2.3`, `v2.0.0-rc.1` | `apps/desktop/package.json` | `.github/workflows/release.yml` |
| Android | `android-v0.1.0-alpha` | `apps/mobile/package.json` | none yet |

`scripts/release-policy.mjs` validates both. An `android-v` prefix resolves against the mobile package and a bare `v` prefix resolves against the desktop package, so neither product can publish under the other's namespace. The desktop workflow triggers on `v*`, which cannot match an `android-v` tag because the glob is anchored at the start of the ref.

Both products accept `X.Y.Z` and `X.Y.Z-(alpha|beta|rc)`. The prerelease number is optional for Android, so `0.1.0-alpha` and `0.1.0-alpha.1` are both valid Android versions. The desktop policy requires the number.

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

## Release workflow

`.github/workflows/android-release.yml` builds and publishes the APK. It is separate from the desktop workflow and uses its own `android-release` environment, so a mobile approval never queues behind a desktop approval.

```text
verify    tag is android-v*, matches apps/mobile/package.json, workspace is green
signing   the pinned certificate exists and the production identity resolves closed
build     EAS production build, download, verify signer, assemble the Release Set
release   draft the release, then publish and verify immutability
```

The APK is built by EAS using the `production` profile, which holds the signing key in remote credentials so the key never reaches a GitHub runner. The workflow refuses to produce bytes until three independent gates agree: the pinned certificate is present, all four production variables are set, and the release channel is `production`.

Set these before the first run. The four identity values are not secrets, so they belong in environment variables, not environment secrets:

| Name | Kind | Meaning |
| --- | --- | --- |
| `EXPO_TOKEN` | repository secret | Expo CLI access |
| `STREAMFUSION_PRODUCTION_EAS_PROJECT_ID` | variable | StreamFusion Expo project UUID |
| `STREAMFUSION_PRODUCTION_EAS_OWNER` | variable | Expo account name |
| `ANDROID_PRODUCTION_VERSION_CODE` | variable | Strictly increasing `versionCode` for this release |

Publish with:

```bash
git tag android-v0.1.0-alpha.1 <commit>
git push origin android-v0.1.0-alpha.1
```

The workflow never creates or moves a tag, and never publishes from a contributor pull request.

Each release attaches the full Android Release Set: the signed APK, `android-update.json`, `SHA256SUMS`, `build-info.json`, and `release-notes.md`. The updater manifest carries no URLs, and the release is created as a draft and published only after the signer is re-verified, because an immutable release cannot be corrected afterwards.

## The Android Release Gate is not enforced here

`CONTEXT.md` defines the Android Release Gate as the single publish decision. This workflow does not run it, and that is a deliberate temporary gap rather than an oversight.

The gate reads recorded evidence whose `apkDigest` must equal the digest of the APK under evaluation. A workflow that builds its own APK therefore cannot have a pre-existing record for it, so gating publication on `android-public-release` inside the release workflow would be circular rather than merely blocked. `verification/catalog.json` also has an empty `gateRuns`, so no gate can pass today.

What this workflow does enforce, fail-closed, is the part of the gate that concerns its own bytes: the pinned signer, the production package name, the release commit matching the tag, the production build profile, and a self-consistent Release Set. The remaining slots, including candidate runs, device journeys, and human approvals, stay in `android-public-release.yml`. The human gate here is the required reviewer on the `android-release` environment.

Enable GitHub release immutability in the repository settings before the first publish. Without it the release stays mutable, which the in-app updater rejects.

## What is not built yet

A production build is not a release. The remaining work is tracked in [#175](https://github.com/TheDarkSkyXD/StreamFusion/issues/175), [#178](https://github.com/TheDarkSkyXD/StreamFusion/issues/178), and [#181](https://github.com/TheDarkSkyXD/StreamFusion/issues/181):

- the production Android signing key, its two offline backups, and a recovery drill
- Android Developer Console identity verification and package registration
- the in-app updater that consumes `android-update.json` ([#176](https://github.com/TheDarkSkyXD/StreamFusion/issues/176))
- GitHub release immutability enabled on the repository
- working Twitch and Kick sign-in ([#145](https://github.com/TheDarkSkyXD/StreamFusion/issues/145), [#146](https://github.com/TheDarkSkyXD/StreamFusion/issues/146))

Every Android parity record still blocks public release on OAuth. Do not tag a mobile version until those close.
