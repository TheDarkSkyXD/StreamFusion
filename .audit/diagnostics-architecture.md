# Diagnostics implementation architecture

## Decision

Use a main-owned segmented observation store with one adaptive resource sampler and synchronous active-view snapshot materialization. Candidate B is the base. Candidate A contributes stricter source states, unit-suffixed metrics, short-lived recovery eligibility, sanitizer fixtures, and preload race handling. Full snapshot deltas are deferred unless the benchmark shows active-view snapshots exceed budget.

The latest product decision keeps the floating widget. Rename it **Developer Console**, keep Chat Simulation, UI State, Chromium DevTools, `/mod`, collapse and positioning controls, remove only its duplicate Performance tab, and add **Open Diagnostics**.

## Invariants

- Main owns collection, retention, redaction, artifacts, trace and I/O storage, and recovery authorization.
- Renderer reads one `DiagnosticsSnapshot` through one lease and renders only the active detail.
- No tab, card, table, chart, or report owns resource polling.
- The sampler takes an immediate sample, runs every 30 seconds with no visible lease, and every second with at least one visible lease.
- Epoch time is for display and retention. Monotonic time is for rates and gap detection.
- `ProcessObservation` is evidence. It cannot be used or cast as `ProcessSignalTarget` authority.
- Missing, stale, unavailable, and unsupported data never render as zero.
- Shared types remain JSON-safe. Zod schemas remain at the IPC boundary.
- Diagnostics never transports absolute paths, credentials, bodies, chat or caption text, URL queries or fragments, raw account or channel IDs, cookies, or authorization headers.
- Windows exact signals and OS I/O remain typed unsupported until a bounded TypeScript adapter proves their semantics and cost.

## Core shape

```ts
type DiagnosticSourceStatus =
  | { kind: "ready"; observedAtMs: number }
  | { kind: "stale"; observedAtMs: number; staleSinceMs: number; reason: StaleReason }
  | { kind: "unavailable"; sinceMs: number; reason: UnavailableReason; retry: RetryAdvice }
  | { kind: "unsupported"; platform: DiagnosticPlatform; capability: DiagnosticCapability };

type DiagnosticsView =
  | { tab: "overview" }
  | { tab: "resources" | "processes" | "io" | "traces" | "failures"; windowMinutes: 5 | 15 | 30 | 60 }
  | { tab: "logs-reports"; logView: DiagnosticLogView }
  | { tab: "developer-tools" };

interface DiagnosticsSnapshot {
  schemaVersion: 1;
  sequence: number;
  observedAtMs: number;
  sourceStatuses: Readonly<Record<DiagnosticSource, DiagnosticSourceStatus>>;
  overview: DiagnosticsOverview;
  detail: DiagnosticsDetail;
}
```

Segmented stores use bounded structures suited to their writes. Resources and recovery use timestamp rings. Processes use a current identity map and per-identity rings. Traces retain counts for all static names and detail only for failures, slow spans, and deterministic successes. I/O uses bounded aggregate buckets. Renderer performance retains one bounded summary per subject. Failures and rankings are derived at materialization time.

## Transport

Add lazy `IPC_FEATURES.DIAGNOSTICS` and strict routes for open lease, configure lease, close lease, refresh, execute command, record renderer batch, and snapshot changed. Every invoke route uses `TrustedIpcRegistry`. Main validates a push before sending it to the exact trusted renderer. Preload validates it again.

The preload client installs its listener before opening a lease. Cleanup marks cancellation synchronously. A late open result immediately closes. Main also closes leases on navigation, renderer termination, and destruction. Strict Mode remounts converge on one lease.

## Safety and actions

Construction-time allowlists keep system snapshots numeric and enum-only. A dependency-leaf sanitizer runs before diagnostic stores. The central logger redacts before formatting, disk, terminal, and sink fan-out. Export sanitizes again and fails closed.

Recovery commands contain only a short-lived eligibility token. Force uses a separate confirmation challenge. Main resolves the token, re-reads PID plus exact creation time and ancestry, rejects the main process, validates platform semantics, serializes by target, runs once without automatic signal retry, records a typed `RecoveryAttempt`, and requests one coalesced sample. Managed-runtime actions call their actual owner rather than an observed PID.

Artifacts are opaque refs. Main canonicalizes and checks root containment immediately before Open, Reveal, or Delete. Reports are sanitized, written to a temporary file, atomically renamed, immutable, and never uploaded automatically.

## Module map

```text
apps/desktop/src/shared/diagnostics-types.ts
apps/desktop/src/ipc-contracts/diagnostics-contracts.ts
apps/desktop/src/backend/diagnostics/
  diagnostics-runtime.ts
  diagnostics-stores.ts
  snapshot-materializer.ts
  resource-sampler.ts
  diagnostic-sanitizer.ts
  resources/electron-resource-source.ts
  resources/{win32,darwin,linux}-process-adapter.ts
  processes/recovery-coordinator.ts
  tracing/{trace-recorder,trace-store,trace-ndjson-writer}.ts
  io/logical-io-store.ts
  performance/attribution-coordinator.ts
  artifacts/{artifact-registry,report-builder}.ts
apps/desktop/src/backend/ipc/handlers/diagnostics-handlers.ts
apps/desktop/src/preload/diagnostics-client.ts
apps/desktop/src/hooks/use-diagnostics-workspace.ts
apps/desktop/src/pages/Settings/diagnostics/
  DiagnosticsWorkspace.tsx
  {Overview,Resources,Processes,Io,Traces,Failures,LogsReports,DeveloperTools}Tab.tsx
apps/desktop/src/components/dev/DeveloperConsole.tsx
```

## Delivery order

1. #73 establishes shared types, strict schemas, sanitizer fixtures, runtime shell, Electron resource source, one trusted lease, one renderer store, and live System Footprint.
2. #74 adds adaptive sampling, one-hour rings, gaps, host state, Resources, and canonical process-monitor log formatting.
3. #75 adds process history/tree, typed unsupported fields, recovery eligibility and confirmation, safe owner actions, and immediate refresh.
4. #76 adds bounded tracing, slow-span policy, failure fingerprints, NDJSON retention, Traces, and Failures.
5. #77 adds logical I/O, performance subjects, renderer summaries, one targeted attribution session, budget shedding, and I/O/Developer metrics.
6. #78 migrates the real log viewer and report workflow behind strict Diagnostics APIs and opaque artifacts.
7. #79 renames Developer Console, removes only Performance, retains its useful tools, and adds Open Diagnostics.
8. #80 verifies the matrix and removes standalone Logs/Report Bug plus prototype and duplicate collectors. Developer Console remains.

## Verification

Each slice gets focused type, schema, collector, IPC, preload lifecycle, component, and accessibility tests plus live Electron proof. Final proof covers all eight tabs, the retained Developer Console, production gates, file-backed logs, packaged Windows, cross-platform adapter contracts, benchmark, active workload, and soak evidence. macOS and Linux packaged runtime evidence requires those hosts or CI runners and cannot be truthfully manufactured from Windows.
