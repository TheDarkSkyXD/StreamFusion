# Candidate A: one canonical runtime with projected subscriptions

## Problem

Issues 73 through 80 require a production Diagnostics workspace without making Diagnostics itself a bottleneck. Today the only production resource sampler writes a 30-second text line, Option 1 is synthetic, Logs and Report Bug expose absolute paths, and the floating debug tools own renderer timers and state. The design must preserve the strict Electron boundary, lazy IPC, 350 MB heaps, existing log locations and retention, TypeScript-only adapters, explicit platform support states, and the accepted performance budgets.

The latest product decision supersedes issue 80's floating-widget retirement language. The widget remains and is renamed **Developer Console**. Chat Simulation, UI State, the DevTools launcher, and other useful buttons remain. Only its duplicate Performance tab is removed, and it gains **Open Diagnostics**.

## Usage, caller's view

### Main lifecycle

```ts
const diagnostics = createDiagnosticsRuntime({
  mainWindow,
  logger,
  roots: diagnosticRoots,
  platform: createDiagnosticsPlatformAdapter(process.platform),
  managedRuntimes: createManagedRuntimeOwners({ mainWindow }),
});

await diagnostics.start();
registerIpcHandlers(mainWindow, { diagnostics });
app.on("before-quit", () => diagnostics.stop());
```

`start()` is idempotent, takes an immediate resource sample, and owns one 30-second baseline scheduler. Issue 74 removes the old `startProcessMonitor()` timer. Its grep-stable line is then formatted from the same canonical observation used by the UI.

### Renderer page

```tsx
export function DiagnosticsPage() {
  const diagnostics = useDiagnostics();
  return (
    <DiagnosticsWorkspace
      snapshot={diagnostics.snapshot}
      onSelect={diagnostics.select}
      onRefresh={diagnostics.refresh}
      onCommand={diagnostics.command}
    >
      <ActiveDiagnosticsTab snapshot={diagnostics.snapshot} />
    </DiagnosticsWorkspace>
  );
}
```

`useDiagnostics()` reads one process-wide `DiagnosticsStore` through `useSyncExternalStore`. The first consumer opens one preload subscription; later consumers increment a renderer reference count. Tab, filter, and time-window changes update the projection on that subscription. No tab, section, chart, or card owns a timer or poll.

### Instrumentation

```ts
const appendRecording = diagnosticsInstrumentation.io.bind(IO_OPERATIONS.RECORDING_APPEND);
const startedAt = performance.now();
await writer.append(chunk);
appendRecording.add({ writeBytes: chunk.byteLength, durationMs: performance.now() - startedAt });

const span = rendererDiagnostics.startSpan({
  operation: "player.manifest-to-first-frame",
  subject: streamSlotSubject,
});
try {
  const value = await window.electronAPI.streams.getPlaybackUrl(input, span.context);
  span.end({ kind: "ok" });
  return value;
} catch (error) {
  span.end({ kind: "error", error });
  throw error;
}
```

Callers select a static operation and submit safe numeric observations. They do not choose sampling, storage, redaction, cardinality, or transport policy.

### Recovery

```ts
await diagnostics.command({
  kind: "recover",
  action: { kind: "signal-interrupt", eligibilityToken: row.interrupt.token },
});
```

The renderer never sends a PID, start time, owner lease, or shell command. Main resolves the current observation from a short-lived token, re-reads identity and ancestry, rejects the current main process, validates exact platform semantics, serializes the target, records a `RecoveryAttempt`, and requests one coalesced refresh. Force uses a separate short-lived confirmation challenge.

## Shape

### Central serialized types

Shared types are JSON-safe, readonly, and use unit suffixes. Shared contains types and constants only. Zod schemas live at the transport boundary.

```ts
export type DiagnosticSourceStatus =
  | { readonly kind: "ready"; readonly observedAtMs: number }
  | { readonly kind: "stale"; readonly observedAtMs: number; readonly staleSinceMs: number;
      readonly reason: "suspended" | "missed-deadline" | "partial-scan" }
  | { readonly kind: "unavailable"; readonly sinceMs: number;
      readonly reason: "collector-error" | "permission-denied" | "process-exited" | "corrupt-data";
      readonly retry: "automatic" | "manual" }
  | { readonly kind: "unsupported"; readonly platform: "win32" | "darwin" | "linux" | "other";
      readonly capability: DiagnosticCapability; readonly explanation: string };

export type DiagnosticsTab =
  | "overview" | "resources" | "processes" | "io"
  | "traces" | "failures" | "logs-reports" | "developer-tools";
export type DiagnosticsWindow = "5m" | "15m" | "30m" | "1h";

export type DiagnosticsSelection =
  | { readonly tab: "overview" }
  | { readonly tab: "resources" | "processes" | "io" | "traces" | "failures";
      readonly window: DiagnosticsWindow }
  | { readonly tab: "logs-reports"; readonly query: DiagnosticLogQuery }
  | { readonly tab: "developer-tools" };

export interface DiagnosticsSnapshot {
  readonly revision: number;
  readonly observedAtMs: number;
  readonly sessionId: string;
  readonly selection: DiagnosticsSelection;
  readonly sources: Readonly<Record<DiagnosticSource, DiagnosticSourceStatus>>;
  readonly footprint: SystemFootprint;
  readonly latestFailures: FailureSummary;
  readonly attribution: AttributionState;
  readonly detail: DiagnosticsDetail;
}

export type DiagnosticsDetail =
  | { readonly tab: "overview"; readonly value: OverviewDetail }
  | { readonly tab: "resources"; readonly value: ResourceDetail }
  | { readonly tab: "processes"; readonly value: ProcessDetail }
  | { readonly tab: "io"; readonly value: IoDetail }
  | { readonly tab: "traces"; readonly value: TraceDetail }
  | { readonly tab: "failures"; readonly value: FailureDetail }
  | { readonly tab: "logs-reports"; readonly value: LogsReportsDetail }
  | { readonly tab: "developer-tools"; readonly value: DeveloperToolsDetail };

export interface CollectionGap {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly cause: "suspend" | "clock-jump" | "source-failure" | "budget-shed";
  readonly sources: readonly DiagnosticSource[];
}
```

`null` is allowed only when a ready source did not produce an optional metric; it never means zero. Unsupported fields have an explicit source status.

```ts
export interface ProcessObservation {
  readonly observationId: string;
  readonly observedAtMs: number;
  readonly pid: number;
  readonly startedAtMs: number | null;
  readonly parentObservationId: string | null;
  readonly ancestry: "streamfusion" | "external" | "unknown";
  readonly category: ProcessCategory;
  readonly displayName: string;
  readonly currentCpuPercent: number | null;
  readonly cumulativeCpuMs: number | null;
  readonly residentBytes: number | null;
  readonly readBytesPerSecond: number | null;
  readonly writeBytesPerSecond: number | null;
  readonly readTotalBytes: number | null;
  readonly writeTotalBytes: number | null;
  readonly samples: number;
  readonly managedRuntime: ManagedRuntimeRef | null;
  readonly performanceSubject: PerformanceSubjectRef | null;
  readonly interrupt: RecoveryEligibility;
  readonly force: RecoveryEligibility;
}

export interface DiagnosticArtifactRef {
  readonly artifactId: string;
  readonly kind: "main-log" | "network-log" | "noise-log" | "trace-session" | "report";
  readonly displayName: string;
  readonly createdAtMs: number;
  readonly sizeBytes: number;
}
```

Observations, action eligibility, internal `ProcessSignalTarget`, managed-runtime leases, `RecoveryAttempt`, and artifact refs are different types. An observation cannot be cast into authority. This follows foundational-thinking and type-system-discipline.

### Canonical ownership and actor separation

`DiagnosticsRuntime` is the main-process composition root and canonical read owner:

```ts
interface DiagnosticsRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscriptions: DiagnosticsSubscriptionService;
  commands: DiagnosticsCommandService;
  ingestRenderer(observation: RendererDiagnosticObservation): void;
}

interface DiagnosticsSubscriptionService {
  open(sender: TrustedRendererIdentity, selection: DiagnosticsSelection): Promise<SubscriptionOpened>;
  update(sender: TrustedRendererIdentity, request: UpdateSubscription): Promise<DiagnosticsSnapshot>;
  close(sender: TrustedRendererIdentity, subscriptionId: string): void;
  closeAllForWebContents(webContentsId: number): void;
}
```

Resource, trace, log, I/O, runtime-owner, and renderer stores remain owned by the module that knows their invariants. `DiagnosticsProjector.snapshot(selection)` is the only cross-store merge. The renderer agent owns its frame, commit, render, interval, and chat-rate accumulators and submits capped numeric summaries. It never mutates main state. This applies separate-before-serializing-shared-state.

The subscription interface is deep. It hides scheduler changes, histories, adapters, redaction, resync, source revisions, and push transport behind three lifecycle operations.

### Projected snapshots and bounded deltas

Main retains canonical current-session observations but does not push an hour of process and trace rows every second.

1. Connect, selection changes, and refresh return a complete snapshot for the active tab and window.
2. Main pushes a strictly validated `DiagnosticsDelta` with the current sample and changed active-detail records.
3. `DiagnosticsStore` applies consecutive revisions to one immutable snapshot. A revision gap triggers one coalesced resync on the same subscription.
4. Selection changes atomically replace the detail projection without disturbing the collector.
5. History projections contain observed buckets with time range, count, min/max/average, and gaps. They never interpolate missing values.

Every snapshot, delta, row set, string, and byte payload has a hard cap. Detailed components mount only for the active tab. Thus every React read comes from one `DiagnosticsSnapshot` without repeated large IPC clones.

### Collector and platform adapters

```ts
interface ResourceCollector {
  start(): Promise<ResourceObservation>;
  setVisibleSubscriberCount(count: number): void;
  sampleNow(reason: SampleReason): Promise<ResourceObservation>;
  history(window: DiagnosticsWindow): ResourceHistoryProjection;
  stop(): void;
}

interface DiagnosticsPlatformAdapter {
  collectHost(): Promise<SourceResult<HostObservation>>;
  scanProcesses(): Promise<SourceResult<readonly PlatformProcessObservation[]>>;
  rereadProcessIdentity(pid: number): Promise<SourceResult<PlatformProcessIdentity>>;
  createSignalTarget(input: ValidateSignalInput): Promise<SignalTargetResult>;
  signal(target: ProcessSignalTarget): Promise<PlatformSignalResult>;
}
```

The collector owns one managed interval and one single-flight sample promise. First visible subscriber swaps 30 seconds to 1 second; last close swaps it back. Manual refresh joins an in-flight sample. Baselines survive tab and cadence changes. Stop and close are idempotent.

The timestamp ring evicts entries older than one hour and enforces an item cap. Suspend/resume, large monotonic elapsed jumps, and source failures append `CollectionGap` and reset only affected delta baselines. Epoch time is for display and retention, monotonic time for rates.

- Linux reads bounded `/proc` files asynchronously and uses boot-tick identity.
- macOS uses one bounded async `ps` batch; unsupported I/O or exact signals stay typed unsupported.
- Windows uses one bounded async PowerShell/CIM batch through `execFile`, never a shell, with timeout/output caps. Expensive identity and I/O use a slower sub-cadence; Electron app metrics remain at visible cadence. Fields that cannot fit the budget remain typed unsupported.
- Electron supplies app metrics and power-monitor events. Power, low-power, idle/session, thermal, and speed-limit support are independent.

The collector records collection time, CPU cost, scan/retained/inaccessible/restart counts, retained items, and dropped detail. Pressure sheds renderer leaf/frame detail, successful span detail, then high-resolution process history. It ends targeted attribution before baseline summaries.

### Safety before sinks

`diagnostic-sanitizer.ts` is a dependency leaf with no logger import. Static descriptors allow fields for every source, span, I/O operation, and report category. Tags and operation names come from finite registries. Text is capped and removes credentials, authorization/cookies, bodies, chat/caption content, query/fragment values, raw account/channel IDs, and absolute paths. External correlations use session-local opaque IDs rather than reversible hashes.

The central logger sanitizes before formatting, disk, terminal, or sink fan-out. Trace, I/O, renderer ingestion, and reports sanitize before memory/queue insertion. Export sanitizes again and fails closed. Clipboard formatters accept only snapshot evidence types. Sentinel fixtures prove forbidden values never reach memory, disk, IPC, DOM, clipboard, or artifacts. This follows boundary-discipline.

### Trusted IPC and preload

Add one lazy `IPC_FEATURES.DIAGNOSTICS`. Strict bounded Zod contracts live in `ipc-contracts/diagnostics-contracts.ts`.

```ts
const channels = {
  CONNECT: "diagnostics:connect",
  UPDATE: "diagnostics:update",
  DISCONNECT: "diagnostics:disconnect",
  COMMAND: "diagnostics:command",
  INGEST_RENDERER: "diagnostics:ingest-renderer",
  DELTA: "diagnostics:delta",
  REQUEST_RENDERER_SAMPLE: "diagnostics:renderer-sample",
} as const;
```

All renderer-to-main routes use `TrustedIpcRegistry.handle`, validating exact webContents, top frame, allowed origin, expected document, request, and response. Pushes are schema-validated before send, bound to the subscriber's webContents, parsed again in preload, and filtered by subscription ID.

`electronAPI.diagnostics` exposes connect, update, disconnect, command, renderer-ingest, and two validated listener registrations. Preload installs listeners before Connect. Cleanup marks cancellation synchronously; a late Connect result immediately disconnects. Main closes leases on webContents destroy or document change.

### Tracing, failures, I/O, and attribution

Main tracing uses `AsyncLocalStorage<TraceContext>`. Renderer context is explicit at selected high-value call sites and selected preload methods wrap only their allowlisted IPC requests. Missing context starts a root. This avoids an unsafe browser-global async stack.

All static names update O(1) aggregates. Detail keeps failures, slow spans, and deterministic successful samples selected from trace ID. Slow uses the registered absolute threshold until 20 completions, then the stricter of absolute and rolling p95. Capped rings and an async size-capped NDJSON writer keep current plus three prior sessions. The writer never performs synchronous hot-path I/O. Parse errors become source status.

Failures derive on read from failed spans, error diagnostic logs, and collector failures. A versioned fingerprint uses static operation/source, normalized error class/message template, stable app frame, and status after removing volatile values.

Main and renderer `LogicalIoRegistry` instances bind static descriptors and accumulate count, logical read/write bytes, and duration in actor-local maps. Renderer submits a bounded aggregate on the collector's coordinated sample request. Logical bytes remain distinct from OS counters.

`AttributionCoordinator` owns exactly one session. Subjects are opaque route, named renderer boundary, managed-runtime, or process-observation refs, never recovery authority. It includes the prior 60-second baseline, supports 30/60/120/300 seconds, defaults to 60, and stops idempotently on request, target destruction, pressure, or five minutes. React Profiler and frame evidence aggregate counts/histograms rather than emitting per-event spans.

### Recovery and artifacts

`RecoveryCoordinator` keeps a keyed promise queue per target. Identical in-flight requests share a promise; different actions serialize. Signals run once and never retry. Owner adapters call the actual authority: BrowserWindow Reload UI, exact caption `{sessionId,generation}` Stop, atomic download Cancel/Retry, and recording Pause/Stop. Deferred runtimes remain display-only.

Every path records one typed attempt, including stale token, PID reuse, start mismatch, changed ancestry, main rejection, unsupported platform, owner-generation mismatch, success, and failure. Completion asks the collector for one coalesced sample.

`DiagnosticArtifactService` owns approved roots and opaque refs. Main resolves `realpath`, checks containment/type immediately before Open/Reveal/Delete, and never accepts renderer paths. Report preview returns a safe manifest, statuses, toggles, and estimated size. Create writes a sanitized temp file, fsyncs, atomically renames, and registers an immutable ref. A command ID makes repeated Create idempotent. There is no upload API.

### Renderer composition and retained Developer Console

Replace the prototype with `pages/Settings/diagnostics/DiagnosticsPage.tsx`, `DiagnosticsWorkspace.tsx`, eight `tabs/*.tsx`, a `diagnostics-store.ts`, `useDiagnostics.ts`, and shared `DiagnosticCard`, `DiagnosticTable`, `SourceState`, `ResourceTimeline`, `ProcessTree`, `RecoveryDialog`, and `AttributionControls` components.

Split `LogsSection` into reusable presentation plus legacy and Diagnostics adapters; do the same for report presentation. Diagnostics uses snapshot data and opaque artifacts. No capability is copied.

Rename `DebugPanel` to `DeveloperConsole`. Remove its Performance tab only after those metrics pass in Diagnostics. Retain Chat Simulation, UI State, DevTools, `/mod`, and useful utility buttons. Extract shared `ChatSimulationTools` and `UiStateTools` bodies so Diagnostics and Developer Console do not duplicate logic. Add **Open Diagnostics** through the router. Stress/mutation execution is gated by the real development environment at presentation and capability boundaries; safe metrics remain in production.

UI preserves Option 1 with semantic tabs/tables, 14px rows and primary labels, 13px support copy, 12px headers, internal horizontal scrolling, visible focus, reduced motion, flat tonal cards, pale-mint reads, light-violet writes, amber aggregate warnings, white numbers, and red only for errors/destructive actions.

### Exact module map

```text
src/shared/diagnostics-types.ts
src/ipc-contracts/diagnostics-contracts.ts
src/backend/diagnostics/
  diagnostics-runtime.ts
  diagnostics-projector.ts
  diagnostics-subscriptions.ts
  resource-collector.ts
  resource-history.ts
  resource-model.ts
  diagnostics-platform-adapter.ts
  adapters/{electron,linux,macos,windows}-diagnostics.ts
  safety/diagnostic-sanitizer.ts
  tracing/{trace-context,trace-recorder,failure-projector}.ts
  io/{logical-io-registry,io-operations}.ts
  attribution/attribution-coordinator.ts
  recovery/{recovery-coordinator,managed-runtime-owners,process-signal-target}.ts
  artifacts/diagnostic-artifact-service.ts
src/backend/ipc/handlers/diagnostics-handlers.ts
src/preload/diagnostics-api.ts
src/renderer/diagnostics/
  renderer-diagnostics-agent.ts
  renderer-tracing.ts
  renderer-io-registry.ts
  performance-subjects.ts
src/pages/Settings/diagnostics/
  DiagnosticsPage.tsx
  DiagnosticsWorkspace.tsx
  diagnostics-store.ts
  useDiagnostics.ts
  tabs/*.tsx
  components/*.tsx
src/components/dev/
  DeveloperConsole.tsx
  ChatSimulationTools.tsx
  UiStateTools.tsx
```

The reader path is page selector, renderer store, validated preload, one thin handler, runtime. No pass-through layer is added.

### Lifecycle

1. Logger initializes with sanitizer; runtime attaches its safe sink, takes an immediate sample, then starts one 30-second interval.
2. Lazy Diagnostics handlers load on first Connect. Main binds the subscription to exact sender/document, switches to one second, and returns the active projection.
3. Tab changes update the existing projection. Refresh joins the current sample. Deltas apply in revision order.
4. Final unsubscribe disconnects. Crash/navigation cleanup closes remaining leases. Zero visible subscribers restores 30 seconds.
5. Recovery resolves eligibility, revalidates process/owner identity, coalesces or serializes, executes once, records, then refreshes.

### Smallest ticket plan

1. **#73:** shared types, schemas, sanitizer fixtures, trusted lazy IPC/preload, runtime skeleton, singleton renderer store, and live Overview footprint/source states.
2. **#74:** canonical adaptive collector, immediate/baseline sampling, monotonic gap ring, host adapters, log-line derivation, Overview/Resources views, and self-cost.
3. **#75:** process adapters/history/tree, observation-only action display, challenges, recovery coordinator, exact signals, owner actions, and post-action refresh.
4. **#76:** trace context/recorder, selected instrumentation, bounded NDJSON, slow rules, log correlation, fingerprints, Traces and Failures.
5. **#77:** I/O registries, renderer agent, subjects, one attribution session, budget shedding, I/O and safe Developer Tools metrics.
6. **#78:** central pre-write/fan-out redaction, reusable real log viewer, opaque artifacts, immutable report workflow, while legacy panels remain.
7. **#79:** shared simulation tools, production gating, rename Developer Console, remove only its Performance tab after parity, retain utilities, add Open Diagnostics.
8. **#80:** update ticket language for the new console decision; run full proof/benchmarks/soaks; redirect and remove only legacy Logs/Report Bug, prototype code, path IPC, duplicate collectors, and gate. Keep Developer Console.

Each ticket is a vertical commit with contracts, tests, Electron evidence, docs, and no production-reachable fixture fallback.

### Verification

- Pure tests cover redaction sentinels, source exhaustiveness, monotonic deltas, rings/gaps/downsampling, thresholds/fingerprints, writer caps, attribution, confinement, and recovery queues.
- Adapter contract fixtures cover Windows/macOS/Linux, failures, permissions, PID reuse, main rejection, and unsupported semantics.
- IPC tests reject wrong sender, subframe, document, request, response, expired token, document change, and oversized payload.
- Preload/store tests prove schema checks, lazy loading, listener cleanup, connect/unmount races, one connection, revision resync, and no duplicate timers.
- React tests cover every tab/state/window, active-only mounting, keyboard/focus/reduced motion, contained tables, logs, traces, reports, recovery, and dev gates.
- Fresh Electron proof visibly exercises all eight tabs with real data, every required interaction/state, Developer Console and Open Diagnostics, and live log files.
- Packaged platform checks accept absent fields only as typed unsupported.
- A deterministic harness compares disabled, closed, visible, and attribution modes for 15 minutes, 60 minutes packaged, and four hours packaged, recording CPU, memory, retained items, queues, files, timers, and subscriptions.

## Synthesis decision

Arena has not selected a base. This candidate deliberately chooses active-tab projections plus bounded deltas rather than full snapshots or per-tab queries.

## Tradeoffs accepted

- We accept delta-reducer complexity for a coherent renderer snapshot without retransmitting an hour of history each second.
- We accept slower OS identity sub-cadence for TypeScript-only portable collection inside budget.
- We accept explicit renderer trace context for correct concurrency.
- We accept actor-local aggregators and a read-boundary merge to avoid shared mutable state.
- We accept finite instrumentation registries for bounded cardinality and dependable redaction.
- We accept two presentations of simulation tools for the retained Developer Console, while sharing one implementation and gate.

## Alternatives considered

- **Full snapshot every second:** simple transport, but makes every subscriber pay unbounded history/log clone costs and exposes internal cost policy.
- **Independent per-tab polling:** simple components, but callers must understand cadence/gaps/cache and it creates duplicate timers and incoherent evidence.
- **SQLite for all observations:** convenient queries, but adds native persistence and disk pressure to the hot paths being diagnosed.
- **Native/Rust sidecar:** potentially richer I/O, but violates the accepted TypeScript-only boundary and adds another lifecycle.

## Open questions and risks

- Can bounded Windows PowerShell/CIM scans meet the visible budget, or must exact Windows I/O be typed unsupported?
- Which existing network, search, player, and runtime operations form the smallest useful initial trace allowlist?
- Will packaged macOS permissions permit the proposed `ps` scan, or must that support matrix narrow?
- Can platform CI hold four-hour packaged workers reliably, or should the harness checkpoint evidence across runner restarts?

## Next implementation step

Build #73's `DiagnosticsSnapshot`, strict schemas, sanitizer boundary, and one projected trusted subscription through to a live Overview footprint before adding another source.
