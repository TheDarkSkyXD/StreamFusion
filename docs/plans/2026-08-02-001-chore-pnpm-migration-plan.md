# StreamFusion pnpm Migration Plan

**Status:** Draft — awaiting user approval  
**Created:** 2026-08-02  
**Scope:** Replace npm dependency management with pnpm, preserve `npm start`, reproduce every current dependency before upgrading packages, and harden dependency installation.

## Non-negotiable boundaries

- Commit the legitimate existing work to local `main` before starting the migration.
- Do not push `main` without separate approval.
- pnpm becomes the only dependency installer and `pnpm-lock.yaml` becomes the only dependency lockfile.
- Preserve `npm start` as the user-facing StreamFusion launcher.
- Reproduce and account for every dependency from every current `package.json` before broad upgrades or removals.
- Do not touch reference-folder content or commit logs, runtime dumps, secrets, build output, or temporary files.
- Leave the completed migration uncommitted until the user reviews the final diff and verification results.

## Stage 0 — Create a clean baseline on `main`

1. Confirm the current branch and safely place the intended work on local `main`.
2. Inventory every modified and untracked file.
3. Exclude secrets, environment files, `node_modules`, build/release output, logs, runtime dumps, and temporary or generated files.
4. Preserve legitimate tracked Valo index files.
5. Run the current lint, typecheck, tests, and production build.
6. Record existing failures as the pre-migration baseline so they are not blamed on pnpm.
7. Run the required deslop review.
8. Show the staged files, exclusions, results, and proposed commit message.
9. Commit all legitimate existing work to local `main`.
10. Confirm the worktree is clean.
11. Do not push without separate approval.

## Stage 1 — Pin pnpm

1. Add `"packageManager": "pnpm@11.17.0"` to the root `package.json`. Version 11.18.0 remains inside the seven-day quarantine window at execution time.
2. Activate the pinned version through Corepack.
3. Confirm Node 24 can run the pinned pnpm version.
4. Add a small repository-owned package-manager guard that:
   - Allows `pnpm install`.
   - Rejects ordinary `npm install`, Yarn, and Bun installs.
   - Continues allowing `npm start`.

## Stage 2 — Create the pnpm workspace

Add a root `pnpm-workspace.yaml` containing:

```yaml
packages:
  - apps/*
```

This workspace must include:

- The root `package.json`.
- `apps/desktop/package.json`.
- `apps/worker/package.json`.

The root package is included automatically. Keep the existing npm `workspaces` field temporarily if it is needed for compatibility, then review it after the migration is proven.

Move the desktop manifest's pnpm overrides into the root `pnpm-workspace.yaml`, because pnpm only applies overrides configured at the workspace root.

## Stage 3 — Preserve every existing dependency

This is a mandatory acceptance gate before upgrades or removals.

1. Inventory every direct dependency, development dependency, and optional dependency from all three package manifests.
2. Record the versions currently resolved by `package-lock.json`.
3. Import the existing npm lockfile into `pnpm-lock.yaml`.
4. Reproduce the current dependency graph as closely as pnpm permits.
5. Verify every direct dependency appears in the pnpm workspace.
6. Compare the npm and pnpm inventories, including direct, development, optional, and transitive dependencies.
7. Report every missing, changed, duplicated, or unresolved package.
8. Do not begin broad upgrades until the preserved dependency set installs, lints, builds, and passes focused baseline tests.
9. Do not silently remove packages.
10. The only planned initial removal is `@lavamoat/allow-scripts`, and only after pnpm's native build policy replaces it.
11. Any other removal requires evidence that the package is unused and must be included in the approval report.

The current npm lockfile contains transitive releases newer than seven days. Preserve every declared dependency first, then re-resolve those transitive versions under the age policy and report every resulting version difference rather than weakening the policy.

## Stage 4 — Configure pnpm security

Configure these policies in `pnpm-workspace.yaml`:

```yaml
minimumReleaseAge: 10080
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
blockExoticSubdeps: true
strictDepBuilds: true
verifyDepsBeforeRun: error
```

These settings must enforce:

- A seven-day release delay.
- Failure when no eligible version exists.
- Failure when registry publication time cannot be verified.
- Blocking of transitive Git and remote-tarball dependencies.
- Default denial of unreviewed dependency build scripts.
- Failure instead of silently installing dependencies when a run or exec command finds stale modules.

If an existing dependency lacks registry-time metadata, stop and report it rather than disabling the policy globally.

## Stage 5 — Block direct Git and URL dependencies

Because `blockExoticSubdeps` still permits direct exotic sources, add a repository-owned dependency-source validator.

Check every active `package.json` and reject direct dependency specifications using:

- `git:`
- `git+ssh:`
- `git+https:`
- `github:`
- `gitlab:`
- `bitbucket:`
- Arbitrary HTTP URLs
- Direct remote tarballs

Permit registry versions, local pnpm workspace dependencies, and explicitly reviewed local file dependencies when required.

Add a `lint:dependencies` script and run it locally, in CI, and before release packaging.

## Stage 6 — Replace LavaMoat with pnpm build approvals

1. Remove `@lavamoat/allow-scripts` only after pnpm's replacement is configured.
2. Use pnpm's `allowBuilds` map with default-deny behavior.
3. Begin with dependency scripts blocked, perform a clean install, and review every requested lifecycle script.
4. Expected packages requiring review include:
   - `electron`
   - `better-sqlite3`
   - `esbuild`
   - `ffmpeg-static`
   - `workerd`
   - `electron-winstaller`
   - Platform-specific `fsevents`
   - Required Electron and Wrangler helpers
5. Give every package an explicit approved or denied entry.
6. Never enable `dangerouslyAllowAllBuilds`.

## Stage 7 — Replace npm-specific configuration

After equivalent pnpm policies pass:

1. Remove npm-only `min-release-age` and `allow-git` settings.
2. Remove the desktop and worker `.npmrc` files if nothing useful remains.
3. Retain only useful root npm fallback protection, such as `package-lock=false`.
4. Preserve legitimate registry or authentication configuration if present.
5. Confirm `npm start` emits no unknown-configuration warnings.

## Stage 8 — Switch lockfiles

1. Generate the reviewed `pnpm-lock.yaml`.
2. Complete the dependency-preservation comparison.
3. Remove `package-lock.json` only after the pnpm lockfile is proven.
4. Ensure no workspace-specific npm lockfiles exist.
5. Add a repository check rejecting `package-lock.json`, `yarn.lock`, and Bun lockfiles.
6. Confirm `pnpm install --frozen-lockfile` succeeds from the repository root.
7. Maintain only `pnpm-lock.yaml` afterward.

## Stage 9 — Add pnpm lockfile linting

Do not install `lockfile-lint`; its current release does not support `pnpm-lock.yaml`.

1. Add `eslint-plugin-lockfile` as a root development dependency.
2. Configure it for `pnpm-lock.yaml`.
3. Add a `lint:lockfile` script.
4. Validate the lockfile format, supported version, integrity information, dependency origins, and internal consistency.
5. Combine lockfile linting with the direct-dependency source validator.
6. Run both checks before build and test jobs in CI.

## Stage 10 — Preserve `npm start`

Keep this user-facing launch command:

```text
npm start
```

Change the root script to invoke pnpm internally:

```json
"start": "pnpm --filter streamfusion start"
```

Refactor the desktop start picker so it launches `scripts/start-dev.js` directly after the user selects a mode. It must not nest another npm or pnpm invocation.

Use pnpm for all dependency management and ordinary project commands:

| Purpose | Command |
|---|---|
| Install | `pnpm install` |
| Add dependency | `pnpm add` |
| Remove dependency | `pnpm remove` |
| Start StreamFusion | `npm start` |
| Build | `pnpm build` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Lockfile validation | `pnpm lint:lockfile` |
| Dependency-source validation | `pnpm lint:dependencies` |

Convert nested `npm run` calls in active package scripts to pnpm.

## Stage 11 — Upgrade electron-builder for pnpm

1. First reproduce the current non-packaged build.
2. Upgrade electron-builder from 26.7.0 to the newest eligible stable 26.x release.
3. Require at least 26.9.1 because it contains pnpm virtual-store resolution fixes.
4. Test pnpm's standard isolated dependency layout first.
5. Use hoisted mode only if an observed packaging incompatibility requires it.
6. Verify production dependency collection and native module packaging.

## Stage 12 — Convert GitHub Actions

Update `.github/workflows/build.yml`, `.github/workflows/pre-release.yml`, and `.github/workflows/release.yml`.

1. Install the pinned pnpm version with the official setup action.
2. Change `actions/setup-node` caching from npm to pnpm.
3. Replace `npm ci` with `pnpm install --frozen-lockfile`.
4. Run lockfile linting and dependency-source validation before builds.
5. Convert test, lint, build, and packaging commands to pnpm.
6. Replace temporary `npm install js-yaml` calls with a declared, locked dependency.
7. Update Dependabot or Renovate configuration if present.
8. Preserve existing release artifact names and behavior.

## Stage 13 — Upgrade all existing packages

Only begin upgrades after pnpm reproduces the current dependency baseline successfully.

1. Audit every direct package in all three manifests.
2. Select the newest stable version that is at least seven days old, compatible with StreamFusion, and does not require an unreviewed security exception.
3. Classify updates into patches, minors, majors, native Electron dependencies, build tooling, and deprecated or unused packages.
4. Review especially:
   - Electron
   - electron-builder
   - electron-vite and Vite
   - React
   - TanStack Query and Router
   - TypeScript
   - Vitest
   - Storybook
   - ESLint and Prettier
   - Tailwind CSS
   - Wrangler and Workerd
   - `better-sqlite3`
   - `ffmpeg-static`
   - Twitch and Kick packages
   - Chat and authentication dependencies
5. Do not run one uncontrolled upgrade-everything command.
6. Upgrade compatible groups separately and review official migration notes for every major release.
7. Test after each major group.
8. Rebuild native modules against the selected Electron version.
9. Remove packages only after proving they are unused.
10. Record packages that must remain behind and explain why.
11. Do not apply unsafe forced audit upgrades.
12. Produce a before-and-after dependency report.

## Stage 14 — Update active documentation

Update active documentation to explain:

- Use `pnpm install`, `pnpm add`, and `pnpm remove` for dependency management.
- Continue using `npm start` to launch StreamFusion.
- Do not use `npm install`.
- `pnpm-lock.yaml` is the only accepted lockfile.
- Dependency lifecycle scripts require explicit approval.

Do not rewrite reference-folder content, historical plans, completed historical specifications, or old audit records merely to replace command names.

## Stage 15 — Verification gates

### Dependency preservation

- Account for every original direct dependency.
- Document every intentional removal.
- Explain every npm-versus-pnpm inventory difference.
- Confirm that no package silently disappeared.

### Installation and security

- Clean pnpm installation passes.
- Frozen-lockfile installation passes.
- Seven-day release filtering is enforced.
- Direct Git and URL dependencies are rejected.
- Transitive exotic dependencies are blocked.
- Unreviewed lifecycle scripts fail.
- Lockfile linting passes.
- No competing lockfile returns.
- `pnpm audit` results are reviewed without unsafe forced upgrades.

### Native dependencies

- Electron installs correctly.
- `better-sqlite3` builds for Electron's ABI and performs a basic operation inside Electron.
- `ffmpeg-static` resolves correctly.
- Wrangler and Workerd execute correctly.
- Native packages work in the packaged application.

### Code quality

Run the available desktop and worker checks:

- Lint
- Formatting
- Typecheck
- Focused IPC and preload tests
- Full test suite
- Production build
- Worker checks
- Windows packaging

Distinguish existing baseline failures from migration regressions.

### Runtime proof

Use Electron MCP only:

1. Launch through `npm start`.
2. Confirm the StreamFusion window opens.
3. Confirm preload initialization and IPC registration.
4. Confirm SQLite initialization.
5. Check main, preload, and renderer errors.
6. Launch the packaged Windows application.
7. Repeat native SQLite and IPC checks in the packaged build.

## Stage 16 — Final review and approval

1. Remove transient build and test output.
2. Confirm no logs or reference-folder files were added.
3. Run deslop on the final diff.
4. Present:
   - The complete diff.
   - The dependency-preservation comparison.
   - The dependency-upgrade report.
   - Removed npm files and new pnpm files.
   - Approved and denied build scripts.
   - Security-validation results.
   - Test, build, packaging, and runtime results.
   - Remaining baseline failures.
5. Leave the migration changes uncommitted.
6. Commit or push only after the user's final approval.

## Completion criteria

The migration is complete only when:

- The legitimate pre-migration work is committed to local `main`.
- Every original dependency is accounted for.
- pnpm is the sole installer and `pnpm-lock.yaml` is the sole lockfile.
- `npm start` still launches StreamFusion.
- Dependency-source, release-age, build-script, and lockfile policies pass.
- Native Electron dependencies work in development and in the packaged Windows application.
- All migration-caused lint, typecheck, test, build, packaging, and runtime regressions are resolved.
- The user has reviewed and approved the final migration diff.
