---
name: verify-streamfusion
description: "Drive the StreamFusion Electron desktop app through its real renderer and preload bridge. Use when proving navigation, discovery, playback, MultiStream, downloads, history, settings, or other user-visible desktop behavior."
---

# Verify StreamFusion

Use this skill to launch a disposable StreamFusion development instance, drive its Electron window over Chrome DevTools Protocol, and retain proof after cleanup. The desktop app is the primary user surface. The Kick OAuth Worker and Storybook are secondary surfaces and do not replace a desktop proof.

Read [`features/README.md`](features/README.md) before choosing a recipe. Run every command from the repository root.

## Launch

The controller runs `npm start` from `apps/desktop`. Its non-interactive start picker uses option 1, Electron, and forwards the selected CDP port to the development launcher. It supplies the disposable profile through both Electron's `--user-data-dir` switch and StreamFusion's development-only profile override so Chromium and the app use the same isolated directory. This also runs the repository's `start:checked` typecheck and lint gates before Electron starts. StreamFusion's development artifact root is redirected so logs and Platform health telemetry stay inside the disposable run.

PowerShell:

```powershell
$verifyId = "run-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
$launch = node .agents/skills/verify-streamfusion/scripts/control.mjs launch --id $verifyId | ConvertFrom-Json
$verifyRun = $launch.runFile
$verifyEvidence = $launch.evidenceDir
```

The launch is ready only when the command returns `ready: true`, `title: "StreamFusion"`, `launcher.mode: "dev:electron"`, and a renderer URL. The controller waits for the checked start command, main build, preload build, renderer server, Electron process, and CDP page target. Launch output, including the `npm start` and `start:checked` command headers, is retained at `$verifyEvidence/launch.log`.

## Preview proof

Normal verification uses `launch` without `--mode`. It remains the default because it proves the development path.

Use preview only when you need proof of the compiled Electron artifact. The root picker starts a managed foreground session. Choose `4) E2E Preview` after running `npm start`. The session runs `electron-vite preview`, waits for the Electron process to end, and removes the disposable run directory. Evidence remains in `.scratch/verify-streamfusion/evidence/<run-id>/`.

For automation, run `launch --mode preview` and use the returned run file with the existing controller commands. Use `session --mode preview` when you want automatic cleanup. Arguments after `--` go to Electron. The controller rejects `--user-data-dir` and `--remote-debugging-port` because it owns the isolated profile and CDP port.

Use `smoke --mode preview --fresh` for the automated compiled-app gate. It starts signed out, checks the live window, preload bridge, and SQLite database, then cleans up and exits with a pass or fail status.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs launch --mode preview --id preview-proof
node .agents/skills/verify-streamfusion/scripts/control.mjs session --mode preview -- --disable-gpu
```

Do not attach to a developer's existing port 9222 or 9236 instance. Do not use `electron .`, `electron-vite preview`, or a packaged build for normal feature proof.

The controller creates a WAL-consistent SQLite snapshot of `.streamfusion-dev-user-data/streamfusion.db` and copies only preferences, the last active tab, and window bounds from `streamfusion-storage.json`. Credentials, cached account identities, encryption keys, and browser cookies are never copied: rotating a copied refresh token can invalidate the source account's session. Pass `--database <path>` or `--storage <path>` to select another seed source; the same credential exclusion applies. A missing artifact starts fresh. Authenticated verification requires a dedicated test account signed into the disposable instance.

## Doctor

Run doctor before driving the app and whenever a selector, route, or screenshot looks wrong.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $verifyRun
```

Require `healthy: true`. On Windows, launch records the npm process identity and pins the CDP listener identity only after live ancestry proves that the listener belongs to npm. Doctor requires the same listener PID, creation time, executable, CDP port, profile, and renderer URL. This remains valid if disposable npm or cmd ancestors exit, but rejects a reused PID or a different listener. Doctor also checks the StreamFusion window title, the preload `electronAPI`, rendered body content, package version, launch revision, uncaught error patterns, and account-token decryption failures in the launch log. Seeded runs report no copied authenticated platforms. Authentication is not required for the baseline recipes. A feature that writes account state, follows, chat messages, moderation actions, downloads, or recordings must add its own authenticated precondition.

Inspect the isolated database after doctor succeeds:

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs database --run $verifyRun --output database.json
```

Require `healthy: true`, `quickCheck: ["ok"]`, and no missing required tables. The report records the live source snapshot path, schema version, and row counts for the database-backed features. This proves the launched app opened and migrated an internally consistent isolated database. It does not prove a specific user record is present unless its row count or UI state establishes that fact.

## Drive

Use the controller's role and accessible-name commands. Names come from the current StreamFusion source, including `Search StreamFusion...`, `MultiView`, `Add Stream`, `Focus Layout`, and the Settings links.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "MultiView"
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "MultiStream"
node .agents/skills/verify-streamfusion/scripts/control.mjs element --run $verifyRun --role button --name "Focus Layout"
node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role button --name "Add Stream"
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Add Stream to Layout"
node .agents/skills/verify-streamfusion/scripts/control.mjs hover --run $verifyRun --selector "video" --index 0
```

Other supported commands are `fill`, `press`, `hover`, `snapshot`, `screenshot`, `evaluate`, and `logs`. Run the helper with `help` for exact arguments. Prefer `click`, `fill`, `press`, and `hover`. Use `evaluate` only for a read-only assertion or when the feature map names a direct route as the user entry point. Do not mutate stores or invoke internal setters as proof.

Network-backed features may show a success, empty, offline, or provider-error state. Record which state appeared. An error state proves graceful failure only. It does not prove successful provider data or playback.

## Evidence

Evidence lives at `.scratch/verify-streamfusion/evidence/<run-id>/` and survives cleanup. Capture both the action setup and the resulting state.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output multistream-before.json
node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output multistream-before.png
node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role button --name "Add Stream"
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Add Stream to Layout"
node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output multistream-dialog.json
node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output multistream-dialog.png
node .agents/skills/verify-streamfusion/scripts/control.mjs logs --run $verifyRun --lines 120
```

The controller also appends user actions to `actions.ndjson` and retains `launch.log`. A valid UI proof has a before snapshot or screenshot, the recorded user action, an after snapshot and screenshot, and a log check. Exercise the real renderer and preload bridge. Verify durable side effects from a second user-visible view or filesystem read. Use mocks only where StreamFusion already has a production boundary. If a dry-run or test mode is involved, inspect the filesystem, network result, or stored state that it claims not to change.

## Cleanup

Clean up after every pass and failed attempt.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs cleanup --run $verifyRun
```

Cleanup terminates the recorded launcher process tree only while its process identity still matches. If the launcher has exited on Windows, cleanup terminates the pinned listener tree only after its identity, CDP port, and profile match. It never kills by process name or a reused PID. Cleanup waits for the CDP port to close before removing that run's disposable profile and run file. It refuses run directories outside `.scratch/verify-streamfusion/runs/`. The command must report `evidenceExists: true` after deleting scratch state.

## Isolation

Each launch gets its own CDP port, Electron `userData` directory, and scratch project root. The launch snapshots the live development database and copies only preferences, window bounds, and the last active tab from account storage. It never copies OAuth credentials, account identities, encryption state, or browser cookies, including when `--storage` is supplied. Twitch device-code refresh tokens are single-use; refreshing a copied credential can invalidate the original account. Authenticate a dedicated test account inside the isolated run when a recipe needs authentication. StreamFusion's development compiler still writes shared build output under `apps/desktop/out`, so the controller refuses a second verification run and the common developer CDP ports 9222 and 9236. Close other dev instances before launching. Never reuse a run ID. Account-backed and provider mutation recipes should still use a dedicated test account because OAuth credentials and website cookies can authorize writes to remote Platform state.

## Helpers

`scripts/control.mjs` is the command helper. Invoke it with Node 22 or later:

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs help
```

It has no package dependency. It launches `npm start` option 1, speaks CDP through Node's built-in WebSocket client, writes proof artifacts, checks process ownership, and removes only the run it created.
