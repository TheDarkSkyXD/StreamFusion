# Releasing StreamFusion

Production releases are created only by `.github/workflows/release.yml`. The workflow accepts a pushed `v*` tag or an existing tag selected through **Run workflow**. It rejects any tag that is not exactly `v` plus the version in `apps/desktop/package.json`.

The current application version is `1.0.0-beta.1`, so its matching release tag is `v1.0.0-beta.1`. Supported prerelease suffixes are `alpha.N`, `beta.N`, and `rc.N`. A stable release uses only `X.Y.Z`.

## GitHub setup

Create a protected GitHub environment named `production-release`. Require a reviewer before jobs can use it, then add these environment secrets:

- `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`
- `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`

The release build fails if signing credentials are absent. Windows packages must be signed; macOS packages must be signed and notarized. Ordinary CI builds do not force signing.

## Release process

1. Update `apps/desktop/package.json` to the intended version and merge that change into `main`.
2. Wait for the `CI` workflow to pass.
3. Create and push the exact matching tag, such as `v1.0.0-rc.1` or `v1.0.0`.
4. Approve the `production-release` environment deployment.
5. Confirm the release workflow passes its audit, tests, three native packages, asset validation, signing, and notarization before it publishes.

If a tag workflow needs to be rerun manually, select the existing tag in the `tag` input. The workflow never creates or moves tags.
