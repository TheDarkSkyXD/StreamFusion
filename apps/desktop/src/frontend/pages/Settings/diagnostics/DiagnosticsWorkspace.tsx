import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuActivity,
  LuBug,
  LuChevronLeft,
  LuChevronRight,
  LuCopy,
  LuCpu,
  LuDatabase,
  LuFileText,
  LuGauge,
  LuHardDrive,
  LuMemoryStick,
  LuPause,
  LuPlay,
  LuRadio,
  LuRefreshCw,
  LuShieldCheck,
  LuTriangleAlert,
  LuWorkflow,
} from "react-icons/lu";
import { toast } from "sonner";

import { BugReportSection } from "@/features/settings/components/settings/BugReportSection";
import { LogsSection } from "@/features/settings/components/settings/LogsSection";
import { Button } from "@/components/ui/button";
import { useDiagnosticsWorkspace } from "@/features/settings/data/use-diagnostics-workspace";
import { useDiagnosticsResourceHistory } from "@/features/settings/data/use-diagnostics-resource-history";
import { translateSettings } from "@/features/settings/utils/settings-translation";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { HISTORY_RANGE_PRESETS, historyRangePreset } from "@shared/diagnostics-types";
import type {
  DiagnosticSourceStatus,
  DiagnosticFailure,
  DiagnosticsSnapshot,
  DiagnosticsTab,
  DiagnosticsWindowMinutes,
  DiagnosticValue,
  DiagnosticsHistoryBucket,
  DiagnosticsHistoryRange,
  DiagnosticsHistorySelection,
  DiagnosticsHistorySeries,
  ProcessObservation,
} from "@shared/diagnostics-types";

import { historyTimelineSlots, resourceHistoryBarHeight } from "./diagnostics-resource-history";

function getTabs(): ReadonlyArray<{
  id: DiagnosticsTab;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  color: string;
}> {
  return [
    {
      id: "overview",
      label: translateSettings({ key: "settings.overview" }),
      icon: LuGauge,
      color: "text-emerald-400",
    },
    {
      id: "resources",
      label: translateSettings({ key: "settings.resources" }),
      icon: LuActivity,
      color: "text-cyan-300",
    },
    {
      id: "io",
      label: translateSettings({ key: "settings.iO" }),
      icon: LuDatabase,
      color: "text-emerald-200",
    },
    {
      id: "traces",
      label: translateSettings({ key: "settings.traces" }),
      icon: LuWorkflow,
      color: "text-sky-300",
    },
    {
      id: "logs-reports",
      label: translateSettings({ key: "settings.logsReports" }),
      icon: LuFileText,
      color: "text-emerald-400",
    },
    {
      id: "developer-tools",
      label: translateSettings({ key: "settings.developerTools" }),
      icon: LuBug,
      color: "text-red-400",
    },
  ];
}

const WINDOWS: readonly DiagnosticsWindowMinutes[] = [5, 15, 30, 60];

type WindowedDiagnosticsTab = Extract<DiagnosticsTab, "resources" | "io" | "traces">;

const DEFAULT_WINDOWS_BY_TAB: Readonly<Record<WindowedDiagnosticsTab, DiagnosticsWindowMinutes>> = {
  resources: 15,
  io: 15,
  traces: 15,
};

function usesWindowControl(tab: DiagnosticsTab): tab is WindowedDiagnosticsTab {
  switch (tab) {
    case "resources":
    case "io":
    case "traces":
      return true;
    case "overview":
    case "processes":
    case "failures":
    case "logs-reports":
    case "developer-tools":
      return false;
  }
}

function hasValue<T>(
  value: DiagnosticValue<T>
): value is Extract<DiagnosticValue<T>, { value: T }> {
  return "value" in value;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatRate(bytes: number): string {
  return `${formatBytes(bytes)}/s`;
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 60_000) return `${(durationMs / 60_000).toFixed(2)}m`;
  if (durationMs >= 1_000) return `${(durationMs / 1_000).toFixed(2)}s`;
  return `${durationMs.toFixed(durationMs < 10 ? 2 : 0)}ms`;
}

function formatObservedAt(observedAtMs: number): string {
  return new Date(observedAtMs).toLocaleTimeString(i18n.resolvedLanguage ?? i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function copyTraceId(traceId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(traceId);
    toast.success(translateSettings({ key: "settings.traceIdCopied" }));
  } catch {
    toast.error(translateSettings({ key: "settings.couldNotCopyTheTraceId" }));
  }
}

function sourceLabel(status: DiagnosticSourceStatus): string {
  if (status.kind === "ready") return translateSettings({ key: "settings.ready" });
  if (status.kind === "stale") return translateSettings({ key: "settings.stale" });
  if (status.kind === "unsupported") return translateSettings({ key: "settings.unsupported" });
  return translateSettings({ key: "settings.unavailable" });
}

function valueText<T>(value: DiagnosticValue<T>, format: (item: T) => string): string {
  return hasValue(value) ? format(value.value) : sourceLabel(value.status);
}

function formatSessionState(value: "active" | "idle" | "locked" | "unknown"): string {
  switch (value) {
    case "active":
      return translateSettings({ key: "settings.active" });
    case "idle":
      return translateSettings({ key: "settings.idle" });
    case "locked":
      return translateSettings({ key: "settings.locked" });
    case "unknown":
      return translateSettings({ key: "settings.unknown" });
  }
}

function formatThermalState(value: "nominal" | "fair" | "serious" | "critical"): string {
  switch (value) {
    case "nominal":
      return translateSettings({ key: "settings.nominal" });
    case "fair":
      return translateSettings({ key: "settings.fair" });
    case "serious":
      return translateSettings({ key: "settings.serious" });
    case "critical":
      return translateSettings({ key: "settings.critical" });
  }
}

function formatProcessCount(count: number): string {
  return translateSettings({
    key: count === 1 ? "settings.processCount_one" : "settings.processCount_other",
    options: {
      count,
    },
  });
}

function Panel({
  title,
  eyebrow,
  icon,
  iconClassName,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  iconClassName?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)]">
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-background-secondary)] px-5 py-3">
        {icon ? (
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background-tertiary)]",
              iconClassName
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
              {eyebrow}
            </p>
          ) : null}
          <h3 className="text-base font-bold text-[var(--color-foreground)]">{title}</h3>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function StatusPill({
  status,
  readyLabel,
}: {
  status: DiagnosticSourceStatus;
  readyLabel?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-[0.04em]",
        status.kind === "ready" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
        status.kind === "stale" && "border-amber-400/30 bg-amber-400/10 text-amber-200",
        status.kind === "unavailable" && "border-red-400/30 bg-red-400/10 text-red-200",
        status.kind === "unsupported" &&
          "border-[var(--color-border)] bg-[var(--color-background-tertiary)] text-[var(--color-foreground-secondary)]"
      )}
    >
      {status.kind === "ready" && readyLabel ? readyLabel : sourceLabel(status)}
    </span>
  );
}

function sourceStatusDetail(status: DiagnosticSourceStatus): string {
  switch (status.kind) {
    case "ready":
      return translateSettings({ key: "settings.noReportedErrors" });
    case "stale":
      return translateSettings({
        key: "settings.updatesAreStaleReason",
        options: {
          reason: status.reason.replaceAll("-", " "),
        },
      });
    case "unavailable":
      return translateSettings({
        key: "settings.unavailableReason",
        options: {
          reason: status.reason.replaceAll("-", " "),
        },
      });
    case "unsupported":
      return translateSettings({
        key: "settings.notSupportedOnPlatform",
        options: { platform: status.platform },
      });
  }
}

function CollectionHealthRow({ label, status }: { label: string; status: DiagnosticSourceStatus }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--color-border)] py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-1 text-xs text-[var(--color-foreground-secondary)]">
          {sourceStatusDetail(status)}
        </p>
      </div>
      <StatusPill status={status} readyLabel={translateSettings({ key: "settings.healthy" })} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  iconClassName,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  iconClassName: string;
}) {
  return (
    <div className="min-h-36 border-b border-r border-[var(--color-border)] px-5 py-5">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background-tertiary)]",
            iconClassName
          )}
          aria-hidden
        >
          {icon}
        </span>
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
          {label}
        </p>
      </div>
      <p className="mt-4 text-2xl font-bold tabular-nums text-white">{value}</p>
      <p className="mt-2 text-[13px] leading-5 text-[var(--color-foreground-secondary)]">
        {detail}
      </p>
    </div>
  );
}

function HistoryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-24 border-b border-r border-[var(--color-border)] px-5 py-4">
      <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
        {label}
      </p>
      <p className="mt-3 text-xl font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

function ResourceMetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}

function ResourceAggregateCard({
  accentClassName,
  countLabel,
  label,
  metrics,
}: {
  accentClassName: string;
  countLabel: string;
  label: string;
  metrics: readonly { readonly label: string; readonly value: string }[];
}) {
  return (
    <div className="relative border-t border-[var(--color-border)] px-5 py-5 first:border-t-0 lg:border-l lg:border-t-0 lg:first:border-l-0">
      <span
        className={cn("absolute inset-x-5 top-0 h-0.5 rounded-full", accentClassName)}
        aria-hidden
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
          {label}
        </p>
        <span className="rounded-md bg-[var(--color-background-tertiary)] px-2 py-1 text-xs tabular-nums text-[var(--color-foreground-secondary)]">
          {countLabel}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
        {metrics.map((metric) => (
          <ResourceMetricPair key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>
    </div>
  );
}

function aggregateProcessMetrics(
  rows: readonly ProcessObservation[],
  ioPlaceholder: string
): readonly { readonly label: string; readonly value: string }[] {
  const cpu = rows.reduce((total, row) => total + row.currentCpuPercent, 0);
  const memory = rows.reduce((total, row) => total + row.residentBytes, 0);
  const hasReadRate = rows.some((row) => row.readBytesPerSecond !== null);
  const hasWriteRate = rows.some((row) => row.writeBytesPerSecond !== null);
  const read = rows.reduce((total, row) => total + (row.readBytesPerSecond ?? 0), 0);
  const write = rows.reduce((total, row) => total + (row.writeBytesPerSecond ?? 0), 0);
  return [
    { label: "CPU", value: `${cpu.toFixed(1)}%` },
    { label: translateSettings({ key: "settings.memory" }), value: formatBytes(memory) },
    {
      label: translateSettings({ key: "settings.read" }),
      value: hasReadRate ? formatRate(read) : ioPlaceholder,
    },
    {
      label: translateSettings({ key: "settings.write" }),
      value: hasWriteRate ? formatRate(write) : ioPlaceholder,
    },
  ];
}

function WindowControl({
  value,
  onChange,
}: {
  value: DiagnosticsWindowMinutes;
  onChange: (value: DiagnosticsWindowMinutes) => void;
}) {
  return (
    <div
      className="flex rounded-lg border border-[var(--color-border)] p-1"
      aria-label={translateSettings({ key: "settings.timeWindow" })}
    >
      {WINDOWS.map((minutes) => (
        <button
          key={minutes}
          type="button"
          onClick={() => onChange(minutes)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
            value === minutes
              ? "bg-[var(--color-background-tertiary)] text-white"
              : "text-[var(--color-foreground-secondary)] hover:text-white"
          )}
          aria-pressed={value === minutes}
        >
          {minutes === 60
            ? translateSettings({ key: "settings.value1h" })
            : translateSettings({ key: "settings.valueM", options: { minutes: minutes } })}
        </button>
      ))}
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-[var(--color-border)] py-3 last:border-b-0">
      <span className="text-sm text-[var(--color-foreground-secondary)]">{label}</span>
      <strong className="text-right text-sm font-semibold text-white">{value}</strong>
    </div>
  );
}

interface ProcessTreeEntry {
  readonly depth: number;
  readonly process: ProcessObservation;
}

function visibleProcessTree(rows: readonly ProcessObservation[]): readonly ProcessTreeEntry[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const childrenByPid = new Map<number, ProcessObservation[]>();
  const roots: ProcessObservation[] = [];
  for (const row of rows) {
    if (row.parentPid === null || !byPid.has(row.parentPid) || row.parentPid === row.pid) {
      roots.push(row);
      continue;
    }
    const siblings = childrenByPid.get(row.parentPid) ?? [];
    siblings.push(row);
    childrenByPid.set(row.parentPid, siblings);
  }

  const visible: ProcessTreeEntry[] = [];
  const visited = new Set<number>();
  const visit = (process: ProcessObservation, depth: number): void => {
    if (visited.has(process.pid)) return;
    visited.add(process.pid);
    const children = childrenByPid.get(process.pid) ?? [];
    visible.push({ process, depth });
    for (const child of children) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const row of rows) visit(row, 0);
  return visible;
}

function ProcessTable({
  ioStatus,
  rows,
  viewportClassName,
}: {
  ioStatus: DiagnosticSourceStatus;
  rows: readonly ProcessObservation[];
  viewportClassName?: string;
}) {
  const visibleRows = useMemo(() => visibleProcessTree(rows), [rows]);
  if (rows.length === 0) {
    return (
      <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
        {translateSettings({ key: "settings.noLiveProcessesObserved" })}
      </p>
    );
  }
  const ioPlaceholder =
    ioStatus.kind === "unsupported"
      ? translateSettings({ key: "settings.unsupported" })
      : translateSettings({ key: "settings.collecting" });
  return (
    <div className={cn("max-w-full overflow-x-auto", viewportClassName)}>
      <table className="w-full min-w-[1280px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[10%]" />
          <col className="w-[7%]" />
          <col className="w-[8%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[6%]" />
          <col className="w-[4%]" />
        </colgroup>
        <thead>
          <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
            <th className="px-2 py-3">{translateSettings({ key: "settings.process" })}</th>
            <th className="px-4 py-3">{translateSettings({ key: "settings.category" })}</th>
            <th className="px-4 py-3 text-right">CPU</th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.cpuTime" })}
            </th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.memory" })}
            </th>
            <th className="px-4 py-3 text-right">{translateSettings({ key: "settings.readS" })}</th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.writeS" })}
            </th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.readTotal" })}
            </th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.writeTotal" })}
            </th>
            <th className="px-5 py-3 text-right">PID</th>
            <th className="px-4 py-3 text-right">{translateSettings({ key: "settings.kill" })}</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ depth, process: row }) => (
            <tr
              key={row.observationId}
              className="border-t border-[var(--color-border)] hover:bg-[var(--color-background-secondary)]"
            >
              <td className="px-2 py-3.5 font-semibold text-white">
                <div
                  className="grid min-w-0 grid-cols-[0.4rem_minmax(0,1fr)] items-center gap-1.5"
                  style={{ paddingLeft: `${Math.min(depth, 7) * 10}px` }}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      row.category === "main" ? "bg-violet-400" : "bg-cyan-400"
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{row.displayName}</span>
                </div>
              </td>
              <td className="px-4 py-3.5 text-[var(--color-foreground-secondary)]">
                {row.category}
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-violet-300">
                {row.currentCpuPercent.toFixed(1)}%
              </td>
              <td className="px-4 py-3.5 text-right tabular-nums text-white">
                {row.cumulativeCpuMs === null
                  ? translateSettings({ key: "settings.unsupported" })
                  : translateSettings({
                      key: "settings.valueS",
                      options: {
                        value1: (row.cumulativeCpuMs / 1_000).toFixed(1),
                      },
                    })}
              </td>
              <td className="px-4 py-3.5 text-right tabular-nums text-white">
                {formatBytes(row.residentBytes)}
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-emerald-200">
                {row.readBytesPerSecond === null
                  ? ioPlaceholder
                  : formatRate(row.readBytesPerSecond)}
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-violet-200">
                {row.writeBytesPerSecond === null
                  ? ioPlaceholder
                  : formatRate(row.writeBytesPerSecond)}
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                {row.readTotalBytes === null ? ioPlaceholder : formatBytes(row.readTotalBytes)}
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                {row.writeTotalBytes === null ? ioPlaceholder : formatBytes(row.writeTotalBytes)}
              </td>
              <td className="px-5 py-3.5 text-right tabular-nums text-[var(--color-foreground-secondary)]">
                {row.pid}
              </td>
              <td className="px-4 py-3.5 text-right text-[var(--color-foreground-muted)]">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProcessHistoryTable({ rows }: { rows: readonly ProcessObservation[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="max-h-[360px] max-w-full overflow-auto border-t border-[var(--color-border)]">
      <table className="w-full min-w-[940px] border-collapse text-sm">
        <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
          <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
            <th className="px-5 py-3">{translateSettings({ key: "settings.process" })}</th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.cpuTime" })}
            </th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.current2" })}
            </th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.average" })}
            </th>
            <th className="px-4 py-3 text-right">{translateSettings({ key: "settings.peak" })}</th>
            <th className="px-4 py-3 text-right">
              {translateSettings({ key: "settings.maxMemory" })}
            </th>
            <th className="px-5 py-3 text-right">PID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.observationId} className="border-t border-[var(--color-border)]">
              <td className="px-5 py-3.5 font-semibold text-white">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-violet-400" />
                {row.displayName}
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                {row.cumulativeCpuMs === null
                  ? translateSettings({ key: "settings.nA" })
                  : formatDuration(row.cumulativeCpuMs)}
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-violet-200">
                {row.currentCpuPercent.toFixed(1)}%
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                {row.averageCpuPercent.toFixed(1)}%
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                {row.peakCpuPercent.toFixed(1)}%
              </td>
              <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                {formatBytes(row.peakResidentBytes)}
              </td>
              <td className="px-5 py-3.5 text-right tabular-nums text-[var(--color-foreground-secondary)]">
                {row.pid}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OverviewTab({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const { footprint, host, collection } = snapshot.overview;
  const processStatus = snapshot.sourceStatuses["electron-processes"];
  const mainProcessStatus = snapshot.sourceStatuses.collector;
  return (
    <div className="space-y-4">
      <Panel
        title={translateSettings({ key: "settings.hostStateAndCollection" })}
        eyebrow={translateSettings({ key: "settings.hostAndCollection" })}
        icon={<LuGauge />}
        iconClassName="text-violet-300"
      >
        <div className="grid lg:grid-cols-2">
          <div className="border-b border-[var(--color-border)] px-5 lg:border-b-0 lg:border-r">
            <StatusRow
              label={translateSettings({ key: "settings.powerSource" })}
              value={valueText(host.powerSource, (value) =>
                value === "external"
                  ? translateSettings({ key: "settings.externalPower" })
                  : translateSettings({ key: "settings.battery" })
              )}
            />
            <StatusRow
              label={translateSettings({ key: "settings.lowPowerMode" })}
              value={valueText(host.lowPowerMode, (value) =>
                value
                  ? translateSettings({ key: "settings.on" })
                  : translateSettings({ key: "settings.off" })
              )}
            />
            <StatusRow
              label={translateSettings({ key: "settings.idle" })}
              value={valueText(host.idleSeconds, (value) => `${value}s`)}
            />
            <StatusRow
              label={translateSettings({ key: "settings.session" })}
              value={valueText(host.sessionState, formatSessionState)}
            />
            <StatusRow
              label={translateSettings({ key: "settings.thermal" })}
              value={valueText(host.thermalState, formatThermalState)}
            />
          </div>
          <div className="px-5">
            <CollectionHealthRow
              label={translateSettings({ key: "settings.nativeProcessMonitor" })}
              status={processStatus}
            />
            <CollectionHealthRow
              label={translateSettings({ key: "settings.electronMainProcess" })}
              status={mainProcessStatus}
            />
            <StatusRow
              label={translateSettings({ key: "settings.collectionTime" })}
              value={valueText(footprint.collectionDurationMs, (value) => `${value.toFixed(2)} ms`)}
            />
            <StatusRow
              label={translateSettings({ key: "settings.collectorCpu" })}
              value={valueText(footprint.collectorCpuPercent, (value) => `${value.toFixed(2)}%`)}
            />
            <StatusRow
              label={translateSettings({ key: "settings.samplingInterval" })}
              value={`${(collection.sampleIntervalMs / 1_000).toFixed(0)} s`}
            />
            <StatusRow
              label={translateSettings({ key: "settings.retainedSamples" })}
              value={String(collection.retainedSamples)}
            />
            <StatusRow
              label={translateSettings({ key: "settings.processScan" })}
              value={translateSettings({
                key: "settings.retainedCount",
                options: {
                  count: collection.processScanCount,
                },
              })}
            />
            <StatusRow
              label={translateSettings({ key: "settings.inaccessible" })}
              value={String(collection.inaccessibleProcessCount)}
            />
            <StatusRow
              label={translateSettings({ key: "settings.collectorRestarts" })}
              value={String(collection.restartCount)}
            />
            <StatusRow
              label={translateSettings({ key: "settings.droppedDetail" })}
              value={String(collection.droppedDetailCount)}
            />
          </div>
        </div>
      </Panel>

      <Panel
        eyebrow={translateSettings({ key: "settings.sourceStatus" })}
        title={translateSettings({ key: "settings.evidenceAvailability" })}
        icon={<LuRadio />}
        iconClassName="text-violet-300"
      >
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(snapshot.sourceStatuses).map(([source, status]) => (
            <div
              key={source}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-3"
            >
              <span className="text-sm font-semibold text-white">{source}</span>
              <StatusPill status={status} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function historyRangeDurationMs(range: DiagnosticsHistoryRange): number {
  return historyRangePreset(range).durationMs;
}

function formatHistoryTime(timestampMs: number, precise = false): string {
  return new Date(timestampMs).toLocaleString(i18n.resolvedLanguage ?? i18n.language, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(precise ? { second: "2-digit" as const } : {}),
  });
}

function formatHistoryInput(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSignedBytes(bytes: number): string {
  if (bytes === 0) return "No change";
  return `${bytes > 0 ? "+" : "−"}${formatBytes(Math.abs(bytes))}`;
}

function historyCoverage(bucket: DiagnosticsHistoryBucket): string {
  const periodDurationMs = Math.max(1, bucket.endedAtMs - bucket.startedAtMs);
  return `${Math.min(100, (bucket.observedDurationMs / periodDurationMs) * 100).toFixed(0)}%`;
}

function HistoryTimeline({
  heading,
  history,
  selection,
  onSelect,
  value,
  colorClassName,
}: {
  readonly heading:
    "CPU timeline" | "RAM timeline" | "Incident CPU timeline" | "Incident RAM timeline";
  readonly history: DiagnosticsHistorySeries;
  readonly selection: DiagnosticsHistorySelection | null;
  readonly onSelect: (bucket: DiagnosticsHistoryBucket) => void;
  readonly value: (bucket: DiagnosticsHistoryBucket) => number;
  readonly colorClassName: string;
}) {
  const slots = historyTimelineSlots(history);
  const observed = slots.flatMap((slot) => (slot.kind === "observed" ? [slot.bucket] : []));
  const maximum = Math.max(1, ...observed.map(value));
  const cpu = heading.includes("CPU");
  const unit = cpu ? "% peak" : "RAM peak";
  return (
    <section className="min-w-0" aria-labelledby={`diagnostics-${heading.replace(" ", "-")}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h4
          id={`diagnostics-${heading.replace(" ", "-")}`}
          className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]"
        >
          {heading} ({unit})
        </h4>
        <span className="text-[11px] tabular-nums text-[var(--color-foreground-secondary)]">
          {formatHistoryTime(history.requested.startAtMs)} to{" "}
          {formatHistoryTime(history.requested.endAtMs)}
        </span>
      </div>
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-[var(--color-foreground-secondary)]">
        <span>0</span>
        <span>Scale maximum: {cpu ? `${maximum.toFixed(1)}%` : formatBytes(maximum)}</span>
      </div>
      <div className="mt-1 flex h-24 w-full items-end overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-2">
        {slots.length === 0 ? (
          <p className="m-auto text-sm text-[var(--color-foreground-secondary)]">
            No recorded samples yet.
          </p>
        ) : (
          slots.map((slot) => {
            if (slot.kind === "gap") {
              const detail = slot.cause
                ? `Collection gap: ${slot.cause}`
                : "No retained observation";
              const label = `${detail}, ${formatHistoryTime(slot.startedAtMs)} to ${formatHistoryTime(slot.endedAtMs)}`;
              return (
                <span
                  key={slot.startedAtMs}
                  className="h-full min-w-0 flex-1 bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,rgba(163,163,163,0.22)_2px,rgba(163,163,163,0.22)_3px)]"
                  aria-label={label}
                  title={label}
                  role="img"
                />
              );
            }
            const { bucket } = slot;
            const selected =
              selection?.kind === "bucket" && selection.startedAtMs === bucket.startedAtMs;
            const height = resourceHistoryBarHeight({
              value: value(bucket),
              max: maximum,
              minimumVisiblePercent: 3,
            });
            return (
              <button
                key={bucket.startedAtMs}
                type="button"
                className={cn(
                  "flex h-full min-w-0 flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-white",
                  selected && "ring-1 ring-white"
                )}
                aria-label={`${heading} peak ${value(bucket).toFixed(1)}, observed ${formatHistoryTime(bucket.startedAtMs, true)} to ${formatHistoryTime(bucket.endedAtMs, true)}`}
                title={`${formatHistoryTime(bucket.startedAtMs)} · ${cpu ? `${value(bucket).toFixed(1)}%` : formatBytes(value(bucket))} peak · ${historyCoverage(bucket)} coverage`}
                aria-pressed={selected}
                data-diagnostics-bucket-start={bucket.startedAtMs}
                onClick={() => onSelect(bucket)}
              >
                <span
                  className={cn("block w-full rounded-sm", colorClassName)}
                  style={{ height: `${height}%` }}
                />
              </button>
            );
          })
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-foreground-secondary)]">
        Striped columns have no retained observations. Bars show sampled peaks; select one for
        coverage.
      </p>
    </section>
  );
}

function ResourceHistoryDetail({
  history,
  selection,
  context,
  onSelect,
}: {
  readonly history: DiagnosticsHistorySeries;
  readonly selection: DiagnosticsHistorySelection | null;
  readonly context: ReturnType<typeof useDiagnosticsResourceHistory>["context"];
  readonly onSelect: (bucket: DiagnosticsHistoryBucket) => void;
}) {
  const detail = context.value;
  const selectedLabel =
    selection?.kind === "bucket"
      ? formatHistoryTime(selection.startedAtMs)
      : (detail?.incident?.label ?? "Choose an observed period or incident.");
  const coverage = detail ? historyCoverage(detail.bucket) : null;
  const maxContributorCpu = Math.max(
    1,
    ...(detail?.contributors.map((contributor) => contributor.maximumCpuPercent) ?? [])
  );
  const maxContributorRam = Math.max(
    1,
    ...(detail?.contributors.map((contributor) => contributor.maximumResidentBytes) ?? [])
  );

  return (
    <section
      className="border-t border-[var(--color-border)] p-4"
      aria-labelledby="selected-period-evidence"
    >
      <h4 id="selected-period-evidence" className="text-sm font-bold text-white">
        Selected period evidence
      </h4>
      <p className="mt-1 text-xs text-[var(--color-foreground-secondary)]">{selectedLabel}</p>
      {context.kind === "loading" ? (
        <p className="mt-4 text-sm text-[var(--color-foreground-secondary)]">Loading evidence…</p>
      ) : context.kind === "error" ? (
        <p role="alert" className="mt-4 text-sm text-amber-200">
          No retained observations are available for this selected period. Diagnostic ID:{" "}
          {context.diagnosticId}
        </p>
      ) : detail ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--color-foreground-secondary)]">
            <span>Coverage: {coverage}</span>
            <span>
              {detail.detailComplete ? "Complete period detail" : "Partial period detail"}
            </span>
            <span>
              {detail.detailResolution === "raw"
                ? "Fine samples"
                : detail.detailResolution === "minute"
                  ? "Minute summaries"
                  : "Hourly summaries"}
              : {detail.samples.length}
            </span>
            <span>
              CPU peak: {detail.bucket.maximumCpuPercent.toFixed(1)}% at{" "}
              {formatHistoryTime(detail.bucket.maximumCpuAtMs, true)}
            </span>
            <span>
              RAM peak: {formatBytes(detail.bucket.maximumResidentBytes)} at{" "}
              {formatHistoryTime(detail.bucket.maximumResidentAtMs, true)}
            </span>
            {detail.incident ? <span>Incident: {detail.incident.label}</span> : null}
          </div>
          {detail.incident && detail.samples.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {(["cpu", "ram"] as const).map((metric) => (
                <HistoryTimeline
                  key={metric}
                  heading={metric === "cpu" ? "Incident CPU timeline" : "Incident RAM timeline"}
                  history={{
                    ...history,
                    resolution: detail.detailResolution,
                    requested: {
                      startAtMs: detail.bucket.startedAtMs,
                      endAtMs: detail.bucket.endedAtMs,
                    },
                    buckets: detail.samples,
                  }}
                  selection={selection}
                  onSelect={onSelect}
                  value={(bucket) =>
                    metric === "cpu" ? bucket.maximumCpuPercent : bucket.maximumResidentBytes
                  }
                  colorClassName={metric === "cpu" ? "bg-violet-300" : "bg-cyan-300"}
                />
              ))}
            </div>
          ) : null}
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
              CPU and RAM contributors
            </p>
            {detail.contributors.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-foreground-secondary)]">
                No process contributors were retained for this period.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {detail.contributors.map((contributor) => (
                  <div
                    key={contributor.observationId}
                    className="rounded-md bg-[var(--color-background-secondary)] p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                      <span className="font-semibold text-white">{contributor.displayName}</span>
                      <span className="text-xs text-[var(--color-foreground-secondary)]">
                        {contributor.category} · PID {contributor.pid}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 text-xs">
                      <span className="text-[var(--color-foreground-secondary)]">CPU</span>
                      <span className="h-2 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                        <span
                          className="block h-full rounded-full bg-violet-300"
                          style={{
                            width: `${Math.max(2, (contributor.maximumCpuPercent / maxContributorCpu) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="tabular-nums text-white">
                        {contributor.maximumCpuPercent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 text-xs">
                      <span className="text-[var(--color-foreground-secondary)]">RAM</span>
                      <span className="h-2 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
                        <span
                          className="block h-full rounded-full bg-cyan-300"
                          style={{
                            width: `${Math.max(2, (contributor.maximumResidentBytes / maxContributorRam) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="tabular-nums text-white">
                        {formatBytes(contributor.maximumResidentBytes)}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 text-[11px] text-[var(--color-foreground-secondary)]">
                      <p>
                        RAM: {formatBytes(contributor.firstResidentBytes)} to{" "}
                        {formatBytes(contributor.lastResidentBytes)} (
                        {formatSignedBytes(
                          contributor.lastResidentBytes - contributor.firstResidentBytes
                        )}
                        )
                      </p>
                      <p>
                        CPU peak at {formatHistoryTime(contributor.maximumCpuAtMs, true)}; RAM peak
                        at {formatHistoryTime(contributor.maximumResidentAtMs, true)}
                      </p>
                      <p>
                        Process started {formatHistoryTime(contributor.startedAtMs, true)}; observed{" "}
                        {formatHistoryTime(contributor.firstObservedAtMs, true)} to{" "}
                        {formatHistoryTime(contributor.lastObservedAtMs, true)}
                        {contributor.exitedAtMs === null
                          ? ". Still present at the last observation."
                          : `. Exited ${formatHistoryTime(contributor.exitedAtMs, true)}.`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
              Activity evidence
            </p>
            <p className="mt-1 text-xs text-[var(--color-foreground-secondary)]">
              Correlated activity is evidence, not proof that it caused a resource change.
            </p>
            {detail.activity.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-foreground-secondary)]">
                No recorded renderer or operation activity for this period.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-[var(--color-foreground-secondary)]">
                {detail.activity.map((activity) => (
                  <li key={`${activity.kind}-${activity.name}`}>
                    {activity.name}: {activity.count}{" "}
                    {activity.name === "Chat operations" ? "calls" : "observations"}
                    {activity.failures > 0 ? `, ${activity.failures} failures` : ""}
                  </li>
                ))}
              </ul>
            )}
            {detail.renderer ? (
              <p className="mt-2 text-xs text-[var(--color-foreground-secondary)]">
                Renderer activity: {detail.renderer.route},{" "}
                {detail.renderer.heapUsedBytes === null
                  ? "heap unavailable"
                  : `${formatBytes(detail.renderer.heapUsedBytes)} heap`}
                ,{detail.renderer.domNodeCount} DOM nodes, {detail.renderer.chatEvents} chat
                operations,
                {detail.renderer.activeStreamSlots} stream slots,{" "}
                {detail.renderer.activeVideoElements} video elements. Recorded{" "}
                {formatHistoryTime(detail.renderer.observedAtMs)}.
              </p>
            ) : (
              <p className="mt-2 text-xs text-[var(--color-foreground-secondary)]">
                No renderer evidence was retained for this period.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-foreground-secondary)]">
          Select a timeline bar or incident to inspect recorded evidence.
        </p>
      )}
    </section>
  );
}

function ResourceHistoryPanel({
  leaseId,
  snapshot,
  range,
  onRangeChange,
}: {
  readonly leaseId: string | null;
  readonly snapshot: DiagnosticsSnapshot;
  readonly range: DiagnosticsHistoryRange;
  readonly onRangeChange: (range: DiagnosticsHistoryRange) => void;
}) {
  const [live, setLive] = useState(true);
  const [pausedEndAtMs, setPausedEndAtMs] = useState(snapshot.observedAtMs);
  const [selection, setSelection] = useState<DiagnosticsHistorySelection | null>(null);
  const endAtMs = live ? snapshot.observedAtMs : pausedEndAtMs;
  const { history, context } = useDiagnosticsResourceHistory({
    leaseId,
    range,
    endAtMs,
    selection,
  });
  const series = history.value;
  const selectedContext = context.value;

  const chooseBucket = (bucket: DiagnosticsHistoryBucket): void => {
    setPausedEndAtMs(endAtMs);
    setLive(false);
    setSelection({ kind: "bucket", startedAtMs: bucket.startedAtMs, endedAtMs: bucket.endedAtMs });
  };
  const chooseIncident = (incidentId: string): void => {
    setPausedEndAtMs(endAtMs);
    setLive(false);
    setSelection({ kind: "incident", incidentId });
  };
  const movePeriod = (direction: -1 | 1): void => {
    setLive(false);
    setSelection(null);
    setPausedEndAtMs(
      direction === -1
        ? Math.max(historyRangeDurationMs(range), endAtMs - historyRangeDurationMs(range))
        : Math.min(snapshot.observedAtMs, endAtMs + historyRangeDurationMs(range))
    );
  };
  const zoomToSelectedPeak = (peakAtMs: number): void => {
    onRangeChange("1h");
    setLive(false);
    setPausedEndAtMs(Math.min(snapshot.observedAtMs, peakAtMs + 30 * 60_000));
    setSelection(null);
  };

  return (
    <Panel
      title="Resource history"
      eyebrow="Recorded CPU and memory evidence"
      icon={<LuActivity />}
      iconClassName="text-cyan-300"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] p-4">
        <div
          role="group"
          className="flex max-w-full flex-wrap rounded-lg border border-[var(--color-border)] p-1"
          aria-label="Resource history range"
        >
          {HISTORY_RANGE_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-label={option.label}
              aria-pressed={range === option.id}
              onClick={() => {
                onRangeChange(option.id);
                setSelection(null);
              }}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                range === option.id
                  ? "bg-[var(--color-background-tertiary)] text-white"
                  : "text-[var(--color-foreground-secondary)] hover:text-white"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <label className="sr-only" htmlFor="diagnostics-history-end-at">
            End time for resource history
          </label>
          <input
            id="diagnostics-history-end-at"
            aria-label="End time for resource history"
            type="datetime-local"
            value={formatHistoryInput(endAtMs)}
            max={formatHistoryInput(snapshot.observedAtMs)}
            onChange={(event) => {
              const selectedEndAtMs = new Date(event.currentTarget.value).getTime();
              if (!Number.isFinite(selectedEndAtMs)) return;
              setLive(false);
              setPausedEndAtMs(Math.max(0, Math.min(snapshot.observedAtMs, selectedEndAtMs)));
              setSelection(null);
            }}
            className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous period"
            onClick={() => movePeriod(-1)}
          >
            <LuChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next period"
            disabled={live}
            onClick={() => movePeriod(1)}
          >
            <LuChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={live ? "Pause live updates" : "Resume live updates"}
            onClick={() => {
              if (live) {
                setPausedEndAtMs(endAtMs);
                setLive(false);
                return;
              }
              setLive(true);
              setSelection(null);
            }}
          >
            {live ? (
              <LuPause className="mr-2 h-4 w-4" aria-hidden />
            ) : (
              <LuPlay className="mr-2 h-4 w-4" aria-hidden />
            )}
            {live ? "Pause" : "Resume"}
          </Button>
        </div>
      </div>
      {history.kind === "loading" && series ? (
        <p role="status" className="px-4 pt-2 text-xs text-[var(--color-foreground-secondary)]">
          Updating recorded range…
        </p>
      ) : null}
      {history.kind === "error" ? (
        <p
          role="alert"
          className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
        >
          Unable to load resource history. Diagnostic ID: {history.diagnosticId}
        </p>
      ) : null}
      {series ? (
        <>
          {series.buckets.length === 0 ? (
            <p className="px-4 pt-4 text-sm text-[var(--color-foreground-secondary)]">
              No retained observations in this period.
            </p>
          ) : null}
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <HistoryTimeline
              heading="CPU timeline"
              history={series}
              selection={selection}
              onSelect={chooseBucket}
              value={(bucket) => bucket.maximumCpuPercent}
              colorClassName="bg-violet-300"
            />
            <HistoryTimeline
              heading="RAM timeline"
              history={series}
              selection={selection}
              onSelect={chooseBucket}
              value={(bucket) => bucket.maximumResidentBytes}
              colorClassName="bg-cyan-300"
            />
          </div>
          <div className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-foreground-secondary)]">
            Available:{" "}
            {series.available.oldestAtMs === null
              ? "No retained data"
              : formatHistoryTime(series.available.oldestAtMs)}
            {series.available.newestAtMs === null
              ? null
              : ` to ${formatHistoryTime(series.available.newestAtMs)}`}
            <span className="ml-4">
              {series.resolution === "1s"
                ? "1 second peak buckets"
                : series.resolution === "raw"
                  ? "10s peak buckets"
                  : series.resolution === "minute"
                    ? "1 minute summaries"
                    : `${series.resolution} peak buckets`}{" "}
              · Collected every 5s (1s in Real time)
            </span>
            <span className="ml-4">{formatBytes(series.recorder.databaseBytes)} retained</span>
            {series.recorder.kind === "ready" ? null : (
              <span className="ml-4 text-amber-200">Recorder error: {series.recorder.reason}</span>
            )}
          </div>
          <p className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-foreground-secondary)]">
            History stays on this device after closing. Recording resumes when reopened. Fine detail
            1h · minute summaries 7d · hourly summaries 90d.
          </p>
          {(() => {
            const closedGaps = series.gaps.filter((gap) => gap.cause === "app-closed");
            const latestClosedGap = closedGaps.at(-1);
            return latestClosedGap ? (
              <p className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-amber-200">
                App closed: {formatHistoryTime(latestClosedGap.startedAtMs)} to{" "}
                {formatHistoryTime(latestClosedGap.endedAtMs)}
                {closedGaps.length > 1 ? ` (${closedGaps.length} closed intervals)` : ""}
              </p>
            ) : null;
          })()}
          {series.incidents.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] p-4">
              {series.incidents.map((incident) => {
                const timestamp = formatHistoryTime(incident.observedAtMs);
                return (
                  <Button
                    key={incident.incidentId}
                    size="sm"
                    variant="secondary"
                    aria-label={`Incident ${incident.label} ${timestamp}`}
                    onClick={() => chooseIncident(incident.incidentId)}
                  >
                    {incident.label}
                    <span className="ml-2 font-normal opacity-70">{timestamp}</span>
                  </Button>
                );
              })}
            </div>
          ) : null}
          <ResourceHistoryDetail
            history={series}
            selection={selection}
            context={context}
            onSelect={chooseBucket}
          />
          {selectedContext ? (
            <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] px-4 py-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => zoomToSelectedPeak(selectedContext.bucket.maximumCpuAtMs)}
              >
                Zoom to CPU peak (1 hour)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => zoomToSelectedPeak(selectedContext.bucket.maximumResidentAtMs)}
              >
                Zoom to RAM peak (1 hour)
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
          {history.kind === "loading"
            ? "Loading resource history…"
            : "Waiting for resource history."}
        </p>
      )}
    </Panel>
  );
}

function ResourcesTab({
  leaseId,
  snapshot,
  range,
  onRangeChange,
}: {
  readonly leaseId: string | null;
  readonly snapshot: DiagnosticsSnapshot;
  readonly range: DiagnosticsHistoryRange;
  readonly onRangeChange: (range: DiagnosticsHistoryRange) => void;
}) {
  if (snapshot.detail.tab !== "resources") return null;
  const { collection, footprint, host } = snapshot.overview;
  const rows = snapshot.detail.processes;
  const mainProcesses = rows.filter((row) => row.category === "main");
  const desktopProcesses = rows.filter((row) => row.category !== "main");
  const cpuTimeMs = rows.reduce((total, row) => total + (row.cumulativeCpuMs ?? 0), 0);
  const samples = rows.reduce((total, row) => total + row.samples, 0);
  const peakResidentBytes = rows.reduce((total, row) => total + row.peakResidentBytes, 0);
  const hasReadTotals = rows.some((row) => row.readTotalBytes !== null);
  const hasWriteTotals = rows.some((row) => row.writeTotalBytes !== null);
  const readTotalBytes = rows.reduce((total, row) => total + (row.readTotalBytes ?? 0), 0);
  const writeTotalBytes = rows.reduce((total, row) => total + (row.writeTotalBytes ?? 0), 0);
  const ioStatus = snapshot.sourceStatuses["process-io"];
  const ioPlaceholder =
    ioStatus.kind === "unsupported"
      ? translateSettings({ key: "settings.unsupported" })
      : translateSettings({ key: "settings.collecting" });
  const nativeStatus = snapshot.sourceStatuses["electron-processes"];
  return (
    <div className="space-y-4">
      <ResourceHistoryPanel
        leaseId={leaseId}
        snapshot={snapshot}
        range={range}
        onRangeChange={onRangeChange}
      />
      <Panel
        title={translateSettings({ key: "settings.resourceMonitor" })}
        icon={<LuActivity />}
        iconClassName="text-cyan-300"
        action={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--color-foreground-secondary)]">
                {translateSettings({ key: "settings.native" })}
              </span>
              <StatusPill status={nativeStatus} />
            </div>
            <span className="text-xs tabular-nums text-[var(--color-foreground-secondary)]">
              {translateSettings({ key: "settings.updated" })}
              {formatObservedAt(snapshot.observedAtMs)}
            </span>
            <span className="flex items-center gap-2 text-xs text-[var(--color-foreground-secondary)]">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              {translateSettings({ key: "settings.samplingEvery" })}
              {(collection.sampleIntervalMs / 1_000).toFixed(0)}{" "}
              {translateSettings({ key: "settings.second" })}
            </span>
          </div>
        }
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label={translateSettings({ key: "settings.currentCpu" })}
            value={valueText(footprint.cpuPercent, (value) => `${value.toFixed(1)}%`)}
            detail={translateSettings({
              key: "settings.observedCpuTime",
              options: {
                value: formatDuration(cpuTimeMs),
              },
            })}
            icon={<LuCpu />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.residentMemory" })}
            value={valueText(footprint.residentMemoryBytes, formatBytes)}
            detail={translateSettings({
              key: "settings.combinedProcessPeaks",
              options: {
                value: formatBytes(peakResidentBytes),
              },
            })}
            icon={<LuMemoryStick />}
            iconClassName="text-cyan-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.processCount" })}
            value={valueText(footprint.processCount, String)}
            detail={translateSettings({
              key: "settings.processStartsAndExits",
              options: {
                starts: collection.processStarts,
                exits: collection.processExits,
              },
            })}
            icon={<LuActivity />}
            iconClassName="text-emerald-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.readThroughput" })}
            value={valueText(footprint.readBytesPerSecond, formatRate)}
            detail={
              hasReadTotals
                ? translateSettings({
                    key: "settings.observedValue",
                    options: {
                      value: formatBytes(readTotalBytes),
                    },
                  })
                : ioPlaceholder
            }
            icon={<LuHardDrive />}
            iconClassName="text-emerald-200"
          />
          <MetricCard
            label={translateSettings({ key: "settings.writeThroughput" })}
            value={valueText(footprint.writeBytesPerSecond, formatRate)}
            detail={
              hasWriteTotals
                ? translateSettings({
                    key: "settings.observedValue",
                    options: {
                      value: formatBytes(writeTotalBytes),
                    },
                  })
                : ioPlaceholder
            }
            icon={<LuFileText />}
            iconClassName="text-violet-200"
          />
          <MetricCard
            label={translateSettings({ key: "settings.cpuSpeedLimit" })}
            value={valueText(footprint.cpuSpeedLimitPercent, (value) => `${value.toFixed(0)}%`)}
            detail={
              hasValue(host.thermalState)
                ? translateSettings({
                    key: "settings.thermalStateValue",
                    options: {
                      value: host.thermalState.value,
                    },
                  })
                : translateSettings({ key: "settings.osAdvertisedProcessorLimit" })
            }
            icon={<LuGauge />}
            iconClassName="text-amber-300"
          />
        </div>
        <div className="grid border-t border-[var(--color-border)] bg-[var(--color-background-secondary)] lg:grid-cols-3">
          <ResourceAggregateCard
            label={translateSettings({ key: "settings.mainProcess" })}
            countLabel={formatProcessCount(mainProcesses.length)}
            accentClassName="bg-emerald-300"
            metrics={aggregateProcessMetrics(mainProcesses, ioPlaceholder)}
          />
          <ResourceAggregateCard
            label={translateSettings({ key: "settings.desktopProcesses" })}
            countLabel={formatProcessCount(desktopProcesses.length)}
            accentClassName="bg-cyan-300"
            metrics={aggregateProcessMetrics(desktopProcesses, ioPlaceholder)}
          />
          <ResourceAggregateCard
            label={translateSettings({ key: "settings.collectorOverhead" })}
            countLabel={translateSettings({ key: "settings.inMainProcess" })}
            accentClassName="bg-amber-300"
            metrics={[
              {
                label: "CPU",
                value: valueText(footprint.collectorCpuPercent, (value) => `${value.toFixed(2)}%`),
              },
              {
                label: translateSettings({ key: "settings.collection" }),
                value: valueText(footprint.collectionDurationMs, formatDuration),
              },
              {
                label: translateSettings({ key: "settings.retainedState" }),
                value: valueText(footprint.collectorResidentBytes, formatBytes),
              },
              {
                label: translateSettings({ key: "settings.iO" }),
                value: translateSettings({ key: "settings.includedInMain" }),
              },
            ]}
          />
        </div>
      </Panel>
      <Panel
        title={translateSettings({ key: "settings.liveProcessTree" })}
        eyebrow={translateSettings({ key: "settings.currentActivityAndProcessHierarchy" })}
        icon={<LuGauge />}
        iconClassName="text-amber-300"
      >
        <div className="border-b border-[var(--color-border)] bg-[var(--color-background-secondary)] px-5 py-3">
          <p className="text-sm font-bold text-white">
            {translateSettings({ key: "settings.liveProcessTree" })}
          </p>
          <p className="mt-1 text-xs text-[var(--color-foreground-secondary)]">
            {translateSettings({ key: "settings.parentChildIdentityUsesPidAndCreationTime" })}
          </p>
        </div>
        <ProcessTable
          rows={rows}
          ioStatus={snapshot.sourceStatuses["process-io"]}
          viewportClassName="max-h-[26rem] overflow-y-auto"
        />
      </Panel>
      <Panel
        title={translateSettings({ key: "settings.resourceHistory" })}
        eyebrow={translateSettings({ key: "settings.windowedProcessStatistics" })}
        icon={<LuActivity />}
        iconClassName="text-cyan-300"
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          <HistoryMetric
            label={translateSettings({ key: "settings.cpuTime" })}
            value={formatDuration(cpuTimeMs)}
          />
          <HistoryMetric
            label={translateSettings({ key: "settings.samples" })}
            value={samples.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
          />
          <HistoryMetric
            label={translateSettings({ key: "settings.interval" })}
            value={`${(collection.sampleIntervalMs / 1_000).toFixed(2)} s`}
          />
          <HistoryMetric
            label={translateSettings({ key: "settings.processes" })}
            value={String(rows.length)}
          />
        </div>
        <ProcessHistoryTable rows={rows} />
      </Panel>
    </div>
  );
}

function EmptySource({
  title,
  status,
  explanation,
}: {
  title: string;
  status: DiagnosticSourceStatus;
  explanation: string;
}) {
  return (
    <Panel
      title={title}
      eyebrow={translateSettings({ key: "settings.sourceStatus" })}
      icon={<LuShieldCheck />}
      iconClassName="text-amber-300"
    >
      <div className="flex min-h-52 flex-col items-center justify-center gap-4 p-8 text-center">
        <StatusPill status={status} />
        <p className="max-w-2xl text-sm leading-6 text-[var(--color-foreground-secondary)]">
          {explanation}
        </p>
      </div>
    </Panel>
  );
}

function IoTab({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  if (snapshot.detail.tab !== "io") return null;
  if (snapshot.detail.rows.length === 0) {
    return (
      <EmptySource
        title={translateSettings({ key: "settings.instrumentedApplicationIO" })}
        status={snapshot.sourceStatuses["logical-io"]}
        explanation={translateSettings({ key: "settings.noLogicalIoOperationsObserved" })}
      />
    );
  }
  return (
    <Panel
      title={translateSettings({ key: "settings.instrumentedApplicationIO" })}
      eyebrow={translateSettings({ key: "settings.logicalBytesByOperation" })}
      icon={<LuDatabase />}
      iconClassName="text-emerald-300"
    >
      <p className="border-b border-[var(--color-border)] px-5 py-4 text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
        {translateSettings({
          key: "settings.applicationCountersIdentifyKnownPersistenceAndLoggingWorkTheseLo",
        })}
      </p>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
            <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
              <th className="px-5 py-3">{translateSettings({ key: "settings.component" })}</th>
              <th className="px-4 py-3">{translateSettings({ key: "settings.operation" })}</th>
              <th className="px-4 py-3 text-right">
                {translateSettings({ key: "settings.logicalRead" })}
              </th>
              <th className="px-4 py-3 text-right">
                {translateSettings({ key: "settings.logicalWrite" })}
              </th>
              <th className="px-4 py-3 text-right">
                {translateSettings({ key: "settings.count" })}
              </th>
              <th className="px-5 py-3 text-right">
                {translateSettings({ key: "settings.time" })}
              </th>
            </tr>
          </thead>
          <tbody>
            {snapshot.detail.rows.map((row) => (
              <tr
                key={`${row.component}:${row.operation}`}
                className="border-t border-[var(--color-border)]"
              >
                <td className="px-5 py-3.5 font-semibold text-white">{row.component}</td>
                <td className="px-4 py-3.5 text-[var(--color-foreground-secondary)]">
                  {row.operation}
                </td>
                <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-emerald-200">
                  {formatBytes(row.logicalReadBytes)}
                </td>
                <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-violet-200">
                  {formatBytes(row.logicalWriteBytes)}
                </td>
                <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                  {row.count.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
                </td>
                <td className="px-5 py-3.5 text-right tabular-nums text-[var(--color-foreground-secondary)]">
                  {formatDuration(row.durationMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TracesTab({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  if (snapshot.detail.tab !== "traces") return null;
  const { spans, logs, topNames, latestFailures, commonFailures } = snapshot.detail;
  const failures = spans.filter((span) => span.outcome === "error");
  const slowest = [...spans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 50);
  return (
    <div className="space-y-4">
      <Panel
        title={translateSettings({ key: "settings.traceDiagnostics" })}
        eyebrow={translateSettings({ key: "settings.canonicalSpansAndLogs" })}
        icon={<LuWorkflow />}
        iconClassName="text-violet-300"
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={translateSettings({ key: "settings.spans" })}
            value={spans.length.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
            detail={translateSettings({ key: "settings.retainedInThisTimeWindow" })}
            icon={<LuWorkflow />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.failures" })}
            value={failures.length.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
            detail={translateSettings({ key: "settings.explicitErrorOutcomes" })}
            icon={<LuTriangleAlert />}
            iconClassName="text-amber-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.slowSpans" })}
            value={spans
              .filter((span) => span.durationMs >= 500)
              .length.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
            detail={translateSettings({ key: "settings.atLeast500Ms" })}
            icon={<LuGauge />}
            iconClassName="text-emerald-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.spanLogs" })}
            value={logs.length.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
            detail={translateSettings({ key: "settings.separateCanonicalLogEvidence" })}
            icon={<LuFileText />}
            iconClassName="text-cyan-200"
          />
        </div>
      </Panel>

      <TraceFailurePanels latest={latestFailures} common={commonFailures} />

      <Panel
        title={translateSettings({ key: "settings.slowestSpans" })}
        eyebrow={translateSettings({ key: "settings.durationRankedOperations" })}
        icon={<LuGauge />}
        iconClassName="text-emerald-300"
      >
        {slowest.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings({ key: "settings.noSpansWereRetainedInThisWindow" })}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="px-5 py-3">{translateSettings({ key: "settings.span" })}</th>
                  <th className="px-4 py-3 text-right">
                    {translateSettings({ key: "settings.duration" })}
                  </th>
                  <th className="px-4 py-3">{translateSettings({ key: "settings.ended" })}</th>
                  <th className="px-4 py-3">{translateSettings({ key: "settings.outcome" })}</th>
                  <th className="w-14 px-5 py-3 text-right">
                    {translateSettings({ key: "settings.copy" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {slowest.map((span) => (
                  <tr key={span.spanId} className="border-t border-[var(--color-border)]">
                    <td className="px-5 py-3.5 font-semibold text-white">{span.name}</td>
                    <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-violet-200">
                      {formatDuration(span.durationMs)}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-[var(--color-foreground-secondary)]">
                      {formatObservedAt(span.endedAtMs)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3.5 font-semibold",
                        span.outcome === "error" ? "text-red-300" : "text-emerald-200"
                      )}
                    >
                      {span.outcome}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        className="inline-flex rounded-md p-1.5 text-[var(--color-foreground-secondary)] hover:bg-[var(--color-background-tertiary)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        title={translateSettings({ key: "settings.copyTraceId" })}
                        aria-label={translateSettings({
                          key: "settings.copyTraceIdValue",
                          options: {
                            value1: span.traceId,
                          },
                        })}
                        onClick={() => void copyTraceId(span.traceId)}
                      >
                        <LuCopy className="h-4 w-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title={translateSettings({ key: "settings.spanLogs" })}
        eyebrow={translateSettings({ key: "settings.correlatedRetainedLogEvidence" })}
        icon={<LuFileText />}
        iconClassName="text-cyan-200"
      >
        {logs.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings({ key: "settings.noRetainedLogsMatchThisWindow" })}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[920px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="w-[14%] px-5 py-3">
                    {translateSettings({ key: "settings.time" })}
                  </th>
                  <th className="w-[10%] px-4 py-3">
                    {translateSettings({ key: "settings.level" })}
                  </th>
                  <th className="w-[20%] px-4 py-3">
                    {translateSettings({ key: "settings.source" })}
                  </th>
                  <th className="w-[41%] px-4 py-3">
                    {translateSettings({ key: "settings.message" })}
                  </th>
                  <th className="w-[15%] px-5 py-3">
                    {translateSettings({ key: "settings.trace" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs
                  .slice()
                  .reverse()
                  .map((log, index) => (
                    <tr
                      key={`${log.observedAtMs}:${index}`}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="px-5 py-3.5 tabular-nums text-[var(--color-foreground-secondary)]">
                        {formatObservedAt(log.observedAtMs)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3.5 font-semibold uppercase",
                          log.level === "error"
                            ? "text-red-300"
                            : log.level === "warn"
                              ? "text-amber-200"
                              : "text-white"
                        )}
                      >
                        {log.level}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-white">{log.source}</td>
                      <td className="whitespace-normal break-words px-4 py-3.5 text-[13px] leading-5 text-[var(--color-foreground-secondary)]">
                        {log.message}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-[var(--color-foreground-secondary)]">
                        {log.traceId?.slice(0, 12) ?? translateSettings({ key: "settings.none" })}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title={translateSettings({ key: "settings.topSpanNames" })}
        eyebrow={translateSettings({ key: "settings.countFailuresAverageAndMax" })}
        icon={<LuActivity />}
        iconClassName="text-violet-300"
      >
        {topNames.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings({ key: "settings.noSpanNamesWereCountedInThisWindow" })}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="px-5 py-3">{translateSettings({ key: "settings.span" })}</th>
                  <th className="px-4 py-3 text-right">
                    {translateSettings({ key: "settings.count" })}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {translateSettings({ key: "settings.failures" })}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {translateSettings({ key: "settings.average" })}
                  </th>
                  <th className="px-5 py-3 text-right">
                    {translateSettings({ key: "settings.max" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {topNames.map((row) => (
                  <tr key={row.name} className="border-t border-[var(--color-border)]">
                    <td className="px-5 py-3.5 font-semibold text-white">{row.name}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-white">
                      {row.count.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-white">
                      {row.failures.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-violet-200">
                      {formatDuration(row.averageDurationMs)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-violet-200">
                      {formatDuration(row.maxDurationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function TraceFailurePanels({
  latest,
  common,
}: {
  latest: readonly DiagnosticFailure[];
  common: readonly DiagnosticFailure[];
}) {
  return (
    <>
      <Panel
        title={translateSettings({ key: "settings.latestFailures" })}
        eyebrow={translateSettings({ key: "settings.newestExplicitErrorEvidence" })}
        icon={<LuTriangleAlert />}
        iconClassName="text-amber-300"
      >
        {latest.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings({ key: "settings.noFailuresWereObservedInThisWindow" })}
          </p>
        ) : (
          <div className="max-h-[470px] overflow-auto">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="w-[28%] px-5 py-3">
                    {translateSettings({ key: "settings.span" })}
                  </th>
                  <th className="w-[48%] px-4 py-3">
                    {translateSettings({ key: "settings.cause" })}
                  </th>
                  <th className="w-[11%] px-4 py-3 text-right">
                    {translateSettings({ key: "settings.duration" })}
                  </th>
                  <th className="w-[13%] px-5 py-3">
                    {translateSettings({ key: "settings.ended" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {latest.map((failure) => (
                  <tr key={failure.failureId} className="border-t border-[var(--color-border)]">
                    <td className="px-5 py-3.5 font-semibold text-white">{failure.source}</td>
                    <td className="whitespace-normal break-words px-4 py-3.5 text-[13px] leading-5 text-[var(--color-foreground-secondary)]">
                      {failure.cause}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-white">
                      {failure.durationMs === null
                        ? translateSettings({ key: "settings.nA" })
                        : formatDuration(failure.durationMs)}
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-[var(--color-foreground-secondary)]">
                      {formatObservedAt(failure.observedAtMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel
        title={translateSettings({ key: "settings.mostCommonFailures" })}
        eyebrow={translateSettings({ key: "settings.groupedByStableFingerprint" })}
        icon={<LuActivity />}
        iconClassName="text-amber-300"
      >
        {common.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings({ key: "settings.noRecurringFailuresWereObservedInThisWindow" })}
          </p>
        ) : (
          <div className="max-h-[470px] overflow-auto">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="w-[28%] px-5 py-3">
                    {translateSettings({ key: "settings.span" })}
                  </th>
                  <th className="w-[10%] px-4 py-3 text-right">
                    {translateSettings({ key: "settings.count" })}
                  </th>
                  <th className="w-[49%] px-4 py-3">
                    {translateSettings({ key: "settings.cause" })}
                  </th>
                  <th className="w-[13%] px-5 py-3">
                    {translateSettings({ key: "settings.lastSeen" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {common.map((failure) => (
                  <tr key={failure.fingerprint} className="border-t border-[var(--color-border)]">
                    <td className="px-5 py-3.5 font-semibold text-white">{failure.source}</td>
                    <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                      {failure.count.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
                    </td>
                    <td className="whitespace-normal break-words px-4 py-3.5 text-[13px] leading-5 text-[var(--color-foreground-secondary)]">
                      {failure.cause}
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-[var(--color-foreground-secondary)]">
                      {formatObservedAt(failure.observedAtMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function DeveloperToolsTab({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  if (snapshot.detail.tab !== "developer-tools") return null;
  if (!hasValue(snapshot.detail.renderer))
    return (
      <EmptySource
        title={translateSettings({ key: "settings.rendererPerformance" })}
        status={snapshot.detail.renderer.status}
        explanation={translateSettings({
          key: "settings.waitingForTrustedRendererPerformanceReporter",
        })}
      />
    );
  const renderer = snapshot.detail.renderer.value;
  return (
    <div className="space-y-4">
      <Panel
        title={translateSettings({ key: "settings.rendererPerformance" })}
        eyebrow={translateSettings({ key: "settings.productionSafeLiveCounters" })}
        icon={<LuBug />}
        iconClassName="text-red-400"
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label={translateSettings({ key: "settings.heapUsed" })}
            value={
              renderer.heapUsedBytes === null
                ? translateSettings({ key: "settings.unsupported" })
                : formatBytes(renderer.heapUsedBytes)
            }
            detail={
              renderer.heapTotalBytes === null
                ? translateSettings({ key: "settings.chromiumHeapTotalUnavailable" })
                : translateSettings({
                    key: "settings.allocatedValue",
                    options: {
                      value: formatBytes(renderer.heapTotalBytes),
                    },
                  })
            }
            icon={<LuMemoryStick />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.framesPerSecond" })}
            value={renderer.framesPerSecond.toFixed(1)}
            detail={translateSettings({ key: "settings.observedWhileDiagnosticsIsVisible" })}
            icon={<LuActivity />}
            iconClassName="text-emerald-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.frameTime" })}
            value={formatDuration(renderer.averageFrameTimeMs)}
            detail={translateSettings({ key: "settings.averageAnimationFrameInterval" })}
            icon={<LuGauge />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.liveIntervals" })}
            value={renderer.liveIntervalCount.toLocaleString(
              i18n.resolvedLanguage ?? i18n.language
            )}
            detail={translateSettings({ key: "settings.trackedActiveIntervalHandles" })}
            icon={<LuRadio />}
            iconClassName="text-emerald-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.renderCount" })}
            value={renderer.renderCount.toLocaleString(i18n.resolvedLanguage ?? i18n.language)}
            detail={translateSettings({ key: "settings.selectedHighValueBoundaries" })}
            icon={<LuWorkflow />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label={translateSettings({ key: "settings.chatStoreRatePerSecond" })}
            value={renderer.chatStoreCallsPerSecond.toFixed(1)}
            detail={translateSettings({
              key: "settings.aggregatedStoreActionsNotIndividualMessages",
            })}
            icon={<LuActivity />}
            iconClassName="text-emerald-300"
          />
        </div>
      </Panel>
      <Panel
        title={translateSettings({ key: "settings.developerControls" })}
        eyebrow={translateSettings({ key: "settings.explicitLocalTools" })}
        icon={<LuBug />}
        iconClassName="text-red-400"
      >
        <div className="flex flex-wrap items-center gap-3 p-5">
          <Button variant="outline" onClick={() => window.electronAPI.toggleDevTools()}>
            {translateSettings({ key: "settings.openChromiumDevtools" })}
          </Button>
          {import.meta.env.DEV ? (
            <p className="text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
              {translateSettings({
                key: "settings.chatSimAndUiSimulationRemainInTheFloatingDeveloperConsolePressCt",
              })}
            </p>
          ) : (
            <p className="text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
              {translateSettings({
                key: "settings.stateMutatingSimulatorsAreUnavailableInProductionBuilds",
              })}
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function WorkspaceContent({
  leaseId,
  snapshot,
  range,
  onRangeChange,
}: {
  readonly leaseId: string | null;
  readonly snapshot: DiagnosticsSnapshot;
  readonly range: DiagnosticsHistoryRange;
  readonly onRangeChange: (range: DiagnosticsHistoryRange) => void;
}) {
  if (snapshot.view.tab === "overview") return <OverviewTab snapshot={snapshot} />;
  if (snapshot.view.tab === "resources")
    return (
      <ResourcesTab
        leaseId={leaseId}
        snapshot={snapshot}
        range={range}
        onRangeChange={onRangeChange}
      />
    );
  if (snapshot.view.tab === "io") return <IoTab snapshot={snapshot} />;
  if (snapshot.view.tab === "traces") return <TracesTab snapshot={snapshot} />;
  if (snapshot.view.tab === "logs-reports") {
    return (
      <div className="space-y-4">
        <Panel
          title={translateSettings({ key: "settings.sessionLogs" })}
          eyebrow={translateSettings({ key: "settings.mainNetworkAndNoise" })}
          icon={<LuFileText />}
          iconClassName="text-emerald-400"
        >
          <div className="p-5">
            <LogsSection />
          </div>
        </Panel>
        <Panel
          title={translateSettings({ key: "settings.createDiagnosticReport" })}
          eyebrow={translateSettings({ key: "settings.safeLocalReport" })}
          icon={<LuBug />}
          iconClassName="text-red-400"
        >
          <div className="p-5">
            <BugReportSection />
          </div>
        </Panel>
      </div>
    );
  }
  return <DeveloperToolsTab snapshot={snapshot} />;
}

export function DiagnosticsWorkspace({
  onSectionChange,
}: {
  readonly onSectionChange: () => void;
}) {
  useTranslation();
  const tabs = getTabs();
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>("overview");
  const [resourceHistoryRange, setResourceHistoryRange] =
    useState<DiagnosticsHistoryRange>("realtime");
  const previousTabRef = useRef(activeTab);
  const [windowsByTab, setWindowsByTab] =
    useState<Readonly<Record<WindowedDiagnosticsTab, DiagnosticsWindowMinutes>>>(
      DEFAULT_WINDOWS_BY_TAB
    );
  const windowMinutes = usesWindowControl(activeTab) ? windowsByTab[activeTab] : 15;
  const view = useMemo(
    () => ({ tab: activeTab, windowMinutes, resourceHistoryRange }),
    [activeTab, resourceHistoryRange, windowMinutes]
  );
  const diagnostics = useDiagnosticsWorkspace(view);

  useEffect(() => {
    if (previousTabRef.current === activeTab) return;
    previousTabRef.current = activeTab;
    onSectionChange();
  }, [activeTab, onSectionChange]);

  return (
    <div className="space-y-5 pb-24">
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-secondary)]">
            {translateSettings({ key: "settings.streamfusionSystemEvidence" })}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            {translateSettings({ key: "settings.diagnostics" })}
          </h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
            {translateSettings({
              key: "settings.liveResourcesProcessesApplicationIOTracesFailuresLogsReportsAndR",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {usesWindowControl(activeTab) ? (
            <WindowControl
              value={windowMinutes}
              onChange={(value) =>
                setWindowsByTab((current) => ({ ...current, [activeTab]: value }))
              }
            />
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void diagnostics.refresh()}
            disabled={diagnostics.kind === "loading"}
          >
            <LuRefreshCw className="mr-2 h-4 w-4" aria-hidden />{" "}
            {translateSettings({ key: "settings.refresh" })}
          </Button>
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)]">
        <div
          className="overflow-x-auto border-b border-[var(--color-border)]"
          role="tablist"
          aria-label={translateSettings({ key: "settings.diagnosticsSections" })}
        >
          <div className="flex min-w-max px-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  id={`diagnostics-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls="diagnostics-active-panel"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-2 px-3.5 py-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white motion-reduce:transition-none",
                    activeTab === tab.id
                      ? "text-white after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-white"
                      : "text-[var(--color-foreground-secondary)] hover:text-white"
                  )}
                >
                  <Icon className={cn("h-4 w-4", tab.color)} aria-hidden />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          id="diagnostics-active-panel"
          role="tabpanel"
          aria-labelledby={`diagnostics-tab-${activeTab}`}
          className="p-4"
        >
          {diagnostics.kind === "loading" ? (
            <div
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              aria-label={translateSettings({ key: "settings.loadingLiveDiagnostics" })}
            >
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div
                  key={item}
                  className="h-36 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : diagnostics.snapshot ? (
            <div className="space-y-3">
              {diagnostics.kind === "error" ? (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
                >
                  {translateSettings({
                    key: "settings.theLatestRefreshFailedShowingTheLastTrustedSnapshotDiagnosticId",
                  })}{" "}
                  {diagnostics.diagnosticId}.
                </div>
              ) : null}
              <WorkspaceContent
                leaseId={diagnostics.leaseId}
                snapshot={diagnostics.snapshot}
                range={resourceHistoryRange}
                onRangeChange={setResourceHistoryRange}
              />
            </div>
          ) : (
            <div
              role="alert"
              className="rounded-lg border border-red-400/30 bg-red-400/10 p-5 text-sm text-red-100"
            >
              {translateSettings({
                key: "settings.diagnosticsCouldNotEstablishATrustedLocalSourceDiagnosticId",
              })}{" "}
              {diagnostics.kind === "error"
                ? diagnostics.diagnosticId
                : translateSettings({ key: "settings.unavailable" })}
              .
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
