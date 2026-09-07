import { describe, expect, it } from "vitest";

import {
  HISTORY_CHART_BASELINE,
  historyPointY,
  historyTimelineSlots,
  historyWavePaths,
} from "@/features/settings/components/screens/Settings/diagnostics/diagnostics-resource-history";
import type { DiagnosticsHistorySeries } from "@shared/diagnostics-types";

const series: DiagnosticsHistorySeries = {
  range: "1h",
  resolution: "raw",
  requested: { startAtMs: 60_000, endAtMs: 100_000 },
  available: { oldestAtMs: 60_000, newestAtMs: 100_000 },
  recorder: {
    kind: "ready",
    lastFailureAtMs: null,
    rawRetentionMs: 60 * 60_000,
    summaryRetentionMs: 7 * 24 * 60 * 60_000,
    samplingIntervalMs: 5_000,
    databaseBytes: 0,
  },
  buckets: [
    {
      startedAtMs: 70_000,
      endedAtMs: 80_000,
      averageCpuPercent: 1,
      maximumCpuPercent: 92,
      maximumCpuAtMs: 74_000,
      averageResidentBytes: 100,
      maximumResidentBytes: 250,
      maximumResidentAtMs: 74_000,
      sampleCount: 1,
      observedDurationMs: 5_000,
      gapDurationMs: 0,
    },
    {
      startedAtMs: 90_000,
      endedAtMs: 100_000,
      averageCpuPercent: 2,
      maximumCpuPercent: 3,
      maximumCpuAtMs: 92_000,
      averageResidentBytes: 110,
      maximumResidentBytes: 120,
      maximumResidentAtMs: 92_000,
      sampleCount: 1,
      observedDurationMs: 5_000,
      gapDurationMs: 0,
    },
  ],
  incidents: [],
  gaps: [
    {
      startedAtMs: 80_000,
      endedAtMs: 90_000,
      cause: "source-failure",
      sources: ["electron-processes"],
    },
  ],
};

// Guards: the history chart must preserve the requested timeline and render absent data as explicit gaps.
// Guards: smoothing must retain exact sampled peaks and zeroes without inventing spikes or connecting across gaps.
describe("diagnostics history timeline", () => {
  it("keeps missing intervals in the fixed axis and retains observed peak buckets", () => {
    expect(historyTimelineSlots(series)).toEqual([
      { kind: "gap", startedAtMs: 60_000, endedAtMs: 70_000, cause: null },
      { kind: "observed", bucket: series.buckets[0] },
      { kind: "gap", startedAtMs: 80_000, endedAtMs: 90_000, cause: "source-failure" },
      { kind: "observed", bucket: series.buckets[1] },
    ]);
  });

  it("breaks curves at gaps while retaining isolated samples", () => {
    const paths = historyWavePaths({
      slots: historyTimelineSlots(series),
      value: (bucket) => bucket.maximumCpuPercent,
      maximum: 100,
    });
    expect(paths).toHaveLength(2);
    expect(paths.map((path) => path.line)).toEqual([
      `M 375 ${historyPointY(92, 100)}`,
      `M 875 ${historyPointY(3, 100)}`,
    ]);
    expect(historyPointY(0, 100)).toBe(HISTORY_CHART_BASELINE);
    expect(historyPointY(100, 100)).toBe(4);
    expect(historyWavePaths({ slots: [], value: () => 0, maximum: 1 })).toEqual([]);
  });

  it("keeps every interpolated segment within its sampled endpoints", () => {
    const bucket = series.buckets[0];
    if (!bucket) throw new Error("Fixture needs an observed bucket");
    const peaks = [0, 100, 5, 5, 85, 0];
    const [path] = historyWavePaths({
      slots: peaks.map((maximumCpuPercent) => ({
        kind: "observed",
        bucket: { ...bucket, maximumCpuPercent },
      })),
      value: (point) => point.maximumCpuPercent,
      maximum: 100,
    });
    expect(path).toBeDefined();
    const segments = path?.line.split(" C ").slice(1) ?? [];
    expect(segments).toHaveLength(peaks.length - 1);
    segments.forEach((segment, index) => {
      const [controlX1, controlY1, controlX2, controlY2, x, y] = segment.split(" ").map(Number);
      const from = historyPointY(peaks[index] ?? 0, 100);
      const to = historyPointY(peaks[index + 1] ?? 0, 100);
      expect(y).toBe(to);
      expect(x).toBeGreaterThan(controlX2 ?? 0);
      expect(controlX2).toBeGreaterThanOrEqual(controlX1 ?? 0);
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const interpolated =
          (1 - t) ** 3 * from +
          3 * (1 - t) ** 2 * t * (controlY1 ?? 0) +
          3 * (1 - t) * t ** 2 * (controlY2 ?? 0) +
          t ** 3 * (y ?? 0);
        expect(interpolated).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-10);
        expect(interpolated).toBeLessThanOrEqual(Math.max(from, to) + 1e-10);
      }
    });
  });
});
