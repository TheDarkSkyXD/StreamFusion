import { z } from "zod";

// The renderer uses a strict Content Security Policy that forbids generated
// functions. Keep schema validation on Zod's interpreter path in preload.
z.config({ jitless: true });

import { ipcReplySchema } from "./reliability-contracts";
import { IPC_CHANNELS } from "../ipc-channels";
import { HISTORY_RANGE_PRESETS } from "../diagnostics-types";
import type {
  DiagnosticFailure,
  DiagnosticLogObservation,
  DiagnosticValue,
  DiagnosticsLeaseOpened,
  DiagnosticsActivityReport,
  DiagnosticsHistoryContext,
  DiagnosticsHistoryRange,
  DiagnosticsHistorySeries,
  DiagnosticsSnapshot,
  DiagnosticsSnapshotChanged,
  DiagnosticsView,
  LogicalIoObservation,
  ProcessObservation,
  RendererPerformanceSummary,
  ResourcePoint,
  SpanNameSummary,
  TraceSpanObservation,
} from "../diagnostics-types";

const finiteNonnegative = z.number().finite().nonnegative();
const timestampMs = finiteNonnegative;
const boundedText = z.string().max(512);
const opaqueId = z.string().uuid();

const diagnosticPlatformSchema = z.enum(["win32", "darwin", "linux", "other"]);
const diagnosticCapabilitySchema = z.enum([
  "process-io",
  "process-ancestry",
  "process-signals",
  "power-source",
  "low-power-mode",
  "thermal-state",
  "cpu-speed-limit",
  "renderer-memory",
]);
const diagnosticSourceSchema = z.enum([
  "electron-processes",
  "process-io",
  "host-power",
  "collector",
  "trace-store",
  "logical-io",
  "renderer-performance",
  "diagnostic-logs",
  "diagnostic-reports",
]);

const readyStatusSchema = z
  .object({ kind: z.literal("ready"), observedAtMs: timestampMs })
  .strict();
const staleStatusSchema = z
  .object({
    kind: z.literal("stale"),
    observedAtMs: timestampMs,
    staleSinceMs: timestampMs,
    reason: z.enum(["suspended", "missed-deadline", "partial-scan"]),
  })
  .strict();
const unavailableStatusSchema = z
  .object({
    kind: z.literal("unavailable"),
    sinceMs: timestampMs,
    reason: z.enum(["collector-error", "permission-denied", "process-exited", "corrupt-data"]),
    retry: z.enum(["automatic", "manual"]),
  })
  .strict();
const unsupportedStatusSchema = z
  .object({
    kind: z.literal("unsupported"),
    platform: diagnosticPlatformSchema,
    capability: diagnosticCapabilitySchema,
  })
  .strict();

export const diagnosticSourceStatusSchema = z.discriminatedUnion("kind", [
  readyStatusSchema,
  staleStatusSchema,
  unavailableStatusSchema,
  unsupportedStatusSchema,
]);

function diagnosticValueSchema<T>(value: z.ZodType<T>): z.ZodType<DiagnosticValue<T>> {
  return z.union([
    z.object({ source: diagnosticSourceSchema, status: readyStatusSchema, value }).strict(),
    z.object({ source: diagnosticSourceSchema, status: staleStatusSchema, value }).strict(),
    z.object({ source: diagnosticSourceSchema, status: unavailableStatusSchema }).strict(),
    z.object({ source: diagnosticSourceSchema, status: unsupportedStatusSchema }).strict(),
  ]) as z.ZodType<DiagnosticValue<T>>;
}

const diagnosticsViewSchema = z
  .object({
    tab: z.enum([
      "overview",
      "resources",
      "processes",
      "io",
      "traces",
      "failures",
      "logs-reports",
      "developer-tools",
    ]),
    windowMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
    resourceHistoryRange: z
      .string()
      .refine((range): range is DiagnosticsHistoryRange =>
        HISTORY_RANGE_PRESETS.some((preset) => preset.id === range)
      )
      .optional(),
  })
  .strict() satisfies z.ZodType<DiagnosticsView>;

const recoveryEligibilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("eligible"), token: opaqueId, expiresAtMs: timestampMs }).strict(),
  z
    .object({
      kind: z.literal("ineligible"),
      reason: z.enum(["main-process", "ancestry-unproven", "identity-unavailable"]),
    })
    .strict(),
  z.object({ kind: z.literal("unsupported"), capability: z.literal("process-signals") }).strict(),
]);

const processObservationSchema = z
  .object({
    observationId: opaqueId,
    observedAtMs: timestampMs,
    pid: z.number().int().positive(),
    startedAtMs: timestampMs,
    parentPid: z.number().int().positive().nullable(),
    category: z.enum(["main", "renderer", "gpu", "utility", "managed-runtime", "other"]),
    displayName: z.string().min(1).max(96),
    currentCpuPercent: finiteNonnegative,
    averageCpuPercent: finiteNonnegative,
    peakCpuPercent: finiteNonnegative,
    cumulativeCpuMs: finiteNonnegative.nullable(),
    residentBytes: finiteNonnegative,
    peakResidentBytes: finiteNonnegative,
    readBytesPerSecond: finiteNonnegative.nullable(),
    writeBytesPerSecond: finiteNonnegative.nullable(),
    readTotalBytes: finiteNonnegative.nullable(),
    writeTotalBytes: finiteNonnegative.nullable(),
    samples: z.number().int().nonnegative(),
    interrupt: recoveryEligibilitySchema,
    force: recoveryEligibilitySchema,
  })
  .strict() satisfies z.ZodType<ProcessObservation>;

const resourcePointSchema = z
  .object({
    observedAtMs: timestampMs,
    cpuPercent: finiteNonnegative,
    residentMemoryBytes: finiteNonnegative,
    processCount: z.number().int().nonnegative(),
    readBytesPerSecond: finiteNonnegative.nullable(),
    writeBytesPerSecond: finiteNonnegative.nullable(),
  })
  .strict() satisfies z.ZodType<ResourcePoint>;

const logicalIoObservationSchema = z
  .object({
    component: boundedText,
    operation: boundedText,
    logicalReadBytes: finiteNonnegative,
    logicalWriteBytes: finiteNonnegative,
    count: z.number().int().nonnegative(),
    durationMs: finiteNonnegative,
  })
  .strict() satisfies z.ZodType<LogicalIoObservation>;

const traceSpanObservationSchema = z
  .object({
    spanId: opaqueId,
    traceId: opaqueId,
    name: boundedText,
    startedAtMs: timestampMs,
    endedAtMs: timestampMs,
    durationMs: finiteNonnegative,
    outcome: z.enum(["ok", "error"]),
    message: boundedText.optional(),
  })
  .strict() satisfies z.ZodType<TraceSpanObservation>;

const diagnosticLogObservationSchema = z
  .object({
    observedAtMs: timestampMs,
    level: z.enum(["debug", "info", "warn", "error"]),
    source: boundedText,
    message: boundedText,
    traceId: opaqueId.optional(),
  })
  .strict() satisfies z.ZodType<DiagnosticLogObservation>;

const spanNameSummarySchema = z
  .object({
    name: boundedText,
    count: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    averageDurationMs: finiteNonnegative,
    maxDurationMs: finiteNonnegative,
  })
  .strict() satisfies z.ZodType<SpanNameSummary>;

const diagnosticFailureSchema = z
  .object({
    failureId: opaqueId,
    fingerprint: z.string().min(1).max(128),
    source: boundedText,
    cause: boundedText,
    observedAtMs: timestampMs,
    durationMs: finiteNonnegative.nullable(),
    count: z.number().int().positive(),
    traceId: opaqueId.optional(),
  })
  .strict() satisfies z.ZodType<DiagnosticFailure>;

const rendererPerformanceSummarySchema = z
  .object({
    observedAtMs: timestampMs,
    heapUsedBytes: finiteNonnegative.nullable(),
    heapTotalBytes: finiteNonnegative.nullable(),
    framesPerSecond: finiteNonnegative,
    averageFrameTimeMs: finiteNonnegative,
    liveIntervalCount: z.number().int().nonnegative(),
    renderCount: z.number().int().nonnegative(),
    chatStoreCallsPerSecond: finiteNonnegative,
  })
  .strict() satisfies z.ZodType<RendererPerformanceSummary>;

const diagnosticsActivityReportSchema = z
  .object({
    observedAtMs: timestampMs,
    route: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_-]*$/)
      .max(160),
    heapUsedBytes: finiteNonnegative.nullable(),
    domNodeCount: z.number().int().nonnegative(),
    chatEvents: z.number().int().nonnegative(),
    activeStreamSlots: z.number().int().nonnegative(),
    activeVideoElements: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<DiagnosticsActivityReport>;

const historyRangeSchema = z
  .string()
  .refine((range): range is DiagnosticsHistoryRange =>
    HISTORY_RANGE_PRESETS.some((preset) => preset.id === range)
  );
const historyTimestampMs = z.number().int().safe().nonnegative();
const historySelectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("bucket"),
      startedAtMs: historyTimestampMs,
      endedAtMs: historyTimestampMs,
    })
    .strict()
    .refine(
      (selection) =>
        selection.endedAtMs > selection.startedAtMs &&
        selection.endedAtMs - selection.startedAtMs <= 7 * 24 * 60 * 60_000
    ),
  z.object({ kind: z.literal("incident"), incidentId: z.string().min(1).max(128) }).strict(),
]);
const historyBucketSchema = z
  .object({
    startedAtMs: timestampMs,
    endedAtMs: timestampMs,
    averageCpuPercent: finiteNonnegative,
    maximumCpuPercent: finiteNonnegative,
    maximumCpuAtMs: timestampMs,
    averageResidentBytes: finiteNonnegative,
    maximumResidentBytes: finiteNonnegative,
    maximumResidentAtMs: timestampMs,
    sampleCount: z.number().int().nonnegative(),
    observedDurationMs: finiteNonnegative,
    gapDurationMs: finiteNonnegative,
  })
  .strict();
const historyIncidentSchema = z
  .object({
    incidentId: z.string().min(1).max(128),
    kind: z.enum(["cpu-spike", "memory-growth", "collection-gap", "unclean-exit"]),
    observedAtMs: timestampMs,
    label: boundedText,
  })
  .strict();
const historyRecorderSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ready"),
      lastFailureAtMs: z.null(),
      rawRetentionMs: finiteNonnegative,
      summaryRetentionMs: finiteNonnegative,
      samplingIntervalMs: finiteNonnegative,
      databaseBytes: finiteNonnegative,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["degraded", "unavailable"]),
      reason: boundedText,
      lastFailureAtMs: timestampMs.nullable(),
      rawRetentionMs: finiteNonnegative,
      summaryRetentionMs: finiteNonnegative,
      samplingIntervalMs: finiteNonnegative,
      databaseBytes: finiteNonnegative,
    })
    .strict(),
]);
const historySeriesSchema = z
  .object({
    range: historyRangeSchema,
    resolution: z.enum(["1s", "raw", "minute", "hour", "5m", "30m", "2h", "8h"]),
    requested: z.object({ startAtMs: timestampMs, endAtMs: timestampMs }).strict(),
    available: z
      .object({ oldestAtMs: timestampMs.nullable(), newestAtMs: timestampMs.nullable() })
      .strict(),
    recorder: historyRecorderSchema,
    buckets: z.array(historyBucketSchema).max(361),
    incidents: z.array(historyIncidentSchema).max(32),
    gaps: z
      .array(
        z
          .object({
            startedAtMs: timestampMs,
            endedAtMs: timestampMs,
            cause: z.enum(["suspend", "clock-jump", "source-failure", "budget-shed", "app-closed"]),
            sources: z.array(diagnosticSourceSchema).max(9),
          })
          .strict()
      )
      .max(128),
  })
  .strict() satisfies z.ZodType<DiagnosticsHistorySeries>;
const historyContextSchema = z
  .object({
    selection: historySelectionSchema,
    bucket: historyBucketSchema,
    samples: z.array(historyBucketSchema).max(360),
    detailResolution: z.enum(["raw", "minute", "hour"]),
    contributors: z
      .array(
        z
          .object({
            observationId: opaqueId,
            displayName: z.string().min(1).max(96),
            category: z.enum(["main", "renderer", "gpu", "utility", "managed-runtime", "other"]),
            pid: z.number().int().positive(),
            startedAtMs: timestampMs,
            firstObservedAtMs: timestampMs,
            lastObservedAtMs: timestampMs,
            exitedAtMs: timestampMs.nullable(),
            averageCpuPercent: finiteNonnegative,
            maximumCpuPercent: finiteNonnegative,
            maximumCpuAtMs: timestampMs,
            firstResidentBytes: finiteNonnegative,
            lastResidentBytes: finiteNonnegative,
            maximumResidentBytes: finiteNonnegative,
            maximumResidentAtMs: timestampMs,
          })
          .strict()
      )
      .max(12),
    activity: z
      .array(
        z
          .object({
            kind: z.enum(["renderer", "operation", "warning"]),
            name: boundedText,
            firstObservedAtMs: timestampMs,
            lastObservedAtMs: timestampMs,
            count: z.number().int().nonnegative(),
            failures: z.number().int().nonnegative(),
          })
          .strict()
      )
      .max(12),
    renderer: z
      .object({
        route: boundedText,
        heapUsedBytes: finiteNonnegative.nullable(),
        domNodeCount: z.number().int().nonnegative(),
        chatEvents: z.number().int().nonnegative(),
        activeStreamSlots: z.number().int().nonnegative(),
        activeVideoElements: z.number().int().nonnegative(),
        observedAtMs: timestampMs,
      })
      .strict()
      .nullable(),
    incident: historyIncidentSchema.nullable(),
    detailComplete: z.boolean(),
  })
  .strict() satisfies z.ZodType<DiagnosticsHistoryContext>;

const sourceStatusesSchema = z
  .object({
    "electron-processes": diagnosticSourceStatusSchema,
    "process-io": diagnosticSourceStatusSchema,
    "host-power": diagnosticSourceStatusSchema,
    collector: diagnosticSourceStatusSchema,
    "trace-store": diagnosticSourceStatusSchema,
    "logical-io": diagnosticSourceStatusSchema,
    "renderer-performance": diagnosticSourceStatusSchema,
    "diagnostic-logs": diagnosticSourceStatusSchema,
    "diagnostic-reports": diagnosticSourceStatusSchema,
  })
  .strict();

const numberValueSchema = diagnosticValueSchema(finiteNonnegative);
const footprintSchema = z
  .object({
    cpuPercent: numberValueSchema,
    residentMemoryBytes: numberValueSchema,
    processCount: numberValueSchema,
    readBytesPerSecond: numberValueSchema,
    writeBytesPerSecond: numberValueSchema,
    cpuSpeedLimitPercent: numberValueSchema,
    collectionDurationMs: numberValueSchema,
    collectorCpuPercent: numberValueSchema,
    collectorResidentBytes: numberValueSchema,
  })
  .strict();

const hostSchema = z
  .object({
    powerSource: diagnosticValueSchema(z.enum(["battery", "external"])),
    lowPowerMode: diagnosticValueSchema(z.boolean()),
    idleSeconds: numberValueSchema,
    sessionState: diagnosticValueSchema(z.enum(["active", "idle", "locked", "unknown"])),
    thermalState: diagnosticValueSchema(z.enum(["nominal", "fair", "serious", "critical"])),
  })
  .strict();

const collectionSchema = z
  .object({
    sampleIntervalMs: finiteNonnegative,
    retainedSamples: z.number().int().nonnegative(),
    processScanCount: z.number().int().nonnegative(),
    processStarts: z.number().int().nonnegative(),
    processExits: z.number().int().nonnegative(),
    inaccessibleProcessCount: z.number().int().nonnegative(),
    restartCount: z.number().int().nonnegative(),
    droppedDetailCount: z.number().int().nonnegative(),
  })
  .strict();

const gapSchema = z
  .object({
    startedAtMs: timestampMs,
    endedAtMs: timestampMs,
    cause: z.enum(["suspend", "clock-jump", "source-failure", "budget-shed"]),
    sources: z.array(diagnosticSourceSchema).max(9),
  })
  .strict();

const overviewSchema = z
  .object({
    footprint: footprintSchema,
    host: hostSchema,
    collection: collectionSchema,
    latestFailures: z.array(diagnosticFailureSchema).max(20),
  })
  .strict();

const detailSchema = z.discriminatedUnion("tab", [
  z.object({ tab: z.literal("overview") }).strict(),
  z
    .object({
      tab: z.literal("resources"),
      history: z.array(resourcePointSchema).max(3600),
      gaps: z.array(gapSchema).max(256),
      processes: z.array(processObservationSchema).max(256),
    })
    .strict(),
  z
    .object({
      tab: z.literal("processes"),
      history: z.array(resourcePointSchema).max(3600),
      processes: z.array(processObservationSchema).max(256),
    })
    .strict(),
  z.object({ tab: z.literal("io"), rows: z.array(logicalIoObservationSchema).max(512) }).strict(),
  z
    .object({
      tab: z.literal("traces"),
      spans: z.array(traceSpanObservationSchema).max(512),
      logs: z.array(diagnosticLogObservationSchema).max(512),
      topNames: z.array(spanNameSummarySchema).max(256),
      latestFailures: z.array(diagnosticFailureSchema).max(256),
      commonFailures: z.array(diagnosticFailureSchema).max(256),
    })
    .strict(),
  z
    .object({
      tab: z.literal("failures"),
      latest: z.array(diagnosticFailureSchema).max(256),
      common: z.array(diagnosticFailureSchema).max(256),
    })
    .strict(),
  z.object({ tab: z.literal("logs-reports") }).strict(),
  z
    .object({
      tab: z.literal("developer-tools"),
      renderer: diagnosticValueSchema(rendererPerformanceSummarySchema),
    })
    .strict(),
]);

export const diagnosticsSnapshotSchema: z.ZodType<DiagnosticsSnapshot> = z
  .object({
    schemaVersion: z.literal(1),
    instanceId: opaqueId,
    sequence: z.number().int().nonnegative(),
    observedAtMs: timestampMs,
    view: diagnosticsViewSchema,
    sourceStatuses: sourceStatusesSchema,
    overview: overviewSchema,
    detail: detailSchema,
  })
  .strict() as z.ZodType<DiagnosticsSnapshot>;

const leaseOpenedSchema: z.ZodType<DiagnosticsLeaseOpened> = z
  .object({ leaseId: opaqueId, snapshot: diagnosticsSnapshotSchema })
  .strict() as z.ZodType<DiagnosticsLeaseOpened>;

const leaseRequestSchema = z.object({ leaseId: opaqueId }).strict();

export const diagnosticsIpcContracts = {
  [IPC_CHANNELS.DIAGNOSTICS_OPEN_LEASE]: {
    request: z.object({ documentInstanceId: opaqueId, view: diagnosticsViewSchema }).strict(),
    response: ipcReplySchema(leaseOpenedSchema),
  },
  [IPC_CHANNELS.DIAGNOSTICS_CONFIGURE_LEASE]: {
    request: leaseRequestSchema.extend({ view: diagnosticsViewSchema }).strict(),
    response: ipcReplySchema(diagnosticsSnapshotSchema),
  },
  [IPC_CHANNELS.DIAGNOSTICS_CLOSE_LEASE]: {
    request: leaseRequestSchema,
    response: ipcReplySchema(z.null()),
  },
  [IPC_CHANNELS.DIAGNOSTICS_REFRESH]: {
    request: leaseRequestSchema,
    response: ipcReplySchema(diagnosticsSnapshotSchema),
  },
  [IPC_CHANNELS.DIAGNOSTICS_REPORT_RENDERER]: {
    request: rendererPerformanceSummarySchema,
    response: ipcReplySchema(z.null()),
  },
  [IPC_CHANNELS.DIAGNOSTICS_REPORT_ACTIVITY]: {
    request: diagnosticsActivityReportSchema,
    response: ipcReplySchema(z.null()),
  },
  [IPC_CHANNELS.DIAGNOSTICS_QUERY_RESOURCE_HISTORY]: {
    request: leaseRequestSchema
      .extend({ range: historyRangeSchema, endAtMs: historyTimestampMs })
      .strict(),
    response: ipcReplySchema(historySeriesSchema),
  },
  [IPC_CHANNELS.DIAGNOSTICS_QUERY_RESOURCE_CONTEXT]: {
    request: leaseRequestSchema.extend({ selection: historySelectionSchema }).strict(),
    response: ipcReplySchema(historyContextSchema),
  },
} as const;

export const diagnosticsSnapshotChangedSchema: z.ZodType<DiagnosticsSnapshotChanged> = z
  .object({ leaseId: opaqueId, snapshot: diagnosticsSnapshotSchema })
  .strict() as z.ZodType<DiagnosticsSnapshotChanged>;

export type DiagnosticsIpcChannel = keyof typeof diagnosticsIpcContracts;
