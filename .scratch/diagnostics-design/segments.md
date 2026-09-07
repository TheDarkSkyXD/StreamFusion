# Diagnostics seven-day retention: segmented recorder candidate

## Problem

Diagnostics currently exposes a live `DiagnosticsSnapshot` built by `apps/desktop/src/backend/diagnostics/diagnostics-runtime.ts`. It keeps roughly one hour of in-memory `ResourcePoint` history, compacts transport history to 120 points, and only attributes CPU/RAM to current Electron process rows. The renderer reporter in `apps/desktop/src/frontend/features/settings/data/diagnostics/renderer-diagnostics-reporter.ts` only reports Diagnostics page counters, so a historical spike cannot yet answer what route, stream slot, trace activity, or process category was active. The new requirement is seven-day CPU/RAM history with selectable spikes showing contributors and activity directly on the Diagnostics page, with no export flow.

## Usage

`DiagnosticsRuntime` keeps collecting the live sample as it does today, then passes each committed sample to a bounded recorder. Snapshot leases stay live and small; historical charts are fetched through explicit range queries when the Resources tab asks for them.

```ts
const recorder = await createDiagnosticsHistoryRecorder({
  rootDir: diagnosticsDir,
  nowMs: Date.now,
  logger,
});

runtime.onCommittedSample((sample) => {
  recorder.recordResourceSample({
    instanceId,
    observedAtMs: sample.observedAtMs,
    resource: sample.point,
    processes: sample.processes,
    renderer: latestRendererPerformance,
    activity: observability.snapshotForAttribution(sample.observedAtMs),
    gaps: newGaps,
  });
});
```

The IPC handler exposes a read-only range query and a read-only bucket detail query. The renderer first requests `range: "7d"` summaries, then requests one bucket's detail when the user selects a visible spike.

```ts
await window.electronAPI.diagnostics.getHistory({
  range: "7d",
  bucketMs: 60_000,
});

await window.electronAPI.diagnostics.getHistoryBucket({
  bucketStartedAtMs,
  bucketMs: 60_000,
});
```

`DiagnosticsWorkspace.tsx` replaces the live-only `ResourceChart` on the Resources tab with a fixed-range resource timeline. Bars show CPU peak and RAM peak on separate axes. Selecting a spike pins a detail panel below the chart with top process contributors and top activity names for that minute.

## Shape

Use an append-only segmented disk recorder in `apps/desktop/src/backend/diagnostics/diagnostics-history-recorder.ts`, plus pure bucket reducers in `diagnostics-history-model.ts`. Segments are daily NDJSON files under a main-owned diagnostics directory, for example `diagnostics/resources-2026-09-05.ndjson`. Each line is a canonical minute summary, not every one-second sample. The runtime keeps one-hour raw samples in memory for live views and flushes minute summaries to disk for seven-day history.

```ts
export type DiagnosticsHistoryRange = "1h" | "6h" | "24h" | "7d";

export interface DiagnosticsMinuteSummary {
  readonly schemaVersion: 1;
  readonly instanceId: string;
  readonly bucketStartedAtMs: number;
  readonly bucketEndedAtMs: number;
  readonly sampleCount: number;
  readonly cpu: { readonly avgPercent: number; readonly maxPercent: number };
  readonly memory: { readonly avgResidentBytes: number; readonly maxResidentBytes: number };
  readonly processCount: { readonly max: number };
  readonly contributors: readonly ResourceContributorSummary[];
  readonly activity: readonly DiagnosticsActivitySummary[];
  readonly incidents: readonly DiagnosticsIncidentSummary[];
  readonly gaps: readonly CollectionGap[];
}

export interface ResourceContributorSummary {
  readonly subjectId: string;
  readonly label: string;
  readonly kind: "main" | "renderer" | "gpu" | "utility" | "managed-runtime" | "other";
  readonly maxCpuPercent: number;
  readonly maxResidentBytes: number;
  readonly samples: number;
}

export interface DiagnosticsActivitySummary {
  readonly name: string;
  readonly kind: "trace-span" | "log-source" | "renderer-workload";
  readonly count: number;
  readonly failures: number;
  readonly maxDurationMs: number;
}

export interface DiagnosticsIncidentSummary {
  readonly kind: "cpu-spike" | "memory-spike" | "collector-gap" | "process-churn";
  readonly observedAtMs: number;
  readonly severity: "notice" | "warning";
  readonly label: string;
}
```

The recorder public surface stays small.

```ts
export interface DiagnosticsHistoryRecorder {
  recordResourceSample(input: ResourceSampleForHistory): void;
  queryHistory(input: DiagnosticsHistoryQuery): Promise<DiagnosticsHistoryResult>;
  queryBucket(input: DiagnosticsHistoryBucketQuery): Promise<DiagnosticsHistoryBucketDetail>;
  close(): Promise<void>;
}
```

`recordResourceSample` updates the active minute accumulator synchronously in memory, then appends completed minute summaries through a single promise queue. Writes are best-effort and non-blocking for sampling. On startup, the recorder reads only the current day segment tail enough to resume the current minute, then prunes segments older than seven days. Corrupt lines are skipped, counted as dropped detail, and surfaced through `CollectionState.droppedDetailCount`.

Minute summaries preserve maxima: CPU max, RAM max, per-contributor max CPU, per-contributor max RAM, process-count max, and max activity duration. A selected spike therefore shows the contributors that actually peaked in that minute instead of an average-only ranking.

Crash/restart behavior is intentionally capped. If the app crashes before a minute closes, at most the active minute is lost. On restart, the next writer starts a new daily segment line stream and never rewrites older lines. Query code de-duplicates by `{ instanceId, bucketStartedAtMs }`, keeps the newest complete line if repeated, caps returned buckets to 10,080 for seven days at one-minute resolution, and caps selected-bucket detail to top 12 contributors, top 12 activities, and 20 incidents.

Fixed ranges belong in shared types and Zod contracts:

```ts
export type DiagnosticsHistoryRange = "1h" | "6h" | "24h" | "7d";

export interface DiagnosticsHistoryQuery {
  readonly range: DiagnosticsHistoryRange;
  readonly bucketMs: 60_000 | 300_000 | 900_000;
}

export interface DiagnosticsHistoryResult {
  readonly observedAtMs: number;
  readonly range: DiagnosticsHistoryRange;
  readonly bucketMs: number;
  readonly buckets: readonly DiagnosticsHistoryBucket[];
  readonly sourceStatus: DiagnosticSourceStatus;
}

export interface DiagnosticsHistoryBucket {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly avgCpuPercent: number;
  readonly maxCpuPercent: number;
  readonly avgResidentBytes: number;
  readonly maxResidentBytes: number;
  readonly contributorCount: number;
  readonly activityCount: number;
  readonly incidentCount: number;
}
```

Integration files:

- `apps/desktop/src/shared/diagnostics-types.ts`: add history query/result/bucket/detail types and add `"diagnostics-history"` to `DiagnosticSource`.
- `apps/desktop/src/shared/ipc-channels.ts`: add `DIAGNOSTICS_GET_HISTORY` and `DIAGNOSTICS_GET_HISTORY_BUCKET`.
- `apps/desktop/src/shared/ipc-contracts/diagnostics-contracts.ts`: add strict Zod schemas with max 10,080 buckets and selected-detail caps.
- `apps/desktop/src/backend/diagnostics/diagnostics-history-model.ts`: pure reducers for raw samples to minute summaries and display buckets.
- `apps/desktop/src/backend/diagnostics/diagnostics-history-recorder.ts`: segmented append-only persistence, pruning, query, corrupt-line accounting.
- `apps/desktop/src/backend/diagnostics/diagnostics-runtime.ts`: call recorder after `#collect()` commits a sample; expose `queryHistory`/`queryHistoryBucket`; keep current snapshot shape small.
- `apps/desktop/src/backend/ipc/handlers/diagnostics-handlers.ts`: register the two read-only queries through `TrustedIpcRegistry`.
- `apps/desktop/src/backend/preload/index.ts`: expose `diagnostics.getHistory` and `diagnostics.getHistoryBucket`.
- `apps/desktop/src/frontend/features/settings/data/use-diagnostics-history.ts`: fetch fixed ranges independently from the lease.
- `apps/desktop/src/frontend/pages/Settings/diagnostics/DiagnosticsWorkspace.tsx`: add range control `1h | 6h | 24h | 7d`, CPU/RAM timeline, and selected spike detail panel.

## Synthesis decision

This candidate uses segmented append-only files as the base because it matches the current diagnostics style: bounded in-memory live state, immutable local evidence, strict IPC DTOs, and best-effort persistence that must not block app startup or sampling. The SQLite alternative is rejected for the first pass because Diagnostics needs time-ordered append/read and seven-day pruning, not relational joins or user-authored reports.

## Tradeoffs accepted

- We accept one-minute historical resolution in exchange for small seven-day payloads and predictable disk growth.
- We accept losing the current open minute on crash in exchange for no rewrite-on-sample path and no database transaction dependency in the collector.
- We accept top-N contributor/activity summaries in exchange for renderer-safe payloads and stable selected-spike detail.
- We accept a separate history query instead of embedding seven days in `DiagnosticsSnapshot` in exchange for keeping live lease updates cheap.

## Alternatives considered

- SQLite table with indexed samples and contributors: hides pruning and range queries well, but exposes migration/versioning, native dependency behavior, and transaction latency to a feature that only needs append and bounded scans.
- Extend `DiagnosticsSnapshot.detail.resources.history` to seven days: smallest API change, but it bloats the lease, fights the existing 120-point transport cap, and ties expensive history reads to five-second live publishing.
- Persist raw one-second samples for seven days: best forensic detail, but around 604,800 app-level samples plus process rows per week is unnecessary for visual spike selection and raises disk/corruption cost.

## Open questions and risks

- Which non-Diagnostics renderer workloads should report attribution first: route transitions, stream slots, chat store batches, or player lifecycle events?
- Should the seven-day chart show gaps as explicit empty spans or as incident markers over an otherwise continuous axis?
- Does the app already have a preferred diagnostics directory separate from logs, or should history live beside trace persistence under the current logs directory?

## Next implementation step

Add the shared history DTOs and pure `diagnostics-history-model.ts` reducer tests first, then wire the recorder into `DiagnosticsRuntime` once the minute-summary invariants are locked.
