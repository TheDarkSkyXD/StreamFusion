import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteDiagnosticsHistoryRecorder } from "@backend/diagnostics/diagnostics-history-recorder";
import type { ProcessObservation } from "@shared/diagnostics-types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const EIGHT_HOURS = 8 * HOUR;
const BASE = Date.UTC(2026, 7, 1, 12);
const INSTANCE = "00000000-0000-4000-8000-000000000901";
const directories: string[] = [];
const recorders: SqliteDiagnosticsHistoryRecorder[] = [];

function processAt(atMs: number, cpu: number): ProcessObservation {
  return {
    observationId: "00000000-0000-4000-8000-000000000902",
    observedAtMs: atMs,
    pid: 902,
    startedAtMs: BASE - MINUTE,
    parentPid: null,
    category: "renderer",
    displayName: "Legacy renderer",
    currentCpuPercent: cpu,
    averageCpuPercent: cpu,
    peakCpuPercent: cpu,
    cumulativeCpuMs: null,
    residentBytes: 512 * 1_048_576,
    peakResidentBytes: 512 * 1_048_576,
    readBytesPerSecond: null,
    writeBytesPerSecond: null,
    readTotalBytes: null,
    writeTotalBytes: null,
    samples: 1,
    interrupt: { kind: "unsupported", capability: "process-signals" },
    force: { kind: "unsupported", capability: "process-signals" },
  };
}

function record(recorder: SqliteDiagnosticsHistoryRecorder, atMs: number, cpu: number): void {
  recorder.record({
    instanceId: INSTANCE,
    observedAtMs: atMs,
    point: {
      observedAtMs: atMs,
      cpuPercent: cpu,
      residentMemoryBytes: 512 * 1_048_576,
      processCount: 1,
      readBytesPerSecond: null,
      writeBytesPerSecond: null,
    },
    processes: [processAt(atMs, cpu)],
    activity:
      atMs === BASE + 45_000
        ? {
            observedAtMs: atMs,
            route: "/settings/diagnostics",
            heapUsedBytes: 64 * 1_048_576,
            domNodeCount: 902,
            chatEvents: 3,
            activeStreamSlots: 1,
            activeVideoElements: 1,
          }
        : null,
    gaps: [],
  });
}

afterEach(() => {
  for (const recorder of recorders.splice(0)) recorder.stop(BASE + 92 * DAY, true);
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

// Guards: upgrading a minute-only diagnostics database creates durable hourly rows once.
// Guards: reopening after a backfill does not duplicate hourly samples or discard renderer evidence.
describe("diagnostics hourly rollup backfill", () => {
  it("backfills legacy minute evidence idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "streamfusion-diagnostics-rollup-"));
    directories.push(directory);
    const path = join(directory, "diagnostics.sqlite");
    const legacy = new SqliteDiagnosticsHistoryRecorder(path);
    recorders.push(legacy);
    legacy.start(INSTANCE, BASE);
    record(legacy, BASE, 10);
    record(legacy, BASE + 45_000, 95);
    legacy.stop(BASE + MINUTE, true);

    const database = new Database(path);
    database.exec(
      "DELETE FROM resource_hour; DELETE FROM hour_contributor; DELETE FROM activity_hour; DELETE FROM renderer_hour;"
    );
    database.close();

    const upgraded = new SqliteDiagnosticsHistoryRecorder(path);
    recorders.push(upgraded);
    upgraded.start("00000000-0000-4000-8000-000000000903", BASE + 60 * DAY);
    const first = upgraded.queryHistory({ range: "90d", endAtMs: BASE + 60 * DAY });
    const eightHourBucketAt = Math.floor(BASE / EIGHT_HOURS) * EIGHT_HOURS;
    const firstBucket = first.buckets.find((bucket) => bucket.startedAtMs === eightHourBucketAt);
    expect(first.recorder.kind).toBe("ready");
    expect(first.resolution).toBe("8h");
    expect(firstBucket).toMatchObject({ sampleCount: 2, maximumCpuPercent: 95 });
    const zoomed = upgraded.queryHistory({ range: "1h", endAtMs: BASE + 75 * MINUTE });
    expect(zoomed).toMatchObject({ resolution: "hour" });
    expect(zoomed.buckets).toContainEqual(
      expect.objectContaining({ startedAtMs: BASE, maximumCpuPercent: 95 })
    );
    const context = upgraded.queryContext({
      kind: "bucket",
      startedAtMs: BASE,
      endedAtMs: BASE + HOUR,
    });
    expect(context?.detailResolution).toBe("hour");
    expect(context?.contributors[0]).toMatchObject({
      firstObservedAtMs: BASE,
      lastObservedAtMs: BASE + 45_000,
      maximumCpuAtMs: BASE + 45_000,
    });
    expect(context?.renderer?.observedAtMs).toBe(BASE + 45_000);
    upgraded.stop(BASE + 60 * DAY + MINUTE, true);

    const prunedMinutes = new Database(path);
    prunedMinutes.exec(
      `DELETE FROM resource_minute WHERE started_at_ms = ${BASE};
       DELETE FROM minute_contributor WHERE started_at_ms = ${BASE};`
    );
    prunedMinutes.close();

    const reopened = new SqliteDiagnosticsHistoryRecorder(path);
    recorders.push(reopened);
    reopened.start("00000000-0000-4000-8000-000000000904", BASE + 61 * DAY);
    const second = reopened.queryHistory({ range: "90d", endAtMs: BASE + 61 * DAY });
    expect(second.buckets.find((bucket) => bucket.startedAtMs === eightHourBucketAt)).toMatchObject(
      {
        sampleCount: 2,
        maximumCpuPercent: 95,
      }
    );
    reopened.stop(BASE + 61 * DAY + MINUTE, true);
  });
});
