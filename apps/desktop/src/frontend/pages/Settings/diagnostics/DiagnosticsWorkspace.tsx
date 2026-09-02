import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { i18n } from "@/i18n";
import type { settingsEn } from "@/i18n/locales/en/settings";
import {
  LuActivity,
  LuBug,
  LuCopy,
  LuCpu,
  LuDatabase,
  LuFileText,
  LuGauge,
  LuHardDrive,
  LuMemoryStick,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDiagnosticsWorkspace } from "@/features/settings/data/use-diagnostics-workspace";
import { cn } from "@/lib/utils";
import type {
  DiagnosticSourceStatus,
  DiagnosticFailure,
  DiagnosticsSnapshot,
  DiagnosticsTab,
  DiagnosticsWindowMinutes,
  DiagnosticValue,
  ProcessObservation,
} from "@shared/diagnostics-types";

import {
  bucketDiagnosticsResourceHistory,
  resourceHistoryBarHeight,
} from "./diagnostics-resource-history";

function translateSettings(
  key: `settings.${keyof typeof settingsEn.settings}`,
  options?: Record<string, unknown>
): string {
  const translated: string = i18n["t"](key, { defaultValue: String(key) });
  return options
    ? Object.entries(options).reduce(
        (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)),
        translated
      )
    : translated;
}
const TABS: ReadonlyArray<{
  id: DiagnosticsTab;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  color: string;
}> = [
  {
    id: "overview",
    label: i18n["t"]("settings.overview"),
    icon: LuGauge,
    color: "text-emerald-400",
  },
  {
    id: "resources",
    label: i18n["t"]("settings.resources"),
    icon: LuActivity,
    color: "text-cyan-300",
  },
  { id: "io", label: i18n["t"]("settings.iO"), icon: LuDatabase, color: "text-emerald-200" },
  { id: "traces", label: i18n["t"]("settings.traces"), icon: LuWorkflow, color: "text-sky-300" },
  {
    id: "logs-reports",
    label: i18n["t"]("settings.logsReports"),
    icon: LuFileText,
    color: "text-emerald-400",
  },
  {
    id: "developer-tools",
    label: i18n["t"]("settings.developerTools"),
    icon: LuBug,
    color: "text-red-400",
  },
];

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
  return new Date(observedAtMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function copyTraceId(traceId: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(traceId);
    toast.success(translateSettings("settings.traceIdCopied"));
  } catch {
    toast.error(translateSettings("settings.couldNotCopyTheTraceId"));
  }
}

function sourceLabel(status: DiagnosticSourceStatus): string {
  if (status.kind === "ready") return "Ready";
  if (status.kind === "stale") return "Stale";
  if (status.kind === "unsupported") return "Unsupported";
  return "Unavailable";
}

function valueText<T>(value: DiagnosticValue<T>, format: (item: T) => string): string {
  return hasValue(value) ? format(value.value) : sourceLabel(value.status);
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
      return "No reported errors";
    case "stale":
      return `Updates are stale (${status.reason.replaceAll("-", " ")})`;
    case "unavailable":
      return `Unavailable (${status.reason.replaceAll("-", " ")})`;
    case "unsupported":
      return `Not supported on ${status.platform}`;
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
      <StatusPill status={status} readyLabel="Healthy" />
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
    { label: i18n["t"]("settings.memory"), value: formatBytes(memory) },
    { label: i18n["t"]("settings.read"), value: hasReadRate ? formatRate(read) : ioPlaceholder },
    { label: i18n["t"]("settings.write"), value: hasWriteRate ? formatRate(write) : ioPlaceholder },
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
      aria-label={translateSettings("settings.timeWindow")}
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
            ? translateSettings("settings.value1h")
            : translateSettings("settings.valueM", { minutes: minutes })}
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

function ResourceChart({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const history =
    snapshot.detail.tab === "resources" || snapshot.detail.tab === "processes"
      ? snapshot.detail.history
      : [];
  const buckets = bucketDiagnosticsResourceHistory(
    history,
    snapshot.view.windowMinutes,
    snapshot.observedAtMs
  );
  const maxCpu = Math.max(1, ...buckets.map((bucket) => bucket.avgCpuPercent));
  const maxIo = Math.max(1, ...buckets.map((bucket) => bucket.ioReadBytes + bucket.ioWriteBytes));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-[var(--color-foreground-secondary)]">
        <span>
          <span className="mr-2 inline-block h-1.5 w-3 rounded-full bg-violet-300" />
          {translateSettings("settings.cpuAverage")}
        </span>
        <span>
          <span className="mr-2 inline-block h-1.5 w-3 rounded-full bg-emerald-200" />
          {translateSettings("settings.iOReads")}
        </span>
        <span>
          <span className="mr-2 inline-block h-1.5 w-3 rounded-full bg-violet-500" />
          {translateSettings("settings.iOWrites")}
        </span>
      </div>
      <div
        className="flex h-32 items-end gap-1 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-2 pb-2 pt-3"
        role="img"
        aria-label={translateSettings(
          "settings.resourceHistoryForTheSelectedValueMinuteWindowWithValueTimeBucke",
          { value1: snapshot.view.windowMinutes, value2: buckets.length }
        )}
      >
        {buckets.length === 0 ? (
          <p className="m-auto text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings("settings.waitingForResourceHistory")}
          </p>
        ) : (
          buckets.map((bucket) => {
            const cpuHeight = resourceHistoryBarHeight({
              value: bucket.avgCpuPercent,
              max: maxCpu,
              minimumVisiblePercent: 2,
            });
            const readHeight = resourceHistoryBarHeight({
              value: bucket.ioReadBytes,
              max: maxIo,
              minimumVisiblePercent: 1,
            });
            const writeHeight = resourceHistoryBarHeight({
              value: bucket.ioWriteBytes,
              max: maxIo,
              minimumVisiblePercent: 1,
            });
            return (
              <Tooltip key={bucket.startedAtMs}>
                <TooltipTrigger asChild>
                  <div
                    className="grid h-full min-w-1 flex-1 grid-cols-3 items-end gap-px outline-none focus-visible:ring-1 focus-visible:ring-white"
                    data-resource-bucket={bucket.startedAtMs}
                    tabIndex={0}
                  >
                    <span
                      className="block rounded-t-sm bg-violet-300/85"
                      style={{ height: `${cpuHeight}%` }}
                    />
                    <span
                      className="block rounded-t-sm bg-emerald-200"
                      style={{ height: `${readHeight}%` }}
                    />
                    <span
                      className="block rounded-t-sm bg-violet-500/85"
                      style={{ height: `${writeHeight}%` }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="space-y-0.5 text-left text-xs tabular-nums">
                  <div>
                    {translateSettings("settings.cpuAvg")}
                    {bucket.avgCpuPercent.toFixed(1)}%
                  </div>
                  <div>
                    {translateSettings("settings.cpuPeak")}
                    {bucket.maxCpuPercent.toFixed(1)}%
                  </div>
                  <div>
                    {translateSettings("settings.read")}
                    {formatBytes(bucket.ioReadBytes)}
                  </div>
                  <div>
                    {translateSettings("settings.write")}
                    {formatBytes(bucket.ioWriteBytes)}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })
        )}
      </div>
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
        {translateSettings("settings.noLiveProcessesObserved")}
      </p>
    );
  }
  const ioPlaceholder = ioStatus.kind === "unsupported" ? "Unsupported" : "Collecting…";
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
            <th className="px-2 py-3">{translateSettings("settings.process")}</th>
            <th className="px-4 py-3">{translateSettings("settings.category")}</th>
            <th className="px-4 py-3 text-right">CPU</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.cpuTime")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.memory")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.readS")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.writeS")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.readTotal")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.writeTotal")}</th>
            <th className="px-5 py-3 text-right">PID</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.kill")}</th>
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
                  ? translateSettings("settings.unsupported")
                  : translateSettings("settings.valueS", {
                      value1: (row.cumulativeCpuMs / 1_000).toFixed(1),
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
            <th className="px-5 py-3">{translateSettings("settings.process")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.cpuTime")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.current2")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.average")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.peak")}</th>
            <th className="px-4 py-3 text-right">{translateSettings("settings.maxMemory")}</th>
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
                  ? translateSettings("settings.nA")
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
        title={translateSettings("settings.hostStateAndCollection")}
        eyebrow="Host & collection"
        icon={<LuGauge />}
        iconClassName="text-violet-300"
      >
        <div className="grid lg:grid-cols-2">
          <div className="border-b border-[var(--color-border)] px-5 lg:border-b-0 lg:border-r">
            <StatusRow
              label="Power source"
              value={valueText(host.powerSource, (value) =>
                value === "external" ? "External power" : "Battery"
              )}
            />
            <StatusRow
              label="Low power mode"
              value={valueText(host.lowPowerMode, (value) => (value ? "On" : "Off"))}
            />
            <StatusRow label="Idle" value={valueText(host.idleSeconds, (value) => `${value}s`)} />
            <StatusRow label="Session" value={valueText(host.sessionState, (value) => value)} />
            <StatusRow label="Thermal" value={valueText(host.thermalState, (value) => value)} />
          </div>
          <div className="px-5">
            <CollectionHealthRow label="Native process monitor" status={processStatus} />
            <CollectionHealthRow label="Electron main process" status={mainProcessStatus} />
            <StatusRow
              label="Collection time"
              value={valueText(footprint.collectionDurationMs, (value) => `${value.toFixed(2)} ms`)}
            />
            <StatusRow
              label="Collector CPU"
              value={valueText(footprint.collectorCpuPercent, (value) => `${value.toFixed(2)}%`)}
            />
            <StatusRow
              label="Sampling interval"
              value={`${(collection.sampleIntervalMs / 1_000).toFixed(0)} s`}
            />
            <StatusRow label="Retained samples" value={String(collection.retainedSamples)} />
            <StatusRow label="Process scan" value={`${collection.processScanCount} retained`} />
            <StatusRow label="Inaccessible" value={String(collection.inaccessibleProcessCount)} />
            <StatusRow label="Collector restarts" value={String(collection.restartCount)} />
            <StatusRow label="Dropped detail" value={String(collection.droppedDetailCount)} />
          </div>
        </div>
      </Panel>

      <Panel
        eyebrow="Source status"
        title={translateSettings("settings.evidenceAvailability")}
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

function ResourcesTab({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
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
  const ioPlaceholder = ioStatus.kind === "unsupported" ? "Unsupported" : "Collecting…";
  const nativeStatus = snapshot.sourceStatuses["electron-processes"];
  return (
    <div className="space-y-4">
      <Panel
        title={translateSettings("settings.resourceMonitor")}
        icon={<LuActivity />}
        iconClassName="text-cyan-300"
        action={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--color-foreground-secondary)]">
                {translateSettings("settings.native")}
              </span>
              <StatusPill status={nativeStatus} />
            </div>
            <span className="text-xs tabular-nums text-[var(--color-foreground-secondary)]">
              {translateSettings("settings.updated")}
              {formatObservedAt(snapshot.observedAtMs)}
            </span>
            <span className="flex items-center gap-2 text-xs text-[var(--color-foreground-secondary)]">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              {translateSettings("settings.samplingEvery")}
              {(collection.sampleIntervalMs / 1_000).toFixed(0)}{" "}
              {translateSettings("settings.second")}
            </span>
          </div>
        }
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Current CPU"
            value={valueText(footprint.cpuPercent, (value) => `${value.toFixed(1)}%`)}
            detail={`${formatDuration(cpuTimeMs)} observed CPU time`}
            icon={<LuCpu />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label="Resident memory"
            value={valueText(footprint.residentMemoryBytes, formatBytes)}
            detail={`${formatBytes(peakResidentBytes)} combined process peaks`}
            icon={<LuMemoryStick />}
            iconClassName="text-cyan-300"
          />
          <MetricCard
            label="Process count"
            value={valueText(footprint.processCount, String)}
            detail={`${collection.processStarts} starts · ${collection.processExits} exits`}
            icon={<LuActivity />}
            iconClassName="text-emerald-300"
          />
          <MetricCard
            label="Read throughput"
            value={valueText(footprint.readBytesPerSecond, formatRate)}
            detail={hasReadTotals ? `${formatBytes(readTotalBytes)} observed` : ioPlaceholder}
            icon={<LuHardDrive />}
            iconClassName="text-emerald-200"
          />
          <MetricCard
            label="Write throughput"
            value={valueText(footprint.writeBytesPerSecond, formatRate)}
            detail={hasWriteTotals ? `${formatBytes(writeTotalBytes)} observed` : ioPlaceholder}
            icon={<LuFileText />}
            iconClassName="text-violet-200"
          />
          <MetricCard
            label="CPU speed limit"
            value={valueText(footprint.cpuSpeedLimitPercent, (value) => `${value.toFixed(0)}%`)}
            detail={
              hasValue(host.thermalState)
                ? `${host.thermalState.value} thermal state`
                : "OS-advertised processor limit"
            }
            icon={<LuGauge />}
            iconClassName="text-amber-300"
          />
        </div>
        <div className="grid border-t border-[var(--color-border)] bg-[var(--color-background-secondary)] lg:grid-cols-3">
          <ResourceAggregateCard
            label="Main process"
            countLabel={`${mainProcesses.length} ${mainProcesses.length === 1 ? "process" : "processes"}`}
            accentClassName="bg-emerald-300"
            metrics={aggregateProcessMetrics(mainProcesses, ioPlaceholder)}
          />
          <ResourceAggregateCard
            label="Desktop processes"
            countLabel={`${desktopProcesses.length} ${desktopProcesses.length === 1 ? "process" : "processes"}`}
            accentClassName="bg-cyan-300"
            metrics={aggregateProcessMetrics(desktopProcesses, ioPlaceholder)}
          />
          <ResourceAggregateCard
            label="Collector overhead"
            countLabel="in main process"
            accentClassName="bg-amber-300"
            metrics={[
              {
                label: "CPU",
                value: valueText(footprint.collectorCpuPercent, (value) => `${value.toFixed(2)}%`),
              },
              {
                label: i18n["t"]("settings.collection"),
                value: valueText(footprint.collectionDurationMs, formatDuration),
              },
              {
                label: i18n["t"]("settings.retainedState"),
                value: valueText(footprint.collectorResidentBytes, formatBytes),
              },
              { label: i18n["t"]("settings.iO"), value: "Included in main" },
            ]}
          />
        </div>
      </Panel>
      <Panel
        title={translateSettings("settings.resourceTimelineAndLiveProcessTree")}
        eyebrow="Current activity and process hierarchy"
        icon={<LuGauge />}
        iconClassName="text-amber-300"
      >
        <div className="p-4">
          <ResourceChart snapshot={snapshot} />
        </div>
        <div className="border-y border-[var(--color-border)] bg-[var(--color-background-secondary)] px-5 py-3">
          <p className="text-sm font-bold text-white">
            {translateSettings("settings.liveProcessTree")}
          </p>
          <p className="mt-1 text-xs text-[var(--color-foreground-secondary)]">
            {translateSettings("settings.parentChildIdentityUsesPidAndCreationTime")}
          </p>
        </div>
        <ProcessTable
          rows={rows}
          ioStatus={snapshot.sourceStatuses["process-io"]}
          viewportClassName="max-h-[26rem] overflow-y-auto"
        />
      </Panel>
      <Panel
        title={translateSettings("settings.resourceHistory")}
        eyebrow="Windowed process statistics"
        icon={<LuActivity />}
        iconClassName="text-cyan-300"
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          <HistoryMetric label="CPU time" value={formatDuration(cpuTimeMs)} />
          <HistoryMetric label="Samples" value={samples.toLocaleString()} />
          <HistoryMetric
            label="Interval"
            value={`${(collection.sampleIntervalMs / 1_000).toFixed(2)} s`}
          />
          <HistoryMetric label="Processes" value={String(rows.length)} />
        </div>
        <div className="border-t border-[var(--color-border)] p-4">
          <ResourceChart snapshot={snapshot} />
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
      eyebrow="Source status"
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
        title={translateSettings("settings.instrumentedApplicationIO")}
        status={snapshot.sourceStatuses["logical-io"]}
        explanation="No logical I/O operations have been observed. Diagnostics does not substitute OS process counters or prototype rows."
      />
    );
  }
  return (
    <Panel
      title={translateSettings("settings.instrumentedApplicationIO")}
      eyebrow="Logical bytes by operation"
      icon={<LuDatabase />}
      iconClassName="text-emerald-300"
    >
      <p className="border-b border-[var(--color-border)] px-5 py-4 text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
        {translateSettings(
          "settings.applicationCountersIdentifyKnownPersistenceAndLoggingWorkTheseLo"
        )}
      </p>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
            <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
              <th className="px-5 py-3">{translateSettings("settings.component")}</th>
              <th className="px-4 py-3">{translateSettings("settings.operation")}</th>
              <th className="px-4 py-3 text-right">{translateSettings("settings.logicalRead")}</th>
              <th className="px-4 py-3 text-right">{translateSettings("settings.logicalWrite")}</th>
              <th className="px-4 py-3 text-right">{translateSettings("settings.count")}</th>
              <th className="px-5 py-3 text-right">{translateSettings("settings.time")}</th>
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
                  {row.count.toLocaleString()}
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
        title={translateSettings("settings.traceDiagnostics")}
        eyebrow="Canonical spans and logs"
        icon={<LuWorkflow />}
        iconClassName="text-violet-300"
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Spans"
            value={spans.length.toLocaleString()}
            detail="Retained in this time window"
            icon={<LuWorkflow />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label="Failures"
            value={failures.length.toLocaleString()}
            detail="Explicit error outcomes"
            icon={<LuTriangleAlert />}
            iconClassName="text-amber-300"
          />
          <MetricCard
            label="Slow spans"
            value={spans.filter((span) => span.durationMs >= 500).length.toLocaleString()}
            detail="At least 500 ms"
            icon={<LuGauge />}
            iconClassName="text-emerald-300"
          />
          <MetricCard
            label="Span logs"
            value={logs.length.toLocaleString()}
            detail="Separate canonical log evidence"
            icon={<LuFileText />}
            iconClassName="text-cyan-200"
          />
        </div>
      </Panel>

      <TraceFailurePanels latest={latestFailures} common={commonFailures} />

      <Panel
        title={translateSettings("settings.slowestSpans")}
        eyebrow="Duration-ranked operations"
        icon={<LuGauge />}
        iconClassName="text-emerald-300"
      >
        {slowest.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings("settings.noSpansWereRetainedInThisWindow")}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="px-5 py-3">{translateSettings("settings.span")}</th>
                  <th className="px-4 py-3 text-right">{translateSettings("settings.duration")}</th>
                  <th className="px-4 py-3">{translateSettings("settings.ended")}</th>
                  <th className="px-4 py-3">{translateSettings("settings.outcome")}</th>
                  <th className="w-14 px-5 py-3 text-right">
                    {translateSettings("settings.copy")}
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
                        title={translateSettings("settings.copyTraceId")}
                        aria-label={translateSettings("settings.copyTraceIdValue", {
                          value1: span.traceId,
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
        title={translateSettings("settings.spanLogs")}
        eyebrow="Correlated retained log evidence"
        icon={<LuFileText />}
        iconClassName="text-cyan-200"
      >
        {logs.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings("settings.noRetainedLogsMatchThisWindow")}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[920px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="w-[14%] px-5 py-3">{translateSettings("settings.time")}</th>
                  <th className="w-[10%] px-4 py-3">{translateSettings("settings.level")}</th>
                  <th className="w-[20%] px-4 py-3">{translateSettings("settings.source")}</th>
                  <th className="w-[41%] px-4 py-3">{translateSettings("settings.message")}</th>
                  <th className="w-[15%] px-5 py-3">{translateSettings("settings.trace")}</th>
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
                        {log.traceId?.slice(0, 12) ?? translateSettings("settings.none")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title={translateSettings("settings.topSpanNames")}
        eyebrow="Count, failures, average, and max"
        icon={<LuActivity />}
        iconClassName="text-violet-300"
      >
        {topNames.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings("settings.noSpanNamesWereCountedInThisWindow")}
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="px-5 py-3">{translateSettings("settings.span")}</th>
                  <th className="px-4 py-3 text-right">{translateSettings("settings.count")}</th>
                  <th className="px-4 py-3 text-right">{translateSettings("settings.failures")}</th>
                  <th className="px-4 py-3 text-right">{translateSettings("settings.average")}</th>
                  <th className="px-5 py-3 text-right">{translateSettings("settings.max")}</th>
                </tr>
              </thead>
              <tbody>
                {topNames.map((row) => (
                  <tr key={row.name} className="border-t border-[var(--color-border)]">
                    <td className="px-5 py-3.5 font-semibold text-white">{row.name}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-white">
                      {row.count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-white">
                      {row.failures.toLocaleString()}
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
        title={translateSettings("settings.latestFailures")}
        eyebrow="Newest explicit error evidence"
        icon={<LuTriangleAlert />}
        iconClassName="text-amber-300"
      >
        {latest.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings("settings.noFailuresWereObservedInThisWindow")}
          </p>
        ) : (
          <div className="max-h-[470px] overflow-auto">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="w-[28%] px-5 py-3">{translateSettings("settings.span")}</th>
                  <th className="w-[48%] px-4 py-3">{translateSettings("settings.cause")}</th>
                  <th className="w-[11%] px-4 py-3 text-right">
                    {translateSettings("settings.duration")}
                  </th>
                  <th className="w-[13%] px-5 py-3">{translateSettings("settings.ended")}</th>
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
                        ? translateSettings("settings.nA")
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
        title={translateSettings("settings.mostCommonFailures")}
        eyebrow="Grouped by stable fingerprint"
        icon={<LuActivity />}
        iconClassName="text-amber-300"
      >
        {common.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-foreground-secondary)]">
            {translateSettings("settings.noRecurringFailuresWereObservedInThisWindow")}
          </p>
        ) : (
          <div className="max-h-[470px] overflow-auto">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 bg-[var(--color-background-secondary)]">
                <tr className="text-left text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
                  <th className="w-[28%] px-5 py-3">{translateSettings("settings.span")}</th>
                  <th className="w-[10%] px-4 py-3 text-right">
                    {translateSettings("settings.count")}
                  </th>
                  <th className="w-[49%] px-4 py-3">{translateSettings("settings.cause")}</th>
                  <th className="w-[13%] px-5 py-3">{translateSettings("settings.lastSeen")}</th>
                </tr>
              </thead>
              <tbody>
                {common.map((failure) => (
                  <tr key={failure.fingerprint} className="border-t border-[var(--color-border)]">
                    <td className="px-5 py-3.5 font-semibold text-white">{failure.source}</td>
                    <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-white">
                      {failure.count.toLocaleString()}
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
        title={translateSettings("settings.rendererPerformance")}
        status={snapshot.detail.renderer.status}
        explanation="Waiting for the trusted renderer performance reporter. It starts only while Diagnostics is open and stops on unmount."
      />
    );
  const renderer = snapshot.detail.renderer.value;
  return (
    <div className="space-y-4">
      <Panel
        title={translateSettings("settings.rendererPerformance")}
        eyebrow="Production-safe live counters"
        icon={<LuBug />}
        iconClassName="text-red-400"
      >
        <div className="grid sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Heap used"
            value={
              renderer.heapUsedBytes === null ? "Unsupported" : formatBytes(renderer.heapUsedBytes)
            }
            detail={
              renderer.heapTotalBytes === null
                ? "Chromium heap total unavailable"
                : `${formatBytes(renderer.heapTotalBytes)} allocated`
            }
            icon={<LuMemoryStick />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label="Frames / second"
            value={renderer.framesPerSecond.toFixed(1)}
            detail="Observed while Diagnostics is visible"
            icon={<LuActivity />}
            iconClassName="text-emerald-300"
          />
          <MetricCard
            label="Frame time"
            value={formatDuration(renderer.averageFrameTimeMs)}
            detail="Average animation-frame interval"
            icon={<LuGauge />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label="Live intervals"
            value={renderer.liveIntervalCount.toLocaleString()}
            detail="Tracked active interval handles"
            icon={<LuRadio />}
            iconClassName="text-emerald-300"
          />
          <MetricCard
            label="Render count"
            value={renderer.renderCount.toLocaleString()}
            detail="Selected high-value boundaries"
            icon={<LuWorkflow />}
            iconClassName="text-violet-300"
          />
          <MetricCard
            label="Chat store rate / second"
            value={renderer.chatStoreCallsPerSecond.toFixed(1)}
            detail="Aggregated store actions, not individual messages"
            icon={<LuActivity />}
            iconClassName="text-emerald-300"
          />
        </div>
      </Panel>
      <Panel
        title={translateSettings("settings.developerControls")}
        eyebrow="Explicit local tools"
        icon={<LuBug />}
        iconClassName="text-red-400"
      >
        <div className="flex flex-wrap items-center gap-3 p-5">
          <Button variant="outline" onClick={() => window.electronAPI.toggleDevTools()}>
            {translateSettings("settings.openChromiumDevtools")}
          </Button>
          {import.meta.env.DEV ? (
            <p className="text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
              {translateSettings(
                "settings.chatSimAndUiSimulationRemainInTheFloatingDeveloperConsolePressCt"
              )}
            </p>
          ) : (
            <p className="text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
              {translateSettings(
                "settings.stateMutatingSimulatorsAreUnavailableInProductionBuilds"
              )}
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function WorkspaceContent({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  if (snapshot.view.tab === "overview") return <OverviewTab snapshot={snapshot} />;
  if (snapshot.view.tab === "resources") return <ResourcesTab snapshot={snapshot} />;
  if (snapshot.view.tab === "io") return <IoTab snapshot={snapshot} />;
  if (snapshot.view.tab === "traces") return <TracesTab snapshot={snapshot} />;
  if (snapshot.view.tab === "logs-reports") {
    return (
      <div className="space-y-4">
        <Panel
          title={translateSettings("settings.sessionLogs")}
          eyebrow="Main, network, and noise"
          icon={<LuFileText />}
          iconClassName="text-emerald-400"
        >
          <div className="p-5">
            <LogsSection />
          </div>
        </Panel>
        <Panel
          title={translateSettings("settings.createDiagnosticReport")}
          eyebrow="Safe local report"
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
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>("overview");
  const previousTabRef = useRef(activeTab);
  const [windowsByTab, setWindowsByTab] =
    useState<Readonly<Record<WindowedDiagnosticsTab, DiagnosticsWindowMinutes>>>(
      DEFAULT_WINDOWS_BY_TAB
    );
  const windowMinutes = usesWindowControl(activeTab) ? windowsByTab[activeTab] : 15;
  const view = useMemo(() => ({ tab: activeTab, windowMinutes }), [activeTab, windowMinutes]);
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
            {translateSettings("settings.streamfusionSystemEvidence")}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            {translateSettings("settings.diagnostics")}
          </h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
            {translateSettings(
              "settings.liveResourcesProcessesApplicationIOTracesFailuresLogsReportsAndR"
            )}
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
            {translateSettings("settings.refresh")}
          </Button>
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)]">
        <div
          className="overflow-x-auto border-b border-[var(--color-border)]"
          role="tablist"
          aria-label={translateSettings("settings.diagnosticsSections")}
        >
          <div className="flex min-w-max px-2">
            {TABS.map((tab) => {
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
              aria-label={translateSettings("settings.loadingLiveDiagnostics")}
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
                  {translateSettings(
                    "settings.theLatestRefreshFailedShowingTheLastTrustedSnapshotDiagnosticId"
                  )}{" "}
                  {diagnostics.diagnosticId}.
                </div>
              ) : null}
              <WorkspaceContent snapshot={diagnostics.snapshot} />
            </div>
          ) : (
            <div
              role="alert"
              className="rounded-lg border border-red-400/30 bg-red-400/10 p-5 text-sm text-red-100"
            >
              {translateSettings(
                "settings.diagnosticsCouldNotEstablishATrustedLocalSourceDiagnosticId"
              )}{" "}
              {diagnostics.kind === "error"
                ? diagnostics.diagnosticId
                : translateSettings("settings.unavailable")}
              .
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
