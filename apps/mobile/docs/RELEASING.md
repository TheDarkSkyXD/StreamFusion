# Releasing StreamFusion Mobile

StreamFusion Mobile publishes a signed Android APK in a GitHub Release. The Android release workflow uses the committed Gradle project in `apps/mobile/android`. The desktop release process in `docs/RELEASING.md` is separate.

## Tag namespaces

| Product | Tag format | Version source | Release workflow |
| --- | --- | --- | --- |
| Desktop | `v1.2.3`, `v2.0.0-rc.1` | `apps/desktop/package.json` | `.github/workflows/release.yml` |
| Android | `android-v0.1.9` | `apps/mobile/package.json` | `.github/workflows/android-release.yml` |

`scripts/release-policy.mjs` requires the tag version to equal the corresponding package version. Both products accept `X.Y.Z` and `X.Y.Z-(alpha|beta|rc)`. A prerelease number is optional, so both `0.1.9-alpha` and `0.1.9-alpha.1` are valid.

## Android identity

`apps/mobile/native-config.json` defines the development identity. The Gradle project reads this file directly.

| Field | Development | Production |
| --- | --- | --- |
| Application ID | `com.thedarkskyxd.streamfusion.dev` | `com.thedarkskyxd.streamfusion` |
| Name | StreamFusion Development | StreamFusion |
| Deep-link scheme | `streamfusion-development` | `streamfusion` |
| Version | `0.1.9` | `STREAMFUSION_PRODUCTION_VERSION` |
| `versionCode` | `12` | `STREAMFUSION_PRODUCTION_VERSION_CODE` |

Production identity is active only when `STREAMFUSION_RELEASE_CHANNEL` equals `production`. A production build also requires these values:

| Variable | Meaning | Accepted value |
| --- | --- | --- |
| `STREAMFUSION_PRODUCTION_VERSION` | APK `versionName` | `X.Y.Z`, `X.Y.Z-alpha`, or `X.Y.Z-alpha.N`, with `beta` and `rc` also accepted |
| `STREAMFUSION_PRODUCTION_VERSION_CODE` | APK `versionCode` | Positive integer |

`native-config.cjs` and `android/app/build.gradle` reject a missing version, an invalid version code, or an unpinned production certificate. Preview the resolved identity with:

```text
npm run --prefix apps/mobile config:android
```

Set the three production variables before running that command to preview the production identity.

## Signing identity

Read [SIGNING-KEY-RECOVERY.md](./SIGNING-KEY-RECOVERY.md) before changing the production signer. The recovery guide records the keystore location, backup procedure, and pinned certificate.

`apps/mobile/config/production-signing-certificate.json` pins the public application ID and the SHA-256 certificate fingerprint. `verify:release` refuses to replace that fingerprint with a different signer.

To record the first fingerprint, run:

```text
npm run --prefix apps/mobile verify:release -- --pin <sha256> <recorded-by>
```

To verify an APK, set `APKSIGNER_PATH` to the Android SDK `apksigner`. The script also needs `aapt2`, either through `AAPT2_PATH` or the configured Android SDK.

```text
npm run --prefix apps/mobile verify:release -- StreamFusion-android-v0.1.9.apk
```

The check rejects an unreadable signature, an unexpected signer, and any application ID other than `com.thedarkskyxd.streamfusion`.

## GitHub environment configuration

The `android-release` environment supplies the production build. Configure these secrets:

| Secret | Meaning |
| --- | --- |
| `STREAMFUSION_MOBILE_KEYSTORE_BASE64` | Base64-encoded production keystore |
| `STREAMFUSION_MOBILE_KEYSTORE_PASSWORD` | Keystore password |
| `STREAMFUSION_MOBILE_KEY_ALIAS` | Signing key alias |
| `STREAMFUSION_MOBILE_KEY_PASSWORD` | Signing key password |

Configure `ANDROID_PRODUCTION_VERSION_CODE` as an environment variable. Increase it for every published APK.

The build job also passes these public environment variables to Metro:

| Variable | Runtime use |
| --- | --- |
| `STREAMFUSION_PUBLIC_RELAY_URL` | Installation policy and provider catalog reads |
| `STREAMFUSION_PUBLIC_POLICY_TRUSTED_KEYS` | JSON object of trusted installation-policy keys |
| `STREAMFUSION_PUBLIC_TWITCH_CLIENT_ID` | Twitch client ID override |
| `STREAMFUSION_PUBLIC_KICK_CLIENT_ID` | Kick client ID override |
| `STREAMFUSION_PUBLIC_WORKER_URL` | Kick worker URL override |

The Babel build replaces each configured value in the JavaScript bundle. These public overrides are optional. Installation policy requires a relay URL and trusted policy keys when configured.

Live alerts use Android WorkManager on the device. No Firebase project, Google Services file, or notification server is required. Android checks eligible saved follows about every 15 minutes when a network is available and may delay checks to save battery. Force-stopping the app prevents background checks until you reopen it.

## Release workflow

`.github/workflows/android-release.yml` runs four jobs:

1. `verify` validates the tag, audits dependencies, creates a release bundle for inspection, and runs mobile lint, typecheck, and tests.
2. `signing` requires the pinned certificate and resolves the production identity.
3. `build` restores the keystore, runs `app:assembleRelease`, verifies the APK signer and application ID, and creates the Android Release Set.
4. `release` downloads the Release Set, verifies the APK again, creates a draft GitHub Release, and publishes it.

The workflow fails before publication when the tag does not match `apps/mobile/package.json`, the production identity is incomplete, a signing secret is missing, the signer differs from the pin, or the APK has the wrong application ID.

To publish the version recorded in `apps/mobile/package.json`, create and push the matching tag:

```text
git tag android-v0.1.9 <commit>
git push origin android-v0.1.9
```

The workflow never creates or moves a tag. It attaches the APK, `android-update.json`, `SHA256SUMS`, `build-info.json`, and `release-notes.md` to the GitHub Release.

## Android Release Gate

`docs/research/streamfusion-mobile/CONTEXT.md` defines the Android Release Gate as the final public-release decision. The release workflow does not run that gate.

`.github/workflows/android-public-release.yml` evaluates the recorded public-release evidence separately. APK-bound records must carry the digest of the APK under review. Repository tests require `android-release.yml` to remain separate from this gate. The repository does not connect that separate verdict to the publication workflow. GitHub environment protection, including required reviewers, is configured outside the repository.

Enable immutable GitHub Releases before publishing. When release attestations are unavailable, the workflow reports a notice for the missing attestation. It still fails on other `gh release verify` errors.
