# Stable WebContents identity for renderer recovery

## Problem

`installRendererCrashRecovery()` reloads the existing `WebContents` after a recoverable host-renderer crash. Electron 43.4.1 can leave that object's `mainFrame.detached` flag set after the new renderer document is running. `MainRendererPortController.trustedSender()` treats the flag as proof that the renderer is unusable and returns `null`. Both IPC adapters then reject valid `ipc:feature-load` calls before their event-local sender, frame, and document checks run. The focused baseline confirms the fault. The current four-file test command reports 30 passing tests and only the detached-frame recovery test failing.

## Usage (caller's view)

Callers keep the current API. They bind one `BrowserWindow`, ask the port for the bound live `WebContents` identity, and leave request authorization to the IPC boundary.

```ts
const renderer = new MainRendererPortController();
const registry = new TrustedIpcRegistry(renderer);

renderer.bind(mainWindow);
registerLazyIpcFeatureLoader(renderer, registry);
```

The shared trusted IPC wrapper resolves that identity for every event. A reload needs no rebind and no recovery notification.

```ts
configureTrustedIpcMain(
  () => renderer.trustedSender(),
  trustedDocumentUrl
);
```

Contract-backed routes use the same late-bound lookup.

```ts
registerTrustedIpcHandler({
  channel: route.channel,
  contract: route.contract,
  getTrustedSender: () => renderer.trustedSender(),
  trustedDocumentUrl,
  handle: route.execute,
  failureResponse: route.failureResponse,
});
```

Main-process publishers also keep their existing call site. The port suppresses a missing, destroyed, or currently crashed target. `send()` catches Electron delivery failures.

```ts
renderer.send(IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, isMaximized);
```

## Shape

The existing bound window remains the only state. `window.webContents` is the stable identity across `reload()`. No recovery epoch, frame cache, or readiness flag is added, per `foundational-thinking` and `laziness-protocol`.

```ts
export interface MainRendererPort {
  current(): BrowserWindow | null;
  trustedSender(): WebContents | null;
  bind(window: BrowserWindow): void;
  detach(): void;
  send(channel: IpcChannel, ...args: unknown[]): boolean;
  sendToOwner(ownerId: number, channel: IpcChannel, ...args: unknown[]): boolean;
  useWindow(key: string, attach: WindowBinding): WindowCleanup;
  dispose(): void;
}

export class MainRendererPortController implements MainRendererPort {
  #window: BrowserWindow | null;

  trustedSender(): WebContents | null {
    // TODO: Return null for an absent or destroyed window, destroyed
    // WebContents, or WebContents that Electron still reports as crashed.
    // Otherwise return the exact bound window.webContents object. Do not
    // inspect mainFrame lifecycle flags here.
    throw new Error("not implemented");
  }
}
```

The return shape already encodes the useful state. `null` means that no live renderer process identity is available. `WebContents` means that the port has an exact object identity for the bound renderer. A detached or destroyed `mainFrame` does not change either fact, so it must not affect this result, per `type-system-discipline`.

| Bound state | `trustedSender()` result |
| --- | --- |
| No window or destroyed window | `null` |
| Destroyed `WebContents` | `null` |
| `WebContents.isCrashed()` is true | `null` |
| Live bound `WebContents` | The exact `window.webContents` object |
| Live bound `WebContents` with detached or destroyed `mainFrame` metadata | The exact `window.webContents` object |

The incoming request flow remains:

1. The IPC adapter resolves `trustedSender()` when the event arrives.
2. The adapter requires `event.sender === trustedSender`.
3. The adapter requires `event.senderFrame === event.sender.mainFrame`.
4. The adapter checks `isAllowedSender(event)`.
5. The adapter compares the current frame URL with the configured protocol, host, and pathname.
6. Only then does it parse the request and call the route.

This keeps framework lifecycle metadata inside the Electron adapter and validates the actual request at the request boundary, per `boundary-discipline`. The `trustedSender()` name stays unchanged to avoid a caller migration for a one-line policy correction. Its responsibility is narrower than the name suggests, but all existing callers already treat the return value as expected sender identity.

The public interface is deep enough for this change. One lookup hides window replacement, window destruction, `WebContents` destruction, and crash-state suppression. Callers do not coordinate recovery state. Adding another method would expose a distinction that no caller needs.

### Module map

| File | Design impact |
| --- | --- |
| `apps/desktop/src/backend/ipc/main-renderer-port.ts` | The only production edit. Remove the `mainFrame.isDestroyed()` and `mainFrame.detached` veto from `trustedSender()`. Keep all window, `WebContents`, and crash checks. |
| `apps/desktop/src/backend/ipc/trusted-ipc-main.ts` | No change. It continues to check exact `WebContents`, current main frame, allowed URL, and configured document. |
| `apps/desktop/src/backend/ipc/register-trusted-ipc-handler.ts` | No change. Contract-backed lazy feature loading retains the same independent checks. |
| `apps/desktop/src/backend/ipc/trusted-ipc-registry.ts` | No change. It continues to resolve the port identity for each event. |
| `apps/desktop/src/backend/recovery/renderer-crash-recovery.ts` | No change. Recovery still reloads the same `WebContents`. |
| `apps/desktop/tests/backend/ipc/main-renderer-port.test.ts` | The committed regression becomes green. Add a focused crashed-state assertion only if the implementation change accidentally touches that guard. |

### Security reasoning

This change does not authorize a frame. It only makes the stable expected `WebContents` available to the code that authorizes the event.

- Another `WebContents` still fails exact object equality. A numeric ID or a URL match cannot substitute for the bound object.
- A subframe or stale frame still fails `event.senderFrame === event.sender.mainFrame`.
- A remote document still fails `isAllowedSender()` and the configured document comparison.
- The recovery `data:` document still fails both URL checks.
- A destroyed window, destroyed `WebContents`, or renderer that still reports itself crashed still yields `null` before event validation.
- Main-to-renderer sends can reach the recovered document because they use the stable object. Electron send failures remain contained by the existing `try` and `catch` path.

`mainFrame.detached` is not a trustworthy authorization fact after recovery. The targeted Electron probe proves that it can be true while the same `WebContents` is no longer crashed and is dispatching IPC from the expected StreamFusion URL. Keeping the detached check would make an Electron bookkeeping flag override stronger event-local identity and document evidence.

## Synthesis decision

This individual candidate recommends the stable-identity shape as the synthesis base. It changes one policy decision in the module that already owns the `BrowserWindow` and `WebContents`. It preserves both IPC boundary implementations without adding recovery coordination. The parent synthesis can compare this result with the other candidate shapes.

## Tradeoffs accepted

- We accept that `trustedSender()` no longer proves frame sendability in exchange for using the only identity that survives Electron's reload path.
- We accept the existing method name in exchange for no public API migration. The IPC adapters remain the source of authorization.
- We accept attempted main-to-renderer sends during rare frame-transition windows in exchange for no second readiness state. Existing exception handling turns failed sends into `false`.

## Alternatives considered

- Add a recovery flag cleared by `did-finish-load`. This exposes lifecycle ordering to the recovery module, the port, and tests. It also creates a second source of truth beside Electron's `WebContents`. The extra coordination hides less than the existing late-bound lookup.
- Rebind or replace the port after `reload()`. Electron keeps the same `BrowserWindow` and `WebContents`, so rebinding cannot create a better identity. It would rerun unrelated window bindings and make recovery callers understand port internals.
- Let the IPC adapters bypass a `null` port result when the event URL looks safe. This splits the expected-sender policy across two adapters and risks admitting another same-origin `WebContents`. URL equality is weaker than exact object identity.
- Add separate `expectedSender()` and `sendTarget()` methods. This names the distinction precisely, but it enlarges the interface and all call sites for no observed need. The current send methods already own delivery failure handling.
- Store only `webContents.id`. IDs add conversion logic and may be reused after destruction. The event already carries the exact object reference, which gives a stronger and smaller equality check.

## Open questions and risks

- Does a future Electron release ever deliver the first valid recovered IPC event while `WebContents.isCrashed()` still returns true? If the real recovery proof observes that state, this candidate must be revised from runtime evidence.
- Does the recovered event still satisfy `event.senderFrame === event.sender.mainFrame` on every supported platform? The Windows reproduction implies that it does, but the real-path check must keep this equality intact and report any platform exception rather than weakening it.
- Can a main-to-renderer push succeed while the safe-mode `data:` document is active? Incoming IPC remains denied. If outbound data sensitivity becomes a concern, address it in `send()` with a document policy that is separate from expected-sender identity.

## Verification

First run the focused Node suites from the repository root:

```powershell
npm run --workspace streamfusion test:node -- tests/backend/ipc/main-renderer-port.test.ts tests/backend/ipc/trusted-ipc-main.test.ts tests/backend/ipc/register-trusted-ipc-handler.test.ts tests/backend/ipc/sender-origin.test.ts tests/backend/recovery/renderer-crash-recovery.test.ts
npm run --workspace streamfusion typecheck
npm run --workspace streamfusion lint
```

The first command must report all 37 current tests passing. The detached-frame regression must return the exact bound `WebContents`. Existing tests must still reject another renderer and an unrelated document. The sender-origin suite must still reject remote, `data:`, and `blob:` URLs. Type checking and linting must exit with code 0.

Then prove the real Electron path with a disposable run. Launch at Home before opening a stream so the run has one host renderer process.

```powershell
$verifyId = "renderer-recovery-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
$launch = node .agents/skills/verify-streamfusion/scripts/control.mjs launch --id $verifyId | ConvertFrom-Json
$verifyRun = $launch.runFile
$verifyEvidence = $launch.evidenceDir
node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $verifyRun
node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output before-crash.json
node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output before-crash.png
```

Resolve the renderer only from the disposable launch process tree. Stop if the tree contains zero or more than one renderer.

```powershell
$runState = Get-Content -Raw $verifyRun | ConvertFrom-Json
$processes = @(Get-CimInstance Win32_Process)
$runPids = [System.Collections.Generic.HashSet[int]]::new()
[void]$runPids.Add([int]$runState.pid)
do {
  $added = 0
  foreach ($process in $processes) {
    if ($runPids.Contains([int]$process.ParentProcessId) -and $runPids.Add([int]$process.ProcessId)) {
      $added += 1
    }
  }
} while ($added -gt 0)
$rendererProcesses = @($processes | Where-Object {
  $runPids.Contains([int]$_.ProcessId) -and $_.CommandLine -match '--type=renderer'
})
if ($rendererProcesses.Count -ne 1) {
  throw "Expected one disposable host renderer, found $($rendererProcesses.Count)"
}
$rendererPid = [int]$rendererProcesses[0].ProcessId
Stop-Process -Id $rendererPid -Force
```

Exercise a renderer-to-main feature after reload and retain the result.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Home" --timeout 30000
node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $verifyRun
node .agents/skills/verify-streamfusion/scripts/control.mjs click --run $verifyRun --role link --name "Settings"
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --text "Settings" --timeout 30000
node .agents/skills/verify-streamfusion/scripts/control.mjs snapshot --run $verifyRun --output after-recovery.json
node .agents/skills/verify-streamfusion/scripts/control.mjs screenshot --run $verifyRun --output after-recovery.png
node .agents/skills/verify-streamfusion/scripts/control.mjs logs --run $verifyRun --lines 240
```

Require one `host-renderer-auto-reload` entry. Require no `ipc:feature-load` rejection, no `untrusted-sender` rejection for the recovered renderer, and no `Could not load app feature` error. The second doctor result must report `healthy: true`, and Settings must render through the recovered preload bridge. Clean up only through the run controller.

```powershell
node .agents/skills/verify-streamfusion/scripts/control.mjs cleanup --run $verifyRun
```

## Next implementation step

Delete only the `mainFrame` lifecycle guard from `MainRendererPortController.trustedSender()`, then run the focused unit command before the real Electron recovery proof.
