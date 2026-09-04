# Candidate readiness

## Problem

After host renderer recovery, Electron 43.4.1 keeps the same `WebContents` but reports `webContents.mainFrame.detached === true`. `MainRendererPortController.trustedSender()` treats that stale frame flag as a hard trust failure, so every recovered `ipc:feature-load` call fails before `trustedIpcMain` can apply its stricter event checks. The design must restore lazy IPC after same-`WebContents` recovery without trusting another renderer, a subframe, a remote document, or the safe-mode `data:` document.

## Usage (caller's view)

Renderer and preload code do not change. The recovered preload still calls the same feature-aware IPC wrapper:

```ts
await ipcRenderer.invoke(IPC_CHANNELS.IPC_FEATURE_LOAD, IPC_FEATURES.STREAMS);
await ipcRenderer.invoke(IPC_CHANNELS.STREAMS_GET_TOP, request);
```

The main-process runtime still owns one renderer port and one registry:

```ts
const renderer = new MainRendererPortController();
const registry = new TrustedIpcRegistry(renderer);

registerLazyIpcFeatureLoader(renderer, registry);
renderer.bind(mainWindow);
```

`TrustedIpcRegistry` stops asking the port for a prevalidated sender. It asks a trust object to validate each event when Electron delivers the event:

```ts
const trust = new MainRendererIpcTrust(renderer, trustedDocumentUrl);

registerTrustedIpcHandler({
  channel: IPC_CHANNELS.IPC_FEATURE_LOAD,
  contract: featureLoaderIpcContract,
  trust,
  handle: async (event, feature) => {
    await loadIpcFeature(feature, { renderer, registry });
    return { kind: "ok", value: null };
  },
  failureResponse: registry.internalError(),
});
```

The legacy `trustedIpcMain` wrapper uses the same event-level trust check:

```ts
configureTrustedIpcMain(new MainRendererIpcTrust(renderer, trustedDocumentUrl));

trustedIpcMain.handle(IPC_CHANNELS.PLATFORM_HEALTH_GET, (event) => {
  const trusted = trust.trustEvent(event);
  if (trusted.kind !== "trusted") throwRejected(trusted.reason);
  return getPlatformHealthSnapshot();
});
```

Main-to-renderer push code stays at the current call sites:

```ts
renderer.send(IPC_CHANNELS.PLATFORM_HEALTH_CHANGED, event);
renderer.sendToOwner(ownerId, IPC_CHANNELS.TWITCH_EVENTSUB_EVENT, payload);
```

Those sends require a live bound `BrowserWindow` and a non-crashed `WebContents`. They do not depend on `mainFrame.detached`.

## Shape

The core model separates renderer identity from IPC event trust:

```ts
export type RendererTrustFailure =
  | "no-window"
  | "destroyed-window"
  | "destroyed-webcontents"
  | "crashed-webcontents"
  | "wrong-webcontents"
  | "non-main-frame"
  | "untrusted-origin"
  | "wrong-document";

export type RendererTrustDecision<Event> =
  | {
      readonly kind: "trusted";
      readonly event: Event;
      readonly sender: WebContents;
      readonly documentUrl: string;
    }
  | { readonly kind: "rejected"; readonly reason: RendererTrustFailure };

export interface RendererIdentity {
  liveSender(): WebContents | null;
}

export class MainRendererIpcTrust {
  constructor(identity: RendererIdentity, trustedDocumentUrl: string);

  trustEvent<Event extends IpcMainEvent | IpcMainInvokeEvent>(
    event: Event
  ): RendererTrustDecision<Event>;
}
```

`MainRendererPortController` owns live renderer identity:

```ts
export interface MainRendererPort extends RendererIdentity {
  current(): BrowserWindow | null;
  liveSender(): WebContents | null;
  bind(window: BrowserWindow): void;
  detach(): void;
  send(channel: IpcChannel, ...args: unknown[]): boolean;
  sendToOwner(ownerId: number, channel: IpcChannel, ...args: unknown[]): boolean;
  useWindow(key: string, attach: WindowBinding): WindowCleanup;
  dispose(): void;
}
```

`liveSender()` returns the current window's `webContents` only when:

- the window exists and is not destroyed;
- `webContents.isDestroyed()` is false;
- `webContents.isCrashed?.()` is false.

It does not read `webContents.mainFrame.detached`. The runtime evidence says that flag can describe a retained prior frame after recovery while the new preload sends valid IPC through the same `WebContents`.

`MainRendererIpcTrust.trustEvent()` validates the actual event:

```ts
const sender = identity.liveSender();
if (!sender) return rejected(liveFailure);
if (event.sender !== sender) return rejected("wrong-webcontents");
if (event.senderFrame !== event.sender.mainFrame) return rejected("non-main-frame");
if (!isAllowedSender(event)) return rejected("untrusted-origin");
if (!isExpectedRendererDocument(event.senderFrame?.url, trustedDocumentUrl)) {
  return rejected("wrong-document");
}
return { kind: "trusted", event, sender, documentUrl: event.senderFrame.url };
```

This shape makes a valid IPC event the readiness proof. No post-recovery ready channel is needed. A ready channel would be sent by the same preload through the same IPC boundary, so it carries no authority that the next `ipc:feature-load` event lacks. It also creates a race where the feature loader might be rejected until the ready message wins timing.

Frame generation handling is not warranted. A generation counter would need lifecycle state from `did-start-navigation`, `did-finish-load`, or `dom-ready`, but the bug is already caused by trusting a cached lifecycle fact more than the current IPC event. The event gives the current `WebContents`, the current main frame identity, and the current document URL in one place.

The interface is deeper than the current one because one method, `trustEvent()`, hides the document comparison, origin allowlist, main-frame check, and recovered-frame policy. Callers stop coordinating `getTrustedSender`, `trustedDocumentUrl`, `isAllowedSender`, and `isExpectedRendererDocument` by hand. That follows `boundary-discipline`, `type-system-discipline`, `model-the-domain`, and `minimize-reader-load`.

## Module map

- `apps/desktop/src/backend/ipc/main-renderer-port.ts` owns the live `BrowserWindow` and `WebContents` identity. Replace `trustedSender()` with `liveSender()` or keep `trustedSender()` as a short compatibility alias during the same edit.
- `apps/desktop/src/backend/ipc/main-renderer-ipc-trust.ts` owns `MainRendererIpcTrust`, `RendererTrustDecision`, `RendererTrustFailure`, and the expected-document comparison.
- `apps/desktop/src/backend/ipc/register-trusted-ipc-handler.ts` accepts `trust: MainRendererIpcTrust` and calls `trust.trustEvent(event)` before request parsing.
- `apps/desktop/src/backend/ipc/trusted-ipc-main.ts` uses the same trust object for legacy `handle` and `on` registrations.
- `apps/desktop/src/backend/ipc/trusted-ipc-registry.ts` constructs the trust object from the renderer port and `getMainRendererDocumentUrl()`.
- `apps/desktop/tests/helpers/main-renderer-port-mock.ts` mirrors `liveSender()` so handler tests keep using the project helper.
- No renderer, preload, shared IPC contract, or `installRendererCrashRecovery()` change is part of this candidate.

## Security reasoning

The trusted identity remains the main process's bound `BrowserWindow.webContents`, not a value supplied by the renderer. A recovered renderer is trusted only if Electron delivers an event whose `event.sender` is that exact `WebContents`.

Subframes stay rejected because `event.senderFrame` must equal `event.sender.mainFrame`. A Twitch iframe, Kick iframe, or injected frame cannot satisfy that check.

Remote and safe-mode documents stay rejected because `isAllowedSender(event)` rejects remote, `data:`, `blob:`, and custom-scheme URLs, and the expected-document check requires the configured renderer protocol, host, and path. The hash route may differ, but the loaded app document may not.

Destroyed windows, destroyed `WebContents`, and crashed `WebContents` stay suppressed in `liveSender()`. The stale `mainFrame.detached` flag is removed from trust because Electron can leave it true after successful recovery.

Payload-budget checks and schema checks stay where they are. This candidate changes who may reach those checks, not how requests are parsed or how handler errors are sanitized.

## Synthesis decision

This is the readiness candidate, not the synthesized arena result. If selected, use event-proven readiness as the base. Keep the event-trust extraction only if the implementation owner wants the cleaner boundary. If the goal is the smallest patch, graft only the main conclusion: do not let `mainFrame.detached` veto a same-`WebContents` recovered renderer.

## Tradeoffs accepted

- We accept a small new trust module in exchange for one source of truth for trusted renderer events.
- We accept no explicit post-recovery ready signal in exchange for removing a race and avoiding a renderer-controlled lifecycle flag.
- We accept no frame generation counter in exchange for trusting the event that Electron delivered at the IPC boundary.
- We accept that a truly stale detached frame may reach `webContents.send()` in exchange for preserving recovered sends. Electron send failures are already caught and returned as `false`.
- We accept a slightly broader implementation than a one-line fix in exchange for separating sender liveness from event trust.

## Alternatives considered

- Remove only the `mainFrame.detached` check from `trustedSender()`. This likely fixes the failing regression with the smallest diff. It loses to this candidate on interface depth because `trustedSender()` still mixes live sender selection, outbound send readiness, and inbound IPC trust.
- Add `renderer:ready-after-recovery` from preload. It hides little complexity and exposes timing to callers. The ready event must cross the same IPC trust boundary as `ipc:feature-load`, so it cannot prove more than the feature-load event proves.
- Track a frame generation number from navigation events. It hides reload bookkeeping but exposes lifecycle synchronization risk. The candidate rejects it because Electron's retained `mainFrame` state is the unreliable data in this bug.
- Wait for `did-finish-load` before trusting IPC again. It hides timing inside main, but it can reject valid preload or early renderer IPC after recovery. The current event already carries enough identity and document evidence.

## Open questions and risks

- Should `trustedSender()` be renamed to `liveSender()` in one edit, or should the old name stay as an alias until nearby tests and helpers migrate?
- Should detached-frame push suppression tests move from "detached means no send" to "send failures are caught" after the Electron recovery evidence?
- Should rejection logs record the new `RendererTrustFailure` reason, or should they preserve the current single `untrusted-sender` bucket for log stability?

## Exact verification

Run focused unit coverage from `apps/desktop`:

```powershell
npm exec -- vitest run tests/backend/ipc/main-renderer-port.test.ts tests/backend/ipc/register-trusted-ipc-handler.test.ts tests/backend/ipc/trusted-ipc-main.test.ts tests/backend/ipc/lazy-feature-loader.test.ts tests/preload/ipc-feature-loader.test.ts
```

The required positive regression is:

```powershell
npm exec -- vitest run tests/backend/ipc/main-renderer-port.test.ts -t "keeps a recovered renderer trusted when Electron retains a detached prior frame"
```

Add or update negative tests so these cases still reject before handler execution:

- a different `WebContents`;
- `event.senderFrame !== event.sender.mainFrame`;
- `https://attacker.example/`;
- a `data:text/html` safe-mode document;
- destroyed window;
- destroyed `WebContents`;
- crashed `WebContents`;
- oversized payload.

Run the real Electron recovery proof with the project controller:

```powershell
$verifyId = "renderer-recovery-trust-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
$launch = node .agents/skills/verify-streamfusion/scripts/control.mjs launch --id $verifyId | ConvertFrom-Json
$verifyRun = $launch.runFile
node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $verifyRun
node .agents/skills/verify-streamfusion/scripts/control.mjs evaluate --run $verifyRun --expression "location.hash = '#/stream/kick/iceposeidon?tab=home'"
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --hash "/stream/kick/iceposeidon" --timeout 15000
```

Then kill only the disposable run's renderer PID, wait for `host-renderer-auto-reload`, and verify:

```powershell
$runState = Get-Content -LiteralPath $verifyRun | ConvertFrom-Json
$allProcesses = Get-CimInstance Win32_Process
$descendantIds = @([int]$runState.pid)
do {
  $nextIds = @(
    $allProcesses |
      Where-Object { $descendantIds -contains [int]$_.ParentProcessId -and $descendantIds -notcontains [int]$_.ProcessId } |
      Select-Object -ExpandProperty ProcessId
  )
  $descendantIds += $nextIds
} while ($nextIds.Count -gt 0)
$rendererProcess = $allProcesses |
  Where-Object { $descendantIds -contains [int]$_.ProcessId -and $_.CommandLine -match "--type=renderer" } |
  Select-Object -First 1
Stop-Process -Id $rendererProcess.ProcessId -Force
node .agents/skills/verify-streamfusion/scripts/control.mjs wait --run $verifyRun --hash "/stream/kick/iceposeidon" --timeout 30000
node .agents/skills/verify-streamfusion/scripts/control.mjs doctor --run $verifyRun
node .agents/skills/verify-streamfusion/scripts/control.mjs logs --run $verifyRun --lines 200
node .agents/skills/verify-streamfusion/scripts/control.mjs cleanup --run $verifyRun
```

The log check must show `host-renderer-auto-reload` and must not show repeated `Rejected trusted-renderer IPC call` for `ipc:feature-load` after the reload. The UI check must show the same route hash after recovery.

## Next implementation step

Extract `MainRendererIpcTrust` and change `MainRendererPortController` so live renderer identity no longer depends on `webContents.mainFrame.detached`.
