import { describe, expect, it, vi } from "vitest";

import {
  DiagnosticsRuntime,
  type DiagnosticsRuntimeDependencies,
  type ElectronProcessMetric,
} from "@/backend/diagnostics/diagnostics-runtime";
import type { ProcessIoSnapshot } from "@/backend/diagnostics/process-io-sampler";
import { diagnosticsSnapshotSchema } from "@/ipc-contracts/diagnostics-contracts";

const OVERVIEW = { tab: "overview", windowMinutes: 15 } as const;

function metric(overrides: Partial<ElectronProcessMetric> = {}): ElectronProcessMetric {
  return {
    pid: 100,
    type: "Browser",
    creationTime: 1_000,
    cpu: { percentCPUUsage: 12.5, cumulativeCPUUsage: 2.5 },
    memory: { workingSetSize: 128 * 1_024, peakWorkingSetSize: 160 * 1_024 },
    ...overrides,
  };
}

function createHarness(initialMetrics: readonly ElectronProcessMetric[] = [metric()]) {
  let nowMs = 10_000;
  let monotonicMs = 100;
  let metrics = initialMetrics;
  let shouldThrow = false;
  let id = 0;
  const timerDelays: number[] = [];
  const clearedTimers: number[] = [];
  const logLines: string[] = [];
  const ioIntervals: Array<number | null> = [];
  let ioProcessSetRefreshes = 0;
  let processIo: ProcessIoSnapshot = {
    kind: "ready",
    observedAtMs: nowMs,
    countersByPid: new Map([
      [100, { parentPid: 50, readBytesPerSecond: 4_096, writeBytesPerSecond: 2_048 }],
      [200, { parentPid: 100, readBytesPerSecond: 1_024, writeBytesPerSecond: 512 }],
    ]),
  };
  const dependencies: DiagnosticsRuntimeDependencies = {
    nowMs: () => nowMs,
    monotonicMs: () => monotonicMs,
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    platform: "win32",
    processPid: 100,
    cpuCount: 8,
    processCpuUsage: () => ({ user: 0, system: 0 }),
    processMemoryUsage: () => ({ rss: 128 * 1_024 * 1_024 }),
    getAppMetrics: () => {
      if (shouldThrow) throw new Error("scan failed");
      return metrics;
    },
    isOnBatteryPower: () => false,
    getSystemIdleTime: () => 4,
    getSystemIdleState: () => "active",
    getCpuSpeedLimitReading: () => ({ observedAtMs: nowMs, percent: 100 }),
    setTimer: (_callback, delayMs) => {
      timerDelays.push(delayMs);
      return timerDelays.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (timer) => clearedTimers.push(timer as unknown as number),
    readProcessIo: () => processIo,
    setProcessIoSamplingInterval: (intervalMs) => ioIntervals.push(intervalMs),
    refreshProcessIoProcessSet: () => {
      ioProcessSetRefreshes += 1;
    },
    writeProcessMonitorLine: (line) => logLines.push(line),
  };
  const runtime = new DiagnosticsRuntime(dependencies);
  return {
    runtime,
    timerDelays,
    clearedTimers,
    logLines,
    ioIntervals,
    get ioProcessSetRefreshes() {
      return ioProcessSetRefreshes;
    },
    advance(ms: number) {
      nowMs += ms;
      monotonicMs += ms;
    },
    replaceMetrics(next: readonly ElectronProcessMetric[]) {
      metrics = next;
    },
    failScan() {
      shouldThrow = true;
    },
    replaceProcessIo(next: ProcessIoSnapshot) {
      processIo = next;
    },
  };
}

// Guards: the production Diagnostics route gets an immediate real observation rather than prototype values.
// Guards: visible consumers share one one-second cadence and cleanup restores the thirty-second baseline.
// Guards: Windows process I/O rates are aggregated by Electron PID and warming state is not mislabeled unsupported.
// Guards: source failure preserves the last observation as stale instead of inventing zero activity.
// Guards: the serialized snapshot rejects extra fields and unsupported values carrying invented data.
// Guards: process history exposes windowed average and peak CPU rather than copying the latest sample.
// Guards: process identity tracks starts, exits, parentage, and observed I/O totals for the resource monitor and tree.
// Guards: trace snapshots transport latest and grouped failure evidence through the strict IPC schema.
// Guards: live resource snapshots keep IPC history bounded while the runtime retains the full statistical window.
describe("DiagnosticsRuntime", () => {
  it("validates the failure collections carried by the Traces detail", async () => {
    const harness = createHarness();
    await harness.runtime.start();

    const snapshot = harness.runtime.snapshot({ tab: "traces", windowMinutes: 15 });

    expect(snapshot.detail).toMatchObject({
      tab: "traces",
      latestFailures: [],
      commonFailures: [],
    });
    expect(diagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("takes an immediate sample and exposes real Electron process values", async () => {
    const harness = createHarness([
      metric(),
      metric({
        pid: 200,
        type: "GPU",
        creationTime: 2_000,
        cpu: { percentCPUUsage: 7.5, cumulativeCPUUsage: 1 },
        memory: { workingSetSize: 64 * 1_024, peakWorkingSetSize: 80 * 1_024 },
      }),
    ]);

    await harness.runtime.start();
    const snapshot = harness.runtime.snapshot(OVERVIEW);

    expect(snapshot.overview.footprint.cpuPercent).toMatchObject({ value: 20 });
    expect(snapshot.overview.footprint.residentMemoryBytes).toMatchObject({
      value: 192 * 1_024 * 1_024,
    });
    expect(snapshot.overview.footprint.processCount).toMatchObject({ value: 2 });
    expect(snapshot.overview.footprint.readBytesPerSecond).toMatchObject({ value: 5_120 });
    expect(snapshot.overview.footprint.writeBytesPerSecond).toMatchObject({ value: 2_560 });
    expect(snapshot.overview.footprint.cpuSpeedLimitPercent).toMatchObject({
      source: "host-power",
      value: 100,
    });
    expect(snapshot.overview.collection).toMatchObject({ processStarts: 2, processExits: 0 });
    expect(snapshot.sourceStatuses["electron-processes"].kind).toBe("ready");
    expect(harness.timerDelays).toEqual([30_000]);
    expect(harness.logLines[0]).toContain("rss=192MB cpu=20% procs=2");
    expect(diagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("deduplicates one document lease and restores baseline cadence after cleanup", async () => {
    const harness = createHarness();
    await harness.runtime.start();
    const publish = vi.fn();
    const first = await harness.runtime.openLease({
      ownerId: 7,
      documentInstanceId: "document-a",
      view: OVERVIEW,
      publish,
    });
    const duplicate = await harness.runtime.openLease({
      ownerId: 7,
      documentInstanceId: "document-a",
      view: OVERVIEW,
      publish,
    });

    expect(duplicate.leaseId).toBe(first.leaseId);
    expect(harness.timerDelays.at(-1)).toBe(1_000);
    expect(harness.ioIntervals).toEqual([1_000]);
    expect(harness.runtime.closeLease(7, first.leaseId)).toBe(true);
    expect(harness.timerDelays.at(-1)).toBe(30_000);
    expect(harness.ioIntervals).toEqual([1_000, null]);
    expect(harness.runtime.closeLease(7, first.leaseId)).toBe(false);
  });

  it("samples visible resources every second without publishing renderer snapshots every second", async () => {
    const harness = createHarness();
    await harness.runtime.start();
    const publish = vi.fn();
    await harness.runtime.openLease({
      ownerId: 7,
      documentInstanceId: "document-a",
      view: { tab: "resources", windowMinutes: 15 },
      publish,
    });

    for (let second = 1; second < 5; second += 1) {
      harness.advance(1_000);
      await harness.runtime.sampleNow();
    }
    expect(publish).not.toHaveBeenCalled();

    harness.advance(1_000);
    await harness.runtime.sampleNow();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[1]).toMatchObject({
      observedAtMs: 15_000,
      view: { tab: "resources", windowMinutes: 15 },
    });
  });

  it("reports Windows process I/O as temporarily unavailable while its collector warms", async () => {
    const harness = createHarness();
    harness.replaceProcessIo({ kind: "unavailable", sinceMs: 9_500 });

    await harness.runtime.start();
    const snapshot = harness.runtime.snapshot({ tab: "processes", windowMinutes: 15 });

    expect(snapshot.overview.footprint.readBytesPerSecond.status.kind).toBe("unavailable");
    expect(snapshot.sourceStatuses["process-io"].kind).toBe("unavailable");
    expect(snapshot.detail).toMatchObject({
      tab: "processes",
      processes: [{ readBytesPerSecond: null, writeBytesPerSecond: null }],
    });
  });

  it("refreshes native I/O counters immediately when the Electron PID set changes", async () => {
    const harness = createHarness();
    await harness.runtime.start();
    const lease = await harness.runtime.openLease({
      ownerId: 7,
      documentInstanceId: "document-a",
      view: OVERVIEW,
      publish: vi.fn(),
    });

    harness.replaceMetrics([metric(), metric({ pid: 200, creationTime: 2_000 })]);
    harness.advance(1_000);
    await harness.runtime.sampleNow();
    await harness.runtime.sampleNow();

    expect(harness.ioProcessSetRefreshes).toBe(1);
    harness.runtime.closeLease(7, lease.leaseId);
  });

  it("accumulates observed process I/O and records parentage and exits", async () => {
    const harness = createHarness([metric(), metric({ pid: 200, creationTime: 2_000 })]);
    await harness.runtime.start();

    harness.advance(1_000);
    await harness.runtime.sampleNow();
    let snapshot = harness.runtime.snapshot({ tab: "processes", windowMinutes: 15 });
    expect(snapshot.detail).toMatchObject({
      tab: "processes",
      processes: [
        { pid: 100, parentPid: 50, readTotalBytes: 4_096, writeTotalBytes: 2_048 },
        { pid: 200, parentPid: 100, readTotalBytes: 1_024, writeTotalBytes: 512 },
      ],
    });

    harness.replaceMetrics([metric()]);
    harness.advance(1_000);
    await harness.runtime.sampleNow();
    snapshot = harness.runtime.snapshot({ tab: "processes", windowMinutes: 15 });
    expect(snapshot.overview.collection).toMatchObject({ processStarts: 2, processExits: 1 });
    expect(diagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("aggregates process CPU history across the selected window", async () => {
    const harness = createHarness([
      metric({
        cpu: { percentCPUUsage: 10, cumulativeCPUUsage: 2.5 },
        memory: { workingSetSize: 128 * 1_024, peakWorkingSetSize: 160 * 1_024 },
      }),
    ]);
    await harness.runtime.start();

    harness.replaceMetrics([
      metric({
        cpu: { percentCPUUsage: 30, cumulativeCPUUsage: 3.5 },
        memory: { workingSetSize: 192 * 1_024, peakWorkingSetSize: 224 * 1_024 },
      }),
    ]);
    harness.advance(1_000);
    await harness.runtime.sampleNow();

    const snapshot = harness.runtime.snapshot({ tab: "processes", windowMinutes: 15 });
    expect(snapshot.detail).toMatchObject({
      tab: "processes",
      processes: [
        {
          averageCpuPercent: 20,
          peakCpuPercent: 30,
          peakResidentBytes: 192 * 1_024 * 1_024,
          samples: 2,
        },
      ],
    });
    expect(diagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("bounds resource history transported by the live diagnostics lease", async () => {
    const harness = createHarness();
    await harness.runtime.start();

    for (let sample = 1; sample <= 300; sample += 1) {
      harness.advance(1_000);
      await harness.runtime.sampleNow();
    }

    const snapshot = harness.runtime.snapshot({ tab: "resources", windowMinutes: 15 });
    expect(snapshot.overview.collection.retainedSamples).toBe(301);
    expect(snapshot.detail).toMatchObject({ tab: "resources" });
    if (snapshot.detail.tab !== "resources") throw new Error("Expected resource detail");
    expect(snapshot.detail.history.length).toBeLessThanOrEqual(120);
    expect(snapshot.detail.history.at(-1)?.observedAtMs).toBe(snapshot.observedAtMs);
    expect(diagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("marks retained values stale when a later process scan fails", async () => {
    const harness = createHarness();
    await harness.runtime.start();
    harness.advance(1_000);
    harness.failScan();
    await harness.runtime.sampleNow();

    const cpu = harness.runtime.snapshot(OVERVIEW).overview.footprint.cpuPercent;
    expect(cpu.status.kind).toBe("stale");
    expect("value" in cpu ? cpu.value : null).toBe(12.5);
  });

  it("does not transport an arbitrary Electron process name", async () => {
    const harness = createHarness([
      metric({ pid: 200, type: "Utility", name: "Bearer super-secret-token" }),
    ]);
    await harness.runtime.start();
    const snapshot = harness.runtime.snapshot({ tab: "processes", windowMinutes: 15 });
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain("super-secret-token");
  });

  it("publishes a strictly typed renderer performance observation", async () => {
    const harness = createHarness();
    await harness.runtime.start();
    harness.runtime.reportRendererPerformance(7, {
      observedAtMs: 10_000,
      heapUsedBytes: 40_000_000,
      heapTotalBytes: 80_000_000,
      framesPerSecond: 59.8,
      averageFrameTimeMs: 16.7,
      liveIntervalCount: 5,
      renderCount: 123,
      chatStoreCallsPerSecond: 4.2,
    });

    const snapshot = harness.runtime.snapshot({ tab: "developer-tools", windowMinutes: 15 });

    expect(snapshot.sourceStatuses["renderer-performance"].kind).toBe("ready");
    expect(snapshot.detail).toMatchObject({
      tab: "developer-tools",
      renderer: { value: { framesPerSecond: 59.8, chatStoreCallsPerSecond: 4.2 } },
    });
    expect(diagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("rejects hostile extra fields and invented unsupported values", async () => {
    const harness = createHarness();
    await harness.runtime.start();
    const snapshot = structuredClone(harness.runtime.snapshot(OVERVIEW)) as unknown as Record<
      string,
      unknown
    >;
    snapshot.absolutePath = "C:\\Users\\Alice\\secret.log";
    snapshot.url = "https://example.test/private?token=secret#account";
    snapshot.body = "private response body";
    expect(diagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(false);

    const unsupportedWithValue = structuredClone(harness.runtime.snapshot(OVERVIEW)) as unknown as {
      overview: { footprint: { readBytesPerSecond: Record<string, unknown> } };
    };
    unsupportedWithValue.overview.footprint.readBytesPerSecond = {
      source: "process-io",
      status: { kind: "unsupported", platform: "win32", capability: "process-io" },
      value: 0,
    } as never;
    expect(diagnosticsSnapshotSchema.safeParse(unsupportedWithValue).success).toBe(false);
  });
});
