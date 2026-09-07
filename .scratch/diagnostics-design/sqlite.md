# SQLite-backed diagnostics history candidate

## Problem

`DiagnosticsRuntime` retains one hour in memory (30s baseline, 1s while visible) and sends 120 averaged points. Process history drops exited processes; renderer reporting exists only while Diagnostics is mounted; the Resources chart duplicates CPU/I/O and has no RAM axis. The design must continuously retain seven days, preserve sampled maxima, and correlate a selected spike with historical processes/activity without exposing SQLite or unbounded payloads.

## Usage (caller's view)

Live cards keep the existing lease. A separate hook owns a fixed-ended historical window, pause/follow state, backward navigation, and selection.

```ts
const live = useDiagnosticsWorkspace({ tab: "resources", windowMinutes: 60 });
const history = useDiagnosticsResourceHistory(live.lease, {
  range: "24h",
  endAtMs: Date.now(), // fixed until Follow live is pressed
});

history.moveBackward();
await history.select({ kind: "bucket", bucketId });
await history.select({ kind: "incident", incidentId });
```

## Shape

Add these shared types; IDs are opaque UUIDs resolved only in main.

```ts
type HistoryRange = "1h" | "24h" | "7d";
type HistoryResolution = "raw" | "5m" | "30m";
interface HistoryQuery { leaseId: string; range: HistoryRange; endAtMs: number }
interface HistorySeries {
  range: HistoryRange; resolution: HistoryResolution;
  requested: { startAtMs: number; endAtMs: number };
  available: { oldestAtMs: number | null; newestAtMs: number | null };
  recorder: { kind: "ready" } | { kind: "degraded" | "unavailable"; reason: string };
  buckets: readonly HistoryBucket[]; // contract max 360
  incidents: readonly IncidentSummary[]; // max 32
  gaps: readonly CollectionGap[]; // includes retention/detail-shed gaps
}
interface HistoryBucket {
  bucketId: string; startedAtMs: number; endedAtMs: number;
  averageCpuPercent: number; maximumCpuPercent: number; maximumCpuAtMs: number;
  averageResidentBytes: number; maximumResidentBytes: number; maximumResidentAtMs: number;
  sampleCount: number; observedDurationMs: number; gapDurationMs: number;
}
type HistorySelection =
  | { kind: "bucket"; bucketId: string }
  | { kind: "incident"; incidentId: string };
interface HistoricalContributor {
  processInstanceId: string; displayName: string; category: ProcessCategory;
  firstObservedAtMs: number; lastObservedAtMs: number; exitedAtMs: number | null;
  averageCpuPercent: number; maximumCpuPercent: number; maximumCpuAtMs: number;
  firstResidentBytes: number; lastResidentBytes: number;
  maximumResidentBytes: number; maximumResidentAtMs: number;
}
interface HistoricalActivity {
  kind: "renderer" | "operation" | "warning";
  name: string; firstObservedAtMs: number; lastObservedAtMs: number;
  count: number; failures: number;
}
interface HistoryContext {
  selection: HistorySelection; bucket: HistoryBucket;
  contributors: readonly HistoricalContributor[]; // max 12
  activity: readonly HistoricalActivity[]; // max 12
  incident: IncidentSummary | null; detailComplete: boolean;
}
```

Add trusted channels `diagnostics:query-resource-history` and `diagnostics:query-resource-context` with Zod schemas:

```ts
queryResourceHistory(request: HistoryQuery): Promise<IpcReply<HistorySeries>>;
queryResourceContext(request: {
  leaseId: string; selection: HistorySelection;
}): Promise<IpcReply<HistoryContext>>;
```

The handler validates lease ownership. `DiagnosticsHistoryRecorder` is the only backend API:

```ts
interface DiagnosticsHistoryRecorder {
  start(instanceId: string, atMs: number): void;
  record(sample: RecordedResourceSample): void; // best-effort; cannot fail live sampling
  queryHistory(query: Omit<HistoryQuery, "leaseId">): HistorySeries;
  queryContext(selection: HistorySelection): HistoryContext | null;
  stop(atMs: number, clean: boolean): void;
}
```

Use dedicated `${userData}/diagnostics-history.sqlite`. Private tables are `runtime_instance`, `resource_raw`, `raw_contributor`, `resource_minute`, `minute_contributor`, `activity_minute`, `incident`, `incident_sample`, and `incident_contributor`. A minute row stores sums/count plus independent CPU/RAM maxima and their source timestamps. Later 5m/30m aggregation sums original minute sums and selects the winning stored maxima; it never peaks averaged values.

Fixed reads are: 1h raw grouped to at most 360 buckets, 24h as 288 five-minute buckets, and 7d as 336 thirty-minute buckets. `endAtMs` is explicit. Back/forward changes it by one range; live pushes never move a paused window.

The recorder keeps raw samples for 60 minutes (max 3,600), minute summaries for seven days (10,080), eight contributors/activity rows per minute, and 32 incidents. CPU >=80% for two visible samples or one baseline sample, RSS growth >=256 MiB/60s, collection gaps, and unclean exits create/coalesce incidents. Each preserves five minutes before/after, max 600 samples and 12 contributors/sample. Process identity is `instanceId + observationId`; exited processes remain queryable but omit `RecoveryEligibility`.

Startup marks any prior open runtime unclean, resumes its post-window against the new instance, and idempotently repairs open incidents. Clean stop marks the instance and captures complete. WAL commits preserve crash evidence. Corruption quarantines this disposable DB and recreates it; product data is unaffected.

Row caps plus a 64 MiB page budget shed oldest incident detail, then contributor/activity detail, never seven-day minute summaries. `auto_vacuum=INCREMENTAL` reclaims pages. Storage errors or writes over 20ms disable persistence for that process, update recorder status/dropped detail, and leave playback/live Diagnostics running.

Always-on renderer evidence moves to a lightweight reporter mounted in `App.tsx`: every 30s it records normalized route (no params/query), heap, DOM count, existing chat counter deltas, and small active-workload counters. It must not import playback/chat/download feature modules; producers update a tiny diagnostics activity registry. FPS/rAF reporting remains Diagnostics-visible. Store no messages, tokens, URLs, channel names, paths, or query strings. The UI labels activity as contemporaneous evidence, not causation.

Resources places CPU and RAM timelines first, with time labels, units, dual axes, keyboard-selectable buckets/incidents, and explicit gaps. Selection updates one inline contributor/activity panel with peaks, RAM growth, lifetimes, timestamps, coverage, and recorder failure state. Existing tabs remain unchanged.

## Module map

- New: `backend/diagnostics/diagnostics-history-{recorder,schema}.ts`, `frontend/features/settings/data/use-diagnostics-resource-history.ts`, lightweight `renderer-activity-reporter.ts` and `diagnostics-activity-registry.ts`.
- Wire: runtime, singleton, observability, diagnostics handlers, preload, shared types/channels/contracts, `frontend/App.tsx`, and `DiagnosticsWorkspace.tsx`/chart helper.
- Test: real temp SQLite across eight accelerated days (short peaks, gradual RAM growth, exited processes, gaps, eviction, reopen, budget failure); contracts; paused navigation/selection. Do not claim a real seven-day soak.

## Synthesis decision and rationale

This bounded candidate uses on-demand reads so five-second live pushes never serialize seven days. A dedicated DB isolates disposable retention/corruption from product state and keeps `DatabaseService` ignorant of sampling policy. The recorder surface hides schema, tiering, incident assembly, crash repair, caps, and row parsing; rows never cross IPC.

Alternatives rejected: expanding `DiagnosticsSnapshot` exposes resolution and repeated large payloads; adding churn tables to `streamfusion.db` couples diagnostics failure policy to product persistence; minute-only storage cannot provide incident pre/post or contributors. We accept top-N attribution and fixed thresholds for a predictable disk ceiling and explainable behavior.

## Next implementation step

Build schema/recorder tests first, proving retention, true peak preservation, exited-process identity, crash reopen, incident pre/post, and budget shedding before IPC/UI wiring.
