import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";
import type {
  DiagnosticSource,
  DiagnosticSourceStatus,
  DiagnosticValue,
  DiagnosticsSnapshot,
  DiagnosticsView,
} from "@shared/diagnostics-types";

type DiagnosticsApi = ReturnType<typeof installElectronAPIMock>["diagnostics"];
type OpenLeaseRequest = Parameters<DiagnosticsApi["openLease"]>[0];
type OpenLeaseReply = Awaited<ReturnType<DiagnosticsApi["openLease"]>>;
type ConfigureLeaseRequest = Parameters<DiagnosticsApi["configureLease"]>[0];
type ConfigureLeaseReply = Awaited<ReturnType<DiagnosticsApi["configureLease"]>>;

const readyStatus = { kind: "ready", observedAtMs: 0 } as const;
const sourceStatuses: Readonly<Record<DiagnosticSource, DiagnosticSourceStatus>> = {
  "electron-processes": readyStatus,
  "process-io": readyStatus,
  "host-power": readyStatus,
  collector: readyStatus,
  "trace-store": readyStatus,
  "logical-io": readyStatus,
  "renderer-performance": readyStatus,
  "diagnostic-logs": readyStatus,
  "diagnostic-reports": readyStatus,
};

function readyValue<T>(source: DiagnosticSource, value: T): DiagnosticValue<T> {
  return { source, status: readyStatus, value };
}

function snapshotFor(view: DiagnosticsView): DiagnosticsSnapshot {
  return {
    schemaVersion: 1,
    instanceId: "test-instance",
    sequence: 1,
    observedAtMs: 0,
    view,
    sourceStatuses,
    overview: {
      footprint: {
        cpuPercent: readyValue("electron-processes", 0),
        residentMemoryBytes: readyValue("electron-processes", 0),
        processCount: readyValue("electron-processes", 0),
        readBytesPerSecond: readyValue("process-io", 0),
        writeBytesPerSecond: readyValue("process-io", 0),
        cpuSpeedLimitPercent: readyValue("host-power", 0),
        collectionDurationMs: readyValue("collector", 0),
        collectorCpuPercent: readyValue("collector", 0),
        collectorResidentBytes: readyValue("collector", 0),
      },
      host: {
        powerSource: readyValue("host-power", "external"),
        lowPowerMode: readyValue("host-power", false),
        idleSeconds: readyValue("host-power", 0),
        sessionState: readyValue("host-power", "active"),
        thermalState: readyValue("host-power", "nominal"),
      },
      collection: {
        sampleIntervalMs: 1_000,
        retainedSamples: 0,
        processScanCount: 0,
        processStarts: 0,
        processExits: 0,
        inaccessibleProcessCount: 0,
        restartCount: 0,
        droppedDetailCount: 0,
      },
      latestFailures: [],
    },
    detail: { tab: "overview" },
  };
}

vi.mock("@/features/settings/data/diagnostics/renderer-diagnostics-reporter", () => ({
  startRendererDiagnosticsReporter: vi.fn(() => () => undefined),
}));

// Guards: React StrictMode lease probes must use distinct document identities so cleanup cannot close the active lease.
describe("useDiagnosticsWorkspace", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("opens each effect lifetime with a unique document instance", async () => {
    const api = installElectronAPIMock();
    const openLease = vi.fn(async (_request: OpenLeaseRequest) => ({
      kind: "error" as const,
      error: {
        code: "internal" as const,
        retry: { kind: "manual" as const },
        diagnosticId: crypto.randomUUID(),
      },
    }));
    api.diagnostics = {
      openLease,
      configureLease: vi.fn(),
      closeLease: vi.fn(),
      refresh: vi.fn(),
      reportRenderer: vi.fn(),
      reportActivity: vi.fn(),
      queryResourceHistory: vi.fn(),
      queryResourceContext: vi.fn(),
      onSnapshotChanged: vi.fn(() => () => undefined),
    };

    const { useDiagnosticsWorkspace } =
      await import("@/features/settings/data/use-diagnostics-workspace");
    renderHook(() => useDiagnosticsWorkspace({ tab: "overview", windowMinutes: 15 }), {
      reactStrictMode: true,
    });

    await waitFor(() => expect(openLease).toHaveBeenCalledTimes(2));
    const firstId = openLease.mock.calls.at(0)?.[0].documentInstanceId;
    const secondId = openLease.mock.calls.at(1)?.[0].documentInstanceId;

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
  });

  it("configures a lease with the latest view when the user switches tabs during opening", async () => {
    const api = installElectronAPIMock();
    let resolveOpenLease: ((reply: OpenLeaseReply) => void) | undefined;
    const openLease = vi.fn(
      (): Promise<OpenLeaseReply> =>
        new Promise<OpenLeaseReply>((resolve) => {
          resolveOpenLease = resolve;
        })
    );
    let resolveConfigureLease: ((reply: ConfigureLeaseReply) => void) | undefined;
    const configureLease = vi.fn(
      (_request: ConfigureLeaseRequest): Promise<ConfigureLeaseReply> =>
        new Promise<ConfigureLeaseReply>((resolve) => {
          resolveConfigureLease = resolve;
        })
    );
    api.diagnostics = {
      openLease,
      configureLease,
      closeLease: vi.fn(),
      refresh: vi.fn(),
      reportRenderer: vi.fn(),
      reportActivity: vi.fn(),
      queryResourceHistory: vi.fn(),
      queryResourceContext: vi.fn(),
      onSnapshotChanged: vi.fn(() => () => undefined),
    };

    const { useDiagnosticsWorkspace } =
      await import("@/features/settings/data/use-diagnostics-workspace");
    const overview: DiagnosticsView = { tab: "overview", windowMinutes: 15 };
    const resources: DiagnosticsView = { tab: "resources", windowMinutes: 15 };
    const { result, rerender } = renderHook(({ view }) => useDiagnosticsWorkspace(view), {
      initialProps: { view: overview },
    });

    await waitFor(() => expect(resolveOpenLease).toBeTypeOf("function"));
    rerender({ view: resources });
    act(() => {
      resolveOpenLease?.({
        kind: "ok",
        value: { leaseId: "lease-1", snapshot: snapshotFor(overview) },
      });
    });

    await waitFor(
      () =>
        expect(configureLease).toHaveBeenCalledWith({
          leaseId: "lease-1",
          view: { tab: "resources", windowMinutes: 15 },
        }),
      { timeout: 200 }
    );
    expect(result.current).toMatchObject({ kind: "loading", snapshot: null });

    await act(async () => {
      resolveConfigureLease?.({ kind: "ok", value: snapshotFor(resources) });
    });
    expect(result.current.snapshot?.view).toEqual(resources);
  });

  it("ignores a stale configure reply after a second tab switch", async () => {
    const api = installElectronAPIMock();
    const resources: DiagnosticsView = { tab: "resources", windowMinutes: 15 };
    const traces: DiagnosticsView = { tab: "traces", windowMinutes: 15 };
    const openLease = vi.fn(async () => ({
      kind: "ok" as const,
      value: { leaseId: "lease-1", snapshot: snapshotFor(resources) },
    }));
    const configureResolvers: Array<(reply: ConfigureLeaseReply) => void> = [];
    const configureLease = vi.fn(
      (_request: ConfigureLeaseRequest): Promise<ConfigureLeaseReply> =>
        new Promise<ConfigureLeaseReply>((resolve) => {
          configureResolvers.push(resolve);
        })
    );
    api.diagnostics = {
      openLease,
      configureLease,
      closeLease: vi.fn(),
      refresh: vi.fn(),
      reportRenderer: vi.fn(),
      reportActivity: vi.fn(),
      queryResourceHistory: vi.fn(),
      queryResourceContext: vi.fn(),
      onSnapshotChanged: vi.fn(() => () => undefined),
    };

    const { useDiagnosticsWorkspace } =
      await import("@/features/settings/data/use-diagnostics-workspace");
    const { result, rerender } = renderHook(({ view }) => useDiagnosticsWorkspace(view), {
      initialProps: { view: resources },
    });

    await waitFor(() => expect(configureLease).toHaveBeenCalledTimes(1));
    rerender({ view: traces });
    await waitFor(() => expect(configureLease).toHaveBeenCalledTimes(2));

    await act(async () => {
      configureResolvers[1]?.({ kind: "ok", value: snapshotFor(traces) });
    });
    expect(result.current.snapshot?.view).toEqual(traces);

    await act(async () => {
      configureResolvers[0]?.({ kind: "ok", value: snapshotFor(resources) });
    });
    expect(result.current.snapshot?.view).toEqual(traces);
  });
});
