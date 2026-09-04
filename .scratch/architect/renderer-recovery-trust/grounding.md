# Renderer recovery trust grounding

## Problem

After the host renderer crashes, `installRendererCrashRecovery` calls `webContents.reload()` and retains the same `WebContents`. Electron 43.4.1 then reports the retained `webContents.mainFrame` as `detached: true`, even though the recovered renderer loads the correct StreamFusion URL and sends IPC through that same `WebContents`.

`MainRendererPortController.trustedSender()` currently returns `null` when `webContents.mainFrame.detached` is true. Every recovered `ipc:feature-load` request then fails the shared trust gate as `untrusted-sender`, and the preload reports `Could not load app feature (<uuid>)`.

## Runtime evidence

- Original session log. An OOM at `03:00:13Z` caused `host-renderer-auto-reload`, followed by persistent `IPC:Boundary` rejections and the supplied UUID errors.
- Isolated reproduction. Killing only the disposable run's validated renderer PID reproduced the same recovery reload and feature-load failures.
- Targeted probe. After recovery, `webContents.isCrashed()` was false. `webContents.mainFrame.isDestroyed()` was false. `webContents.mainFrame.detached` was true. The frame URL was still `http://localhost:5174/#/stream/kick/iceposeidon?tab=home`.

## Current boundaries

- `MainRendererPortController` owns the bound `BrowserWindow` and stable `WebContents` identity.
- `trustedIpcMain.isTrustedEvent()` separately requires the exact bound `WebContents`, the event's current main frame, an allowed sender URL, and the exact configured document origin and path.
- Main-to-renderer sends already catch Electron send failures and return `false`.
- The focused test in commit `090016e8` expects a recovered renderer to remain trusted when Electron retains a detached prior frame. It currently fails because `trustedSender()` returns `null`.

## Constraints

- Preserve exact sender, current calling frame, and document checks at the IPC transport boundary.
- Do not weaken trust to another `WebContents`, subframe, remote document, or safe-mode `data:` document.
- Prefer the smallest fix. Do not add recovery state flags or lifecycle synchronization unless runtime evidence requires them.
- The fix belongs in the main-process IPC adapter. No renderer, preload, shared contract, or feature-loader API change should be necessary.

## Candidate rubric

1. Restores lazy IPC after same-`WebContents` renderer recovery.
2. Preserves current IPC sender, frame, and document security checks.
3. Preserves dead-window and crashed-renderer suppression where it remains valid.
4. Adds no cross-module lifecycle state or public API unless required.
5. Fits the failing regression test and can be proved through the real Electron crash-recovery path.
