# E2E Preview through the isolated verification controller

## Usage (caller's view)

The main user path stays one command:

```text
npm start

How would you like to start StreamFusion?
  1) Electron
  2) Browser
  3) Mobile (Expo Go)
  4) E2E Preview

Choose a start mode [1]: 4
```

Selection 4 builds the desktop app with `electron-vite preview`, starts that compiled output in the controller's disposable profile, and keeps the terminal attached as the session owner. Closing the Electron window returns the preview process's exit code and removes the disposable run directory. Pressing Ctrl+C also stops the recorded process tree and removes the run directory. Evidence and `launch.log` remain under `.scratch/verify-streamfusion/evidence/<run-id>/`.

Arguments supplied to the root command reach Electron unchanged:

```powershell
npm start -- --disable-gpu
```

The controller still owns `--remote-debugging-port` and `--user-data-dir`. It rejects either switch in forwarded arguments because allowing a caller to replace them would void the isolation guarantee.

Automation keeps its current default:

```powershell
# Existing development proof. This remains dev:electron.
node .agents/skills/verify-streamfusion/scripts/control.mjs launch --id dev-proof

# Explicit compiled-artifact proof with manual follow-up commands.
node .agents/skills/verify-streamfusion/scripts/control.mjs launch --mode preview --id preview-proof
```

A developer can also run the managed preview entry directly:

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs session --mode preview -- --disable-gpu
```

The existing `doctor`, `database`, drive, evidence, and `cleanup` commands use the returned `run.json` for both modes. They do not need a second E2E API.

## Problem

StreamFusion has the two halves of this feature, but no safe path between them. The root `npm start` picker is the user entry point. The verification controller owns disposable profiles, CDP ports, evidence, process-tree cleanup, and active-run exclusion. `apps/desktop/package.json` already exposes `electron-vite preview`, which builds and starts the compiled main, preload, and renderer output. Today the controller always reaches `dev:electron` through the desktop package's non-interactive picker. Starting `preview` directly would bypass the controller's isolation and cleanup. Changing the controller default would also weaken normal feature proof, where the live development build must remain the default.

## Grounded runtime flow

The current development path is:

```text
controller launch
  -> apps/desktop npm start
  -> start:checked
  -> non-interactive desktop picker option 1
  -> scripts/start-dev.js
  -> electron-vite dev
```

The new preview path is shorter because there is no reason to enter the desktop development picker:

```text
root npm start, option 4
  -> root e2e:preview script
  -> controller session --mode preview
  -> apps/desktop npm run preview -- <controller args> <forwarded args>
  -> electron-vite preview builds out/
  -> Electron loads out/main, out/preload, and out/renderer
```

The preview process remains unpackaged, so StreamFusion accepts an explicit CDP port. Its production-mode renderer loads `out/renderer/index.html`. The explicit Electron `--user-data-dir` still wins over the production-mode default. `STREAMFUSION_DEV_ARTIFACT_ROOT` continues to redirect logs, bug reports, and telemetry because that routing checks `app.isPackaged`, not `NODE_ENV`.

## Shape

The core data shape is `VerificationLaunchPlan`. Its organizing structure is a closed `VERIFICATION_LAUNCHERS` registry keyed by `VerificationLaunchMode`. The registry owns every difference between development and preview. The rest of the controller consumes one plan and does not branch on the mode.

```js
/** @typedef {"dev:electron" | "preview"} VerificationLaunchMode */

/**
 * @typedef {
 *   | { mode: "dev:electron", command: "npm start", selection: 1 }
 *   | { mode: "preview", command: "npm run preview" }
 * } VerificationLauncherIdentity
 */

/**
 * @typedef {object} VerificationLaunchPlan
 * @property {VerificationLauncherIdentity} launcher
 * @property {string} command
 * @property {readonly string[]} args
 * @property {NodeJS.ProcessEnv} env
 * @property {number} readinessTimeoutMs
 */

const VERIFICATION_LAUNCHERS = Object.freeze({
  "dev:electron": Object.freeze({
    npmPrefix: ["start"],
    launcher: { mode: "dev:electron", command: "npm start", selection: 1 },
    readinessTimeoutMs: 120_000,
  }),
  preview: Object.freeze({
    npmPrefix: ["run", "preview"],
    launcher: { mode: "preview", command: "npm run preview" },
    readinessTimeoutMs: 300_000,
  }),
});
```

`VerificationLauncherIdentity` is a discriminated union because a desktop-picker selection exists only for the development path. An optional `selection` field would allow meaningless preview states. The persisted `run.json` keeps the current development identity exactly and adds one valid preview identity. Doctor can report either without inferring the launch from a command string. This applies `principle-model-the-domain` and `principle-foundational-thinking`.

The public helper stays small:

```js
export function createVerificationLaunchPlan(
  request,
  host = {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
  },
) {
  throw new Error("not implemented");
}

export async function runManagedVerificationSession(
  request,
  dependencies,
) {
  throw new Error("not implemented");
}
```

`request` contains the validated mode, generated CDP port, profile path, artifact path, and opaque Electron arguments. `createVerificationLaunchPlan` performs four policies behind one call:

- It defaults a missing mode to `dev:electron`.
- It rejects caller-supplied CDP and profile switches.
- It selects the correct npm command and argument vector.
- It removes `ELECTRON_RUN_AS_NODE` from the child environment.

On Windows, the plan starts npm as `process.execPath <npm-cli.js> ...`. It first uses `npm_execpath`, which exists when the controller came from the root picker. It falls back to the npm CLI beside Node for direct controller use. It never starts `npm.cmd` as the detached controller child, which avoids the existing Windows `spawn EINVAL` class. On other platforms, it preserves the current `npm` executable path. Boundary parsing and host adaptation stay in this helper. The lifecycle code receives trusted values, per `principle-boundary-discipline`.

`runManagedVerificationSession` starts one run through the same internal launch function used by `launch`. It then waits for either the launcher child to exit or the controller to receive SIGINT or SIGTERM. A `finally` block calls the existing cleanup operation exactly once. Cleanup remains recoverable through `evidence/<id>/cleanup-state.json`, so a second explicit cleanup converges on the same result. This choice follows `principle-make-operations-idempotent`.

The root picker remains a table. Add one `START_TARGETS` row with `answer: "4"`, `name: "e2e-preview"`, and `script: "e2e:preview"`. Do not add a special branch to `chooseStartTarget` or `launchRootScript`. Empty, invalid, and non-interactive input still selects the first Electron development row. The root script is:

```json
"e2e:preview": "node .agents/skills/verify-streamfusion/scripts/control.mjs session --mode preview --"
```

The fixed trailing `--` separates controller options from arguments appended by `npm run`. The controller's parser treats every later token as an Electron argument, including values that begin with `--`. The controller then passes them after npm's own separator to `electron-vite preview`. This handles both npm parsing layers without a shell-built command string.

The interface is deep enough to earn the new helper. Callers choose one mode. The helper hides npm layout, Windows executable selection, reserved argument validation, environment cleanup, preview timeout, and launch metadata. The controller shell still owns filesystem and process effects. No wrapper forwards an identical signature to another wrapper, and the runtime flow crosses at most the root picker, controller, and Electron Vite process. This applies `principle-laziness-protocol` and `principle-minimize-reader-load`.

## Module map

- `package.json` adds `e2e:preview` and includes the controller's unit test in the normal deterministic test command.
- `scripts/start-picker-lib.mjs` adds the fourth table row. No new picker branch is needed.
- `scripts/start-picker.test.mjs` guards option 4, unchanged defaults, and Windows-safe argument forwarding.
- `.agents/skills/verify-streamfusion/scripts/verification-launch.mjs` owns `VerificationLaunchPlan`, `VERIFICATION_LAUNCHERS`, npm command resolution, reserved Electron switches, and managed-session cleanup.
- `.agents/skills/verify-streamfusion/scripts/control.mjs` parses `--mode` and the `--` separator, consumes a launch plan, and adds the `session` command. Existing CDP, evidence, doctor, and cleanup behavior stays here.
- `.agents/skills/verify-streamfusion/scripts/verification-launch.test.mjs` uses fake child processes and injected lifecycle functions. It never launches Electron.
- `.agents/skills/verify-streamfusion/SKILL.md` documents development proof as the default and compiled preview as an opt-in artifact check.
- `apps/desktop/tests/e2e/README.md` documents the root picker path, managed cleanup, and the boundary between development proof and preview proof.
- `README.md` adds E2E Preview to the root start choices and links to the E2E guide.

No desktop source layer changes. No renderer, preload, IPC, or Platform code is involved. No ESLint boundary change is warranted because this adds one helper beside the existing controller rather than creating or reorganizing application architecture folders.

## Focused tests

The tests stay deterministic and finish without a host binary:

1. The root picker exposes four rows, resolves `4` and `e2e-preview`, and keeps Electron development as the default for empty, invalid, and non-interactive input.
2. The root launcher passes `--disable-gpu` unchanged to `e2e:preview` and uses Node plus `npm_execpath` on Windows.
3. A missing controller mode produces the existing `npm start -- <generated isolation args>` plan and existing launcher metadata.
4. Preview produces `npm run preview -- <generated isolation args> <forwarded args>`, uses the longer readiness timeout, and stores `launcher.mode: "preview"`.
5. Preview rejects forwarded `--user-data-dir`, `--user-data-dir=...`, `--remote-debugging-port`, and `--remote-debugging-port=...` forms.
6. Windows preview uses `node.exe` plus `npm-cli.js`. It never sends a `.cmd` file to detached `spawn`.
7. Managed session cleanup runs once after a zero exit, a nonzero exit, a signal, and a wait failure. The test uses `EventEmitter` children and injected cleanup spies.
8. A launch failure before a run state exists retains the launch log and does not attempt an unsafe path removal.

After implementation, one real proof should run `npm start`, select 4, check `doctor`, close the window, and confirm that the run directory is gone while evidence remains. That is the only host-level acceptance check. Unit tests prove the policy, while the preview session proves the compiled artifact per `principle-prove-it-works`.

## Synthesis decision

Candidate A selects a mode registry plus a managed controller session. This shape preserves the controller's default and puts preview differences in one data structure. It also gives the root picker a table-only change. The key graft worth accepting from another candidate would be a smaller way to test the same cleanup guarantee. A design that makes the picker own profiles, ports, or process termination should be rejected because it splits the controller's existing invariant across two owners.

## Tradeoffs accepted

- We accept one small controller helper module in exchange for unit testing launch and cleanup policy without importing the 915-line command script or starting Electron.
- We accept a longer preview startup than development startup in exchange for building the exact artifact under test on every preview run.
- We accept the controller's existing single-run rule in exchange for avoiding races in the shared `apps/desktop/out` directory.
- We accept retaining evidence after automatic cleanup in exchange for preserving the proof needed to diagnose a failed preview.
- We accept rejecting two Electron switches in exchange for making profile and CDP isolation non-optional.

## Alternatives considered

### Start `electron-vite preview` directly from the picker

This has the smallest diff, but the caller must choose a profile, find a CDP port, record evidence, and kill the process tree. The interface exposes every safety rule and hides almost nothing. It loses.

### Change controller `launch` to preview by default

This keeps one controller command, but every normal UI proof pays for a production build and no longer exercises the development path. It breaks the documented verification contract and the rubric's default. It loses.

### Add preview to the desktop package picker

The controller currently relies on the desktop picker's non-interactive default to reach development. A fourth desktop mode would either need another selection transport or another nested argument convention. The root picker is already the user entry point, so a second UI for the same choice adds reader load and command routing without hiding work. It loses.

### Add Playwright, Spectron, or another E2E runner

A second framework would duplicate launch, CDP, selectors, evidence, and cleanup while leaving the existing playbooks behind. The controller already owns these capabilities. It loses.

## Red-flag screen

- Shallow module. Pass. Two helper functions hide mode policy, Windows npm behavior, isolation validation, signal handling, and cleanup.
- Information leakage. Pass. Only `VerificationLaunchPlan` knows how a mode maps to npm arguments and persisted launcher identity.
- Temporal decomposition. Pass. The helper owns verification launch policy rather than separate build, start, wait, and stop modules.
- Pass-through methods. Pass. The root picker selects a script. The controller completes the verification operation. No new method repeats another method's arguments unchanged.

## Open questions and risks

- Is five minutes the right preview readiness deadline on the slowest supported Windows machine, or should one measured clean build set the value?
- Should the user-facing preview seed authenticated development state by default, as the controller does today, or should the root entry choose a fresh profile to reduce the chance of remote Platform writes?
- Can an uninstrumented development process write `apps/desktop/out` during preview? The controller can exclude other controller runs and known CDP ports, but the existing shared-output limitation remains. The E2E guide must keep the instruction to close other desktop development instances.

## Next implementation step

Add `verification-launch.mjs` with the registry, the pure plan builder, and failing Node tests for the unchanged development plan and the new preview plan before wiring the root picker.

## Principles that changed the design

- `principle-experience-first` made `npm start` option 4 a managed foreground session, so the user never has to copy a run path to clean up.
- `principle-redesign-from-first-principles` made launch mode an input to one controller-owned plan instead of a preview-only side script.
- `principle-separate-before-serializing-shared-state` kept one active controller run and one disposable profile per run rather than adding locks around shared profile data.
- `principle-boundary-discipline` put CLI parsing, reserved-switch rejection, and Windows npm adaptation in the launch-plan boundary.
- `principle-make-operations-idempotent` required `finally` cleanup and preserved recovery state for repeated cleanup.
- `principle-laziness-protocol` kept the root picker table-driven and reused the existing controller, CDP commands, and playbooks.
