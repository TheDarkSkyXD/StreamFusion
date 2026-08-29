---
name: verify-streamfusion
description: "Drive the StreamFusion Electron desktop app through its real renderer and preload bridge. Use when proving navigation, discovery, playback, MultiStream, downloads, history, settings, or other user-visible desktop behavior."
---

# Verify StreamFusion

Use this skill to launch a disposable StreamFusion development instance, drive its Electron window over Chrome DevTools Protocol, and retain proof after cleanup. The desktop app is the primary user surface. The Kick OAuth Worker and Storybook are secondary surfaces and do not replace a desktop proof.

Read [`features/README.md`](features/README.md) before choosing a recipe. Run every command from the repository root.

## Launch

The controller invokes `apps/desktop/scripts/start-dev.js`, the launcher behind `pnpm dev:mcp`. It selects an unused CDP port, passes an isolated `--user-data-dir`, and sets StreamFusion's development artifact root so logs and Platform health telemetry stay inside the disposable run.

PowerShell:

```powershell
$verifyId = "run-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
$launch = node .agents/skills/verify-streamfusion/scripts/control.mjs launch --id $verifyId | ConvertFrom-Json
$verifyRun = $launch.runFile
$verifyEvidence = $launch.evidenceDir
```

The launch is ready only when the command returns `ready: true`, `title: "StreamFusion"`, and a renderer URL. The controller waits for the main build, preload build, renderer server, Electron process, and CDP page target. Launch output is retained at `$verifyEvidence/launch.log`.

Do not attach to a developer's existing port 9222 or 9236 instance. Do not use `electron .`, `electron-vite preview`, or a packaged build for normal feature proof.

The controller copies `streamfusion.db` from the normal development profile into the disposable profile before launch. This gives cold-start verification the user's current local follows, history, and other database-backed state without allowing the proof run to modify the live database. Pass `--database <path>` to seed from a different database. A machine with no live database starts with a fresh one.

## Doctor

Run doctor before driving the app and whenever a selector, route, or screenshot looks wrong.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $verifyRun
```

Require `healthy: true`. Doctor checks the recorded launcher PID, the process tree that owns the CDP port, the StreamFusion window title and URL, the preload `electronAPI`, rendered body content, package version, launch revision, and uncaught error patterns in the launch log. Authentication is not required for the baseline recipes. A feature that writes account state, follows, chat messages, moderation actions, downloads, or recordings must add its own authenticated precondition.

## Drive

Use the controller's role and accessible-name commands. Names come from the current StreamFusion source, including `Search StreamFusion...`, `MultiView`, `Add Stream`, `Focus Layout`, and the Settings links.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "MultiView"
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "MultiStream"
node .agents/skills/verify-streamfusion/scripts/control.mjs element --run $verifyRun --role button --name "Focus Layout"
node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role button --name "Add Stream"
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Add Stream to Layout"
```

Other supported commands are `fill`, `press`, `snapshot`, `screenshot`, `evaluate`, and `logs`. Run the helper with `help` for exact arguments. Prefer `click`, `fill`, and `press`. Use `evaluate` only for a read-only assertion or when the feature map names a direct route as the user entry point. Do not mutate stores or invoke internal setters as proof.

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

Cleanup terminates the recorded launcher process tree by PID, waits for its CDP port to close, and removes only that run's disposable profile and run file. It never kills by process name. It refuses run directories outside `.scratch/verify-streamfusion/runs/`. The command must report `evidenceExists: true` after deleting scratch state.

## Isolation

Each launch gets its own CDP port, Electron `userData` directory, and scratch project root. The launch reads the live development database once to seed an isolated copy, then all database writes stay inside the disposable profile. StreamFusion's development compiler still writes shared build output under `apps/desktop/out`, so the controller refuses a second verification run and the common developer CDP ports 9222 and 9236. Close other dev instances before launching. Never reuse a run ID. Account-backed and provider mutation recipes should still use a dedicated test account because OAuth and remote Platform state live outside the local profile.

## Helpers

`scripts/control.mjs` is the command helper. Invoke it with Node 22 or later:

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs help
```

It has no package dependency. It launches the repository's development script, speaks CDP through Node's built-in WebSocket client, writes proof artifacts, checks process ownership, and removes only the run it created.
