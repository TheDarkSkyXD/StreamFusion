import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteDiagnosticsHistoryRecorder } from "@backend/diagnostics/diagnostics-history-recorder";
import type { DiagnosticsActivityReport, ProcessObservation } from "@shared/diagnostics-types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BASE = Date.UTC(2026, 8, 1, 12);
const MB = 1_048_576;
const INSTANCE = "00000000-0000-4000-8000-000000000001";
const directories: string[] = [];
const recorders: SqliteDiagnosticsHistoryRecorder[] = [];

function open(
  path = ":memory:",
  atMs = BASE,
  instanceId = INSTANCE
): SqliteDiagnosticsHistoryRecorder {
  const recorder = new SqliteDiagnosticsHistoryRecorder(path);
  recorder.start(instanceId, atMs);
  recorders.push(recorder);
  return recorder;
}

function processAt(atMs: number, cpu: number, memory: number, pid = 100): ProcessObservation {
  return {
    observationId: `00000000-0000-4000-8000-${String(pid).padStart(12, "0")}`,
    observedAtMs: atMs,
    pid,
    startedAtMs: BASE - MINUTE,
    parentPid: null,
    category: "renderer",
    displayName: `Renderer ${pid}`,
    currentCpuPercent: cpu,
    averageCpuPercent: cpu,
    peakCpuPercent: cpu,
    cumulativeCpuMs: null,
    residentBytes: memory,
    peakResidentBytes: memory,
    readBytesPerSecond: null,
    writeBytesPerSecond: null,
    readTotalBytes: null,
    writeTotalBytes: null,
    samples: 1,
    interrupt: { kind: "unsupported", capability: "process-signals" },
    force: { kind: "unsupported", capability: "process-signals" },
  };
}

function record(
  recorder: SqliteDiagnosticsHistoryRecorder,
  atMs: number,
  cpu: number,
  memory: number,
  processes: readonly ProcessObservation[] = [processAt(atMs, cpu, memory)],
  activity: DiagnosticsActivityReport | null = null
): void {
  recorder.record({
    instanceId: INSTANCE,
    observedAtMs: atMs,
    point: {
      observedAtMs: atMs,
      cpuPercent: cpu,
      residentMemoryBytes: memory,
      processCount: processes.length,
      readBytesPerSecond: null,
      writeBytesPerSecond: null,
    },
    processes,
    activity,
    gaps: [],
  });
}

afterEach(() => {
  for (const recorder of recorders.splice(0)) recorder.stop(BASE + 9 * DAY, true);
  for (const directory of directories.splice(0)) {
    if (
      dirname(directory) !== resolve(tmpdir()) ||
      !basename(directory).startsWith("streamfusion-diag-evidence-")
    ) {
      throw new Error("Unexpected test directory");
    }
    rmSync(directory, { recursive: true });
  }
});

// Guards: resource peaks retain their source timestamps, and falling RAM is not reported as growth.
// Guards: old selected periods retain exited contributors after fine samples expire and the database reopens.
// Guards: incident evidence remains available after the normal raw retention window.
// Guards: bounded storage recovers after pressure, and RAM-heavy contributors and gradual growth remain visible.
// Guards: a full recent hour keeps fine resolution and its newest peak across unaligned bucket boundaries.
// Guards: clean restarts preserve historical evidence, append new observations, and expose closed intervals without fake samples.
// Guards: hourly history preserves peak timestamps and chronological RAM through ninety-day retention.
// Guards: a later interrupted session does not turn an earlier running interval into an app-closed gap.
describe("diagnostics historical evidence", () => {
  it("keeps closed gaps separate across clean and interrupted sessions", () => {
    const directory = mkdtempSync(join(tmpdir(), "streamfusion-diag-evidence-"));
    directories.push(directory);
    const path = join(directory, "history.sqlite");
    const first = open(path);
    record(first, BASE, 2, 100 * MB);
    first.stop(BASE + MINUTE, true);
    const second = open(path, BASE + HOUR, "00000000-0000-4000-8000-000000000002");
    record(second, BASE + HOUR, 4, 120 * MB);
    record(second, BASE + HOUR + 5 * MINUTE, 12, 180 * MB);
    second.stop(BASE + HOUR + 6 * MINUTE, false);
    const third = open(path, BASE + 2 * HOUR, "00000000-0000-4000-8000-000000000003");
    record(third, BASE + 2 * HOUR, 2, 130 * MB);
    const history = third.queryHistory({ range: "24h", endAtMs: BASE + 2 * HOUR });
    expect(history.gaps.filter((gap) => gap.cause === "app-closed")).toEqual([
      {
        startedAtMs: BASE + MINUTE,
        endedAtMs: BASE + HOUR,
        cause: "app-closed",
        sources: ["collector"],
      },
      {
        startedAtMs: BASE + HOUR + 5 * MINUTE,
        endedAtMs: BASE + 2 * HOUR,
        cause: "app-closed",
        sources: ["collector"],
      },
    ]);
    expect(
      history.buckets.some((bucket) => bucket.maximumCpuAtMs === BASE + HOUR + 5 * MINUTE)
    ).toBe(true);
  });

  it("keeps a full recent hour at fine resolution including its latest boundary peak", () => {
    const recorder = open();
    for (let seconds = 0; seconds <= 7_205; seconds += 5)
      record(recorder, BASE + seconds * 1_000, seconds === 7_205 ? 99 : 2, 200 * MB);
    const history = recorder.queryHistory({ range: "1h", endAtMs: BASE + 7_205_000 });
    expect(history.resolution).toBe("raw");
    expect(history.buckets.at(-1)?.maximumCpuPercent).toBe(99);
    expect(history.buckets.length).toBeLessThanOrEqual(361);
  });
  it("keeps chronological memory and the winning peak timestamp in fine and minute detail", () => {
    const recorder = open();
    record(recorder, BASE, 10, 200 * MB);
    record(recorder, BASE + 5_000, 92, 500 * MB);
    record(recorder, BASE + 10_000, 1, 100 * MB);
    const status = recorder.queryHistory({ range: "1h", endAtMs: BASE + MINUTE }).recorder;
    expect(status.kind, JSON.stringify(status)).toBe("ready");
    expect(
      recorder.queryHistory({ range: "1h", endAtMs: BASE + MINUTE }).available.newestAtMs
    ).toBe(BASE + 10_000);
    const selection = { kind: "bucket", startedAtMs: BASE, endedAtMs: BASE + MINUTE } as const;
    const recent = recorder.queryContext(selection);
    expect(recent?.contributors[0]).toMatchObject({
      firstResidentBytes: 200 * MB,
      lastResidentBytes: 100 * MB,
      maximumResidentBytes: 500 * MB,
      maximumResidentAtMs: BASE + 5_000,
      maximumCpuPercent: 92,
      maximumCpuAtMs: BASE + 5_000,
    });
    record(recorder, BASE + DAY, 1, 100 * MB, []);
    expect(recorder.queryContext(selection)?.contributors[0]).toMatchObject({
      firstResidentBytes: 200 * MB,
      lastResidentBytes: 100 * MB,
      maximumCpuAtMs: BASE + 5_000,
      maximumResidentAtMs: BASE + 5_000,
    });
  });

  it("loads yesterday's one-hour range and its exited process after reopening the real database", () => {
    const directory = mkdtempSync(join(tmpdir(), "streamfusion-diag-evidence-"));
    directories.push(directory);
    const path = join(directory, "history.sqlite");
    const recorder = open(path);
    record(recorder, BASE, 4, 200 * MB);
    record(recorder, BASE + 5_000, 93, 250 * MB);
    record(recorder, BASE + MINUTE, 2, 100 * MB, []);
    record(recorder, BASE + DAY, 1, 100 * MB, []);
    recorder.stop(BASE + DAY, true);
    const reopened = open(path, BASE + DAY + 5_000);
    const history = reopened.queryHistory({ range: "1h", endAtMs: BASE + HOUR });
    expect(history.recorder.kind).toBe("ready");
    expect(Math.max(...history.buckets.map((bucket) => bucket.maximumCpuPercent))).toBe(93);
    const context = reopened.queryContext({
      kind: "bucket",
      startedAtMs: BASE,
      endedAtMs: BASE + MINUTE,
    });
    expect(context?.contributors[0]).toMatchObject({ pid: 100, exitedAtMs: BASE + MINUTE });
    expect(context?.contributors[0]).not.toHaveProperty("force");
  });

  it("preserves a brief incident and its surrounding process evidence after one day", () => {
    const recorder = open();
    for (let second = 0; second <= 660; second += 5) {
      record(recorder, BASE + second * 1_000, second === 300 ? 95 : 2, 200 * MB);
    }
    const firstHistory = recorder.queryHistory({ range: "1h", endAtMs: BASE + 660_000 });
    const incident = firstHistory.incidents.find((entry) => entry.kind === "cpu-spike");
    expect(incident).toBeDefined();
    if (!incident) throw new Error("CPU spike was not retained");
    record(recorder, BASE + DAY, 1, 100 * MB, []);
    const context = recorder.queryContext({ kind: "incident", incidentId: incident.incidentId });
    expect(context?.bucket.maximumCpuPercent).toBe(95);
    expect(context?.bucket.maximumCpuAtMs).toBe(BASE + 300_000);
    expect(context?.contributors[0].firstObservedAtMs).toBeLessThan(BASE + 300_000);
    expect(context?.contributors[0].lastObservedAtMs).toBeGreaterThan(BASE + 300_000);
    expect(context?.detailResolution).toBe("raw");
    expect(context?.samples.length).toBeGreaterThan(30);
    expect(context?.samples.find((sample) => sample.maximumCpuPercent === 95)?.maximumCpuAtMs).toBe(
      BASE + 300_000
    );
  });

  it("does not invent five seconds of coverage for every one-second observation", () => {
    const recorder = open();
    for (let second = 0; second < 60; second++)
      record(recorder, BASE + second * 1_000, 1, 200 * MB);
    const history = recorder.queryHistory({ range: "1h", endAtMs: BASE + MINUTE });
    expect(history.buckets.length).toBeGreaterThan(0);
    const covered = history.buckets.reduce((sum, bucket) => sum + bucket.observedDurationMs, 0);
    expect(covered).toBeLessThanOrEqual(MINUTE + 5_000);
    expect(covered).toBeGreaterThanOrEqual(55_000);
  });

  it("does not mark a quiet living process exited when contributors exceed the display limit", () => {
    const recorder = open();
    const processes = Array.from({ length: 14 }, (_, index) =>
      processAt(BASE, index + 1, 200 * MB, index + 100)
    );
    record(recorder, BASE, 40, 3_000 * MB, processes);
    const later = processes.map((process) => ({
      ...process,
      observedAtMs: BASE + MINUTE,
      currentCpuPercent: process.pid === 100 ? 99 : 0,
    }));
    record(recorder, BASE + MINUTE, 40, 3_000 * MB, later);
    const context = recorder.queryContext({
      kind: "bucket",
      startedAtMs: BASE,
      endedAtMs: BASE + 2 * MINUTE,
    });
    expect(context?.contributors.length).toBeGreaterThan(0);
    expect(context?.contributors.every((process) => process.exitedAtMs === null)).toBe(true);
  });

  it("shows seven days while preserving older evidence in hourly history", () => {
    const recorder = open();
    for (let day = 0; day <= 8; day++) {
      record(recorder, BASE + day * DAY + 15_000, day === 0 ? 99 : 10 + day, (200 + day) * MB);
    }
    const history = recorder.queryHistory({ range: "7d", endAtMs: BASE + 8 * DAY + MINUTE });
    expect(history.recorder.kind).toBe("ready");
    expect(history.buckets.length).toBeGreaterThanOrEqual(7);
    expect(Math.max(...history.buckets.map((bucket) => bucket.maximumCpuPercent))).toBe(18);
    expect(history.available.oldestAtMs).toBe(BASE + 15_000);
    expect(history.available.newestAtMs).toBe(BASE + 8 * DAY + 15_000);
    expect(
      recorder.queryContext({ kind: "bucket", startedAtMs: BASE, endedAtMs: BASE + MINUTE })
    ).toMatchObject({ detailResolution: "hour", bucket: { maximumCpuPercent: 99 } });
  });

  it("preserves old evidence through two clean restarts and resumes without filling closed time", () => {
    const directory = mkdtempSync(join(tmpdir(), "streamfusion-diag-evidence-"));
    directories.push(directory);
    const path = join(directory, "restart.sqlite");
    const original = open(path);
    record(original, BASE, 2, 100 * MB);
    record(original, BASE + 15_000, 90, 500 * MB);
    record(original, BASE + 45_000, 3, 120 * MB, [processAt(BASE + 45_000, 3, 120 * MB)], {
      observedAtMs: BASE + 45_000,
      route: "/",
      heapUsedBytes: 60 * MB,
      domNodeCount: 123,
      chatEvents: 4,
      activeStreamSlots: 1,
      activeVideoElements: 2,
    });
    original.stop(BASE + MINUTE, true);
    const reopened = open(path, BASE + 60 * DAY, "00000000-0000-4000-8000-000000000002");
    record(reopened, BASE + 60 * DAY + 5_000, 2, 160 * MB, [
      processAt(BASE + 60 * DAY + 5_000, 2, 160 * MB, 101),
    ]);
    const selection = { kind: "bucket", startedAtMs: BASE, endedAtMs: BASE + HOUR } as const;
    const oldDetail = reopened.queryContext(selection);
    expect(oldDetail).toMatchObject({
      detailResolution: "hour",
      bucket: {
        maximumCpuPercent: 90,
        maximumCpuAtMs: BASE + 15_000,
        maximumResidentBytes: 500 * MB,
      },
    });
    expect(oldDetail?.contributors[0]).toMatchObject({
      pid: 100,
      firstResidentBytes: 100 * MB,
      lastResidentBytes: 120 * MB,
      maximumCpuAtMs: BASE + 15_000,
    });
    expect(oldDetail?.contributors[0].exitedAtMs).toBe(BASE + MINUTE);
    expect(oldDetail?.renderer).toMatchObject({
      route: "/",
      heapUsedBytes: 60 * MB,
      domNodeCount: 123,
    });
    reopened.stop(BASE + 60 * DAY + MINUTE, true);
    const secondReopen = open(path, BASE + 61 * DAY, "00000000-0000-4000-8000-000000000003");
    record(secondReopen, BASE + 61 * DAY + 5_000, 1, 100 * MB);
    const history = secondReopen.queryHistory({ range: "90d", endAtMs: BASE + 61 * DAY + MINUTE });
    expect(history.recorder.kind).toBe("ready");
    expect(history.available).toEqual({ oldestAtMs: BASE, newestAtMs: BASE + 61 * DAY + 5_000 });
    expect(Math.max(...history.buckets.map((bucket) => bucket.maximumCpuPercent))).toBe(90);
    expect(history.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cause: "app-closed",
          startedAtMs: BASE + MINUTE,
          endedAtMs: BASE + 60 * DAY,
        }),
        expect.objectContaining({
          cause: "app-closed",
          startedAtMs: BASE + 60 * DAY + MINUTE,
          endedAtMs: BASE + 61 * DAY,
        }),
      ])
    );
    expect(
      history.buckets.some(
        (bucket) => bucket.startedAtMs > BASE + DAY && bucket.endedAtMs < BASE + 59 * DAY
      )
    ).toBe(false);
    expect(history.buckets.every((bucket) => bucket.sampleCount > 0)).toBe(true);
  });

  it("bounds ninety days of history while retaining peaks in the thirty-day view", () => {
    const recorder = open();
    for (let day = 0; day <= 92; day++) {
      record(
        recorder,
        BASE + day * DAY + 15_000,
        day === 0 ? 99 : day === 75 ? 88 : 2,
        (200 + day) * MB
      );
      record(recorder, BASE + day * DAY + 20_000, 1, 100 * MB);
    }
    const ninety = recorder.queryHistory({ range: "90d", endAtMs: BASE + 92 * DAY + MINUTE });
    const month = recorder.queryHistory({ range: "30d", endAtMs: BASE + 92 * DAY + MINUTE });
    expect(ninety.recorder.kind).toBe("ready");
    expect(ninety.buckets.length).toBeGreaterThanOrEqual(89);
    expect(ninety.buckets.length).toBeLessThanOrEqual(361);
    expect(Math.max(...ninety.buckets.map((bucket) => bucket.maximumCpuPercent))).toBe(88);
    expect(month.buckets.find((bucket) => bucket.maximumCpuPercent === 88)?.maximumCpuAtMs).toBe(
      BASE + 75 * DAY + 15_000
    );
    expect(ninety.available.oldestAtMs).toBeGreaterThanOrEqual(BASE + 2 * DAY);
    expect(
      recorder.queryContext({ kind: "bucket", startedAtMs: BASE, endedAtMs: BASE + HOUR })
    ).toBeNull();
  });

  it("offers short windows and real time without including peaks outside the chosen duration", () => {
    const recorder = open();
    record(recorder, BASE, 95, 200 * MB);
    record(recorder, BASE + 20 * MINUTE, 20, 100 * MB);
    record(recorder, BASE + 21 * MINUTE, 2, 100 * MB);
    for (const range of ["realtime", "5m", "30m", "1h", "24h"] as const) {
      const history = recorder.queryHistory({ range, endAtMs: BASE + 22 * MINUTE });
      expect(history.recorder.kind).toBe("ready");
      expect(history.range).toBe(range);
      expect(history.buckets.length).toBeLessThanOrEqual(361);
      expect(Math.max(...history.buckets.map((bucket) => bucket.maximumCpuPercent))).toBe(
        range === "realtime" || range === "5m" ? 20 : 95
      );
    }
  });

  it("keeps chronological endpoints and winning timestamps across several retained minutes", () => {
    const recorder = open();
    record(recorder, BASE, 2, 200 * MB);
    record(recorder, BASE + 5_000, 3, 250 * MB);
    record(recorder, BASE + MINUTE, 20, 80 * MB);
    record(recorder, BASE + MINUTE + 5_000, 1, 70 * MB);
    record(recorder, BASE + DAY, 1, 50 * MB, []);
    const context = recorder.queryContext({
      kind: "bucket",
      startedAtMs: BASE,
      endedAtMs: BASE + 2 * MINUTE,
    });
    expect(context?.contributors[0]).toMatchObject({
      firstResidentBytes: 200 * MB,
      lastResidentBytes: 70 * MB,
      maximumCpuPercent: 20,
      maximumCpuAtMs: BASE + MINUTE,
      maximumResidentBytes: 250 * MB,
      maximumResidentAtMs: BASE + 5_000,
    });
  });

  it("does not discard the older part of a range that crosses the fine-sample cutoff", () => {
    const recorder = open();
    record(recorder, BASE, 95, 200 * MB);
    record(recorder, BASE + 30 * MINUTE, 30, 200 * MB);
    record(recorder, BASE + 90 * MINUTE, 1, 200 * MB);
    const history = recorder.queryHistory({ range: "1h", endAtMs: BASE + 45 * MINUTE });
    expect(Math.max(...history.buckets.map((bucket) => bucket.maximumCpuPercent))).toBe(95);
  });

  it("detects gradual RAM growth independently of a simultaneous CPU incident", () => {
    const recorder = open();
    for (let minute = 0; minute <= 20; minute++) {
      record(recorder, BASE + minute * MINUTE, minute === 13 ? 90 : 2, (200 + minute * 20) * MB);
    }
    const history = recorder.queryHistory({ range: "1h", endAtMs: BASE + 21 * MINUTE });
    expect(history.incidents.map((incident) => incident.kind)).toEqual(
      expect.arrayContaining(["cpu-spike", "memory-growth"])
    );
    expect(history.incidents.some((incident) => incident.label === "Sustained RAM growth")).toBe(
      true
    );
  });

  it("includes a quiet RAM-heavy process alongside busy CPU contributors", () => {
    const recorder = open();
    const processes = Array.from({ length: 14 }, (_, index) =>
      processAt(BASE, index, 100 * MB, index + 100)
    );
    const memoryHog = processAt(BASE, 0, 2_000 * MB, 999);
    record(recorder, BASE, 99, 3_400 * MB, [...processes, memoryHog]);
    const detail = recorder.queryContext({
      kind: "bucket",
      startedAtMs: BASE,
      endedAtMs: BASE + MINUTE,
    });
    expect(detail?.contributors.some((process) => process.pid === 999)).toBe(true);
    expect(detail?.detailComplete).toBe(false);
  });

  it("aggregates the entire unaligned selected interval and keeps its RAM evidence", () => {
    const recorder = open();
    record(recorder, BASE + MINUTE, 2, 100 * MB);
    record(recorder, BASE + 11 * MINUTE, 5, 500 * MB);
    const selection = {
      kind: "bucket",
      startedAtMs: BASE + MINUTE,
      endedAtMs: BASE + 12 * MINUTE,
    } as const;
    const detail = recorder.queryContext(selection);
    expect(detail?.bucket).toMatchObject({
      startedAtMs: selection.startedAtMs,
      endedAtMs: selection.endedAtMs,
      maximumResidentBytes: 500 * MB,
    });
    expect(detail?.contributors[0].lastResidentBytes).toBe(500 * MB);
  });

  it("bounds disk use, reports storage pressure, and resumes after expired detail can be pruned", () => {
    const directory = mkdtempSync(join(tmpdir(), "streamfusion-diag-evidence-"));
    directories.push(directory);
    const recorder = new SqliteDiagnosticsHistoryRecorder(
      join(directory, "bounded.sqlite"),
      256 * 1024
    );
    recorder.start(INSTANCE, BASE);
    recorders.push(recorder);
    for (let second = 0; second < 500; second++) {
      const atMs = BASE + second * 1_000;
      record(
        recorder,
        atMs,
        2,
        100 * MB,
        Array.from({ length: 8 }, (_, index) =>
          processAt(atMs, index, (200 - index) * MB, index + 100)
        )
      );
    }
    const pressure = recorder.queryHistory({ range: "1h", endAtMs: BASE + 500_000 });
    expect(pressure.recorder.kind).toBe("degraded");
    expect(pressure.recorder.databaseBytes).toBeLessThanOrEqual(256 * 1024 + 1_048_576 + 32_768);
    record(recorder, BASE + 2 * HOUR, 1, 100 * MB);
    const recovered = recorder.queryHistory({ range: "1h", endAtMs: BASE + 2 * HOUR });
    expect(recovered.recorder.kind, JSON.stringify(recovered.recorder)).toBe("ready");
    expect(recovered.available.newestAtMs).toBe(BASE + 2 * HOUR);
    expect(recovered.gaps.length).toBeGreaterThan(0);
  });
});
