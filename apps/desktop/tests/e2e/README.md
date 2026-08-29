# Electron end-to-end verification

These playbooks exercise the real StreamFusion renderer and preload bridge. Unit tests
cover isolated components and services. They do not replace an Electron run.

## Use the isolated controller

The project verification skill owns normal live proof. Run these commands from the
repository root:

```powershell
$verifyId = "run-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
$launch = node .agents/skills/verify-streamfusion/scripts/control.mjs launch --id $verifyId | ConvertFrom-Json
$verifyRun = $launch.runFile

node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $verifyRun
node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output app-launch.json
```

The controller starts a disposable profile on an unused Chrome DevTools Protocol port.
It seeds SQLite from the development profile without writing to the live database. Read
`.agents/skills/verify-streamfusion/SKILL.md` for the drive, evidence, and cleanup rules.

Always clean the run when the pass ends:

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs cleanup --run $verifyRun
```

## Start a fixed-port session

Use a fixed port only when an external Chrome DevTools Protocol client requires it:

```powershell
npm --prefix apps/desktop run dev:mcp
```

This command exposes port 9222 and uses the normal development profile. Do not run it at
the same time as the isolated controller.

## Run a playbook

The files under `playbooks/` describe the route, action, and pass criteria for each user
flow. Prefer accessible roles and names. Capture screenshots under `.scratch/images/`.

Start with these playbooks:

- `00-app-launch.playbook.md` checks the shell and preload bridge.
- `00b-sidebar-navigation.playbook.md` checks the top-level routes.
- `01-home.playbook.md` checks the Home page result or graceful provider failure.
- `99-full-app-sweep.playbook.md` covers the complete legacy sweep.

The project verification skill has the current controller commands and feature map. Use
the playbooks as scenario references when their selectors still match the source.

## Test boundary

| Check | Owner |
| --- | --- |
| Components, pages, hooks, stores, and main-process services | `npm --prefix apps/desktop test` |
| Real Electron window, router, preload bridge, and SQLite startup | Project verification controller |
| Manual fixed-port debugging | `npm --prefix apps/desktop run dev:mcp` |

If a selector fails, run `doctor` before changing the playbook. A healthy process with a
stale selector is documentation drift. An unhealthy process needs a clean relaunch.
