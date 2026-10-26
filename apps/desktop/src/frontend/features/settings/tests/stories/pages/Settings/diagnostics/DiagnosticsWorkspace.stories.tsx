import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, type ReactNode } from "react";
import { expect, userEvent, within } from "storybook/test";

import type { ElectronAPI } from "@backend/preload";
import type {
  DiagnosticSource,
  DiagnosticValue,
  DiagnosticsDetail,
  DiagnosticsSnapshot,
  DiagnosticsTab,
  DiagnosticsView,
} from "@shared/diagnostics-types";
import { DiagnosticsWorkspace } from "../../../../../components/screens/Settings/diagnostics/DiagnosticsWorkspace";

const readyStatus = { kind: "ready", observedAtMs: 1_723_289_600_000 } as const;
const sourceStatuses = {
  "electron-processes": readyStatus,
  "process-io": readyStatus,
  "host-power": readyStatus,
  collector: readyStatus,
  "trace-store": readyStatus,
  "logical-io": readyStatus,
  "renderer-performance": readyStatus,
  "diagnostic-logs": readyStatus,
  "diagnostic-reports": readyStatus,
} satisfies DiagnosticsSnapshot["sourceStatuses"];

function measured<T>(source: DiagnosticSource, value: T): DiagnosticValue<T> {
  return { source, status: readyStatus, value };
}

function snapshot(view: DiagnosticsView): DiagnosticsSnapshot {
  const details = {
    overview: { tab: "overview" },
    resources: { tab: "resources", history: [], gaps: [], processes: [] },
    processes: { tab: "processes", history: [], processes: [] },
    io: { tab: "io", rows: [] },
    traces: {
      tab: "traces",
      spans: [],
      logs: [],
      topNames: [],
      latestFailures: [],
      commonFailures: [],
    },
    failures: { tab: "failures", latest: [], common: [] },
    "logs-reports": { tab: "logs-reports" },
    "developer-tools": {
      tab: "developer-tools",
      renderer: {
        source: "renderer-performance",
        status: { kind: "unsupported", platform: "other", capability: "renderer-memory" },
      },
    },
  } satisfies Record<DiagnosticsTab, DiagnosticsDetail>;
  return {
    schemaVersion: 1,
    instanceId: "storybook-desktop",
    sequence: 1,
    observedAtMs: readyStatus.observedAtMs,
    view,
    sourceStatuses,
    overview: {
      footprint: {
        cpuPercent: measured("electron-processes", 12.5),
        residentMemoryBytes: measured("electron-processes", 734_003_200),
        processCount: measured("electron-processes", 7),
        readBytesPerSecond: measured("process-io", 786_432),
        writeBytesPerSecond: measured("process-io", 131_072),
        cpuSpeedLimitPercent: measured("host-power", 100),
        collectionDurationMs: measured("collector", 42),
        collectorCpuPercent: measured("collector", 0.5),
        collectorResidentBytes: measured("collector", 16_777_216),
      },
      host: {
        powerSource: measured("host-power", "external"),
        lowPowerMode: measured("host-power", false),
        idleSeconds: measured("host-power", 2),
        sessionState: measured("host-power", "active"),
        thermalState: measured("host-power", "nominal"),
      },
      collection: {
        sampleIntervalMs: 1_000,
        retainedSamples: 480,
        processScanCount: 40,
        processStarts: 1,
        processExits: 0,
        inaccessibleProcessCount: 0,
        restartCount: 0,
        droppedDetailCount: 0,
      },
      latestFailures: [],
    },
    detail: details[view.tab],
  };
}

function LocalDiagnostics({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const previous = Object.getOwnPropertyDescriptor(window, "electronAPI");
    const bridge = window.electronAPI;
    let currentView: DiagnosticsView = { tab: "overview", windowMinutes: 15 };
    const historyUnavailable = async () => ({
      kind: "error" as const,
      error: {
        code: "transient" as const,
        retry: { kind: "none" as const },
        diagnosticId: "storybook-history",
      },
    });
    const diagnostics = {
      openLease: async () => ({
        kind: "ok" as const,
        value: {
          leaseId: "storybook-lease",
          snapshot: snapshot(currentView),
        },
      }),
      configureLease: async ({ view }: { leaseId: string; view: DiagnosticsView }) => {
        currentView = view;
        return { kind: "ok" as const, value: snapshot(currentView) };
      },
      closeLease: async () => ({ kind: "ok" as const, value: null }),
      refresh: async () => ({
        kind: "ok" as const,
        value: snapshot(currentView),
      }),
      reportRenderer: async () => ({ kind: "ok" as const, value: null }),
      reportActivity: async () => ({ kind: "ok" as const, value: null }),
      queryResourceHistory: historyUnavailable,
      queryResourceContext: historyUnavailable,
      onSnapshotChanged: () => () => undefined,
    } satisfies ElectronAPI["diagnostics"];
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { ...bridge, diagnostics },
    });
    return () => {
      if (previous) Object.defineProperty(window, "electronAPI", previous);
      else Reflect.deleteProperty(window, "electronAPI");
    };
  }, []);
  return children;
}

const meta = {
  title: "Pages/Settings/DiagnosticsWorkspace",
  component: DiagnosticsWorkspace,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <LocalDiagnostics>
        <div className="mx-auto max-w-6xl">
          <Story />
        </div>
      </LocalDiagnostics>
    ),
  ],
  args: { onSectionChange: () => undefined },
} satisfies Meta<typeof DiagnosticsWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByText("Diagnostics")).toBeVisible();
    expect(await canvas.findByText("External power")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Refresh" }));
    expect(canvas.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(canvas.getByRole("tab", { name: "Resources" }));
    expect(await canvas.findByText("700.0 MB")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Refresh" }));
    expect(canvas.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    expect(await canvas.findByText("700.0 MB")).toBeVisible();
  },
};
