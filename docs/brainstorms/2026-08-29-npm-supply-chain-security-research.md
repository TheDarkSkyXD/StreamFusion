---
date: 2026-08-29
topic: npm-supply-chain-security
status: implemented
scope: StreamFusion dependency installation, CI, and npm publishing
---

# Enforceable npm supply-chain security

## Bottom line

StreamFusion now uses npm 11.19.0 for the root plus worker and for the standalone desktop dependency root. npm 11.19.0 is the newest release that was at least seven days old on 2026-08-29. The newer npm 11.19.1 release was still inside the quarantine window.

npm 12.0.2 was the latest stable release during this review, but it requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`. StreamFusion still supports Node 22.14.0, so npm 11.19.0 preserves that runtime contract while providing the required release-age and lifecycle approval controls. [npm registry metadata](https://registry.npmjs.org/npm/latest), [npm 12.0.2 release](https://github.com/npm/cli/releases/tag/v12.0.2)

## The seven-day npm setting is not a complete CI gate

Use `min-release-age=7` when npm resolves or updates dependencies. The value is days, not seconds or minutes. npm 11.10.0 added the setting. npm 11.17.0 added `min-release-age-exclude`, which accepts package names and name globs. It does not accept a version-scoped exception. [npm 11.10.0 release](https://github.com/npm/cli/releases/tag/v11.10.0), [npm 11.17.0 release](https://github.com/npm/cli/releases/tag/v11.17.0), [npm 12 configuration](https://docs.npmjs.com/cli/v12/using-npm/config/#min-release-age)

Do not assume that `npm ci` enforces the setting. `npm ci` installs the versions recorded in `package-lock.json`, and the command does not resolve versions or check release dates. npm's current command reference omits both age options. An open npm documentation change describes this behavior and the resulting attack path through a committed lockfile. [npm ci reference](https://docs.npmjs.com/cli/v12/commands/npm-ci/), [npm CLI documentation change](https://github.com/npm/cli/pull/9844)

An enforceable npm design needs both controls:

1. Set `min-release-age=7` so maintainer installs and automated updates do not select an immature release.
2. Run a separate CI validator after a script-disabled `npm ci` and before any dependency lifecycle script or build step. Validate every registry package and version in `package-lock.json` against registry publish times. Fail on a release younger than seven days or a missing time. Keep emergency exceptions version-scoped, documented, and short-lived.

npm has no built-in command for the second control as of 12.0.2. `min-release-age-exclude` is too broad for an emergency patch because it exempts every version of a matching package. Also expect `npm audit fix` to fail when the only patched version is younger than the configured age. npm reports that conflict instead of bypassing the policy. [npm release-age configuration](https://docs.npmjs.com/cli/v12/using-npm/config/#min-release-age-exclude)

## npm support matrix

| Control | Enforceable form | Minimum npm version | Limit |
| --- | --- | --- | --- |
| Seven-day resolution delay | `.npmrc` with `min-release-age=7` | 11.10.0 | Does not validate a committed lockfile during `npm ci` |
| Release-age exclusions | Repeated `min-release-age-exclude[]=` entries | 11.17.0 | Matches package names or globs, not exact versions |
| Frozen dependency tree | Commit `package-lock.json` and run `npm ci` | Current baseline 12.0.2 | Checks manifest and lockfile agreement, not release age |
| Lockfile artifact integrity | Require `integrity` on registry entries and use lockfile version 3 | npm 9 or later writes version 3 by default | Integrity proves bytes match the lockfile, not that the code is safe |
| Dependency lifecycle approval | `allowScripts` in `package.json` with `strict-allow-scripts=true` | 11.16.0 introduced the policy | npm 11 warns by default. npm 12 blocks unreviewed dependency scripts by default |
| Default-deny dependency scripts | Review version-pinned approvals with `npm install-scripts` | 12.0.0 | `ignore-scripts` overrides the approval policy, and root project scripts are a separate trust decision |
| Non-registry source restrictions | `allow-git`, `allow-remote`, `allow-file`, and `allow-directory` | 11.15.0 | npm 12 defaults git and remote to `none`, but file and directory default to `all` |
| Registry signatures and provenance verification | `npm audit signatures` after installation | 9.5.0 for provenance verification | Fails on missing or invalid signatures or attestations. It does not review source code |
| Full attestation bundles in JSON | `npm audit signatures --json --include-attestations` | 11.12.0 | Evidence output only |
| Trusted publishing through OIDC | GitHub-hosted runner with `id-token: write` | npm 11.5.1 and Node 22.14.0 | Supports publish operations, not private dependency installation |
| Strict `.npmrc` parsing | `strict-npmrc=true` | 12.0.0 | Unknown project settings otherwise warn and may be ignored |

On npm 11.19.0, `allowScripts` is available, but an unreviewed dependency script still runs after a warning unless `strict-allow-scripts=true`. Treat that flag as mandatory. `ignore-scripts=true` remains the stronger all-off switch. npm 12 changes the default to blocking unreviewed dependency scripts and fixes an npm 11 bug where an explicit denial could also remove a package's executable link. Prefer npm 12 if npm owns the workspace. [npm 11.16.0 release](https://github.com/npm/cli/releases/tag/v11.16.0), [npm 11 warning behavior](https://github.com/npm/cli/issues/9750), [npm 12 changelog](https://github.com/npm/cli/blob/latest/CHANGELOG.md#1200-2026-07-08), [npm 11 denial bug and npm 12 fix](https://github.com/npm/cli/issues/9681)

## Recommended npm project policy

StreamFusion commits this policy in each dependency root's `.npmrc`:

```ini
package-lock=true
lockfile-version=3
min-release-age=7
strict-allow-scripts=true
allow-git=none
allow-remote=none
allow-file=root
allow-directory=root
audit=true
```

`package-lock.json` records an exact dependency tree and Standard Subresource Integrity hashes. `npm ci` fails if the manifest and lockfile disagree, removes an existing `node_modules`, and does not rewrite the lockfile. These properties make reviewable lockfile changes the admission point. [package-lock reference](https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json/), [npm ci behavior](https://docs.npmjs.com/cli/v12/commands/npm-ci/)

Record reviewed dependency scripts in `package.json` under `allowScripts`. Keep the default version pins produced by `npm install-scripts approve`. With `strict-allow-scripts=true`, an unreviewed dependency script fails the install instead of becoming a warning. Use `npm ci --ignore-scripts` in jobs that need no native builds. For jobs that need approved native builds, install without scripts, verify signatures, and then run `npm rebuild --ignore-scripts=false` under the committed approval policy. [npm script policy](https://docs.npmjs.com/cli/v12/using-npm/config/#allow-scripts), [npm install-script commands](https://docs.npmjs.com/cli/v12/commands/npm-install-scripts/)

Avoid `dangerously-allow-all-scripts`. It disables the approval boundary. Do not use a name-only approval when a version-pinned approval works. A newly published version can change its install script. [npm script configuration](https://docs.npmjs.com/cli/v12/using-npm/config/#dangerously-allow-all-scripts)

## CI checks

Use this order in an npm-owned job:

1. Install and verify the exact approved npm version.
2. Run `npm ci --ignore-scripts`.
3. Run the custom seven-day lockfile validator before any dependency lifecycle script or build step.
4. Run `npm audit signatures`.
5. If required, run `npm rebuild --ignore-scripts=false` under `allowScripts` and `strict-allow-scripts=true`.
6. Run `npm audit --audit-level=high` against the full dependency tree.
7. Run the project's explicit build and test scripts.

Do not rely on the audit report attached to `npm install` or `npm ci` as the gate. The `audit=true` setting submits reports during those commands. An explicit `npm audit` supplies the documented nonzero exit behavior and severity threshold. `audit-level` changes only the failure threshold, not the report. Do not run `npm audit fix` in CI because it performs an install and can rewrite the lockfile. Put remediations through a reviewed update pull request. [npm audit reference](https://docs.npmjs.com/cli/v12/commands/npm-audit/)

Audit the full tree for this application. Development dependencies execute in CI and can affect the packaged Electron application. A production-only audit misses compromised or vulnerable build tools. A second `npm audit --omit=dev --audit-level=high` can report runtime exposure, but it must not replace the full-tree check.

`npm audit signatures` verifies registry signatures and any provenance attestations for installed packages. It returns an error for missing or invalid evidence. Run the latest approved npm CLI because npm says attestation verification can change independently of the Node-bundled npm version. Provenance links an artifact to source and a build identity. It does not establish that the source is benign. [npm signature audit](https://docs.npmjs.com/cli/v12/commands/npm-audit/#audit-signatures), [npm provenance verification](https://docs.npmjs.com/viewing-package-provenance/)

## CI authentication and publishing

Public dependency installation needs no npm token. If a workspace later uses private dependencies, commit only a registry-scoped environment placeholder such as `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`. Give the install job a read-only granular token with the shortest useful lifetime. Never commit the token or expose a publish token to a pull request job. [npm private-package CI guidance](https://docs.npmjs.com/using-private-packages-in-a-ci-cd-workflow/)

Keep npm publishing in a separate protected job. Configure an npm trusted publisher for the exact GitHub workflow and optional GitHub environment. Grant only `contents: read` and `id-token: write`. Do not set `NODE_AUTH_TOKEN` for the publish step. Trusted publishing requires npm 11.5.1 or later and Node 22.14.0 or later, uses short-lived OIDC credentials, and creates provenance automatically for supported public packages from public repositories. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

Keep non-published packages marked `"private": true`; npm refuses to publish them. For a package meant for npm, set `publishConfig.registry`, `publishConfig.access`, and `publishConfig.provenance`, use a `files` allowlist, and inspect `npm pack --dry-run` before publishing. After trusted publishing works, set the npm package to require 2FA and disallow traditional tokens. npm documents that trusted publishers continue to work under that setting. [npm package metadata](https://docs.npmjs.com/files/package.json/#private), [npm 2FA publishing policy](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)

StreamFusion currently publishes signed desktop artifacts through GitHub Releases, not npm packages. Its root `"private": true` is the correct npm publishing safeguard.

## Dependency update automation

Keep dependency changes in pull requests. Configure Dependabot for every independent package directory and for the `github-actions` ecosystem. Set `cooldown.default-days: 7` for npm version updates. Dependabot's default cooldown is three days, and a configured cooldown does not delay security updates. The CI lockfile-age validator remains authoritative, including for a security pull request. [Dependabot cooldown](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/optimizing-pr-creation-version-updates), [Dependabot GitHub Actions updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions)

When a new patch must bypass the seven-day delay, use one exact-version exception in the custom validator. Link the advisory, require review, and remove the exception after seven days. Do not use npm's name-wide `min-release-age-exclude` for a one-version emergency.

Pin every GitHub Action to a full commit SHA and let Dependabot update the SHA with the release comment on the same line. GitHub states that a full commit SHA is the only immutable action reference and offers a repository policy that enforces it. [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions)

Add the dependency review action to pull requests and make the check required. Set `fail-on-severity: high` for both runtime and development scopes. This blocks a pull request that introduces a known high-severity dependency before it reaches the default branch. [GitHub dependency review](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/customize-dependency-review-action)

## StreamFusion implementation

- Pin npm 11.19.0 in both package manifests and CI.
- Keep separate root and desktop npm lockfiles. The desktop boundary isolates Electron's native dependency and packaging flow.
- Run the seven-day validator against both committed lockfiles because `npm ci` does not check release age.
- Install with scripts disabled, verify registry signatures, then rebuild under version-pinned `allowScripts` entries and `strict-allow-scripts=true`.
- Cover both npm roots and GitHub Actions with a seven-day Dependabot cooldown.
- Pin workflow actions to full commit SHAs and audit the full dependency tree.
- Keep npm publication disabled. StreamFusion publishes signed desktop artifacts through GitHub Releases.

No single control proves that a package is safe. The enforceable setup combines delayed admission, a frozen integrity-bearing lockfile, strict script approval, signature checks, advisory checks, low-privilege CI, and reviewed update pull requests.
