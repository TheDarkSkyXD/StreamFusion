# Signed GitHub APK delivery and update safety

Status: research complete

Date: 2026-08-29

Ticket: [#99](https://github.com/TheDarkSkyXD/StreamFusion/issues/99)

## Decision summary

GitHub-only Android distribution is viable for StreamFusion Mobile, but it makes StreamFusion responsible for work that an app store normally handles. The project must protect the signing key, publish immutable artifacts, notify users about updates, invoke Android's installer, and recover by shipping a newer build rather than rolling users back.

Use this release shape for Android 1.0:

1. Build a release APK with EAS Build using a production profile with `android.buildType: "apk"`.
2. Let EAS hold the operational copy of a StreamFusion-specific app-signing keystore. Keep independently encrypted offline backups of the keystore and every password needed to use it.
3. Promote the exact EAS artifact through a manually approved GitHub Actions release job. Verify its package name, numeric `versionCode`, signing-certificate fingerprint, and APK signature before publication.
4. Publish the APK, a machine-readable update manifest, checksums, and build metadata together in a draft GitHub Release, then publish it with GitHub release immutability enabled.
5. Check for updates from the public GitHub Releases API without embedding a GitHub token. Download only after user consent, verify the release metadata and SHA-256 digest, and hand the APK to Android's current `PackageInstaller` API with user action required.
6. Use APK releases, not EAS Update, as the production update channel unless the project explicitly changes the GitHub-only distribution decision.
7. Register the package and signing certificate through Android Developer Console before broad distribution.

The repository is public and currently has release immutability disabled. It has one existing desktop prerelease. Enabling immutability changes only future releases, according to [GitHub's setup documentation](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes).

## A new 2026 launch requirement

GitHub distribution does not avoid Android developer verification. Google now directs developers who distribute only outside Google Play to use Android Developer Console, verify their identity, register each package name, add the SHA-256 signing-certificate fingerprint, and prove ownership with a signed APK when required. Package-name claims may be first-come, first-served when no signing-key cluster has at least 50 known installs. StreamFusion should reserve its final package name as soon as the signing key exists. See the current [Android Developer Console registration guide](https://developer.android.com/developer-verification/guides/android-developer-console).

Regional enforcement starts September 30, 2026, in Brazil, Indonesia, Singapore, and Thailand for participating stores. Google plans global enforcement across install sources on certified Android devices in 2027. Unregistered apps remain available only through ADB or a more demanding advanced user flow. That is not an acceptable primary installation path for a public release. See [Android's current verification timeline](https://developer.android.com/developer-verification) and the [user-facing behavior](https://support.google.com/android/answer/17065026).

Developer verification establishes a link between a real developer, a package name, and signing keys. It is not an app review and does not make the APK safe by itself.

## Build-path comparison

| Path | Signing-key exposure | Traceability | Operational cost | Fit |
| --- | --- | --- | --- | --- |
| EAS cloud build with remote credentials | EAS stores and uses the operational keystore copy | EAS records the profile, versions, commit, initiator, logs, and build ID | Lowest | Recommended for 1.0 |
| `eas build --local` in a protected GitHub Actions environment | The GitHub runner receives the keystore and passwords | GitHub can attest the workflow that compiled the final APK | Medium | Good later if GitHub-native build provenance is required |
| Generated Android project built directly with Gradle in GitHub Actions | The GitHub runner receives the keystore and passwords | Strong GitHub workflow linkage | Highest because the team owns native generation and build maintenance | Viable, but it gives up much of EAS Build's value |
| Maintainer laptop build and manual upload | The key and build environment live on a workstation | Weak unless extensive evidence is recorded manually | Low setup, high audit and continuity risk | Do not use for production |

EAS defaults Android production output to an AAB, which cannot be installed directly. A GitHub release therefore needs `android.buildType: "apk"`; Expo maps that to Gradle's `:app:assembleRelease`. See [Expo's APK guide](https://docs.expo.dev/build-reference/apk/) and [the current `eas.json` schema](https://docs.expo.dev/eas/json/).

EAS cloud builds are the practical starting point. EAS supports remote or local credentials, and its Android credential store encrypts keystores with KMS and at rest. Without Play App Signing, however, the EAS keystore is the app-signing key itself rather than a replaceable upload key. Expo explicitly recommends downloading and backing it up. See [Expo's credential security model](https://docs.expo.dev/app-signing/security/) and [credential download procedure](https://docs.expo.dev/app-signing/app-credentials/).

The local EAS path is useful if policy later requires the compiler and signer to run inside GitHub Actions. It is not a drop-in reproducibility guarantee. Expo documents that local builds ignore several tool-version settings from `eas.json`, require the caller to provide Android tooling, and still require Expo authentication. See [EAS local-build limitations](https://docs.expo.dev/build-reference/local-builds/).

## Signing-key custody and recovery

The signing key is the durable identity of StreamFusion Mobile. Android accepts an update only when its application ID matches, its signing certificate matches or has a valid proof of rotation, and its `versionCode` is at least the installed value. A package that fails these checks requires uninstalling the installed app, which erases its app data. See [Android's update rules](https://developer.android.com/google/play/app-updates).

Required custody controls:

- Generate one signing key dedicated to StreamFusion Mobile. Do not reuse the desktop signing key or another Android app's key.
- Give the certificate a validity period longer than the expected product lifetime. Android recommends at least 25 years in its [app-signing guidance](https://developer.android.com/studio/publish/app-signing).
- Keep the operational copy in EAS remote credentials for production builds. Require multi-factor authentication for maintainers who can manage credentials or start production builds.
- Immediately download the keystore through `eas credentials`. Store at least two encrypted offline copies in separate locations. Keep the keystore password, key password, alias, creation details, and recovery instructions in the project's approved secret manager.
- Store the public certificate and its SHA-256 fingerprint in the repository. A public certificate is not secret. The release job must fail if the APK signer differs from this pinned fingerprint.
- Test recovery before 1.0, then on a schedule. Restore a backup in an isolated environment, sign a non-production test artifact, and confirm that `apksigner verify --print-certs` reports the pinned fingerprint.
- Keep GitHub and Expo release authority separate where practical. A GitHub compromise should not automatically grant access to the signing key, and an Expo compromise should not automatically publish a GitHub Release.

There is no Play-managed key reset in this distribution model. If every keystore copy or its passwords are lost, existing installs cannot receive a normal update. A new key requires a new application ID and a fresh installation.

Android supports proof-of-rotation through APK Signature Scheme v3, but rotation is a planned migration, not a substitute for backups. The lineage must be authorized by the old key. Android also warns that rotation is not recommended for Android 12 and earlier; behavior depends on target OS versions and signing options. See the [APK Signature Scheme v3 specification](https://source.android.com/docs/security/features/apksigning/v3) and [`apksigner` rotation options](https://developer.android.com/tools/apksigner). Treat key compromise as a release-stopping security incident and test any rotation plan across every supported Android version before using it.

## Release pipeline

### Build gate

The release commit is the source of truth for `versionName` and `versionCode`. Use a strictly increasing `versionCode` for every public APK, even though Android permits an equal value in some update cases. Expo exposes the installed Android value as `Application.nativeBuildVersion`; see [Expo Application](https://docs.expo.dev/versions/latest/sdk/application/) and [Expo's version-management guide](https://docs.expo.dev/build-reference/app-versions/).

The production profile should:

- require a clean Git commit with `cli.requireCommit: true`;
- use `android.buildType: "apk"`;
- keep automatic version increments off so the release commit records the shipped `versionCode`;
- pin the EAS CLI, Expo SDK, Node version, package-manager version, lockfile, Gradle wrapper, Android SDK and NDK versions, and a named EAS build image rather than `latest` or an SDK alias;
- use remote production credentials, never a debug keystore.

Expo says a specifically named EAS image provides a consistent environment with only minor updates. It is more stable than `auto` or `latest`, but it is not a hermetic input. See [EAS build-server images](https://docs.expo.dev/build-reference/infrastructure/) and [build-tool configuration](https://docs.expo.dev/build/eas-json/).

### Promotion gate

After EAS finishes, a protected GitHub Actions environment should require a maintainer's approval before it can publish. The job must select the EAS build by build ID and confirm the recorded Git commit matches the release tag. EAS build metadata records the last commit, build profile, app version, version code, initiator, and logs; see [Expo's build metadata description](https://docs.expo.dev/tutorial/eas/android-development-build/) and [EAS build environment fields](https://docs.expo.dev/eas/environment-variables/usage/).

Before creating a release, the job must fail unless all checks pass:

- `apksigner verify --verbose --print-certs` succeeds;
- package name equals StreamFusion Mobile's registered application ID;
- `versionCode` equals the committed release value and exceeds the last public release;
- signer SHA-256 equals the pinned public certificate fingerprint;
- the artifact is a release build and does not contain debug configuration;
- automated Android tests and a clean-device install and upgrade test passed;
- the computed SHA-256 and byte length match every generated metadata file.

`apksigner` is the Android SDK tool that verifies whether an APK's signatures work across its supported Android versions. Any byte change after signing invalidates the APK signature. See the official [`apksigner` reference](https://developer.android.com/tools/apksigner).

### GitHub Release contract

Create the release as a draft first. Attach every asset, validate it, then publish once. GitHub recommends this order because immutable release assets and tags cannot be changed after publication. Immutable releases also generate a release attestation that records the release tag, commit SHA, and assets. See [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) and [release integrity verification](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity).

Each stable Android release should contain:

- `StreamFusion-android-vX.Y.Z.apk`, the single universal production APK;
- `android-update.json`, the versioned updater contract;
- `SHA256SUMS`, for manual verification and mirrors;
- `build-info.json`, containing the Git tag, commit SHA, EAS build ID and URL, build profile, Expo SDK, build image, package name, `versionName`, `versionCode`, minimum SDK, signer SHA-256, artifact SHA-256, and byte length;
- an SPDX or CycloneDX SBOM when the mobile build pipeline can generate one reliably;
- release notes with supported Android versions, permission changes, migrations, known issues, and the exact first-install instructions.

`android-update.json` should have a schema version and contain only typed data needed by the updater: release tag, `versionName`, `versionCode`, APK asset name, SHA-256, byte length, minimum SDK, and mandatory-update status. Do not put executable URLs in the manifest. Select the actual download URL from the GitHub API's matching release asset object.

GitHub's release API reports each asset's `browser_download_url`, size, and SHA-256 digest. GitHub permits up to 1,000 assets per release, requires each asset to be under 2 GiB, and has no release bandwidth limit. See the [release API](https://docs.github.com/en/rest/releases/releases) and [release storage limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).

Never replace an APK under an existing version. Publish a new tag and a higher `versionCode`. Release immutability is currently disabled in this repository and must be enabled before the first production mobile release.

## Provenance and reproducibility

Do not call the APK reproducible until two clean, independent builds of the same commit produce the same unsigned and signed hashes. EAS cloud images may receive minor updates, Android packaging can include environment-sensitive inputs, and the signing stage is another source of variation. A pinned image and lockfiles reduce drift but do not prove byte-for-byte reproduction.

Use these controls even if byte-for-byte reproduction is not yet achieved:

- commit JavaScript and native dependency lockfiles;
- reject dynamic and snapshot dependencies in production;
- use Gradle dependency locking and check lockfiles into source control;
- enable Gradle dependency verification with reviewed SHA-256 checksums and signatures where publishers provide them;
- pin third-party GitHub Actions to full commit SHAs;
- record all build inputs and the EAS build ID in `build-info.json`;
- retain build logs according to a written retention policy;
- build only from a reviewed release commit, never from a contributor pull request context.

Gradle states that dependency locking is needed to resolve the same module versions and that dependency verification detects replaced or tampered dependencies. See [Gradle dependency locking](https://docs.gradle.org/current/userguide/dependency_locking.html) and [Gradle dependency verification](https://docs.gradle.org/current/userguide/dependency_verification.html). GitHub likewise says a full commit SHA is the only immutable way to pin an action. See [GitHub Actions secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

GitHub artifact attestations provide useful provenance only when the attested workflow actually builds the artifact. If GitHub Actions merely downloads a signed APK from EAS, an Actions attestation proves which GitHub workflow handled those bytes, not how EAS compiled them. For the recommended EAS-cloud path, use the immutable-release attestation plus EAS build metadata and state this boundary plainly. If stronger build provenance becomes a release requirement, move the compile and sign stages into a vetted GitHub reusable workflow, then generate a GitHub artifact attestation for the final APK. GitHub documents what attestations contain and warns that they link artifacts to build instructions rather than proving an artifact is safe in [Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations).

## Safe in-app update flow

The updater needs a small Android-only native Expo module. Expo recommends a local module for custom native code used by one app; see [Expo Modules API](https://docs.expo.dev/modules/get-started/). A config plugin should declare the required Android manifest configuration so Continuous Native Generation can recreate it safely; see [Expo config plugins](https://docs.expo.dev/config-plugins/introduction/).

Use this flow:

1. Check only on explicit user request and at most once per 24 hours while the app is in the foreground. Cache the last success and apply exponential backoff after errors.
2. Call `GET /repos/TheDarkSkyXD/StreamFusion/releases/latest` over HTTPS. GitHub defines this as the latest published, non-draft, non-prerelease release and permits unauthenticated access for public repositories. The unauthenticated limit is 60 requests per hour per source IP, so never poll frequently and never embed a personal or repository token in the APK. See [Get the latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) and [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
3. Accept only a release whose API response says `immutable: true`. Find exactly one `android-update.json` asset and verify its downloaded SHA-256 against the API's asset digest before parsing it.
4. Parse the manifest with a strict schema and bounded sizes. Compare its numeric `versionCode` with `Application.nativeBuildVersion`. Do not decide update order from a SemVer tag alone.
5. Show the version, download size, permission changes, and plain-text release notes. Do not render release HTML or follow URLs embedded in release notes.
6. After consent, download the one named APK from the matching API asset into app-private cache. Enforce the declared byte length and a conservative maximum size, then compute and compare SHA-256.
7. Confirm the archive's application ID and `versionCode` before starting installation. The Android package installer remains the authority for signature and update compatibility.
8. Declare `REQUEST_INSTALL_PACKAGES`, check `PackageManager.canRequestPackageInstalls()`, and open the per-app `ACTION_MANAGE_UNKNOWN_APP_SOURCES` settings only after the user taps Install. Android lets the user decide which external source may request installs. See [`canRequestPackageInstalls`](<https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()>) and [`ACTION_MANAGE_UNKNOWN_APP_SOURCES`](https://developer.android.com/reference/android/provider/Settings#ACTION_MANAGE_UNKNOWN_APP_SOURCES).
9. Stage the APK through `PackageInstaller` and explicitly require user action. Handle `STATUS_PENDING_USER_ACTION`, success, cancellation, verification failure, and insufficient storage. Do not try to install silently. Android deprecated `ACTION_INSTALL_PACKAGE` in API 29 in favor of `PackageInstaller`; see the [Intent reference](https://developer.android.com/reference/android/content/Intent#ACTION_INSTALL_PACKAGE) and [`PackageInstaller.SessionParams`](<https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)>).
10. Delete the cached APK and manifest after success, cancellation, or expiry.

The GitHub asset digest and `SHA256SUMS` detect corruption and asset mismatch. They are not independent proof against a compromised GitHub account because an attacker who can create a new release can publish matching metadata. Android's APK signature is the final code-authenticity boundary. The system rejects an update that lacks the correct signing certificate or valid rotation proof.

Do not certificate-pin GitHub's TLS certificate. Pin the StreamFusion APK signing-certificate fingerprint in release validation, and let the platform TLS store handle GitHub's changing service certificates.

### First installation

The first installation starts on the GitHub Release page because no updater exists yet:

1. The user opens the repository's published immutable release and downloads the named APK.
2. Android may ask the user to allow that browser or file manager to install unknown apps.
3. Android shows its package-installer confirmation and developer-verification result.
4. The user disables the source permission afterward if they do not want that browser to remain trusted. StreamFusion's later in-app updates use StreamFusion itself as the requesting source.

Project documentation should never tell users to disable Play Protect. The advanced unverified-developer flow is an emergency path for power users, not normal onboarding.

## Rollback constraints

GitHub can retain old APKs, but Android does not treat them as normal rollback packages. A lower `versionCode` fails the standard update rules. Installing it requires uninstalling StreamFusion first, which erases device-local app data.

The production rollback strategy is therefore a forward fix:

- rebuild the last known-good source with a new tag and a `versionCode` higher than the faulty release;
- keep database and preference migrations recoverable enough for that forward fix to open data written by the faulty version;
- stop advertising a faulty release and publish clear incident notes, but never replace its immutable APK;
- use prereleases for beta users. GitHub's latest-release endpoint excludes prereleases, so stable clients will not see them;
- test clean install, one-version upgrade, oldest-supported upgrade, canceled install, low-storage failure, and forward-fix recovery before each public release.

GitHub-only distribution has no staged rollout or automatic store rollback. Once a stable release becomes latest, every checking client can see it. A mandatory update flag should be reserved for remotely exploitable or service-breaking releases and should still leave the user in control of Android's install confirmation.

## Security boundaries

| Boundary | What it protects | What it cannot protect |
| --- | --- | --- |
| Android app-signing key | Code identity and update continuity | A build signed after the key or signing service is compromised |
| Android package installer | Package ID, signature lineage, version rules, and user install consent | A malicious APK correctly signed by the legitimate key |
| Android Developer Console registration | Developer identity and package ownership on certified devices | App quality or source-to-binary correctness |
| EAS credentials and build service | Operational signing and build isolation | A compromised Expo account, token, project member, or service |
| GitHub protected release workflow | Which artifact becomes an official release | APKs distributed outside GitHub with a stolen signing key |
| Immutable GitHub Release | Post-publication tag and asset replacement | A newly created malicious release by an attacker with release access |
| Checksums | Corruption and byte mismatch | Authenticity when checksum and artifact share one compromised publisher |
| Release and build attestations | Traceability to release or build context | Proof that source and dependencies are safe |
| In-app updater | Correct release selection, size limits, digest checks, and install handoff | Silent install authority or recovery from a lost signing key |

A signing-key compromise is worse than a GitHub-only compromise. Android notes that another installer can update an app when it has an APK with the same certificate and a sufficient `versionCode`. Protect Expo signing authority accordingly; GitHub is not the only place a stolen key could be abused. See [Android's cross-installer update behavior](https://developer.android.com/google/play/app-updates).

The release workflow should use a protected environment, least-privilege `GITHUB_TOKEN` permissions, no signing or Expo secrets in pull-request jobs, and actions pinned to full commit SHAs. GitHub confirms that Actions secrets are not sent to fork pull-request workflows, but maintainers still must prevent untrusted code from running in the approved release job. See [GitHub secret behavior](https://docs.github.com/en/code-security/reference/secret-security/secret-types) and [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use).

## Decisions still needed

1. **Verified publisher ownership.** Will the Android Developer Console full-distribution account belong to the project owner as an individual or to a legal organization? This determines identity evidence, account recovery, and who can register the package name.
2. **Signing-service boundary.** Is EAS cloud allowed to hold and use the production app-signing key, as recommended for 1.0, or must StreamFusion build and sign only inside a protected GitHub environment?
3. **Recovery custody.** Who holds the two offline keystore backups and the separate recovery credentials, and who performs the scheduled restore test?
4. **Minimum Android version.** Will Mobile support Android 7 and 8 because current Expo SDKs can, or set Android 9 or newer as the floor? The answer changes key-rotation compatibility and device test coverage.
5. **Production OTA policy.** Does "GitHub APK releases only" also forbid EAS Update for JavaScript and asset changes? This report recommends yes so every production code change is represented by a signed immutable APK.
6. **Updater scope.** Should 1.0 include the native download and `PackageInstaller` flow, or only a safe in-app check that opens the immutable GitHub Release page? The native flow is smoother but adds a security-sensitive Android module and `REQUEST_INSTALL_PACKAGES` permission.

## Acceptance checks for the later implementation

- A clean device can install the GitHub APK through the documented flow.
- A device on the previous production build can update without losing local data.
- An APK with the wrong signer, package name, digest, or lower `versionCode` never reaches a successful install.
- The updater handles API rate limits, offline use, redirects, canceled installs, low storage, and missing or malformed assets without blocking app startup.
- The release job refuses a dirty or mismatched commit and refuses an unapproved signing certificate.
- `gh release verify TAG` and `gh release verify-asset TAG APK` pass for the immutable release.
- The offline keystore backup can reproduce the pinned signing-certificate fingerprint.
- The package and signing key show Registered in Android Developer Console before public launch.
