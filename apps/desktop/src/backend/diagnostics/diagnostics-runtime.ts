import { historyRangePreset } from "../../shared/diagnostics-types";
import type {
  CollectionGap,
  DiagnosticsActivityReport,
  DiagnosticsHistoryContext,
  DiagnosticsHistoryQuery,
  DiagnosticsHistorySelection,
  DiagnosticsHistorySeries,
  DiagnosticCapability,
  DiagnosticPlatform,
  DiagnosticSource,
  DiagnosticSourceStatus,
  DiagnosticsDetail,
  DiagnosticsLeaseOpened,
  DiagnosticsSnapshot,
  DiagnosticsView,
  DiagnosticValue,
  HostState,
  ProcessCategory,
  ProcessObservation,
  RendererPerformanceSummary,
  ResourcePoint,
  SystemFootprint,
} from "../../shared/diagnostics-types";
import {
  SqliteDiagnosticsHistoryRecorder,
  type DiagnosticsHistoryRecorder,
} from "./diagnostics-history-recorder";
import type { ObservabilitySnapshot } from "./diagnostics-observability";
import type { CpuSpeedLimitReading } from "./cpu-speed-limit-source";
import type { ProcessIoSnapshot } from "./process-io-sampler";

const BASELINE_INTERVAL_MS = 5_000;
const PROCESS_MONITOR_LOG_INTERVAL_MS = 30_000;
const VISIBLE_INTERVAL_MS = 1_000;
const VISIBLE_PUBLISH_INTERVAL_MS = 5_000;
const HISTORY_RETENTION_MS = 60 * 60 * 1_000;
const HISTORY_CAPACITY = 3_600;
const PROCESS_HISTORY_CAPACITY = 100_000;
const TRANSPORT_HISTORY_CAPACITY = 120;
const EXPECTED_GAP_MULTIPLIER = 2.5;
const KB_TO_BYTES = 1_024;
const SAFE_ELECTRON_PROCESS_NAMES = new Set([
  "Audio Service",
  "Network Service",
  "Video Capture",
  "Data Decoder Service",
  "Storage Service",
]);

export interface ElectronProcessMetric {
  readonly pid: number;
  readonly type: string;
  readonly name?: string;
  readonly creationTime: number;
  readonly cpu: {
    readonly percentCPUUsage: number;
    readonly cumulativeCPUUsage?: number;
  };
  readonly memory: {
    readonly workingSetSize: number;
    readonly peakWorkingSetSize: number;
  };
}

interface CpuUsage {
  readonly user: number;
  readonly system: number;
}

interface RuntimeDependencies {
  readonly nowMs: () => number;
  readonly monotonicMs: () => number;
  readonly createId: () => string;
  readonly platform: DiagnosticPlatform;
  readonly processPid: number;
  readonly cpuCount: number;
  readonly processCpuUsage: (previous?: CpuUsage) => CpuUsage;
  readonly processMemoryUsage: () => { readonly rss: number };
  readonly getAppMetrics: () => readonly ElectronProcessMetric[];
  readonly isOnBatteryPower: () => boolean;
  readonly getSystemIdleTime: () => number;
  readonly getSystemIdleState: (
    thresholdSeconds: number
  ) => "active" | "idle" | "locked" | "unknown";
  readonly getCpuSpeedLimitReading: () => CpuSpeedLimitReading | null;
  readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  readonly readProcessIo: () => ProcessIoSnapshot;
  readonly setProcessIoSamplingInterval: (intervalMs: number | null) => void;
  readonly refreshProcessIoProcessSet: () => void;
  readonly writeProcessMonitorLine: (line: string) => void;
  readonly getObservabilitySnapshot?: (sinceMs: number) => ObservabilitySnapshot;
  readonly diagnosticsHistoryPath?: () => string;
}

interface DiagnosticsLease {
  readonly leaseId: string;
  readonly ownerId: number;
  readonly documentInstanceId: string;
  view: DiagnosticsView;
  lastPublishedAtMs: number;
  readonly publish: (leaseId: string, snapshot: DiagnosticsSnapshot) => void;
}

interface SampleState {
  readonly observedAtMs: number;
  readonly monotonicMs: number;
  readonly footprint: SystemFootprint;
  readonly host: HostState;
  readonly point: ResourcePoint | null;
  readonly processes: readonly ProcessObservation[];
}

interface HistoricalProcessPoint {
  readonly observationId: string;
  readonly observedAtMs: number;
  readonly cpuPercent: number;
  readonly residentBytes: number;
}

interface ProcessIoTotals {
  readonly lastObservedAtMs: number;
  readonly readBytes: number;
  readonly writeBytes: number;
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function createReadyValue<T>(
  source: DiagnosticSource,
  observedAtMs: number,
  value: T
): DiagnosticValue<T> {
  return { source, status: { kind: "ready", observedAtMs }, value };
}

function createUnsupportedValue<T>(
  source: DiagnosticSource,
  platform: DiagnosticPlatform,
  capability: DiagnosticCapability
): DiagnosticValue<T> {
  return { source, status: { kind: "unsupported", platform, capability } };
}

function createUnavailableValue<T>(source: DiagnosticSource, sinceMs: number): DiagnosticValue<T> {
  return {
    source,
    status: {
      kind: "unavailable",
      sinceMs,
      reason: "collector-error",
      retry: "automatic",
    },
  };
}

function classifyProcess(metric: ElectronProcessMetric, mainPid: number): ProcessCategory {
  if (metric.pid === mainPid || metric.type.toLowerCase() === "browser") return "main";
  const type = metric.type.toLowerCase();
  if (type === "tab" || type.includes("renderer")) return "renderer";
  if (type === "gpu") return "gpu";
  if (type === "utility") return "utility";
  return "other";
}

function safeProcessName(metric: ElectronProcessMetric, category: ProcessCategory): string {
  const fallback =
    category === "main"
      ? "StreamFusion main"
      : category === "renderer"
        ? "Renderer"
        : category === "gpu"
          ? "GPU"
          : category === "utility"
            ? "Electron utility"
            : "Electron process";
  if (!metric.name) return fallback;
  return SAFE_ELECTRON_PROCESS_NAMES.has(metric.name) ? metric.name : fallback;
}

function formatMegabytes(bytes: number): number {
  return Math.round(bytes / (1_024 * 1_024));
}

function averageNullable(
  points: readonly ResourcePoint[],
  select: (point: ResourcePoint) => number | null
): number | null {
  let total = 0;
  let count = 0;
  for (const point of points) {
    const value = select(point);
    if (value === null) continue;
    total += value;
    count += 1;
  }
  return count === 0 ? null : total / count;
}

function compactResourceHistory(history: readonly ResourcePoint[]): readonly ResourcePoint[] {
  if (history.length <= TRANSPORT_HISTORY_CAPACITY) return history;

  const compacted: ResourcePoint[] = [];
  for (let bucket = 0; bucket < TRANSPORT_HISTORY_CAPACITY; bucket += 1) {
    const start = Math.floor((bucket * history.length) / TRANSPORT_HISTORY_CAPACITY);
    const end = Math.floor(((bucket + 1) * history.length) / TRANSPORT_HISTORY_CAPACITY);
    const points = history.slice(start, Math.max(start + 1, end));
    const latest = points.at(-1);
    if (!latest) continue;
    compacted.push({
      observedAtMs: latest.observedAtMs,
      cpuPercent: points.reduce((total, point) => total + point.cpuPercent, 0) / points.length,
      residentMemoryBytes:
        points.reduce((total, point) => total + point.residentMemoryBytes, 0) / points.length,
      processCount: latest.processCount,
      readBytesPerSecond: averageNullable(points, (point) => point.readBytesPerSecond),
      writeBytesPerSecond: averageNullable(points, (point) => point.writeBytesPerSecond),
    });
  }
  return compacted;
}

export class DiagnosticsRuntime {
  readonly #dependencies: RuntimeDependencies;
  readonly #instanceId: string;
  readonly #leases = new Map<string, DiagnosticsLease>();
  readonly #processObservationIds = new Map<string, string>();
  readonly #processSampleCounts = new Map<string, number>();
  readonly #history: ResourcePoint[] = [];
  readonly #processHistory: HistoricalProcessPoint[] = [];
  readonly #processIoTotals = new Map<string, ProcessIoTotals>();
  readonly #gaps: CollectionGap[] = [];
  readonly #rendererPerformance = new Map<number, RendererPerformanceSummary>();
  readonly #rendererActivity = new Map<number, DiagnosticsActivityReport>();
  #historyRecorder: DiagnosticsHistoryRecorder | null = null;

  #timer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #sampling: Promise<void> | null = null;
  #sequence = 0;
  #lastSample: SampleState | null = null;
  #lastCpuUsage: CpuUsage;
  #lastSampleMonotonicMs: number;
  #lastLogAtMs = 0;
  #lastRecordedRendererActivityAtMs = 0;
  #lastProcessPidSet = "";
  #activeProcessKeys = new Set<string>();
  #processStarts = 0;
  #processExits = 0;

  constructor(dependencies: RuntimeDependencies) {
    this.#dependencies = dependencies;
    this.#instanceId = dependencies.createId();
    this.#lastCpuUsage = dependencies.processCpuUsage();
    this.#lastSampleMonotonicMs = dependencies.monotonicMs();
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    if (this.#dependencies.diagnosticsHistoryPath) {
      this.#historyRecorder = new SqliteDiagnosticsHistoryRecorder(
        this.#dependencies.diagnosticsHistoryPath()
      );
      this.#historyRecorder.start(this.#instanceId, this.#dependencies.nowMs());
    }
    await this.sampleNow();
    this.#scheduleNext();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    if (this.#timer) this.#dependencies.clearTimer(this.#timer);
    this.#timer = null;
    this.#leases.clear();
    this.#dependencies.setProcessIoSamplingInterval(null);
    this.#historyRecorder?.stop(this.#dependencies.nowMs(), true);
    this.#historyRecorder = null;
  }

  async openLease(input: {
    ownerId: number;
    documentInstanceId: string;
    view: DiagnosticsView;
    publish: (leaseId: string, snapshot: DiagnosticsSnapshot) => void;
  }): Promise<DiagnosticsLeaseOpened> {
    if (!this.#started) await this.start();
    const existing = [...this.#leases.values()].find(
      (lease) =>
        lease.ownerId === input.ownerId && lease.documentInstanceId === input.documentInstanceId
    );
    if (existing) {
      const cadenceChanged =
        this.#isRealtimeResourcesLease(existing) !==
        (input.view.tab === "resources" && input.view.resourceHistoryRange === "realtime");
      existing.view = input.view;
      if (cadenceChanged) this.#rescheduleForCadenceChange();
      return { leaseId: existing.leaseId, snapshot: this.snapshot(input.view) };
    }

    const leaseId = this.#dependencies.createId();
    this.#leases.set(leaseId, {
      leaseId,
      ...input,
      lastPublishedAtMs: this.#lastSample?.observedAtMs ?? this.#dependencies.nowMs(),
    });
    this.#rescheduleForCadenceChange();
    await this.sampleNow();
    return { leaseId, snapshot: this.snapshot(input.view) };
  }

  configureLease(
    ownerId: number,
    leaseId: string,
    view: DiagnosticsView
  ): DiagnosticsSnapshot | null {
    const lease = this.#leases.get(leaseId);
    if (!lease || lease.ownerId !== ownerId) return null;
    const cadenceChanged =
      this.#isRealtimeResourcesLease(lease) !==
      (view.tab === "resources" && view.resourceHistoryRange === "realtime");
    lease.view = view;
    if (cadenceChanged) this.#rescheduleForCadenceChange();
    return this.snapshot(view);
  }

  closeLease(ownerId: number, leaseId: string): boolean {
    const lease = this.#leases.get(leaseId);
    if (!lease || lease.ownerId !== ownerId) return false;
    this.#leases.delete(leaseId);
    this.#rescheduleForCadenceChange();
    return true;
  }

  closeOwner(ownerId: number): void {
    let changed = false;
    for (const [leaseId, lease] of this.#leases) {
      if (lease.ownerId !== ownerId) continue;
      this.#leases.delete(leaseId);
      changed = true;
    }
    if (changed) this.#rescheduleForCadenceChange();
    this.#rendererPerformance.delete(ownerId);
    this.#rendererActivity.delete(ownerId);
  }

  reportRendererPerformance(ownerId: number, summary: RendererPerformanceSummary): void {
    this.#rendererPerformance.set(ownerId, summary);
  }

  reportRendererActivity(ownerId: number, report: DiagnosticsActivityReport): void {
    if (Math.abs(this.#dependencies.nowMs() - report.observedAtMs) > 60_000) return;
    this.#rendererActivity.set(ownerId, report);
  }

  queryResourceHistory(
    ownerId: number,
    leaseId: string,
    query: Omit<DiagnosticsHistoryQuery, "leaseId">
  ): DiagnosticsHistorySeries | null {
    const lease = this.#leases.get(leaseId);
    return !lease || lease.ownerId !== ownerId
      ? null
      : (this.#historyRecorder?.queryHistory(query) ?? null);
  }

  queryResourceContext(
    ownerId: number,
    leaseId: string,
    selection: DiagnosticsHistorySelection
  ): DiagnosticsHistoryContext | null {
    const lease = this.#leases.get(leaseId);
    return !lease || lease.ownerId !== ownerId
      ? null
      : (this.#historyRecorder?.queryContext(selection) ?? null);
  }

  async refresh(ownerId: number, leaseId: string): Promise<DiagnosticsSnapshot | null> {
    const lease = this.#leases.get(leaseId);
    if (!lease || lease.ownerId !== ownerId) return null;
    await this.sampleNow();
    return this.snapshot(lease.view);
  }

  sampleNow(): Promise<void> {
    if (this.#sampling) return this.#sampling;
    this.#sampling = Promise.resolve()
      .then(() => this.#collect())
      .finally(() => {
        this.#sampling = null;
      });
    return this.#sampling;
  }

  snapshot(view: DiagnosticsView): DiagnosticsSnapshot {
    const sample = this.#lastSample ?? this.#unavailableSample();
    const cutoff = sample.observedAtMs - view.windowMinutes * 60_000;
    const observability = this.#dependencies.getObservabilitySnapshot?.(cutoff);
    const rendererPerformance = this.#latestRendererPerformance();
    const sourceStatuses = this.#sourceStatuses(sample, observability, rendererPerformance);
    return {
      schemaVersion: 1,
      instanceId: this.#instanceId,
      sequence: this.#sequence,
      observedAtMs: sample.observedAtMs,
      view,
      sourceStatuses,
      overview: {
        footprint: sample.footprint,
        host: sample.host,
        collection: {
          sampleIntervalMs: this.#currentIntervalMs(),
          retainedSamples: this.#history.length,
          processScanCount: sample.processes.length,
          processStarts: this.#processStarts,
          processExits: this.#processExits,
          inaccessibleProcessCount: 0,
          restartCount: 0,
          droppedDetailCount: 0,
        },
        latestFailures: observability?.latestFailures.slice(0, 20) ?? [],
      },
      detail: this.#materializeDetail(view, sample, observability, rendererPerformance),
    };
  }

  #materializeDetail(
    view: DiagnosticsView,
    sample: SampleState,
    observability: ObservabilitySnapshot | undefined,
    rendererPerformance: RendererPerformanceSummary | undefined
  ): DiagnosticsDetail {
    const cutoff = sample.observedAtMs - view.windowMinutes * 60_000;
    const history = compactResourceHistory(
      this.#history.filter((point) => point.observedAtMs >= cutoff)
    );
    const processes = this.#processesForWindow(sample.processes, cutoff);
    if (view.tab === "overview") return { tab: "overview" };
    if (view.tab === "resources") {
      return {
        tab: "resources",
        history,
        gaps: this.#gaps.filter((gap) => gap.endedAtMs >= cutoff),
        processes,
      };
    }
    if (view.tab === "processes") {
      return { tab: "processes", history, processes };
    }
    if (view.tab === "io") return { tab: "io", rows: observability?.io ?? [] };
    if (view.tab === "traces") {
      return {
        tab: "traces",
        spans: observability?.spans.slice(-512) ?? [],
        logs: observability?.logs.slice(-512) ?? [],
        topNames: observability?.topNames.slice(0, 256) ?? [],
        latestFailures: observability?.latestFailures.slice(0, 256) ?? [],
        commonFailures: observability?.commonFailures.slice(0, 256) ?? [],
      };
    }
    if (view.tab === "failures") {
      return {
        tab: "failures",
        latest: observability?.latestFailures.slice(0, 256) ?? [],
        common: observability?.commonFailures.slice(0, 256) ?? [],
      };
    }
    if (view.tab === "logs-reports") return { tab: "logs-reports" };
    return {
      tab: "developer-tools",
      renderer:
        rendererPerformance === undefined
          ? createUnavailableValue("renderer-performance", sample.observedAtMs)
          : createReadyValue(
              "renderer-performance",
              rendererPerformance.observedAtMs,
              rendererPerformance
            ),
    };
  }

  #sourceStatuses(
    sample: SampleState,
    observability: ObservabilitySnapshot | undefined,
    rendererPerformance: RendererPerformanceSummary | undefined
  ): Record<DiagnosticSource, DiagnosticSourceStatus> {
    const electronStatus = sample.footprint.cpuPercent.status;
    const observabilityStatus: DiagnosticSourceStatus = observability
      ? { kind: "ready", observedAtMs: sample.observedAtMs }
      : {
          kind: "unavailable",
          sinceMs: sample.observedAtMs,
          reason: "collector-error",
          retry: "manual",
        };
    return {
      "electron-processes": electronStatus,
      "process-io": sample.footprint.readBytesPerSecond.status,
      "host-power": sample.host.powerSource.status,
      collector: sample.footprint.collectionDurationMs.status,
      "trace-store": observabilityStatus,
      "logical-io": observabilityStatus,
      "renderer-performance": rendererPerformance
        ? { kind: "ready", observedAtMs: rendererPerformance.observedAtMs }
        : {
            kind: "unavailable",
            sinceMs: sample.observedAtMs,
            reason: "collector-error",
            retry: "automatic",
          },
      "diagnostic-logs": { kind: "ready", observedAtMs: sample.observedAtMs },
      "diagnostic-reports": { kind: "ready", observedAtMs: sample.observedAtMs },
    };
  }

  #latestRendererPerformance(): RendererPerformanceSummary | undefined {
    let latest: RendererPerformanceSummary | undefined;
    for (const summary of this.#rendererPerformance.values()) {
      if (!latest || summary.observedAtMs > latest.observedAtMs) latest = summary;
    }
    return latest;
  }

  #latestRendererActivity(): DiagnosticsActivityReport | null {
    let latest: DiagnosticsActivityReport | null = null;
    for (const activity of this.#rendererActivity.values()) {
      if (!latest || activity.observedAtMs > latest.observedAtMs) latest = activity;
    }
    return latest;
  }

  #collect(): void {
    const startedAtMonotonicMs = this.#dependencies.monotonicMs();
    const observedAtMs = this.#dependencies.nowMs();
    const elapsedMs = Math.max(1, startedAtMonotonicMs - this.#lastSampleMonotonicMs);
    if (this.#lastSample && elapsedMs > this.#currentIntervalMs() * EXPECTED_GAP_MULTIPLIER) {
      this.#gaps.push({
        startedAtMs: this.#lastSample.observedAtMs,
        endedAtMs: observedAtMs,
        cause: "clock-jump",
        sources: ["electron-processes", "process-io", "collector"],
      });
    }

    const previousCpu = this.#lastCpuUsage;
    const sampleStartCpu = this.#dependencies.processCpuUsage();
    let metrics: readonly ElectronProcessMetric[];
    try {
      metrics = this.#dependencies.getAppMetrics();
    } catch {
      this.#commitUnavailable(observedAtMs, startedAtMonotonicMs);
      return;
    }

    const processPidSet = metrics
      .slice(0, 256)
      .map((metric) => metric.pid)
      .sort((left, right) => left - right)
      .join(":");
    if (
      this.#leases.size > 0 &&
      this.#lastProcessPidSet !== "" &&
      processPidSet !== this.#lastProcessPidSet
    ) {
      this.#dependencies.refreshProcessIoProcessSet();
    }
    this.#lastProcessPidSet = processPidSet;

    const processIo = this.#dependencies.readProcessIo();
    const processKeys = new Set(
      metrics.slice(0, 256).map((metric) => `${metric.pid}:${metric.creationTime}`)
    );
    for (const key of processKeys) {
      if (!this.#activeProcessKeys.has(key)) this.#processStarts += 1;
    }
    for (const key of this.#activeProcessKeys) {
      if (!processKeys.has(key)) this.#processExits += 1;
    }
    this.#activeProcessKeys = processKeys;
    const processes = metrics
      .slice(0, 256)
      .map((metric) => this.#mapProcess(metric, observedAtMs, processIo));
    const currentObservationIds = new Set(processes.map((process) => process.observationId));
    for (const observationId of this.#processIoTotals.keys()) {
      if (!currentObservationIds.has(observationId)) this.#processIoTotals.delete(observationId);
    }
    this.#processHistory.push(
      ...processes.map((process) => ({
        observationId: process.observationId,
        observedAtMs,
        cpuPercent: process.currentCpuPercent,
        residentBytes: process.residentBytes,
      }))
    );
    const residentMemoryBytes = processes.reduce((total, item) => total + item.residentBytes, 0);
    const cpuPercent = processes.reduce((total, item) => total + item.currentCpuPercent, 0);
    const processesWithIo = processes.filter(
      (process) => process.readBytesPerSecond !== null && process.writeBytesPerSecond !== null
    );
    const ioObserved = processIo.kind === "ready" && processesWithIo.length > 0;
    const readBytesPerSecond = processesWithIo.reduce(
      (total, process) => total + (process.readBytesPerSecond ?? 0),
      0
    );
    const writeBytesPerSecond = processesWithIo.reduce(
      (total, process) => total + (process.writeBytesPerSecond ?? 0),
      0
    );
    const processIoValue = (value: number): DiagnosticValue<number> => {
      if (ioObserved && processIo.kind === "ready") {
        return createReadyValue("process-io", processIo.observedAtMs, value);
      }
      if (processIo.kind === "unsupported") {
        return createUnsupportedValue("process-io", this.#dependencies.platform, "process-io");
      }
      return createUnavailableValue(
        "process-io",
        processIo.kind === "unavailable" ? processIo.sinceMs : observedAtMs
      );
    };
    const endedAtMonotonicMs = this.#dependencies.monotonicMs();
    const collectionDurationMs = Math.max(0, endedAtMonotonicMs - startedAtMonotonicMs);
    const collectionCpu = this.#dependencies.processCpuUsage(sampleStartCpu);
    const collectorCpuMs = (collectionCpu.user + collectionCpu.system) / 1_000;
    const collectorCpuPercent =
      (collectorCpuMs / Math.max(1, collectionDurationMs) / this.#dependencies.cpuCount) * 100;
    const cpuSpeedLimit = this.#dependencies.getCpuSpeedLimitReading();
    const footprint: SystemFootprint = {
      cpuPercent: createReadyValue("electron-processes", observedAtMs, cpuPercent),
      residentMemoryBytes: createReadyValue(
        "electron-processes",
        observedAtMs,
        residentMemoryBytes
      ),
      processCount: createReadyValue("electron-processes", observedAtMs, processes.length),
      readBytesPerSecond: processIoValue(readBytesPerSecond),
      writeBytesPerSecond: processIoValue(writeBytesPerSecond),
      cpuSpeedLimitPercent: cpuSpeedLimit
        ? createReadyValue("host-power", cpuSpeedLimit.observedAtMs, cpuSpeedLimit.percent)
        : this.#dependencies.platform === "win32" || this.#dependencies.platform === "darwin"
          ? createUnavailableValue("host-power", observedAtMs)
          : createUnsupportedValue("host-power", this.#dependencies.platform, "cpu-speed-limit"),
      collectionDurationMs: createReadyValue("collector", observedAtMs, collectionDurationMs),
      collectorCpuPercent: createReadyValue(
        "collector",
        observedAtMs,
        finiteNonnegative(collectorCpuPercent)
      ),
      collectorResidentBytes: createReadyValue(
        "collector",
        observedAtMs,
        Buffer.byteLength(JSON.stringify({ processes, observedAtMs }), "utf8")
      ),
    };

    const host: HostState = {
      powerSource: createReadyValue(
        "host-power",
        observedAtMs,
        this.#dependencies.isOnBatteryPower() ? "battery" : "external"
      ),
      lowPowerMode: createUnsupportedValue(
        "host-power",
        this.#dependencies.platform,
        "low-power-mode"
      ),
      idleSeconds: createReadyValue(
        "host-power",
        observedAtMs,
        finiteNonnegative(this.#dependencies.getSystemIdleTime())
      ),
      sessionState: createReadyValue(
        "host-power",
        observedAtMs,
        this.#dependencies.getSystemIdleState(60)
      ),
      thermalState: createUnsupportedValue(
        "host-power",
        this.#dependencies.platform,
        "thermal-state"
      ),
    };

    const point: ResourcePoint = {
      observedAtMs,
      cpuPercent,
      residentMemoryBytes,
      processCount: processes.length,
      readBytesPerSecond: ioObserved ? readBytesPerSecond : null,
      writeBytesPerSecond: ioObserved ? writeBytesPerSecond : null,
    };
    this.#history.push(point);
    this.#evictHistory(observedAtMs);
    this.#lastCpuUsage = this.#dependencies.processCpuUsage(previousCpu);
    this.#lastSampleMonotonicMs = endedAtMonotonicMs;
    this.#lastSample = {
      observedAtMs,
      monotonicMs: endedAtMonotonicMs,
      footprint,
      host,
      point,
      processes,
    };
    const activity = this.#latestRendererActivity();
    const freshActivity =
      activity && activity.observedAtMs > this.#lastRecordedRendererActivityAtMs ? activity : null;
    if (freshActivity) this.#lastRecordedRendererActivityAtMs = freshActivity.observedAtMs;
    this.#historyRecorder?.record({
      instanceId: this.#instanceId,
      observedAtMs,
      point,
      observedDurationMs: elapsedMs,
      processes,
      activity: freshActivity,
      gaps: this.#gaps.filter((gap) => gap.endedAtMs >= observedAtMs - BASELINE_INTERVAL_MS * 2),
    });
    const completedCollectionDurationMs = Math.max(
      0,
      this.#dependencies.monotonicMs() - startedAtMonotonicMs
    );
    const completedCollectionCpu = this.#dependencies.processCpuUsage(sampleStartCpu);
    const committedSample = this.#lastSample;
    if (committedSample) {
      this.#lastSample = {
        ...committedSample,
        footprint: {
          ...committedSample.footprint,
          collectionDurationMs: createReadyValue(
            "collector",
            observedAtMs,
            completedCollectionDurationMs
          ),
          collectorCpuPercent: createReadyValue(
            "collector",
            observedAtMs,
            finiteNonnegative(
              ((completedCollectionCpu.user + completedCollectionCpu.system) /
                1_000 /
                Math.max(1, completedCollectionDurationMs) /
                this.#dependencies.cpuCount) *
                100
            )
          ),
        },
      };
    }
    this.#sequence += 1;

    if (
      observedAtMs - this.#lastLogAtMs >= PROCESS_MONITOR_LOG_INTERVAL_MS ||
      this.#lastLogAtMs === 0
    ) {
      this.#lastLogAtMs = observedAtMs;
      this.#dependencies.writeProcessMonitorLine(
        `rss=${formatMegabytes(residentMemoryBytes)}MB cpu=${Math.round(cpuPercent)}% procs=${processes.length}`
      );
    }
    this.#publishSnapshots();
  }

  #commitUnavailable(observedAtMs: number, monotonicMs: number): void {
    if (this.#lastSample) {
      const staleSinceMs = observedAtMs;
      const stale = {
        kind: "stale",
        observedAtMs: this.#lastSample.observedAtMs,
        staleSinceMs,
        reason: "partial-scan",
      } as const;
      const last = this.#lastSample;
      const staleValue = <T>(value: DiagnosticValue<T>): DiagnosticValue<T> =>
        "value" in value ? { source: value.source, status: stale, value: value.value } : value;
      this.#lastSample = {
        ...last,
        observedAtMs,
        monotonicMs,
        footprint: {
          ...last.footprint,
          cpuPercent: staleValue(last.footprint.cpuPercent),
          residentMemoryBytes: staleValue(last.footprint.residentMemoryBytes),
          processCount: staleValue(last.footprint.processCount),
        },
      };
    } else {
      this.#lastSample = this.#unavailableSample(observedAtMs, monotonicMs);
    }
    this.#sequence += 1;
    this.#lastSampleMonotonicMs = monotonicMs;
    this.#publishSnapshots();
  }

  #unavailableSample(
    observedAtMs = this.#dependencies.nowMs(),
    monotonicMs = this.#dependencies.monotonicMs()
  ): SampleState {
    const unavailable = <T>(source: DiagnosticSource): DiagnosticValue<T> =>
      createUnavailableValue(source, observedAtMs);
    const unsupportedValue = <T>(
      source: DiagnosticSource,
      capability: Parameters<typeof createUnsupportedValue<T>>[2]
    ): DiagnosticValue<T> =>
      createUnsupportedValue(source, this.#dependencies.platform, capability);
    const processIoUnavailable = <T>(): DiagnosticValue<T> =>
      this.#dependencies.platform === "win32"
        ? unavailable("process-io")
        : unsupportedValue("process-io", "process-io");
    const cpuSpeedLimit = this.#dependencies.getCpuSpeedLimitReading();
    return {
      observedAtMs,
      monotonicMs,
      point: null,
      processes: [],
      footprint: {
        cpuPercent: unavailable("electron-processes"),
        residentMemoryBytes: unavailable("electron-processes"),
        processCount: unavailable("electron-processes"),
        readBytesPerSecond: processIoUnavailable(),
        writeBytesPerSecond: processIoUnavailable(),
        cpuSpeedLimitPercent: cpuSpeedLimit
          ? createReadyValue("host-power", cpuSpeedLimit.observedAtMs, cpuSpeedLimit.percent)
          : this.#dependencies.platform === "win32" || this.#dependencies.platform === "darwin"
            ? unavailable("host-power")
            : unsupportedValue("host-power", "cpu-speed-limit"),
        collectionDurationMs: unavailable("collector"),
        collectorCpuPercent: unavailable("collector"),
        collectorResidentBytes: unavailable("collector"),
      },
      host: {
        powerSource: unavailable("host-power"),
        lowPowerMode: unsupportedValue("host-power", "low-power-mode"),
        idleSeconds: unavailable("host-power"),
        sessionState: unavailable("host-power"),
        thermalState: unsupportedValue("host-power", "thermal-state"),
      },
    };
  }

  #mapProcess(
    metric: ElectronProcessMetric,
    observedAtMs: number,
    processIo: ProcessIoSnapshot
  ): ProcessObservation {
    const key = `${metric.pid}:${metric.creationTime}`;
    const observationId = this.#processObservationIds.get(key) ?? this.#dependencies.createId();
    this.#processObservationIds.set(key, observationId);
    const samples = (this.#processSampleCounts.get(key) ?? 0) + 1;
    this.#processSampleCounts.set(key, samples);
    const category = classifyProcess(metric, this.#dependencies.processPid);
    const action =
      category === "main"
        ? ({ kind: "ineligible", reason: "main-process" } as const)
        : ({ kind: "unsupported", capability: "process-signals" } as const);
    const ioCounters =
      processIo.kind === "ready" ? processIo.countersByPid.get(metric.pid) : undefined;
    const previousIoTotals = this.#processIoTotals.get(observationId);
    const elapsedIoSeconds = previousIoTotals
      ? Math.min(
          Math.max(0, observedAtMs - previousIoTotals.lastObservedAtMs),
          this.#currentIntervalMs() * EXPECTED_GAP_MULTIPLIER
        ) / 1_000
      : 0;
    const ioTotals = ioCounters
      ? {
          lastObservedAtMs: observedAtMs,
          readBytes:
            (previousIoTotals?.readBytes ?? 0) + ioCounters.readBytesPerSecond * elapsedIoSeconds,
          writeBytes:
            (previousIoTotals?.writeBytes ?? 0) + ioCounters.writeBytesPerSecond * elapsedIoSeconds,
        }
      : previousIoTotals;
    if (ioTotals) this.#processIoTotals.set(observationId, ioTotals);
    return {
      observationId,
      observedAtMs,
      pid: metric.pid,
      startedAtMs: finiteNonnegative(metric.creationTime),
      parentPid: ioCounters?.parentPid ?? null,
      category,
      displayName: safeProcessName(metric, category),
      currentCpuPercent: finiteNonnegative(metric.cpu.percentCPUUsage),
      averageCpuPercent: finiteNonnegative(metric.cpu.percentCPUUsage),
      peakCpuPercent: finiteNonnegative(metric.cpu.percentCPUUsage),
      cumulativeCpuMs:
        metric.cpu.cumulativeCPUUsage === undefined
          ? null
          : finiteNonnegative(metric.cpu.cumulativeCPUUsage * 1_000),
      residentBytes: finiteNonnegative(metric.memory.workingSetSize * KB_TO_BYTES),
      peakResidentBytes: finiteNonnegative(metric.memory.peakWorkingSetSize * KB_TO_BYTES),
      readBytesPerSecond: ioCounters?.readBytesPerSecond ?? null,
      writeBytesPerSecond: ioCounters?.writeBytesPerSecond ?? null,
      readTotalBytes: ioTotals?.readBytes ?? null,
      writeTotalBytes: ioTotals?.writeBytes ?? null,
      samples,
      interrupt: action,
      force: action,
    };
  }

  #evictHistory(nowMs: number): void {
    const cutoff = nowMs - HISTORY_RETENTION_MS;
    while (this.#history.length > 0 && this.#history[0].observedAtMs < cutoff) {
      this.#history.shift();
    }
    if (this.#history.length > HISTORY_CAPACITY) {
      this.#history.splice(0, this.#history.length - HISTORY_CAPACITY);
    }
    const firstRetainedProcessIndex = this.#processHistory.findIndex(
      (point) => point.observedAtMs >= cutoff
    );
    if (firstRetainedProcessIndex === -1) this.#processHistory.length = 0;
    else if (firstRetainedProcessIndex > 0) {
      this.#processHistory.splice(0, firstRetainedProcessIndex);
    }
    if (this.#processHistory.length > PROCESS_HISTORY_CAPACITY) {
      this.#processHistory.splice(0, this.#processHistory.length - PROCESS_HISTORY_CAPACITY);
    }
    while (this.#gaps.length > 0 && this.#gaps[0].endedAtMs < cutoff) this.#gaps.shift();
  }

  #processesForWindow(
    current: readonly ProcessObservation[],
    cutoffMs: number
  ): readonly ProcessObservation[] {
    const currentIds = new Set(current.map((process) => process.observationId));
    const aggregates = new Map<
      string,
      { cpuTotal: number; peakCpuPercent: number; peakResidentBytes: number; samples: number }
    >();
    for (const point of this.#processHistory) {
      if (point.observedAtMs < cutoffMs || !currentIds.has(point.observationId)) continue;
      const aggregate = aggregates.get(point.observationId) ?? {
        cpuTotal: 0,
        peakCpuPercent: 0,
        peakResidentBytes: 0,
        samples: 0,
      };
      aggregate.cpuTotal += point.cpuPercent;
      aggregate.peakCpuPercent = Math.max(aggregate.peakCpuPercent, point.cpuPercent);
      aggregate.peakResidentBytes = Math.max(aggregate.peakResidentBytes, point.residentBytes);
      aggregate.samples += 1;
      aggregates.set(point.observationId, aggregate);
    }
    return current.map((process) => {
      const aggregate = aggregates.get(process.observationId);
      if (!aggregate || aggregate.samples === 0) return process;
      return {
        ...process,
        averageCpuPercent: aggregate.cpuTotal / aggregate.samples,
        peakCpuPercent: aggregate.peakCpuPercent,
        peakResidentBytes: aggregate.peakResidentBytes,
        samples: aggregate.samples,
      };
    });
  }

  #publishSnapshots(): void {
    const observedAtMs = this.#lastSample?.observedAtMs;
    if (observedAtMs === undefined) return;
    for (const lease of this.#leases.values()) {
      const publishIntervalMs = this.#isRealtimeResourcesLease(lease)
        ? historyRangePreset("realtime").publishIntervalMs
        : VISIBLE_PUBLISH_INTERVAL_MS;
      if (observedAtMs - lease.lastPublishedAtMs < publishIntervalMs) continue;
      lease.lastPublishedAtMs = observedAtMs;
      lease.publish(lease.leaseId, this.snapshot(lease.view));
    }
  }

  #currentIntervalMs(): number {
    return [...this.#leases.values()].some((lease) => this.#isRealtimeResourcesLease(lease))
      ? VISIBLE_INTERVAL_MS
      : BASELINE_INTERVAL_MS;
  }

  #isRealtimeResourcesLease(lease: DiagnosticsLease): boolean {
    return lease.view.tab === "resources" && lease.view.resourceHistoryRange === "realtime";
  }

  #rescheduleForCadenceChange(): void {
    if (!this.#started) return;
    this.#dependencies.setProcessIoSamplingInterval(
      [...this.#leases.values()].some((lease) => this.#isRealtimeResourcesLease(lease))
        ? VISIBLE_INTERVAL_MS
        : null
    );
    if (this.#timer) this.#dependencies.clearTimer(this.#timer);
    this.#timer = null;
    this.#scheduleNext();
  }

  #scheduleNext(): void {
    if (!this.#started || this.#timer) return;
    this.#timer = this.#dependencies.setTimer(() => {
      this.#timer = null;
      void this.sampleNow().finally(() => this.#scheduleNext());
    }, this.#currentIntervalMs());
  }
}

export type DiagnosticsRuntimeDependencies = RuntimeDependencies;
