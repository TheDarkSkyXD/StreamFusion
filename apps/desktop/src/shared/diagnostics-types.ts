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

export interface DiagnosticsView {
  readonly tab: DiagnosticsTab;
  readonly windowMinutes: DiagnosticsWindowMinutes;
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
  readonly cause: "suspend" | "clock-jump" | "source-failure" | "budget-shed";
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
