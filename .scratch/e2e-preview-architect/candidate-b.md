# E2E Preview candidate B

## Problem

StreamFusion needs one opt-in path that runs the artifact produced by `electron-vite preview` while retaining the verification controller's disposable profile, CDP ownership checks, evidence, and PID-based cleanup. The normal controller launch must stay development mode because it is the default proof path. The root `npm start` picker already forwards CLI arguments through a tested Node launcher, while Electron Vite forwards tokens after `--` to Electron through `ELECTRON_CLI_ARGS`.

## Usage (caller's view)

An engineer who wants normal proof keeps using the current controller command. No mode flag means development mode.

```powershell
$launch = node .agents/skills/verify-streamfusion/scripts/control.mjs launch | ConvertFrom-Json
node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $launch.runFile
node .agents/skills/verify-streamfusion/scripts/control.mjs cleanup --run $launch.runFile
```

An engineer who wants the compiled artifact runs one root command and chooses the new picker entry.

```powershell
npm start
# Choose 4) E2E Preview (compiled Electron build)
# Copy the emitted runFile into $verifyRun.
node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $verifyRun
node .agents/skills/verify-streamfusion/scripts/control.mjs cleanup --run $verifyRun
```

The direct form is useful for a terminal or script. Arguments after the root command reach Electron, not the controller.

```powershell
npm run e2e:preview -- --enable-logging
```

The controller emits the same run record in both modes. Callers use `doctor`, the CDP actions, evidence commands, and `cleanup` unchanged.

## Shape

The core data shape is `E2eLaunchPlan`. It is an immutable plan for one isolated controller run. A single `mode` discriminant owns the only behavior that differs between normal proof and preview proof. The organizing structure is a two-row launch-mode registry, not mode checks scattered through argument parsing, spawning, state recording, and tests.

```ts
export type E2eLaunchMode = "dev" | "preview";

export type E2eLaunchRequest = Readonly<{
  mode: E2eLaunchMode;
  port: number;
  profileDir: string;
  electronArgs: readonly string[];
}>;

export type E2eLaunchPlan = Readonly<{
  mode: E2eLaunchMode;
  npmArguments: readonly string[];
  launcher: Readonly<{
    command: "npm start" | "npm run preview";
    selection?: 1;
    mode: "dev:electron" | "preview";
  }>;
}>;

export function createE2eLaunchPlan(
  request: E2eLaunchRequest,
): E2eLaunchPlan;
// not implemented
```

`createE2eLaunchPlan` returns these exact command shapes.

```ts
// dev
["start", "--", "--remote-debugging-port=<port>", "--user-data-dir=<profile>", ...electronArgs]

// preview
["run", "preview", "--", "--remote-debugging-port=<port>", "--user-data-dir=<profile>", ...electronArgs]
```

The preview row deliberately omits `--skipBuild`. Electron Vite therefore builds and then starts the compiled `out` artifact. The separator keeps every controller-generated switch and caller-supplied argument on Electron's side of Electron Vite's command line. Electron Vite version 5 turns that tail into `ELECTRON_CLI_ARGS`, so the remote debugging and disposable `--user-data-dir` switches reach the previewed Electron process.

The controller CLI becomes `launch [--mode dev|preview] [--id ID] [--port PORT] [--database PATH] [--storage PATH] [-- <electron args...>]`. `dev` remains the default. Parse the tail once at the CLI boundary and pass a typed `electronArgs` array to plan creation. Reject any unsupported mode before a run directory is created.

The controller keeps profile seeding, `STREAMFUSION_DEV_ARTIFACT_ROOT`, the active-run lock, known-port checks, launch log, doctor, evidence, and cleanup exactly where they are. It records the selected plan's `launcher` value in `run.json`. On a build or readiness failure, it continues to stop the recorded npm process tree and removes only that run's scratch directory. `cleanup` remains retry-safe because it can recover state from evidence after the first removal.

This is a deep interface. Callers choose one mode and receive the familiar run record. The controller hides Electron Vite syntax, Windows npm resolution, generated CDP switches, profile seeding, readiness polling, and cleanup ownership. Callers do not receive process handles, an Electron Vite option bag, or a second automation API. This follows boundary discipline, model the domain, and make operations idempotent.

## Module map

`.agents/skills/verify-streamfusion/scripts/control-launch-plan.mjs` owns the pure mode registry and `createE2eLaunchPlan`. It imports no filesystem, process, or Electron code.

`.agents/skills/verify-streamfusion/scripts/control.mjs` owns CLI parsing, run directory creation, profile seeding, process spawning, readiness, evidence, and cleanup. It calls the plan creator once and persists its launcher metadata.

`scripts/start-picker-lib.mjs` gains the frozen `e2e-preview` target. It remains the sole owner of root picker text, numeric and named target selection, argument forwarding, and Windows npm spawning.

`package.json` adds `e2e:preview`, which invokes the existing controller as `launch --mode preview --`. The trailing separator is intentional. It makes arguments forwarded by the root picker Electron arguments rather than controller options.

`scripts/start-picker.test.mjs` covers the fourth target and keeps option 1 and non-interactive startup on `desktop`.

`scripts/package-policy.test.mjs` pins the `e2e:preview` script, including its trailing separator.

`.agents/skills/verify-streamfusion/scripts/control-launch-plan.test.mjs` uses Node's built-in test runner to assert both command plans, caller argument placement, default dev metadata, and preview's lack of `--skipBuild`. It launches no Electron process.

`apps/desktop/tests/e2e/README.md` documents the picker path, direct command, shared controller workflow, and required cleanup. It states that development mode remains the default proof path.

## Test plan

Run the focused Node tests without Electron.

```powershell
node --test scripts/start-picker.test.mjs .agents/skills/verify-streamfusion/scripts/control-launch-plan.test.mjs
```

The picker test proves the Windows-safe npm launcher receives the root target and forwarded arguments through the existing `npm_execpath` path. The package-policy test prevents removal of the script separator. The plan test proves preview launches `npm run preview --` with the CDP and profile switches after the separator. The existing controller commands remain the live proof boundary. One manual preview run should confirm `doctor` reports `launcher.mode: "preview"`, then `cleanup` reports `evidenceExists: true` and removes only the run profile.

## Synthesis decision

Pending arena synthesis. Candidate B favors one controller mode plus a pure launch-plan module. It rejects a new preview controller command because that would duplicate lifecycle and cleanup policy.

## Tradeoffs accepted

- We accept rebuilding `apps/desktop/out` for each preview run in exchange for proving the compiled artifact instead of a stale build.
- We accept an explicit cleanup command after an interactive run in exchange for a usable live Electron session and the controller's existing evidence retention.
- We accept one small pure module in exchange for testing command construction without Electron or a second E2E framework.
- We accept automatic run IDs from the picker in exchange for keeping its forwarded arguments unambiguously reserved for Electron.

## Alternatives considered

- A separate `preview-control.mjs` lost. It would expose a second lifecycle, state file, and cleanup path to callers while hiding almost no new complexity.
- A picker target that directly invokes Electron Vite lost. It would expose isolation, CDP, evidence, and cleanup coordination to the caller, which is exactly the policy the controller already hides.
- A controller option bag that mirrors Electron Vite lost. It makes callers learn build-stage details and creates a shallow interface. The two fixed modes hide those details.

## Open questions and risks

- Does the project want a future explicit controller-options path from the root picker, such as a chosen seed database? This design intentionally reserves picker-forwarded arguments for Electron.
- The preview build writes the shared `apps/desktop/out` directory. The controller's one-active-run lock protects verification sessions, but it cannot protect a simultaneous manual build outside the controller.
- Preview runs an unpackaged Electron executable. The main process accepts the controller's CDP switch because `app.isPackaged` remains false. A future packaged-artifact proof needs a separate security decision because the current runtime policy intentionally disables CDP for packaged apps.

## Next implementation step

Add the pure `control-launch-plan.mjs` module and its Node test, then replace the controller's inline npm argument construction with that plan.

## Throughput checkpoint

- Blocking first steps. Define and test the pure launch plan before wiring picker or controller behavior.
- Independent workstreams. The pure plan test and root picker test can proceed separately after the plan shape is fixed. Controller wiring and documentation follow the shared shape.
- Shared mutable state. `apps/desktop/out` is shared build output, so preview launch wiring stays serial with the controller's existing one-active-run rule.
- Smallest safe decomposition. One implementation owner should make the wiring changes because the controller state record and root picker command must agree on the same mode name.

## Principles applied

Foundational Thinking changed the order. The immutable launch plan comes before spawn code. Model the Domain changed the organizing structure. The mode registry replaces repeated preview checks. Boundary Discipline keeps raw CLI tokens at the controller boundary and leaves plan creation pure. Make Operations Idempotent preserves the existing state-recovery cleanup path. Laziness Protocol and Minimize Reader Load rejected a second controller and a broad Electron Vite option API. Experience First keeps normal development proof as the default and makes compiled proof one picker choice. Prove It Works requires a real preview run after the pure command tests. Sequence Work into Verifiable Units puts plan tests before controller wiring.
