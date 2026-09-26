# Disposable Start local-file probe

This is a failed compatibility experiment, not a migration implementation. It builds a minimal Start renderer and packages it with Electron 43.4.1. It does not load StreamFusion main, preload, SQLite, FFmpeg, or player services.

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
