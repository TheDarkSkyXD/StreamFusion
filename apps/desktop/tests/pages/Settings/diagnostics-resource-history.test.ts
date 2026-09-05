import { describe, expect, it } from "vitest";

import { historyTimelineSlots } from "@/pages/Settings/diagnostics/diagnostics-resource-history";
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
describe("diagnostics history timeline", () => {
  it("keeps missing intervals in the fixed axis and retains observed peak buckets", () => {
    expect(historyTimelineSlots(series)).toEqual([
      { kind: "gap", startedAtMs: 60_000, endedAtMs: 70_000, cause: null },
      { kind: "observed", bucket: series.buckets[0] },
      { kind: "gap", startedAtMs: 80_000, endedAtMs: 90_000, cause: "source-failure" },
      { kind: "observed", bucket: series.buckets[1] },
    ]);
  });
});
