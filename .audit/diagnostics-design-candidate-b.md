# Candidate B: segmented observation store with materialized snapshots

## Problem

StreamFusion needs one production Diagnostics workspace that explains resources, processes, I/O, traces, failures, logs, reports, and renderer performance without creating eight polling systems or weakening Electron security. The current process monitor is one 30-second logger timer, the Settings prototype is synthetic, legacy log/report IPC exposes paths, and the floating Debug Console owns separate renderer timers. The design must keep current log locations and owner-held recovery semantics, stay TypeScript-only, fit the 350 MB heap cap, and report unsupported capabilities explicitly. The latest product decision keeps the widget as a development-only **Developer Console**. It retains Chat Simulation, UI State, Chromium DevTools, the mod shortcut, and useful controls; only its duplicate Performance tab is removed, and it gains Open Diagnostics.

## Usage (caller's view)

### Main composition

```ts
const diagnostics = createDiagnosticsRuntime({
  clock: systemDiagnosticsClock,
  host: createHostAdapter(process.platform),
  processes: createProcessAdapter(process.platform),
  roots: createDiagnosticArtifactRoots(logPaths),
  owners: createManagedRuntimeOwners(),
});

diagnostics.start(); // immediate sample, then the only adaptive scheduler
const mainWindow = windowManager.createMainWindow();
diagnostics.attachRenderer(mainWindow.webContents);
registerIpcHandlers(mainWindow, diagnostics);

// Before logger shutdown
await diagnostics.stop();
```

The runtime starts where `startProcessMonitor()` starts today, before the window is shown, so its 30-second baseline exists while Diagnostics is closed. IPC handlers remain lazy. The old monitor does not run beside it; its grep-stable text line is formatted from the committed resource observation.

### Instrumentation

Callers get narrow typed recorders, not a generic event emitter.

```ts
const span = diagnostics.recorders.traces.start({
  name: "search.request",
  subject: { kind: "route", route: "/search" },
  parent: currentTraceContext(),
});
try {
  const result = await runSearch(request);
  span.end({ kind: "ok" });
  return result;
} catch (error) {
  span.end({ kind: "error", error: classifyDiagnosticError(error) });
  throw error;
}

diagnostics.recorders.io.add({
  component: "stream-recording",
  operation: "section.append",
  logicalWriteBytes: chunk.byteLength,
  elapsedUs,
});

diagnostics.recorders.runtimes.publish({
  subject: { kind: "managed-runtime", runtimeKind: "recording", runtimeId },
  counters: { writtenBytes, reconnects },
});
```

Span completion updates bounded memory synchronously. Redacted NDJSON persistence is queued and never blocks the caller. Logical I/O aggregates counters and does not create one record per byte, chunk, message, frame, render, progress update, or segment.

### Renderer page

```tsx
function DiagnosticsPage() {
  const [view, setView] = useState<DiagnosticsView>({ kind: "overview" });
  const diagnostics = useDiagnosticsWorkspace({ view, visible: true });

  return (
    <DiagnosticsWorkspace
      snapshot={diagnostics.snapshot}
      status={diagnostics.status}
      onViewChange={setView}
      onRefresh={diagnostics.refresh}
      onCommand={diagnostics.execute}
    />
  );
}
```

`useDiagnosticsWorkspace()` uses one module-scoped `DiagnosticsClient` and `useSyncExternalStore`. The first consumer opens a main lease, later consumers share it, and the final unmount closes it. Tab/window changes configure the existing lease and materialize retained data immediately. They do not add timers or reset deltas.

### Developer Console

```tsx
const CONSOLE_TOOLS = [
  { id: "chat-sim", label: "Chat Simulation", Component: ChatSimulationTool },
  { id: "ui-state", label: "UI State", Component: UiStateTool },
] as const;

<DeveloperConsole
  tools={CONSOLE_TOOLS}
  onOpenDiagnostics={() => navigate({ to: "/settings", search: { tab: "diagnostics" } })}
  onToggleDevTools={() => window.electronAPI.toggleDevTools()}
/>
```

Performance is absent from this widget. Production-safe heap, frame, interval, render, and chat-store summaries have one source in Diagnostics. Simulator code is build-excluded from packaged output; any future mutating IPC command is also rejected by main production policy.

## Shape

### Core data

Shared files hold serializable types/constants only. Zod schemas live in `src/ipc-contracts`.

```ts
export type DiagnosticSourceStatus =
  | { readonly kind: "ready"; readonly observedAt: string }
  | { readonly kind: "stale"; readonly observedAt: string; readonly reason: StaleReason }
  | { readonly kind: "unavailable"; readonly diagnosticId: string; readonly retry: RetryAdvice }
  | { readonly kind: "unsupported"; readonly capability: DiagnosticCapability };

export interface CanonicalObservation<T> {
  readonly sequence: number;
  readonly observedAt: string;
  readonly monotonicMs: number;
  readonly source: DiagnosticSource;
  readonly value: T;
}

export interface CollectionGap {
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly source: DiagnosticSource;
  readonly reason: "suspend" | "clock-jump" | "source-failure" | "budget-shed";
}

export type DiagnosticsView =
  | { readonly kind: "overview" }
  | { readonly kind: "resources"; readonly minutes: 5 | 15 | 30 | 60 }
  | { readonly kind: "processes"; readonly minutes: 5 | 15 | 30 | 60 }
  | { readonly kind: "io"; readonly minutes: 5 | 15 | 30 | 60 }
  | { readonly kind: "traces"; readonly minutes: 5 | 15 | 30 | 60 }
  | { readonly kind: "failures"; readonly minutes: 5 | 15 | 30 | 60 }
  | { readonly kind: "logs-reports"; readonly logView: DiagnosticLogView }
  | { readonly kind: "developer-tools" };

export interface DiagnosticsSnapshot {
  readonly schemaVersion: 1;
  readonly snapshotSequence: number;
  readonly observedAt: string;
  readonly sourceStatuses: Readonly<Record<DiagnosticSource, DiagnosticSourceStatus>>;
  readonly overview: DiagnosticsOverview;
  readonly detail: DiagnosticsDetail; // discriminated by detail.kind
}
```

This is the only read model sent to renderer. It carries current overview/status plus detail for the active tab/window. It avoids cloning one hour of every table each second while keeping all reads in one typed snapshot. Only the matching detail component mounts.

Observation never grants authority:

```ts
export interface ProcessObservation {
  readonly observationId: string;
  readonly pid: number;
  readonly observedStartTime: string | null;
  readonly parentPid: number | null;
  readonly category: ProcessCategory;
  readonly resources: ProcessResourceValues;
  readonly actionAvailability: readonly RecoveryAvailability[];
  readonly relatedSubjects: readonly PerformanceSubject[];
  readonly relatedRuntimes: readonly ManagedRuntimeRef[];
}

// Main-only, never serialized or retained by the page.
interface ProcessSignalTarget {
  readonly pid: number;
  readonly exactStartTime: string;
  readonly validatedAncestry: readonly number[];
}

export type RecoveryAttempt =
  | { readonly kind: "completed"; readonly attemptId: string; readonly observedAt: string }
  | { readonly kind: "rejected"; readonly attemptId: string; readonly reason: RecoveryRejection }
  | { readonly kind: "failed"; readonly attemptId: string; readonly diagnosticId: string };

export interface DiagnosticArtifactRef {
  readonly artifactId: string;
  readonly kind: "main-log" | "network-log" | "noise-log" | "report" | "trace-store";
  readonly displayName: string;
  readonly createdAt: string;
  readonly sizeBytes: number;
}
```

No absolute path, raw account/channel identifier, body, chat/caption text, URL query/fragment, credential, cookie, or authorization header exists in these types.

### Segmented store

Each producer owns a bounded segment optimized for its access pattern. The materializer merges them synchronously at the read boundary, per `separate-before-serializing-shared-state`.

```ts
interface DiagnosticsRuntime {
  readonly recorders: DiagnosticsRecorders;
  start(): void;
  stop(): Promise<void>;
  attachRenderer(renderer: WebContents): void;
  openLease(input: OpenDiagnosticsLease): DiagnosticsSnapshot;
  configureLease(input: ConfigureDiagnosticsLease): DiagnosticsSnapshot;
  closeLease(input: CloseDiagnosticsLease): void;
  refresh(input: RefreshDiagnostics): Promise<DiagnosticsSnapshot>;
  execute(command: DiagnosticsCommand): Promise<DiagnosticsCommandResult>;
}

interface DiagnosticsStores {
  readonly resources: TimestampRing<ResourceSample | CollectionGap>;
  readonly processCatalog: ProcessObservationStore;
  readonly mainTraces: TraceStore;
  readonly rendererTraces: TraceStore;
  readonly logs: DiagnosticLogStore;
  readonly io: LogicalIoStore;
  readonly runtimes: RuntimeSummaryStore;
  readonly recovery: TimestampRing<RecoveryAttempt>;
}
```

All mutation occurs on the main JS thread. `SnapshotMaterializer.materialize(view)` has no `await`, so it sees a consistent cut between event-loop turns. Each store has its own sequence/capacity. Derived failures, span rankings, timelines, and totals are projections, never another truth.

- Resources/recovery use timestamp rings with age and capacity eviction.
- Processes use a current identity map plus per-identity timestamp rings.
- Traces count every name but retain detail only for failures, slow spans, and deterministic successes.
- I/O uses a bounded `(component, operation, subject)` map with 60 one-minute buckets.
- Runtime performance stores one bounded summary per subject plus short attribution detail.
- Logs use a capped safe-evidence ring fed by the sanitized logger.

The façade is deep: callers record typed facts or request snapshots. Cadence, retention, sampling, derivation, status, and serialization remain hidden.

### One scheduler

`ResourceSampler` owns the only diagnostic timer. Start samples immediately; cadence is 30 seconds without a visible lease and one second with any visible lease. It uses monotonic elapsed time. Suspend, large elapsed jumps, and adapter failures append gaps and reset rate baselines. Expensive identity scans are subcadences of this scheduler and return cached identity between due scans, not separate timers.

Manual refresh joins the same single-flight `sampleNow()`. View changes only rematerialize. `SnapshotPublisher` coalesces changes to at most one push per sample and validates the snapshot before sending it to the exact attached renderer.

```ts
logger.info("ProcessMonitor", formatProcessMonitorLine(committedResourceObservation));
```

Thus logs and Diagnostics cannot disagree.

### Trusted IPC and lease

Add lazy feature `diagnostics`, registered through `TrustedIpcRegistry.handle`:

```ts
DIAGNOSTICS_OPEN_LEASE
DIAGNOSTICS_CONFIGURE_LEASE
DIAGNOSTICS_CLOSE_LEASE
DIAGNOSTICS_REFRESH
DIAGNOSTICS_EXECUTE
DIAGNOSTICS_RECORD_RENDERER_BATCH
DIAGNOSTICS_SNAPSHOT_CHANGED // main to preload push
```

Preload owns a document-instance ID and local listener set. First listener opens, last closes. Open is idempotent for `(trusted WebContents, top-level document, documentInstanceId)`. Main clears leases on navigation, renderer termination, and destruction, so a lost cleanup cannot retain one-second sampling. Strict Mode races converge on one lease.

`diagnostics-contracts.ts` validates every request/reply. Main validates pushes before send; preload validates again before fan-out. Invalid sender, subframe, document, request, response, or push fails closed with only a safe diagnostic ID. Renderer batches are capped by count, encoded size, and age and accept allowlisted performance/trace/I/O shapes only.

### Safety boundary

`sanitizeDiagnosticObservation()` runs before every store. Typed allowlists strip URL query/fragment data, replace absolute paths with root labels, remove raw identifiers, bound strings, normalize errors, and reject body/chat/caption fields. `sanitizeDiagnosticSnapshot()` runs before IPC.

The central logger must sanitize before `formatLine()`, disk write, and sink fan-out. Existing `redactor.ts` becomes part of stricter `sanitizeLogEntry()`. Diagnostics subscribes only to sanitized entries. Export sanitizes the assembled manifest and attachments again and fails closed if forbidden fixtures match.

### Resources, processes, and recovery

`HostAdapter` and `ProcessAdapter` return capability status per field. Electron remains the cheap common source; platform adapters add start time, ancestry, process CPU, and OS I/O when reliable. Windows may use a bounded child probe on a slower sampler subcadence; macOS/Linux use native process tables. Missing capability is `unavailable` or `unsupported`, never zero.

Before SIGINT or confirmed SIGKILL, `RecoveryCoordinator` re-reads the process, matches exact start time, proves current ancestry reaches StreamFusion main, and rejects main itself. Only then does it create `ProcessSignalTarget`. Windows reports unsupported where Node cannot guarantee signal semantics. Commands serialize by target, identical in-flight commands share a promise, differing commands queue, and signals never retry.

Managed runtime commands call owners, not PIDs: Reload UI through current `BrowserWindow`; caption stop through exact `{sessionId,generation}`; download cancel/retry through queue and concrete owner; recording pause/stop through `StreamRecordingService`. Every attempt is recorded and triggers the same immediate sample.

### Traces, failures, I/O, attribution

Main context uses `AsyncLocalStorage`; renderer context is explicit in strictly validated instrumented IPC envelopes. Missing context starts a root. Initial spans cover network summaries, search, crashes/errors, selected IPC, route/lazy load, player startup/recovery, and runtime transitions. High-frequency events aggregate instead.

`TraceStore` keeps rolling histograms. A span is slow by explicit operation threshold or rolling p95 after 20 samples. Failure fingerprints use operation, source, classified error, normalized message, and stable frame/status after volatile removal.

`TraceNdjsonWriter` receives redacted retained spans through a byte-bounded async queue. It drops successful leaf detail first, caps line/session size, and keeps current plus three prior sessions. Startup parsing validates each line and counts parse errors without poisoning current state.

`LogicalIoStore.add()` aggregates logical reads/writes separately from OS counters at existing batch/lifecycle boundaries. `AttributionCoordinator` allows one session, includes a preceding 60-second baseline, defaults to 60 seconds, supports 30/60/120/300, and ends on request, target destruction, budget pressure, or five minutes. Renderer details batch at most once per second. Budget pressure drops targeted leaf detail, ends attribution, then preserves baseline summaries, with visible gaps/drop counts.

### Logs and reports

Refactor `LogsSection` into a reusable view plus `useDiagnosticLogs()`. During migration, old Settings and Diagnostics render the same implementation. The new adapter returns safe parsed entries and opaque refs, never paths. Main/network/noise/correlated spans preserve search, filters, tail, refresh, network rows, and safe copy.

`DiagnosticArtifactRegistry` scans only configured roots and maps random IDs to freshly checked file identity. Open/Reveal/Delete canonicalize, reject traversal/symlink/root escape/stale identity, and apply kind policy. Development keeps repository `.logs/`; packaged Windows keeps `logs/` beside executable; macOS/Linux use Electron logs.

Report preview returns categories, statuses, attachment refs, and estimate. Creation writes a sanitized temp, validates, atomically renames to immutable final, registers it, and never uploads. A request ID deduplicates double submission.

### Renderer presentation

Option 1 remains. Replace the large prototype with a workspace and one active detail component. Components receive snapshot data/commands and know no IPC channels. Preserve flat tonal cards, semantic tabs/tables/buttons, focus, reduced motion, and internal horizontal scroll. Rows/primary labels are at least 14px, copy 13px, headers 12px. Process identities are colored. Reads use pale mint, writes light violet. Aggregate failures use amber and neutral badges with white counts. Red is only explicit errors/destructive actions. Loading, empty, stale, unavailable, and unsupported are distinct; absent data never renders zero.

### Exact module map

```text
apps/desktop/src/shared/
  diagnostics-types.ts
  ipc-channels.ts
apps/desktop/src/ipc-contracts/
  diagnostics-contracts.ts
apps/desktop/src/backend/diagnostics/
  diagnostics-runtime.ts
  diagnostics-stores.ts
  snapshot-materializer.ts
  resource-sampler.ts
  diagnostic-clock.ts
  diagnostic-sanitizer.ts
  budget-policy.ts
  recorders.ts
  resources/{host-adapter,process-adapter,electron-resource-source}.ts
  resources/{win32,darwin,linux}-process-adapter.ts
  processes/recovery-coordinator.ts
  processes/managed-runtime-owners.ts
  tracing/{trace-recorder,trace-store,slow-span-policy,failure-fingerprint}.ts
  tracing/trace-ndjson-writer.ts
  io/logical-io-store.ts
  performance/attribution-coordinator.ts
  artifacts/{artifact-registry,report-builder}.ts
apps/desktop/src/backend/logging/
  process-monitor.ts                 formatter only
  sanitize-log-entry.ts
  logger.ts                          sanitize before write/fan-out
apps/desktop/src/backend/ipc/handlers/
  diagnostics-handlers.ts
apps/desktop/src/backend/ipc/lazy-feature-loader.ts
apps/desktop/src/preload/
  diagnostics-client.ts
  ipc-feature-loader.ts
  index.ts
apps/desktop/src/hooks/
  use-diagnostics-workspace.ts
apps/desktop/src/pages/Settings/diagnostics/
  DiagnosticsWorkspace.tsx
  {Overview,Resources,Processes,Io,Traces,Failures,LogsReports,DeveloperTools}Tab.tsx
  diagnostics-formatters.ts
apps/desktop/src/components/settings/
  diagnostic-logs/LogViewer.tsx
  diagnostic-reports/ReportBuilder.tsx
apps/desktop/src/components/dev/
  DeveloperConsole.tsx
  ChatSimulationTool.tsx
  UiStateTool.tsx
```

Tests mirror source. Contract/boundary tests go under `tests/shared` and `tests/backend/ipc`; stores/adapters/recovery under `tests/backend/diagnostics`; hook and active-tab/accessibility tests under renderer paths. Inject clock, scheduler, adapters, and writer. Every retained test names its `// Guards:` regression class and stays within the speed budget.

### Sequence

1. Initialize logging and durable services.
2. Start runtime, commit immediate sample, emit legacy summary, schedule 30s.
3. Create window, attach exact renderer, register lazy loader.
4. Opening page loads feature and one lease; cadence becomes 1s without resetting deltas.
5. Materialize Overview plus active detail and send a validated snapshot.
6. Tab/window change rematerializes without sampling or another subscriber.
7. Recorders update isolated segments; tick/refresh/command completion coalesce publication.
8. Last listener closes; cadence returns 30s. Navigation/crash handles missed close.
9. Quit closes leases, stops scheduler, drains capped writes, removes sinks, then shuts logger.

### Ticket plan

1. **#73:** Types, schemas, sanitizer fixtures, runtime shell, Electron resource source, lease, live Overview, active-tab shell. Keep legacy surfaces.
2. **#74:** Adaptive sampler/ring/gaps/host adapters/Resources tab/canonical log formatter. Prove 30s/1s/ref-count with fake clock.
3. **#75:** Process adapters/history/tree/fresh target validation/coordinator/owner actions/confirmation/typed feedback/immediate refresh.
4. **#76:** Trace stores/context/renderer batches/instrumentation/NDJSON/slow policy/fingerprints/real Traces and Failures.
5. **#77:** Logical I/O, subjects/runtime summaries, one attribution session, budget shedding, renderer aggregates, I/O and production-safe Developer Tools metrics.
6. **#78:** Central logger sanitizer, embedded existing log viewer, opaque artifacts, report preview/create/open/reveal/delete. Old Settings calls same components temporarily.
7. **#79:** Reuse Chat Simulation and UI State in Diagnostics when dev-gated. Rename `DebugPanel` to `DeveloperConsole`, remove only Performance, retain Chat Simulation/UI State/mod/DevTools/collapse, add Open Diagnostics. Prove packaged safe metrics and absent simulator chunk/mutating path.
8. **#80:** Full functional/security/accessibility/benchmark/workload/soak matrix. Redirect/remove standalone Logs/Report Bug, prototype, path IPC, duplicate collectors, and gate. Keep trimmed dev-only Developer Console per latest decision.

No later ticket adds another transport, timer, history, or authority path.

### Red-flag screen

- **Shallow module:** Pass. One runtime, narrow recorders, one hook, typed commands. Policy stays internal.
- **Information leakage:** Pass. Wire schemas stay in `ipc-contracts`; paths, Zod, Electron, and OS representations are private.
- **Temporal decomposition:** Pass. Modules group by trace retention, artifact confinement, process authority, and other owned knowledge.
- **Pass-through methods:** Pass with one deliberate boundary. IPC handlers add trust/schema/policy adaptation rather than transparent forwarding.

## Synthesis decision

Pending arena comparison. Select this candidate if isolated producer state, active-view materialization, and bounded renderer payloads outweigh the simplicity of one monolithic in-memory snapshot.

## Tradeoffs accepted

- We accept snapshot materialization per visible sample for bounded cloning and coherent reads.
- We accept different store structures for O(1) hot writes and query-shaped retention.
- We accept cached slower OS identity scans for one scheduler and performance budgets.
- We accept selected explicit instrumentation instead of a global profiler.
- We accept shared dev tools in both Diagnostics and the retained Console to preserve quick access without duplicate implementation or sampling.
- We accept typed unsupported signals where Node cannot prove exact semantics rather than unsafe best effort.

## Alternatives considered

- **One giant mutable snapshot:** simple reads, but every producer shares update/retention rules and visible pushes clone too much.
- **Universal append-only event bus:** uniform ingestion, but leaks event versioning to producers and reduces high-volume I/O inefficiently.
- **Per-tab polling hooks:** locally simple, but exposes cadence/delta/cleanup to every section and violates one sampler.
- **SQLite for all diagnostics:** flexible queries, but adds native/synchronous pressure, migrations, privacy exposure, and a second truth.

## Open questions and risks

- Which Windows probe reliably supplies start time, ancestry, and I/O within visible budget?
- Which player/StreamSlot boundaries can issue stable subjects before full WebContentsView isolation?
- Should production label the read-only Developer Tools tab as Performance while keeping its route ID?
- Which deterministic fixtures exercise downloads, recordings, and captions in the 15-minute benchmark?
- Can macOS/Linux packaged UI run in CI, or does their matrix need adapter integration plus platform-owned manual evidence?

## Next implementation step

Implement #73 with shared types, strict schemas, sanitizer fixtures, runtime shell, one lease, and a live Electron System Footprint before extending another tab.
