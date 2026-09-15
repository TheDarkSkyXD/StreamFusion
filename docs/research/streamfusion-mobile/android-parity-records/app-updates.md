# Android parity record: `app-updates`

- Capability ID: `app-updates`
- Desktop baseline: `docs/research/streamfusion-mobile/desktop-parity-inventory.md` Updates section
- Observed `main` at branch start: `5ebd06b`
- Android owner: Mobile Settings Updates panel plus GitHub latest-stable release check
- Progress: `implemented` for searchable Check now and automatic-foreground preference; `deferred` for APK download and PackageInstaller
- Delivery: `adapted`
- Adaptation: Check now fetches `GET /repos/TheDarkSkyXD/StreamFusion/releases/latest` with `User-Agent: StreamFusion-Mobile`. Drafts and prereleases are ignored. Copy states that APK download and PackageInstaller wait for the native updater (R02/#176). Automatic 24h scheduling is R02. Appearance stays dark-only.
- Freshness: `current` at `verification/evidence/issue-170-settings.json` on APK `sha256:b13cd849694b15e45d369601d69092c7737695040191af66a977237c81c55c92`

## Desktop outcome

Check, download, and install desktop application updates.

## Android outcome

More Settings hosts a searchable Updates panel. Check now inspects the latest stable GitHub release and persists the result in `support-settings.v1`. This build does not download an APK or hand a package to PackageInstaller.

## Required evidence

- `change-gate`
- `api30-journey`
- `local-search`

## Evidence residuals

TalkBack was not enabled. Native updater download, signature checks, and PackageInstaller remain R02.

## Blocking for public release

OAuth stays on #145 and #146. Native updater stays on #176. Human release gate stays on #175.
