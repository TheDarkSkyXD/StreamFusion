# Releasing StreamFusion

Production releases are created only by `.github/workflows/release.yml`. The workflow accepts a pushed `v*` tag or an existing tag selected through **Run workflow**. It rejects any tag that is not exactly `v` plus the version in `apps/desktop/package.json`.

The current application version is `2.0.0`, so its matching release tag is `v2.0.0`. Supported prerelease suffixes are `alpha.N`, `beta.N`, and `rc.N`. A stable release uses only `X.Y.Z`.

## GitHub setup

Create a protected GitHub environment named `production-release`. Require a reviewer before jobs can use it, then add these environment secrets when you want signed production builds:

- `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`
- `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`

### Signing behavior

Production prefers filled signing secrets. When those secrets are present (and for macOS, Apple notarization secrets too), the Release workflow packages signed Windows installers and signed+notarized macOS apps, then verifies Authenticode / codesign / stapler before upload.

When signing secrets are **absent** or incomplete, the workflow does **not** fail. It packages **unsigned** desktop installers (`package:windows:x64`, `package:macos:x64`, `package:macos:arm64` with `CSC_IDENTITY_AUTO_DISCOVERY=false`), skips signature and notarization verification, uploads the same artifact filenames, and still publishes the GitHub Release. Expect Windows SmartScreen and macOS Gatekeeper warnings on unsigned builds. Ordinary CI builds do not force signing either.

Do not commit certificates or Apple credentials to the repository.

The Publish job downloads package bundles into `packaged-artifacts/` (not the tracked `artifacts/` screenshot folder) before `merge_artifacts.js` validates filenames and updater metadata.

## Release process

1. Update `apps/desktop/package.json` to the intended version and merge that change into `main`.
2. Wait for the `CI` workflow to pass.
3. Create and push the exact matching tag, such as `v1.0.0-rc.1` or `v1.0.0`.
4. Approve the `production-release` environment deployment.
5. Confirm the release workflow passes its audit, tests, three native packages, asset validation, and (when secrets are set) signing/notarization before it publishes.

If a tag workflow needs to be rerun manually, select the existing tag in the `tag` input. The workflow never creates or moves tags.