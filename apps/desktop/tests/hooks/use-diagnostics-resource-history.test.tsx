import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagnosticsResourceHistory } from "@/features/settings/data/use-diagnostics-resource-history";
import type {
  DiagnosticsHistoryContext,
  DiagnosticsHistorySeries,
} from "@shared/diagnostics-types";

import { installElectronAPIMock } from "../test-utils";

const history: DiagnosticsHistorySeries = {
  range: "1h",
  resolution: "raw",
  requested: { startAtMs: 0, endAtMs: 3_600_000 },
  available: { oldestAtMs: 0, newestAtMs: 3_600_000 },
  recorder: {
    kind: "ready",
    lastFailureAtMs: null,
    rawRetentionMs: 60 * 60_000,
    summaryRetentionMs: 24 * 60 * 60_000,
    samplingIntervalMs: 1_000,
    databaseBytes: 0,
  },
  buckets: [],
  incidents: [],
  gaps: [],
};

const context: DiagnosticsHistoryContext = {
  selection: { kind: "bucket", startedAtMs: 0, endedAtMs: 60_000 },
  bucket: {
    startedAtMs: 0,
    endedAtMs: 60_000,
    averageCpuPercent: 10,
    maximumCpuPercent: 20,
    maximumCpuAtMs: 30_000,
    averageResidentBytes: 100,
    maximumResidentBytes: 120,
    maximumResidentAtMs: 30_000,
    sampleCount: 1,
    observedDurationMs: 60_000,
    gapDurationMs: 0,
  },
  samples: [],
  detailResolution: "raw",
  contributors: [],
  activity: [],
  renderer: null,
  incident: null,
  detailComplete: true,
};

// Guards: history reads stay scoped to the active diagnostics lease and pinned period.
// Guards: selecting a visual period retrieves its evidence through the same lease.
// Guards: bridge rejection ends loading and exposes an actionable failure state.
describe("useDiagnosticsResourceHistory", () => {
  beforeEach(() => {
    installElectronAPIMock();
  });

  it("queries the selected history period and its evidence through the active lease", async () => {
    const queryResourceHistory = vi.fn(async () => ({ kind: "ok" as const, value: history }));
    const queryResourceContext = vi.fn(async () => ({ kind: "ok" as const, value: context }));
    window.electronAPI.diagnostics.queryResourceHistory = queryResourceHistory;
    window.electronAPI.diagnostics.queryResourceContext = queryResourceContext;

    const { rerender } = renderHook(
      ({ selection }) =>
        useDiagnosticsResourceHistory({
          leaseId: "lease-1",
          range: "1h",
          endAtMs: 3_600_000,
          selection,
        }),
      { initialProps: { selection: null as null | DiagnosticsHistoryContext["selection"] } }
    );

    await waitFor(() =>
      expect(queryResourceHistory).toHaveBeenCalledWith({
        leaseId: "lease-1",
        range: "1h",
        endAtMs: 3_600_000,
      })
    );

    rerender({ selection: context.selection });

    await waitFor(() =>
      expect(queryResourceContext).toHaveBeenCalledWith({
        leaseId: "lease-1",
        selection: context.selection,
      })
    );
  });

  it("reports a rejected bridge call instead of leaving the evidence panel loading", async () => {
    window.electronAPI.diagnostics.queryResourceHistory = vi
      .fn()
      .mockRejectedValue(new Error("bridge closed"));
    window.electronAPI.diagnostics.queryResourceContext = vi
      .fn()
      .mockRejectedValue(new Error("bridge closed"));
    const { result } = renderHook(() =>
      useDiagnosticsResourceHistory({
        leaseId: "lease-1",
        range: "1h",
        endAtMs: 3_600_000,
        selection: context.selection,
      })
    );
    await waitFor(() => {
      expect(result.current.history).toMatchObject({
        kind: "error",
        diagnosticId: "history-bridge-unavailable",
      });
      expect(result.current.context).toMatchObject({
        kind: "error",
        diagnosticId: "history-context-bridge-unavailable",
      });
    });
  });
});
