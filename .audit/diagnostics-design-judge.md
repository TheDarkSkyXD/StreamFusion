# Diagnostics design judge

## Verdict

Use **Candidate B** as the base.

B fits StreamFusion's current Electron/TypeScript architecture better: segmented producer stores, one adaptive scheduler, synchronous active-view materialization, lazy trusted IPC, one preload client, and one renderer store. That matches the existing main/preload/renderer boundaries and the 350 MB heap constraint with less machinery than A's snapshot-plus-delta protocol.

Candidate A is valuable, but its projected delta/revision model adds a second correctness surface before the design has evidence that active-view snapshots are too expensive.

## Comparison

### Correctness

B wins. Stores mutate on the main JS thread and `SnapshotMaterializer.materialize(view)` has no `await`, so each snapshot is a coherent read boundary. A's delta reducer can be correct, but it requires gap detection, resync, active-tab replacement, and client reducer correctness before it earns its cost.

### Security

B is sound and aligns with the existing `TrustedIpcRegistry` and `trustedIpcMain` posture: exact sender, top frame, expected document, bounded payloads, contracts in `ipc-contracts`, and safe diagnostic IDs. It also directly fixes today's weak spot: legacy log/report APIs expose absolute paths.

Graft A's stricter security details: short-lived recovery tokens, separate force confirmation challenges, sanitizer as a dependency leaf with no logger import, fail-closed export sanitization, and sentinel fixtures proving forbidden values never reach memory, disk, IPC, DOM, clipboard, or artifacts.

### Maintainability

B wins. Its module map is closer to the current codebase: `backend/diagnostics`, `backend/logging/process-monitor.ts` as formatter-only, `ipc-contracts`, a preload client, and a hook under `src/hooks`. The "typed recorders, segmented stores, materializer" split is easier to review and test incrementally than A's subscription/delta machinery.

### Performance

B wins for the first implementation. It bounds hot writes with per-source data structures, aggregates high-volume I/O, retains selective trace detail, and sends overview plus active detail only. Reject A's delta transport unless measured active-view snapshots exceed budget.

### Testability

B wins. Fake clock, scheduler, adapters, stores, writer, recovery coordinator, and materializer tests are direct. Add A's stricter test cases for sender/document rejection, preload connect/unmount races, stale recovery tokens, PID reuse, sanitizer sentinels, and duplicate timer/subscription prevention.

### Fit

B fits the repo:

- `shared/` remains serializable types/constants only.
- Zod contracts stay in `ipc-contracts`.
- Main owns services; renderer reaches main only through `window.electronAPI`.
- Diagnostics becomes a new lazy `IPC_FEATURES.DIAGNOSTICS`.
- The existing `startProcessMonitor()` singleton can be replaced by the runtime sampler without running two timers.
- `DebugPanel` is already dev-only under `components/dev`; renaming it to `DeveloperConsole`, removing only `PerfTool`, and adding Open Diagnostics is contained.

## Grafts From A

- Use unit-suffixed numeric fields for hot wire/internal metrics (`observedAtMs`, `residentBytes`, `readBytesPerSecond`) and format ISO/display strings at presentation/export boundaries.
- Preserve A's richer `DiagnosticSourceStatus` shape and null semantics: `null` may mean "ready but optional metric absent"; it must not mean zero or unsupported.
- Keep observation refs, action eligibility, `ProcessSignalTarget`, managed-runtime leases, recovery attempts, and artifact refs as separate non-cast-compatible types.
- Renderer recovery commands carry only short-lived eligibility/challenge tokens. Main re-reads process identity and ancestry immediately before action.
- Use session-local opaque IDs for external correlations, not reversible hashes of account/channel/path data.
- Track collector self-cost, retained/dropped counts, inaccessible/restart counts, queue sizes, and budget-shed gaps.
- Keep A's preload race handling: listeners install before connect; cleanup marks cancellation synchronously; a late connect result immediately disconnects.
- Keep A's issue #80 product language: Developer Console remains; only duplicate Performance is removed.

## Reject Or Simplify

- Reject A's bounded delta protocol for phase one. Ship B's active-view materialized snapshot first.
- Do not mix vocabularies. If B is base, use lease/open/configure/close/refresh/execute, not A's subscription naming.
- Simplify B's `attachRenderer(mainWindow.webContents)` unless it owns more than storing the same trusted sender already known by IPC registration.
- Reject generic instrumentation event emitters. Keep narrow typed recorders and finite registries.
- Reject renderer-visible absolute paths in Diagnostics, including copy-path affordances. Use opaque artifact refs and safe display names.
- Keep Chat Simulation and UI State mutators dev-only in `DeveloperConsole`. Diagnostics may show production-safe metrics only.
- Mark Windows exact signals or OS I/O as typed unsupported until the adapter proves exact start identity, ancestry, timeout bounds, and budget compliance.
- Keep channel strings in `shared/ipc-channels.ts`; no raw diagnostics channel literals.

## Synthesized Shape

1. `DiagnosticsRuntime` owns recorders, bounded stores, one adaptive scheduler, artifact registry, recovery coordinator, and command execution.
2. Producers write typed sanitized facts into segmented stores.
3. `SnapshotMaterializer.materialize(view)` synchronously builds overview plus active detail.
4. Lazy diagnostics IPC opens one trusted lease per document, configures active view/window, refreshes through the single-flight sampler, executes typed commands, and pushes validated active-view snapshots.
5. Preload exposes one `electronAPI.diagnostics` namespace, validates pushes again, and owns listener cleanup.
6. Renderer uses one module-scoped `DiagnosticsClient` and `useSyncExternalStore`; no tab/card/table owns a polling timer.

## First Step

Implement #73 from B, with A's source status, unit-suffixed numeric types, sanitizer fixtures, short-lived authority separation, lazy trusted IPC contracts, one lease, one renderer client/store, and a live Electron System Footprint overview. Keep legacy Logs, Report Bug, and DebugPanel/DeveloperConsole surfaces until replacement adapters are proven.
