# Disposable Start local-file probe

These are disposable compatibility experiments, not a migration implementation. The original probe records the failing baseline. The follow-up adds a client-only route boundary and tests an output adapter against the existing compiled Electron backend, preserving local-file loading and CSP.

## Passing integration probe

From the repository root on Windows, with workspace dependencies installed and the existing app built (`npm run build`):

```powershell
node docs/research/prototypes/tanstack-start-local-file/run-integration.mjs
```

This command installs the pinned Start dependencies into a unique scratch directory, overlays `fixed/` on `source/`, builds the renderer, and assembles the external-bootstrap variant. It copies the current compiled desktop main process, preload, player document and native dependencies into a disposable package. It bundles the slot preload into one file inside that copy, then launches twice with an isolated profile and external networking disabled. The summary includes the compiled main's hash so evidence can be tied to the input build.

Exit 0 means the recorded startup, navigation, IPC, native dependency, sandboxed player bridge and storage checks passed. The runner retains evidence in its scratch directory and removes its own profile after completed observations. It leaves production source, workspace manifests, app output and real user data untouched. Root tooling must provide Node's `node:sqlite`, esbuild, electron-builder and Electron 43.4.1.

See the [adapter report](../../2026-09-26-tanstack-start-local-file-adapter.md), [summary](evidence-fixed/summary.json), and [restart screenshot](evidence-fixed/restart.png). `evidence-fixed/initial.*` and `restart.*` come from the complete one-command reproduction. Other named files preserve intermediate diagnostic runs. The output transformations are specific to the pinned Start output; production integration and full feature acceptance remain separate work.

## Original failing probe

The minimal baseline packages Electron without StreamFusion main, preload, SQLite, FFmpeg, or player services.

From the repository root on Windows, with the existing workspace dependencies installed:

```powershell
node docs/research/prototypes/tanstack-start-local-file/run.mjs
```

The runner copies these sources into a unique `.scratch/` directory, installs the pinned prototype dependencies there, builds Start, packages an unpacked Windows executable, and launches it hidden with a disposable profile. It preserves evidence and removes the profile after a completed run. It does not modify workspace manifests, the root lockfile, app output, or a real user profile. An exit code of 1 is expected for the recorded failing candidate.

The four variants isolate successive conditions:

- `emitted` loads the Start output unchanged.
- `relative-diagnostic` changes `/./assets/` references to `./assets/` only.
- `csp-diagnostic` adds the current production CSP to that diagnostic copy.
- `external-scripts-diagnostic` moves inline bootstrap bodies into local script files while preserving the CSP.

The source config also sets an explicit router base of `/`. Without that setting, deriving the router base from `./` left child routes absent in the initial experiment.

The transformations are deliberately simple probes. They are not a production HTML parser or a supported Start integration. The root hydration flag alone is insufficient: the runner also captures console errors and failed requests. The transformed candidate renders Home but still reports React error 418. See the [recorded report](../../2026-09-26-tanstack-start-local-file-prototype.md) for interpretation and untested gates.

`evidence/` contains the recorded build output, packaged runtime observations and screenshots. `source/package-lock.json` pins the dependencies used for reproduction. Start generates `routeTree.gen.ts` during the build; it is not hand-maintained here.
