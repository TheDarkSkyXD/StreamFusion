export type DiagnosticPlatform = "win32" | "darwin" | "linux" | "other";

export type DiagnosticSource =
  | "electron-processes"
  | "process-io"
  | "host-power"
  | "collector"
  | "trace-store"
  | "logical-io"
  | "renderer-performance"
  | "diagnostic-logs"
  | "diagnostic-reports";

export type DiagnosticCapability =
  | "process-io"
  | "process-ancestry"
  | "process-signals"
  | "power-source"
  | "low-power-mode"
  | "thermal-state"
  | "cpu-speed-limit"
  | "renderer-memory";

export type DiagnosticSourceStatus =
  | { readonly kind: "ready"; readonly observedAtMs: number }
  | {
      readonly kind: "stale";
      readonly observedAtMs: number;
      readonly staleSinceMs: number;
      readonly reason: "suspended" | "missed-deadline" | "partial-scan";
    }
  | {
      readonly kind: "unavailable";
      readonly sinceMs: number;
      readonly reason: "collector-error" | "permission-denied" | "process-exited" | "corrupt-data";
      readonly retry: "automatic" | "manual";
    }
  | {
      readonly kind: "unsupported";
      readonly platform: DiagnosticPlatform;
      readonly capability: DiagnosticCapability;
    };

export type DiagnosticValue<T> =
  | {
      readonly status: Extract<DiagnosticSourceStatus, { kind: "ready" }>;
      readonly source: DiagnosticSource;
      readonly value: T;
    }
  | {
      readonly status: Extract<DiagnosticSourceStatus, { kind: "stale" }>;
      readonly source: DiagnosticSource;
      readonly value: T;
    }
  | {
      readonly status: Extract<DiagnosticSourceStatus, { kind: "unavailable" | "unsupported" }>;
      readonly source: DiagnosticSource;
    };

export type DiagnosticsTab =
  | "overview"
  | "resources"
  | "processes"
  | "io"
  | "traces"
  | "failures"
  | "logs-reports"
  | "developer-tools";

export type DiagnosticsWindowMinutes = 5 | 15 | 30 | 60;

export type DiagnosticsHistoryResolution =
  "1s" | "raw" | "minute" | "hour" | "5m" | "30m" | "2h" | "8h";

interface DiagnosticsHistoryRangePresetShape {
  readonly id: string;
  readonly label: string;
  readonly durationMs: number;
  readonly bucketMs: number;
  readonly resolution: DiagnosticsHistoryResolution;
  readonly publishIntervalMs: number;
}

export const HISTORY_RANGE_PRESETS = [
  {
    id: "realtime",
    label: "Real time",
    durationMs: 5 * 60_000,
    bucketMs: 1_000,
    resolution: "1s",
    publishIntervalMs: 1_000,
  },
  {
    id: "5m",
    label: "5 minutes",
    durationMs: 5 * 60_000,
    bucketMs: 10_000,
    resolution: "raw",
    publishIntervalMs: 5_000,
  },
  {
    id: "30m",
    label: "30 minutes",
    durationMs: 30 * 60_000,
    bucketMs: 10_000,
    resolution: "raw",
    publishIntervalMs: 5_000,
  },
  {
    id: "1h",
    label: "1 hour",
    durationMs: 60 * 60_000,
    bucketMs: 10_000,
    resolution: "raw",
    publishIntervalMs: 5_000,
  },
  {
    id: "24h",
    label: "24 hours",
    durationMs: 24 * 60 * 60_000,
    bucketMs: 5 * 60_000,
    resolution: "5m",
    publishIntervalMs: 5_000,
  },
  {
    id: "7d",
    label: "7 days",
    durationMs: 7 * 24 * 60 * 60_000,
    bucketMs: 30 * 60_000,
    resolution: "30m",
    publishIntervalMs: 5_000,
  },
  {
    id: "30d",
    label: "30 days",
    durationMs: 30 * 24 * 60 * 60_000,
    bucketMs: 2 * 60 * 60_000,
    resolution: "2h",
    publishIntervalMs: 5_000,
  },
  {
    id: "90d",
    label: "90 days",
    durationMs: 90 * 24 * 60 * 60_000,
    bucketMs: 8 * 60 * 60_000,
    resolution: "8h",
    publishIntervalMs: 5_000,
  },
] as const satisfies readonly DiagnosticsHistoryRangePresetShape[];

export type DiagnosticsHistoryRange = (typeof HISTORY_RANGE_PRESETS)[number]["id"];
export type DiagnosticsHistoryRangePreset = (typeof HISTORY_RANGE_PRESETS)[number];

export function historyRangePreset(range: DiagnosticsHistoryRange): DiagnosticsHistoryRangePreset {
  const preset = HISTORY_RANGE_PRESETS.find((candidate) => candidate.id === range);
  if (!preset) throw new Error(`Unknown diagnostics history range: ${range}`);
  return preset;
}

export interface DiagnosticsView {
  readonly tab: DiagnosticsTab;
  readonly windowMinutes: DiagnosticsWindowMinutes;
  readonly resourceHistoryRange?: DiagnosticsHistoryRange;
}

export interface SystemFootprint {
  readonly cpuPercent: DiagnosticValue<number>;
  readonly residentMemoryBytes: DiagnosticValue<number>;
  readonly processCount: DiagnosticValue<number>;
  readonly readBytesPerSecond: DiagnosticValue<number>;
  readonly writeBytesPerSecond: DiagnosticValue<number>;
  readonly cpuSpeedLimitPercent: DiagnosticValue<number>;
  readonly collectionDurationMs: DiagnosticValue<number>;
  readonly collectorCpuPercent: DiagnosticValue<number>;
  readonly collectorResidentBytes: DiagnosticValue<number>;
}

export interface HostState {
  readonly powerSource: DiagnosticValue<"battery" | "external">;
  readonly lowPowerMode: DiagnosticValue<boolean>;
  readonly idleSeconds: DiagnosticValue<number>;
  readonly sessionState: DiagnosticValue<"active" | "idle" | "locked" | "unknown">;
  readonly thermalState: DiagnosticValue<"nominal" | "fair" | "serious" | "critical">;
}

export interface CollectionState {
  readonly sampleIntervalMs: number;
  readonly retainedSamples: number;
  readonly processScanCount: number;
  readonly processStarts: number;
  readonly processExits: number;
  readonly inaccessibleProcessCount: number;
  readonly restartCount: number;
  readonly droppedDetailCount: number;
}

export interface ResourcePoint {
  readonly observedAtMs: number;
  readonly cpuPercent: number;
  readonly residentMemoryBytes: number;
  readonly processCount: number;
  readonly readBytesPerSecond: number | null;
  readonly writeBytesPerSecond: number | null;
}

export interface CollectionGap {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly cause: "suspend" | "clock-jump" | "source-failure" | "budget-shed" | "app-closed";
  readonly sources: readonly DiagnosticSource[];
}

export type ProcessCategory = "main" | "renderer" | "gpu" | "utility" | "managed-runtime" | "other";

export type RecoveryEligibility =
  | { readonly kind: "eligible"; readonly token: string; readonly expiresAtMs: number }
  | {
      readonly kind: "ineligible";
      readonly reason: "main-process" | "ancestry-unproven" | "identity-unavailable";
    }
  | { readonly kind: "unsupported"; readonly capability: "process-signals" };

export interface ProcessObservation {
  readonly observationId: string;
  readonly observedAtMs: number;
  readonly pid: number;
  readonly startedAtMs: number;
  readonly parentPid: number | null;
  readonly category: ProcessCategory;
  readonly displayName: string;
  readonly currentCpuPercent: number;
  readonly averageCpuPercent: number;
  readonly peakCpuPercent: number;
  readonly cumulativeCpuMs: number | null;
  readonly residentBytes: number;
  readonly peakResidentBytes: number;
  readonly readBytesPerSecond: number | null;
  readonly writeBytesPerSecond: number | null;
  readonly readTotalBytes: number | null;
  readonly writeTotalBytes: number | null;
  readonly samples: number;
  readonly interrupt: RecoveryEligibility;
  readonly force: RecoveryEligibility;
}

export interface LogicalIoObservation {
  readonly component: string;
  readonly operation: string;
  readonly logicalReadBytes: number;
  readonly logicalWriteBytes: number;
  readonly count: number;
  readonly durationMs: number;
}

export interface TraceSpanObservation {
  readonly spanId: string;
  readonly traceId: string;
  readonly name: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number;
  readonly outcome: "ok" | "error";
  readonly message?: string;
}

export interface DiagnosticLogObservation {
  readonly observedAtMs: number;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly source: string;
  readonly message: string;
  readonly traceId?: string;
}

export interface SpanNameSummary {
  readonly name: string;
  readonly count: number;
  readonly failures: number;
  readonly averageDurationMs: number;
  readonly maxDurationMs: number;
}

export interface DiagnosticFailure {
  readonly failureId: string;
  readonly fingerprint: string;
  readonly source: string;
  readonly cause: string;
  readonly observedAtMs: number;
  readonly durationMs: number | null;
  readonly count: number;
  readonly traceId?: string;
}

export interface RendererPerformanceSummary {
  readonly observedAtMs: number;
  readonly heapUsedBytes: number | null;
  readonly heapTotalBytes: number | null;
  readonly framesPerSecond: number;
  readonly averageFrameTimeMs: number;
  readonly liveIntervalCount: number;
  readonly renderCount: number;
  readonly chatStoreCallsPerSecond: number;
}

/** Renderer-safe, always-on evidence. Values are counters or normalized labels only. */
export interface DiagnosticsActivityReport {
  readonly observedAtMs: number;
  readonly route: string;
  readonly heapUsedBytes: number | null;
  readonly domNodeCount: number;
  readonly chatEvents: number;
  readonly activeStreamSlots: number;
  readonly activeVideoElements: number;
}

export interface DiagnosticsHistoryQuery {
  readonly leaseId: string;
  readonly range: DiagnosticsHistoryRange;
  readonly endAtMs: number;
}

export interface DiagnosticsHistoryBucket {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly averageCpuPercent: number;
  readonly maximumCpuPercent: number;
  readonly maximumCpuAtMs: number;
  readonly averageResidentBytes: number;
  readonly maximumResidentBytes: number;
  readonly maximumResidentAtMs: number;
  readonly sampleCount: number;
  readonly observedDurationMs: number;
  readonly gapDurationMs: number;
}

export interface DiagnosticsHistoryIncident {
  readonly incidentId: string;
  readonly kind: "cpu-spike" | "memory-growth" | "collection-gap" | "unclean-exit";
  readonly observedAtMs: number;
  readonly label: string;
}

export interface DiagnosticsHistorySeries {
  readonly range: DiagnosticsHistoryRange;
  readonly resolution: DiagnosticsHistoryResolution;
  readonly requested: { readonly startAtMs: number; readonly endAtMs: number };
  readonly available: { readonly oldestAtMs: number | null; readonly newestAtMs: number | null };
  readonly recorder:
    | {
        readonly kind: "ready";
        readonly lastFailureAtMs: null;
        readonly rawRetentionMs: number;
        readonly summaryRetentionMs: number;
        readonly samplingIntervalMs: number;
        readonly databaseBytes: number;
      }
    | {
        readonly kind: "degraded" | "unavailable";
        readonly reason: string;
        readonly lastFailureAtMs: number | null;
        readonly rawRetentionMs: number;
        readonly summaryRetentionMs: number;
        readonly samplingIntervalMs: number;
        readonly databaseBytes: number;
      };
  readonly buckets: readonly DiagnosticsHistoryBucket[];
  readonly incidents: readonly DiagnosticsHistoryIncident[];
  readonly gaps: readonly CollectionGap[];
}

export type DiagnosticsHistorySelection =
  | { readonly kind: "bucket"; readonly startedAtMs: number; readonly endedAtMs: number }
  | { readonly kind: "incident"; readonly incidentId: string };

export interface DiagnosticsHistoricalContributor {
  readonly observationId: string;
  readonly displayName: string;
  readonly category: ProcessCategory;
  readonly pid: number;
  readonly startedAtMs: number;
  readonly firstObservedAtMs: number;
  readonly lastObservedAtMs: number;
  readonly exitedAtMs: number | null;
  readonly averageCpuPercent: number;
  readonly maximumCpuPercent: number;
  readonly maximumCpuAtMs: number;
  readonly firstResidentBytes: number;
  readonly lastResidentBytes: number;
  readonly maximumResidentBytes: number;
  readonly maximumResidentAtMs: number;
}

export interface DiagnosticsHistoricalActivity {
  readonly kind: "renderer" | "operation" | "warning";
  readonly name: string;
  readonly firstObservedAtMs: number;
  readonly lastObservedAtMs: number;
  readonly count: number;
  readonly failures: number;
}

export interface DiagnosticsHistoricalRendererEvidence {
  readonly route: string;
  readonly heapUsedBytes: number | null;
  readonly domNodeCount: number;
  readonly chatEvents: number;
  readonly activeStreamSlots: number;
  readonly activeVideoElements: number;
  readonly observedAtMs: number;
}

export interface DiagnosticsHistoryContext {
  readonly selection: DiagnosticsHistorySelection;
  readonly bucket: DiagnosticsHistoryBucket;
  readonly samples: readonly DiagnosticsHistoryBucket[];
  readonly detailResolution: "raw" | "minute" | "hour";
  readonly contributors: readonly DiagnosticsHistoricalContributor[];
  readonly activity: readonly DiagnosticsHistoricalActivity[];
  readonly renderer: DiagnosticsHistoricalRendererEvidence | null;
  readonly incident: DiagnosticsHistoryIncident | null;
  readonly detailComplete: boolean;
}

export interface DiagnosticsOverview {
  readonly footprint: SystemFootprint;
  readonly host: HostState;
  readonly collection: CollectionState;
  readonly latestFailures: readonly DiagnosticFailure[];
}

export type DiagnosticsDetail =
  | {
      readonly tab: "overview";
    }
  | {
      readonly tab: "resources";
      readonly history: readonly ResourcePoint[];
      readonly gaps: readonly CollectionGap[];
      readonly processes: readonly ProcessObservation[];
    }
  | {
      readonly tab: "processes";
      readonly history: readonly ResourcePoint[];
      readonly processes: readonly ProcessObservation[];
    }
  | {
      readonly tab: "io";
      readonly rows: readonly LogicalIoObservation[];
    }
  | {
      readonly tab: "traces";
      readonly spans: readonly TraceSpanObservation[];
      readonly logs: readonly DiagnosticLogObservation[];
      readonly topNames: readonly SpanNameSummary[];
      readonly latestFailures: readonly DiagnosticFailure[];
      readonly commonFailures: readonly DiagnosticFailure[];
    }
  | {
      readonly tab: "failures";
      readonly latest: readonly DiagnosticFailure[];
      readonly common: readonly DiagnosticFailure[];
    }
  | {
      readonly tab: "logs-reports";
    }
  | {
      readonly tab: "developer-tools";
      readonly renderer: DiagnosticValue<RendererPerformanceSummary>;
    };

export interface DiagnosticsSnapshot {
  readonly schemaVersion: 1;
  readonly instanceId: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly view: DiagnosticsView;
  readonly sourceStatuses: Readonly<Record<DiagnosticSource, DiagnosticSourceStatus>>;
  readonly overview: DiagnosticsOverview;
  readonly detail: DiagnosticsDetail;
}

export interface DiagnosticsLeaseOpened {
  readonly leaseId: string;
  readonly snapshot: DiagnosticsSnapshot;
}

export interface DiagnosticsSnapshotChanged {
  readonly leaseId: string;
  readonly snapshot: DiagnosticsSnapshot;
}
