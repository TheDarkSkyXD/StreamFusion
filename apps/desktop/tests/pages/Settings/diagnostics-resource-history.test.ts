import { describe, expect, it } from "vitest";

import {
  bucketDiagnosticsResourceHistory,
  resourceHistoryBarHeight,
  resourceWindow,
} from "@/pages/Settings/diagnostics/diagnostics-resource-history";
import type { ResourcePoint } from "@shared/diagnostics-types";

function point(observedAtMs: number, overrides: Partial<ResourcePoint> = {}): ResourcePoint {
  return {
    observedAtMs,
    cpuPercent: 10,
    residentMemoryBytes: 100,
    processCount: 2,
    readBytesPerSecond: 1_000,
    writeBytesPerSecond: 500,
    ...overrides,
  };
}

// Guards: resource bars stay anchored to T3 Code's fixed time buckets instead of sliding every second.
// Guards: tooltip aggregates preserve CPU average, CPU peak, and observed read/write bytes.
describe("diagnostics resource history", () => {
  it("uses the same fixed bucket cadence for every selectable window", () => {
    expect(resourceWindow(5)).toEqual({ windowMs: 300_000, bucketMs: 15_000 });
    expect(resourceWindow(15)).toEqual({ windowMs: 900_000, bucketMs: 30_000 });
    expect(resourceWindow(30)).toEqual({ windowMs: 1_800_000, bucketMs: 60_000 });
    expect(resourceWindow(60)).toEqual({ windowMs: 3_600_000, bucketMs: 120_000 });
  });

  it("updates one anchored bucket until the next boundary", () => {
    const first = bucketDiagnosticsResourceHistory(
      [point(30_100), point(31_100, { cpuPercent: 20 })],
      15,
      31_100
    );
    const updated = bucketDiagnosticsResourceHistory(
      [point(30_100), point(31_100, { cpuPercent: 20 }), point(59_900)],
      15,
      59_900
    );
    const crossed = bucketDiagnosticsResourceHistory(
      [point(30_100), point(59_900), point(60_000)],
      15,
      60_000
    );

    expect(first.map((bucket) => bucket.startedAtMs)).toEqual([30_000]);
    expect(updated.map((bucket) => bucket.startedAtMs)).toEqual([30_000]);
    expect(crossed.map((bucket) => bucket.startedAtMs)).toEqual([30_000, 60_000]);
  });

  it("aggregates tooltip values without turning missing I/O into fake activity", () => {
    const [bucket] = bucketDiagnosticsResourceHistory(
      [
        point(30_100, { cpuPercent: 10, readBytesPerSecond: null, writeBytesPerSecond: null }),
        point(31_100, { cpuPercent: 30, readBytesPerSecond: 2_000, writeBytesPerSecond: 500 }),
      ],
      15,
      31_100
    );

    expect(bucket).toMatchObject({
      startedAtMs: 30_000,
      endedAtMs: 60_000,
      avgCpuPercent: 20,
      maxCpuPercent: 30,
      ioReadBytes: 2_000,
      ioWriteBytes: 500,
    });
  });

  it("matches T3 Code's minimum visible bar behavior", () => {
    expect(resourceHistoryBarHeight({ value: 0, max: 100, minimumVisiblePercent: 2 })).toBe(0);
    expect(resourceHistoryBarHeight({ value: 1, max: 100, minimumVisiblePercent: 2 })).toBe(2);
    expect(resourceHistoryBarHeight({ value: 50, max: 100, minimumVisiblePercent: 2 })).toBe(50);
  });
});
