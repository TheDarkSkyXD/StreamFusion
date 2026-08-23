/**
 * PROTOTYPE, WIPE ME.
 * Three Diagnostics information architectures on `/settings?tab=diagnostics&variant=`.
 * Run with `pnpm --dir apps/desktop dev`.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  LuActivity,
  LuBug,
  LuCaptions,
  LuChevronDown,
  LuChevronRight,
  LuCpu,
  LuDownload,
  LuFileText,
  LuGauge,
  LuLayers,
  LuMemoryStick,
  LuMessageSquare,
  LuMonitor,
  LuPause,
  LuPlay,
  LuRadio,
  LuRefreshCw,
  LuSearch,
  LuShieldCheck,
  LuTriangleAlert,
  LuVideo,
  LuWorkflow,
} from "react-icons/lu";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { type DiagnosticsPrototypeVariant, PrototypeSwitcher } from "./PrototypeSwitcher";

type TimeWindowMinutes = 5 | 15 | 30 | 60;
type CaptureDurationSeconds = 30 | 60 | 120 | 300;
type LiveMode = "live" | "paused";
type CaptureState = { kind: "idle" } | { kind: "running"; durationSeconds: CaptureDurationSeconds };

interface PrototypeState {
  timeWindow: TimeWindowMinutes;
  liveMode: LiveMode;
  selectedSubject: string;
  capture: CaptureState;
  lastAction: string;
}

interface PrototypeActions {
  setTimeWindow: (minutes: TimeWindowMinutes) => void;
  toggleLiveMode: () => void;
  selectSubject: (subject: string) => void;
  startCapture: (durationSeconds: CaptureDurationSeconds) => void;
  stopCapture: () => void;
  recordAction: (action: string) => void;
}

interface VariantProps {
  state: PrototypeState;
  actions: PrototypeActions;
}

interface PanelProps {
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  iconClassName?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

interface StatusLineProps {
  label: string;
  value: string;
  status?: "ready" | "warning" | "muted";
  emphasized?: boolean;
}

interface SubjectButtonProps {
  label: string;
  detail: string;
  selected: boolean;
  icon: ReactNode;
  onClick: () => void;
  inset?: boolean;
}

const TIME_WINDOWS: readonly TimeWindowMinutes[] = [5, 15, 30, 60];
const CAPTURE_DURATIONS: readonly CaptureDurationSeconds[] = [30, 60, 120, 300];

const PROCESS_ROWS = [
  {
    name: "StreamFusion main",
    category: "Electron main",
    cpu: "4.8%",
    cpuTime: "42.8s",
    memory: "184 MB",
    read: "1.84 MB/s",
    write: "126 KB/s",
    pid: "28416",
    dotClassName: "bg-violet-400",
    depth: 0,
  },
  {
    name: "Host renderer",
    category: "Renderer",
    cpu: "7.2%",
    cpuTime: "38.1s",
    memory: "312 MB",
    read: "4.49 MB/s",
    write: "165 KB/s",
    pid: "22104",
    dotClassName: "bg-cyan-400",
    depth: 1,
  },
  {
    name: "StreamSlot 1",
    category: "Managed runtime",
    cpu: "18.6%",
    cpuTime: "1.14m",
    memory: "428 MB",
    read: "5.82 MB/s",
    write: "3.2 MB/s",
    pid: "30488",
    dotClassName: "bg-sky-400",
    depth: 1,
  },
  {
    name: "StreamSlot 2",
    category: "Managed runtime",
    cpu: "31.4%",
    cpuTime: "1.85m",
    memory: "516 MB",
    read: "6.77 MB/s",
    write: "1.67 MB/s",
    pid: "19172",
    dotClassName: "bg-sky-400",
    depth: 1,
  },
  {
    name: "GPU",
    category: "Electron utility",
    cpu: "11.9%",
    cpuTime: "24.6s",
    memory: "246 MB",
    read: "42.6 MB/s",
    write: "10.6 MB/s",
    pid: "26320",
    dotClassName: "bg-emerald-400",
    depth: 1,
  },
] satisfies ReadonlyArray<{
  name: string;
  category: string;
  cpu: string;
  cpuTime: string;
  memory: string;
  read: string;
  write: string;
  pid: string;
  dotClassName: string;
  depth: 0 | 1;
}>;

const TRACE_ROWS = [
  {
    name: "player.manifest-to-first-frame",
    duration: "1.84 s",
    ended: "2m ago",
    trace: "7fb2a9c13d",
    status: "slow",
  },
  {
    name: "recording.finalize",
    duration: "1.12 s",
    ended: "4m ago",
    trace: "01bb7286af",
    status: "slow",
  },
  {
    name: "chat.batch-to-commit",
    duration: "76 ms",
    ended: "6m ago",
    trace: "9014ce882a",
    status: "slow",
  },
  {
    name: "ipc.stream.resolve",
    duration: "42 ms",
    ended: "8m ago",
    trace: "f11a4c091e",
    status: "ok",
  },
] satisfies ReadonlyArray<{
  name: string;
  duration: string;
  ended: string;
  trace: string;
  status: "slow" | "ok";
}>;

const SPAN_LOG_ROWS = [
  {
    time: "3m ago",
    level: "ERROR",
    span: "player.segment",
    message: "HLS segment request timed out after 15 seconds",
    trace: "7fb2a9c13d",
  },
  {
    time: "6m ago",
    level: "WARN",
    span: "chat.batch-to-commit",
    message: "Commit exceeded the operation slow threshold",
    trace: "9014ce882a",
  },
] satisfies ReadonlyArray<{
  time: string;
  level: "ERROR" | "WARN";
  span: string;
  message: string;
  trace: string;
}>;

const TOP_SPAN_ROWS = [
  { name: "network.request", count: "1,284", failures: "3", average: "38 ms", max: "1.84 s" },
  {
    name: "chat.batch-to-commit",
    count: "946",
    failures: "0",
    average: "12 ms",
    max: "76 ms",
  },
  { name: "player.segment", count: "722", failures: "8", average: "84 ms", max: "2.10 s" },
  { name: "ipc.invoke", count: "384", failures: "0", average: "9 ms", max: "42 ms" },
] satisfies ReadonlyArray<{
  name: string;
  count: string;
  failures: string;
  average: string;
  max: string;
}>;

const FAILURE_ROWS = [
  { label: "HLS buffer stalled", count: 8, detail: "StreamSlot 2, 3 minutes ago" },
  { label: "Caption chunk rejected", count: 4, detail: "Queue at capacity" },
  { label: "Kick request timed out", count: 3, detail: "Channel lookup" },
] satisfies ReadonlyArray<{ label: string; count: number; detail: string }>;

const IO_ROWS = [
  {
    component: "stream-segment-cache",
    operation: "segment.read",
    logicalRead: "6.18 GB",
    logicalWrite: "0 B",
    count: "92,184",
    time: "18.42 s",
  },
  {
    component: "chat-event-log",
    operation: "batch.append",
    logicalRead: "0 B",
    logicalWrite: "648 MB",
    count: "621,963",
    time: "12.59 s",
  },
  {
    component: "caption-transcript-store",
    operation: "chunk.append",
    logicalRead: "12.8 MB",
    logicalWrite: "459 MB",
    count: "43,849",
    time: "5.60 s",
  },
  {
    component: "recording-writer",
    operation: "frame.append",
    logicalRead: "0 B",
    logicalWrite: "1.42 GB",
    count: "284,921",
    time: "42.16 s",
  },
] satisfies ReadonlyArray<{
  component: string;
  operation: string;
  logicalRead: string;
  logicalWrite: string;
  count: string;
  time: string;
}>;

function isPrototypeVariant(value: unknown): value is DiagnosticsPrototypeVariant {
  return value === "a" || value === "b" || value === "c";
}

function adjacentVariant(
  current: DiagnosticsPrototypeVariant,
  direction: "previous" | "next"
): DiagnosticsPrototypeVariant {
  if (direction === "next") {
    if (current === "a") return "b";
    if (current === "b") return "c";
    return "a";
  }
  if (current === "a") return "c";
  if (current === "b") return "a";
  return "b";
}

function Panel({ title, eyebrow, icon, iconClassName, action, className, children }: PanelProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)]",
        className
      )}
    >
      <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-background-tertiary)]/40 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? (
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-lg",
                iconClassName
              )}
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? (
              <p className="mb-0.5 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-secondary)]">
                {eyebrow}
              </p>
            ) : null}
            <h3 className="truncate text-base font-bold text-[var(--color-foreground)]">{title}</h3>
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function StatusLine({ label, value, status = "ready", emphasized = false }: StatusLineProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            status === "ready" && "bg-emerald-400",
            status === "warning" && "bg-amber-400",
            status === "muted" && "bg-[var(--color-foreground-muted)]"
          )}
          aria-hidden
        />
        <span
          className={cn(
            "truncate",
            emphasized
              ? "font-semibold text-[var(--color-foreground)]"
              : "text-[var(--color-foreground-secondary)]"
          )}
        >
          {label}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 tabular-nums text-[var(--color-foreground)]",
          emphasized ? "text-base font-bold" : "font-semibold"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function WindowControl({
  value,
  onChange,
}: {
  value: TimeWindowMinutes;
  onChange: (value: TimeWindowMinutes) => void;
}) {
  return (
    <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-0.5">
      {TIME_WINDOWS.map((minutes) => (
        <button
          key={minutes}
          type="button"
          onClick={() => onChange(minutes)}
          className={cn(
            "rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] motion-reduce:transition-none",
            value === minutes
              ? "bg-[var(--color-background-elevated)] text-[var(--color-foreground)]"
              : "text-[var(--color-foreground-muted)] hover:text-[var(--color-foreground)]"
          )}
          aria-pressed={value === minutes}
        >
          {minutes}m
        </button>
      ))}
    </div>
  );
}

function ResourceChart({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn("relative overflow-hidden", compact ? "h-28" : "h-44")}
      role="img"
      aria-label="Mock CPU and memory resource timeline"
    >
      <div className="absolute inset-0 grid grid-rows-4">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="border-b border-[var(--color-border)]/55 last:border-b-0" />
        ))}
      </div>
      <svg
        viewBox="0 0 720 180"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <path
          d="M0 138 C55 132 64 126 105 130 S165 112 205 118 S262 89 314 97 S386 72 427 88 S505 44 551 62 S636 47 720 28"
          fill="none"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M0 156 C80 150 126 142 180 145 S281 126 338 132 S418 111 476 117 S588 96 720 91"
          fill="none"
          stroke="rgba(160,160,160,0.7)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="absolute left-[75%] top-0 h-full border-l border-dashed border-amber-400/50">
        <span className="absolute -left-11 top-2 whitespace-nowrap rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
          stall cluster
        </span>
      </div>
    </div>
  );
}

function ProcessTable({ onAction }: { onAction: (action: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[980px] divide-y divide-[var(--color-border)]">
        <div className="grid grid-cols-[minmax(210px,1.5fr)_130px_70px_78px_88px_98px_98px_62px_64px] items-center gap-3 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-secondary)]">
          <span>Process</span>
          <span>Category</span>
          <span className="text-right">CPU</span>
          <span className="text-right">CPU time</span>
          <span className="text-right">Memory</span>
          <span className="text-right text-green-200">Read/s</span>
          <span className="text-right text-violet-300">Write/s</span>
          <span className="text-right">PID</span>
          <span className="text-right">Action</span>
        </div>
        {PROCESS_ROWS.map((process) => (
          <div
            key={process.name}
            className="grid grid-cols-[minmax(210px,1.5fr)_130px_70px_78px_88px_98px_98px_62px_64px] items-center gap-3 px-4 py-3 text-[13px] transition-colors hover:bg-[var(--color-background-tertiary)]/50 motion-reduce:transition-none"
          >
            <div
              className="flex min-w-0 items-center gap-2"
              style={{ paddingLeft: process.depth * 20 }}
            >
              <LuChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-[var(--color-foreground-muted)]",
                  process.depth > 0 && "invisible"
                )}
              />
              <span className={cn("h-2 w-2 shrink-0 rounded-full", process.dotClassName)} />
              <p className="truncate font-semibold text-[var(--color-foreground)]">
                {process.name}
              </p>
            </div>
            <span className="truncate text-[var(--color-foreground-secondary)]">
              {process.category}
            </span>
            <span className="text-right font-semibold tabular-nums">{process.cpu}</span>
            <span className="text-right font-semibold tabular-nums">{process.cpuTime}</span>
            <span className="text-right font-semibold tabular-nums">{process.memory}</span>
            <span className="text-right font-semibold tabular-nums text-green-200">
              {process.read}
            </span>
            <span className="text-right font-semibold tabular-nums text-violet-300">
              {process.write}
            </span>
            <span className="text-right tabular-nums text-[var(--color-foreground-secondary)]">
              {process.pid}
            </span>
            <button
              type="button"
              onClick={() => onAction(`Selected ${process.name}`)}
              className="rounded px-2 py-1 text-xs font-semibold text-[var(--color-foreground-secondary)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              Inspect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FailureList() {
  return (
    <div className="divide-y divide-[var(--color-border)]">
      {FAILURE_ROWS.map((failure) => (
        <button
          key={failure.label}
          type="button"
          className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--color-background-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)] motion-reduce:transition-none"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-500/10 text-amber-300">
            <LuTriangleAlert className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-[var(--color-foreground)]">
              {failure.label}
            </span>
            <span className="mt-1 block truncate text-[13px] text-[var(--color-foreground-secondary)]">
              {failure.detail}
            </span>
          </span>
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-background-elevated)] px-2.5 py-1 text-xs font-bold tabular-nums text-white">
            {failure.count}
          </span>
        </button>
      ))}
    </div>
  );
}

function TraceTable() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] divide-y divide-[var(--color-border)]">
        <div className="grid grid-cols-[minmax(280px,1fr)_100px_100px_140px] items-center gap-4 px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
          <span>Span</span>
          <span>Duration</span>
          <span>Ended</span>
          <span>Trace</span>
        </div>
        {TRACE_ROWS.map((trace) => (
          <div
            key={trace.name}
            className="grid grid-cols-[minmax(280px,1fr)_100px_100px_140px] items-center gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-[var(--color-background-tertiary)]/50 motion-reduce:transition-none"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  trace.status === "slow" ? "bg-amber-400" : "bg-emerald-400"
                )}
                aria-hidden
              />
              <span className="truncate font-bold text-[var(--color-foreground)]">
                {trace.name}
              </span>
            </span>
            <span className="font-semibold tabular-nums text-[var(--color-foreground)]">
              {trace.duration}
            </span>
            <span className="font-medium text-[var(--color-foreground-secondary)]">
              {trace.ended}
            </span>
            <span className="truncate text-xs font-medium tabular-nums text-[var(--color-foreground-secondary)]">
              {trace.trace}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpanLogsTable() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px] divide-y divide-[var(--color-border)]">
        <div className="grid grid-cols-[76px_72px_minmax(200px,1fr)_minmax(280px,1.4fr)_140px] items-center gap-4 px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
          <span>Time</span>
          <span>Level</span>
          <span>Span</span>
          <span>Message</span>
          <span>Trace</span>
        </div>
        {SPAN_LOG_ROWS.map((row) => (
          <div
            key={`${row.time}:${row.span}`}
            className="grid grid-cols-[76px_72px_minmax(200px,1fr)_minmax(280px,1.4fr)_140px] items-start gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-[var(--color-background-tertiary)]/50 motion-reduce:transition-none"
          >
            <span className="font-medium text-[var(--color-foreground-secondary)]">{row.time}</span>
            <span
              className={cn(
                "w-fit rounded px-2 py-0.5 text-[11px] font-bold",
                row.level === "ERROR"
                  ? "bg-red-500/15 text-red-300"
                  : "bg-amber-500/15 text-amber-300"
              )}
            >
              {row.level}
            </span>
            <span className="truncate font-bold text-[var(--color-foreground)]">{row.span}</span>
            <span className="leading-5 text-[var(--color-foreground-secondary)]">
              {row.message}
            </span>
            <span className="truncate text-xs font-medium tabular-nums text-[var(--color-foreground-secondary)]">
              {row.trace}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopSpanNamesTable() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px] divide-y divide-[var(--color-border)]">
        <div className="grid grid-cols-[minmax(260px,1fr)_100px_100px_110px_110px] items-center gap-4 px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
          <span>Span</span>
          <span className="text-right">Count</span>
          <span className="text-right">Failures</span>
          <span className="text-right">Average</span>
          <span className="text-right">Max</span>
        </div>
        {TOP_SPAN_ROWS.map((row) => (
          <div
            key={row.name}
            className="grid grid-cols-[minmax(260px,1fr)_100px_100px_110px_110px] items-center gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-[var(--color-background-tertiary)]/50 motion-reduce:transition-none"
          >
            <span className="truncate font-bold text-[var(--color-foreground)]">{row.name}</span>
            <span className="text-right font-semibold tabular-nums">{row.count}</span>
            <span
              className={cn(
                "text-right font-semibold tabular-nums",
                row.failures !== "0" ? "text-red-300" : "text-[var(--color-foreground)]"
              )}
            >
              {row.failures}
            </span>
            <span className="text-right font-medium tabular-nums text-[var(--color-foreground-secondary)]">
              {row.average}
            </span>
            <span className="text-right font-semibold tabular-nums text-amber-300">{row.max}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IoTable() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[880px] divide-y divide-[var(--color-border)]">
        <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(170px,1.4fr)_112px_112px_100px_88px] items-center gap-4 px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
          <span>Component</span>
          <span>Operation</span>
          <span className="text-right text-green-200">Logical read</span>
          <span className="text-right text-violet-300">Logical write</span>
          <span className="text-right">Count</span>
          <span className="text-right">Time</span>
        </div>
        {IO_ROWS.map((row) => (
          <div
            key={`${row.component}:${row.operation}`}
            className="grid grid-cols-[minmax(180px,1.2fr)_minmax(170px,1.4fr)_112px_112px_100px_88px] items-center gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-[var(--color-background-tertiary)]/50 motion-reduce:transition-none"
          >
            <span className="truncate font-bold text-[var(--color-foreground)]">
              {row.component}
            </span>
            <span className="truncate font-medium text-[var(--color-foreground-secondary)]">
              {row.operation}
            </span>
            <span className="text-right font-semibold tabular-nums text-green-200">
              {row.logicalRead}
            </span>
            <span className="text-right font-semibold tabular-nums text-violet-300">
              {row.logicalWrite}
            </span>
            <span className="text-right font-semibold tabular-nums text-[var(--color-foreground)]">
              {row.count}
            </span>
            <span className="text-right font-medium tabular-nums text-[var(--color-foreground-secondary)]">
              {row.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CaptureControl({ state, actions, compact = false }: VariantProps & { compact?: boolean }) {
  if (state.capture.kind === "running") {
    return (
      <div className={cn("space-y-3", compact && "space-y-2")}>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-50 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          Capturing {state.selectedSubject}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-background-tertiary)]">
          <div className="h-full w-[42%] rounded-full bg-white" />
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--color-foreground-secondary)]">
          <span>25 s collected</span>
          <span>{state.capture.durationSeconds} s maximum</span>
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={actions.stopCapture}>
          <LuPause className="mr-2 h-3.5 w-3.5" /> Stop capture
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      <p className="text-[13px] leading-5 text-[var(--color-foreground-secondary)]">
        Profile one subject and related work. The preceding 60 seconds remain attached as baseline.
      </p>
      <div className="grid grid-cols-4 gap-1">
        {CAPTURE_DURATIONS.map((duration) => (
          <button
            key={duration}
            type="button"
            onClick={() => actions.startCapture(duration)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-2 text-xs font-semibold tabular-nums text-[var(--color-foreground-secondary)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            {duration < 60 ? `${duration}s` : `${duration / 60}m`}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-left transition-colors hover:bg-[var(--color-background-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] motion-reduce:transition-none"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background-tertiary)] text-white">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{title}</span>
        <span className="mt-0.5 block truncate text-[13px] text-[var(--color-foreground-secondary)]">
          {description}
        </span>
      </span>
      <LuChevronRight className="ml-auto h-4 w-4 shrink-0 text-[var(--color-foreground-muted)]" />
    </button>
  );
}

function DeveloperTools({ onAction }: { onAction: (action: string) => void }) {
  return (
    <div>
      <div className="grid grid-cols-2 border-b border-[var(--color-border)] text-sm">
        <div className="border-b border-r border-[var(--color-border)] bg-[var(--color-background)] px-4 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
            Renderer heap
          </p>
          <p className="mt-2 text-base font-bold tabular-nums">286 / 512 MB</p>
        </div>
        <div className="border-b border-[var(--color-border)] bg-[var(--color-background)] px-4 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
            Frame time
          </p>
          <p className="mt-2 text-base font-bold tabular-nums">15.2 ms · 66 fps</p>
        </div>
        <div className="border-r border-[var(--color-border)] bg-[var(--color-background)] px-4 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
            Live intervals
          </p>
          <p className="mt-2 text-base font-bold tabular-nums">2</p>
        </div>
        <div className="bg-[var(--color-background)] px-4 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
            Render counts
          </p>
          <p className="mt-2 text-base font-bold tabular-nums">8 registered · 0 hot</p>
        </div>
      </div>

      <div className="border-b border-[var(--color-border)] bg-[var(--color-background)] px-4 py-4">
        <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--color-foreground)]">
          Chat store rate / second
        </p>
        <div className="grid grid-cols-2 gap-x-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-3">
          <StatusLine emphasized label="addMessageBatched" value="0" />
          <StatusLine emphasized label="flushBatch" value="0" />
          <StatusLine emphasized label="addMessage" value="0" />
          <StatusLine emphasized label="setCalls" value="0" />
        </div>
      </div>

      <div className="space-y-3 bg-[var(--color-background)] p-4">
        <ToolButton
          icon={<LuActivity />}
          title="Render and chat stress tools"
          description="Reset counters or run 1,000 messages over 30s"
          onClick={() => onAction("Developer stress tools opened")}
        />
        <ToolButton
          icon={<LuMessageSquare />}
          title="Chat event simulator"
          description="Messages, moderation, subs, raids, polls, and predictions"
          onClick={() => onAction("Chat event simulator opened")}
        />
        <ToolButton
          icon={<LuMonitor />}
          title="UI state simulator"
          description="Force the offline banner or restore real network state"
          onClick={() => onAction("UI state simulator opened")}
        />
      </div>
      <p className="border-t border-[var(--color-border)] px-4 py-3 text-[13px] leading-5 text-[var(--color-foreground-secondary)]">
        These development utilities move here from the floating Debug Console; production-safe
        telemetry remains available in every build.
      </p>
    </div>
  );
}

function PrototypeStateStrip({
  variant,
  state,
}: {
  variant: DiagnosticsPrototypeVariant;
  state: PrototypeState;
}) {
  const captureLabel =
    state.capture.kind === "running" ? `${state.capture.durationSeconds}s capture` : "idle";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed border-white/20 bg-white/[0.03] px-3 py-2 text-[10px] text-[var(--color-foreground-muted)]">
      <span className="font-bold uppercase tracking-[0.1em] text-[var(--color-foreground-secondary)]">
        Prototype state
      </span>
      <span>variant {variant.toUpperCase()}</span>
      <span>{state.timeWindow}m window</span>
      <span>{state.liveMode}</span>
      <span>{state.selectedSubject}</span>
      <span>{captureLabel}</span>
      <span className="ml-auto truncate">{state.lastAction}</span>
    </div>
  );
}

function VariantHeader({
  state,
  actions,
  title,
  description,
}: VariantProps & { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--color-foreground-secondary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />9 of 10 sources ready
          <span className="text-[var(--color-border)]">/</span>
          Updated 2 seconds ago
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-foreground-secondary)]">
          {description}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WindowControl value={state.timeWindow} onChange={actions.setTimeWindow} />
        <Button size="sm" variant="outline" onClick={actions.toggleLiveMode}>
          {state.liveMode === "live" ? (
            <LuPause className="mr-2 h-3.5 w-3.5" />
          ) : (
            <LuPlay className="mr-2 h-3.5 w-3.5" />
          )}
          {state.liveMode === "live" ? "Pause" : "Resume"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => actions.recordAction("Snapshot refreshed")}
        >
          <LuRefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
        <Button size="sm" onClick={() => actions.recordAction("Report manifest opened")}>
          <LuFileText className="mr-2 h-3.5 w-3.5" /> Create report
        </Button>
      </div>
    </div>
  );
}

type DiagnosticsWorkspaceTab =
  "overview" | "resources" | "processes" | "io" | "traces" | "failures" | "logs" | "developer";

const DIAGNOSTICS_WORKSPACE_TABS: ReadonlyArray<{
  id: DiagnosticsWorkspaceTab;
  label: string;
  icon: typeof LuActivity;
  iconClassName: string;
}> = [
  { id: "overview", label: "Overview", icon: LuGauge, iconClassName: "text-emerald-400" },
  { id: "resources", label: "Resources", icon: LuActivity, iconClassName: "text-cyan-400" },
  { id: "processes", label: "Processes", icon: LuCpu, iconClassName: "text-violet-400" },
  { id: "io", label: "I/O", icon: LuRadio, iconClassName: "text-green-200" },
  { id: "traces", label: "Traces", icon: LuWorkflow, iconClassName: "text-sky-400" },
  { id: "failures", label: "Failures", icon: LuTriangleAlert, iconClassName: "text-red-400" },
  { id: "logs", label: "Logs & Reports", icon: LuFileText, iconClassName: "text-emerald-400" },
  { id: "developer", label: "Developer Tools", icon: LuBug, iconClassName: "text-red-400" },
];

function WorkspaceTabs({
  active,
  onSelect,
}: {
  active: DiagnosticsWorkspaceTab;
  onSelect: (tab: DiagnosticsWorkspaceTab) => void;
}) {
  return (
    <div className="overflow-x-auto border-b border-[var(--color-border)]" role="tablist">
      <div className="flex min-w-max px-2">
        {DIAGNOSTICS_WORKSPACE_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              onClick={() => onSelect(tab.id)}
              className={cn(
                "relative flex items-center gap-2 px-3.5 py-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)] motion-reduce:transition-none",
                active === tab.id
                  ? "text-[var(--color-foreground)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-white"
                  : "text-[var(--color-foreground-muted)] hover:text-[var(--color-foreground)]"
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", tab.iconClassName)} aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SummaryMetrics({
  metrics,
}: {
  metrics: ReadonlyArray<{
    label: string;
    value: string;
    detail: string;
    tone?: "warning";
    icon?: ReactNode;
    iconClassName?: string;
  }>;
}) {
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="min-h-32 border-b border-r border-[var(--color-border)] bg-[var(--color-background)] px-5 py-5"
        >
          <div className="flex items-center gap-3">
            {metric.icon ? (
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background-tertiary)] text-base",
                  metric.iconClassName
                )}
                aria-hidden
              >
                {metric.icon}
              </span>
            ) : null}
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-foreground-secondary)]">
              {metric.label}
            </p>
          </div>
          <p
            className={cn(
              "mt-4 text-2xl font-bold tabular-nums",
              metric.tone === "warning" && "text-amber-300"
            )}
          >
            {metric.value}
          </p>
          <p className="mt-2 text-xs text-[var(--color-foreground-secondary)]">{metric.detail}</p>
        </div>
      ))}
    </div>
  );
}

function ResourceMonitorPanel() {
  return (
    <Panel
      eyebrow="System footprint"
      title="Resource monitor"
      icon={<LuActivity />}
      iconClassName="text-cyan-400"
    >
      <SummaryMetrics
        metrics={[
          {
            label: "Current CPU",
            value: "37.6%",
            detail: "11.3s observed CPU time",
            icon: <LuCpu />,
            iconClassName: "text-violet-400",
          },
          {
            label: "Resident memory",
            value: "1.84 GB",
            detail: "2.02 GB combined peaks",
            icon: <LuMemoryStick />,
            iconClassName: "text-cyan-400",
          },
          {
            label: "Process count",
            value: "5",
            detail: "42 starts · 37 exits",
            icon: <LuActivity />,
            iconClassName: "text-emerald-400",
          },
          {
            label: "Read throughput",
            value: "12.4 MB/s",
            detail: "6.18 GB observed",
            icon: <LuDownload />,
            iconClassName: "text-sky-400",
          },
          {
            label: "Write throughput",
            value: "7.8 MB/s",
            detail: "1.42 GB observed",
            tone: "warning",
            icon: <LuFileText />,
            iconClassName: "text-amber-400",
          },
          {
            label: "CPU speed limit",
            value: "100%",
            detail: "thermal state unknown",
            icon: <LuGauge />,
            iconClassName: "text-amber-400",
          },
        ]}
      />
    </Panel>
  );
}

function CommandCenterVariant({ state, actions }: VariantProps) {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<DiagnosticsWorkspaceTab>("overview");

  return (
    <div className="space-y-5 pb-24" data-prototype-variant="a">
      <VariantHeader
        state={state}
        actions={actions}
        title="Diagnostics"
        description="Every T3-equivalent diagnostic workspace, StreamFusion evidence tool, and developer utility lives here without competing floating panels."
      />
      <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)]">
        <WorkspaceTabs active={activeWorkspaceTab} onSelect={setActiveWorkspaceTab} />

        <div role="tabpanel" className="p-4">
          {activeWorkspaceTab === "overview" && (
            <div className="space-y-4">
              <ResourceMonitorPanel />
              <div className="grid gap-4 xl:grid-cols-3">
                <Panel
                  eyebrow="Host and collection"
                  title="Collection health"
                  icon={<LuShieldCheck />}
                  iconClassName="text-emerald-400"
                >
                  <div className="divide-y divide-[var(--color-border)] px-4">
                    <StatusLine label="Electron process metrics" value="healthy" />
                    <StatusLine label="Renderer performance" value="healthy" />
                    <StatusLine label="Application I/O" value="healthy" />
                    <StatusLine label="Collection time" value="22.4 ms" />
                  </div>
                </Panel>
                <Panel
                  eyebrow="Performance attribution"
                  title="Targeted capture"
                  icon={<LuWorkflow />}
                  iconClassName="text-sky-400"
                >
                  <div className="p-4">
                    <p className="mb-3 text-xs text-[var(--color-foreground-secondary)]">
                      Selected subject: <strong>{state.selectedSubject}</strong>
                    </p>
                    <CaptureControl state={state} actions={actions} compact />
                  </div>
                </Panel>
                <Panel
                  eyebrow="Latest failures"
                  title="Needs attention"
                  icon={<LuTriangleAlert />}
                  iconClassName="text-amber-300"
                >
                  <FailureList />
                </Panel>
              </div>
            </div>
          )}

          {activeWorkspaceTab === "resources" && (
            <div className="space-y-4">
              <Panel
                eyebrow="Host and collection"
                title="Host state and source health"
                icon={<LuGauge />}
                iconClassName="text-violet-400"
              >
                <div className="grid lg:grid-cols-2">
                  <div className="border-b border-[var(--color-border)] px-5 py-3 lg:border-b-0 lg:border-r">
                    <StatusLine label="Power source" value="External power" />
                    <StatusLine label="Low power mode" value="Off" />
                    <StatusLine label="Session" value="Unlocked" />
                    <StatusLine label="Thermal" value="Unknown" status="muted" />
                  </div>
                  <div className="px-5 py-3">
                    <StatusLine label="Electron metrics" value="healthy" />
                    <StatusLine label="Renderer probes" value="healthy" />
                    <StatusLine label="Collection time" value="22.4 ms" />
                    <StatusLine label="Process scan" value="5 / 5 retained" />
                  </div>
                </div>
              </Panel>

              <Panel
                eyebrow="CPU average, I/O reads, and I/O writes"
                title="Resource timeline"
                icon={<LuMemoryStick />}
                iconClassName="text-cyan-400"
                action={<WindowControl value={state.timeWindow} onChange={actions.setTimeWindow} />}
              >
                <div className="px-4 pt-4">
                  <ResourceChart />
                </div>
                <ProcessTable onAction={actions.recordAction} />
              </Panel>
            </div>
          )}

          {activeWorkspaceTab === "processes" && (
            <div className="space-y-4">
              <Panel
                eyebrow="One-second samples"
                title="Resource history"
                icon={<LuGauge />}
                iconClassName="text-amber-400"
                action={<WindowControl value={state.timeWindow} onChange={actions.setTimeWindow} />}
              >
                <div className="px-4 pt-4">
                  <ResourceChart />
                </div>
                <div className="grid grid-cols-2 border-t border-[var(--color-border)] px-4 lg:grid-cols-4">
                  <StatusLine label="CPU time" value="11.3 s" />
                  <StatusLine label="Samples" value="2,487" />
                  <StatusLine label="Interval" value="1.00 s" />
                  <StatusLine label="Processes" value="5" />
                </div>
              </Panel>
              <Panel
                eyebrow="Managed descendants"
                title="Live processes"
                icon={<LuActivity />}
                iconClassName="text-cyan-400"
              >
                <SummaryMetrics
                  metrics={[
                    { label: "Child processes", value: "4", detail: "fresh scan just now" },
                    { label: "CPU", value: "31.4%", detail: "all descendants" },
                    { label: "Memory", value: "1.23 GB", detail: "current resident set" },
                  ]}
                />
              </Panel>
              <Panel
                eyebrow="Identity: PID and start time"
                title="Live process tree"
                icon={<LuCpu />}
                iconClassName="text-violet-400"
              >
                <ProcessTable onAction={actions.recordAction} />
              </Panel>
            </div>
          )}

          {activeWorkspaceTab === "io" && (
            <Panel
              eyebrow="Logical bytes by operation"
              title="Instrumented application I/O"
              icon={<LuRadio />}
              iconClassName="text-green-200"
              action={
                <span className="text-[11px] text-[var(--color-foreground-secondary)]">
                  read / write / count / time
                </span>
              }
            >
              <p className="border-b border-[var(--color-border)] px-4 py-3 text-[13px] leading-6 text-[var(--color-foreground-secondary)]">
                Process counters identify where bytes move. These application counters connect
                spikes to playback, chat, captions, recording, persistence, and logging operations.
              </p>
              <IoTable />
            </Panel>
          )}

          {activeWorkspaceTab === "traces" && (
            <div className="space-y-4">
              <Panel
                eyebrow="Trace diagnostics"
                title="Trace health"
                icon={<LuWorkflow />}
                iconClassName="text-green-200"
              >
                <SummaryMetrics
                  metrics={[
                    { label: "Spans", value: "187,571", detail: "bounded recent session" },
                    {
                      label: "Failures",
                      value: "14",
                      detail: "redacted before storage",
                      tone: "warning",
                    },
                    { label: "Slow spans", value: "937", detail: "operation-aware thresholds" },
                    { label: "Parse errors", value: "0", detail: "all records readable" },
                  ]}
                />
              </Panel>
              <Panel
                eyebrow="Duration and trace identity"
                title="Slowest spans"
                icon={<LuActivity />}
                iconClassName="text-violet-300"
              >
                <TraceTable />
              </Panel>
              <Panel
                eyebrow="Warning and error records"
                title="Span logs"
                icon={<LuFileText />}
                iconClassName="text-amber-300"
              >
                <SpanLogsTable />
              </Panel>
              <Panel
                eyebrow="Count, failures, average, and max"
                title="Top span names"
                icon={<LuLayers />}
                iconClassName="text-green-200"
              >
                <TopSpanNamesTable />
              </Panel>
            </div>
          )}

          {activeWorkspaceTab === "failures" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel
                eyebrow="Cause, duration, and end time"
                title="Latest failures"
                icon={<LuTriangleAlert />}
                iconClassName="text-red-400"
              >
                <FailureList />
              </Panel>
              <Panel
                eyebrow="Stable failure fingerprints"
                title="Most common failures"
                icon={<LuLayers />}
                iconClassName="text-amber-400"
              >
                <div className="divide-y divide-[var(--color-border)] px-4">
                  <StatusLine label="HLS buffer stalled" value="8" status="warning" />
                  <StatusLine label="Caption chunk rejected" value="4" status="warning" />
                  <StatusLine label="Kick request timed out" value="3" status="warning" />
                  <StatusLine label="Recording finalize delayed" value="2" />
                </div>
              </Panel>
            </div>
          )}

          {activeWorkspaceTab === "logs" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel
                eyebrow="Existing StreamFusion capability"
                title="Browse logs"
                icon={<LuFileText />}
                iconClassName="text-emerald-400"
              >
                <div className="space-y-2 p-3">
                  <ToolButton
                    icon={<LuFileText />}
                    title="Session logs"
                    description="Filter main, network, and noise entries"
                    onClick={() => actions.recordAction("Logs browser opened")}
                  />
                  <ToolButton
                    icon={<LuSearch />}
                    title="Correlated span logs"
                    description="Filter by trace, subject, or selected time"
                    onClick={() => actions.recordAction("Correlated logs opened")}
                  />
                </div>
              </Panel>
              <Panel
                eyebrow="Existing StreamFusion capability"
                title="Reports"
                icon={<LuBug />}
                iconClassName="text-white"
              >
                <div className="space-y-2 p-3">
                  <ToolButton
                    icon={<LuBug />}
                    title="Create diagnostic report"
                    description="Preview the safe evidence manifest"
                    onClick={() => actions.recordAction("Report manifest opened")}
                  />
                  <ToolButton
                    icon={<LuDownload />}
                    title="Export approved evidence"
                    description="Secrets redacted before the artifact exists"
                    onClick={() => actions.recordAction("Report export opened")}
                  />
                </div>
              </Panel>
            </div>
          )}

          {activeWorkspaceTab === "developer" && (
            <Panel
              eyebrow="Replaces the floating Debug Console"
              title="Developer tools"
              icon={<LuBug />}
              iconClassName="text-red-400"
            >
              <DeveloperTools onAction={actions.recordAction} />
            </Panel>
          )}
        </div>
      </section>
      <PrototypeStateStrip variant="a" state={state} />
    </div>
  );
}

function TimelineLane({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-14 grid-cols-[138px_minmax(0,1fr)] border-b border-[var(--color-border)] last:border-b-0">
      <div className="border-r border-[var(--color-border)] px-3 py-2">
        <p className="text-[11px] font-bold">{label}</p>
        <p className="mt-0.5 truncate text-[9px] text-[var(--color-foreground-muted)]">{detail}</p>
      </div>
      <div className="relative overflow-hidden bg-[linear-gradient(to_right,transparent_24.8%,var(--color-border)_25%,transparent_25.2%,transparent_49.8%,var(--color-border)_50%,transparent_50.2%,transparent_74.8%,var(--color-border)_75%,transparent_75.2%)] px-3 py-2">
        {children}
      </div>
    </div>
  );
}

function InvestigationTimelineVariant({ state, actions }: VariantProps) {
  return (
    <div className="space-y-5 pb-24" data-prototype-variant="b">
      <VariantHeader
        state={state}
        actions={actions}
        title="Diagnostics timeline"
        description="Put resources, processes, I/O, spans, failures, and logs on one clock. Select a moment to inspect everything that was happening around it."
      />

      <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)]">
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="mr-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-foreground-muted)]">
              Resource timeline and history
            </p>
            <h3 className="text-sm font-bold">Synchronized investigation</h3>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--color-foreground-muted)]">
            <span className="h-2 w-2 rounded-full bg-white" /> selected moment
            <span className="h-2 w-2 rounded-full bg-amber-400" /> anomaly
            <span className="h-2 w-2 rounded-full bg-[var(--color-foreground-muted)]" /> activity
          </div>
        </header>
        <div className="grid grid-cols-[138px_minmax(0,1fr)] border-b border-[var(--color-border)] text-[9px] text-[var(--color-foreground-muted)]">
          <span className="border-r border-[var(--color-border)] px-3 py-2">
            {state.timeWindow} minute window
          </span>
          <div className="flex justify-between px-3 py-2">
            <span>-15m</span>
            <span>-10m</span>
            <span>-5m</span>
            <span>now</span>
          </div>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute bottom-0 left-[66%] top-0 z-10 w-px bg-white/75">
            <span className="absolute left-1 top-1 rounded bg-white px-1.5 py-0.5 text-[9px] font-bold text-black">
              14:38:22
            </span>
          </div>
          <TimelineLane label="Host and collection" detail="CPU, memory, thermal">
            <div className="flex h-full items-end gap-1">
              {[32, 40, 28, 45, 48, 52, 44, 61, 72, 64, 76, 58, 46, 41, 38, 35].map(
                (height, index) => (
                  <span
                    key={`${height}-${index}`}
                    className="flex-1 rounded-t-sm bg-white/45"
                    style={{ height: `${height}%` }}
                  />
                )
              )}
            </div>
          </TimelineLane>
          <TimelineLane label="Live processes" detail="main, renderers, GPU">
            <div className="space-y-1.5 py-1">
              <div className="h-2 w-[92%] rounded-full bg-white/25" />
              <div className="ml-[8%] h-2 w-[76%] rounded-full bg-white/55" />
              <div className="ml-[35%] h-2 w-[58%] rounded-full bg-white/35" />
            </div>
          </TimelineLane>
          <TimelineLane label="Application I/O" detail="network and owner queues">
            <div className="relative h-full">
              <span className="absolute left-[8%] top-2 h-4 w-[22%] rounded bg-white/20" />
              <span className="absolute left-[39%] top-2 h-4 w-[18%] rounded bg-white/35" />
              <span className="absolute left-[62%] top-2 h-4 w-[31%] rounded bg-amber-400/35" />
            </div>
          </TimelineLane>
          <TimelineLane label="Trace diagnostics" detail="slowest spans and names">
            <div className="relative h-full">
              <span className="absolute left-[5%] top-1 h-2 w-[28%] rounded bg-white/30" />
              <span className="absolute left-[37%] top-4 h-2 w-[11%] rounded bg-white/60" />
              <span className="absolute left-[58%] top-1 h-2 w-[25%] rounded bg-amber-300/70" />
              <span className="absolute left-[84%] top-4 h-2 w-[9%] rounded bg-white/35" />
            </div>
          </TimelineLane>
          <TimelineLane label="Renderer instrumentation" detail="frames, heap, renders, chat rate">
            <div className="relative h-full">
              <span className="absolute left-[4%] top-1 h-2 w-[38%] rounded bg-white/20" />
              <span className="absolute left-[45%] top-4 h-2 w-[17%] rounded bg-white/55" />
              <span className="absolute left-[64%] top-1 h-2 w-[27%] rounded bg-amber-300/50" />
            </div>
          </TimelineLane>
          <TimelineLane label="Failures" detail="latest and grouped">
            <div className="relative h-full">
              <button
                type="button"
                onClick={() => actions.recordAction("Selected HLS stall at 14:38:22")}
                className="absolute left-[64%] top-3 h-4 w-4 rounded-full border-2 border-[var(--color-background-secondary)] bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label="Select HLS stall failure"
              />
              <span className="absolute left-[77%] top-4 h-2 w-2 rounded-full bg-amber-300" />
            </div>
          </TimelineLane>
          <TimelineLane label="Span logs" detail="warning and error entries">
            <div className="flex h-full items-center gap-1">
              {[12, 24, 43, 56, 68, 70, 86].map((left, index) => (
                <span
                  key={left}
                  className={cn(
                    "absolute h-3 w-1 rounded-full",
                    index === 4 ? "bg-amber-300" : "bg-white/35"
                  )}
                  style={{ left: `${left}%` }}
                />
              ))}
            </div>
          </TimelineLane>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_300px]">
        <Panel eyebrow="Selected moment" title="14:38:22, HLS buffer stalled">
          <div className="p-4">
            <ResourceChart compact />
          </div>
          <div className="grid grid-cols-2 divide-x divide-[var(--color-border)] border-t border-[var(--color-border)] px-4">
            <div className="pr-4">
              <StatusLine label="StreamSlot 2 CPU" value="31.4%" />
              <StatusLine label="Buffer" value="0.4 s" status="warning" />
              <StatusLine label="Dropped frames" value="142" status="warning" />
            </div>
            <div className="pl-4">
              <StatusLine label="GPU CPU" value="11.9%" />
              <StatusLine label="Network p95" value="312 ms" status="warning" />
              <StatusLine label="Chat backlog" value="0" />
            </div>
          </div>
          <div className="border-t border-[var(--color-border)] p-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
              Live process tree
            </div>
            <ProcessTable onAction={actions.recordAction} />
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel eyebrow="Trace diagnostics" title="Evidence around selection">
            <TraceTable />
          </Panel>
          <Panel eyebrow="Most common failures" title="Failure groups">
            <FailureList />
          </Panel>
          <Panel eyebrow="Instrumented application I/O" title="Queues at selection">
            <IoTable />
          </Panel>
          <Panel eyebrow="Developer diagnostics" title="Renderer and test tools">
            <DeveloperTools onAction={actions.recordAction} />
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel eyebrow="Investigation" title={state.selectedSubject}>
            <div className="p-4">
              <CaptureControl state={state} actions={actions} compact />
            </div>
          </Panel>
          <Panel eyebrow="Recovery" title="Available actions">
            <div className="space-y-2 p-3">
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                onClick={() => actions.recordAction("Mock SIGINT requested for StreamSlot 2")}
              >
                <LuPause className="mr-2 h-3.5 w-3.5" /> Send SIGINT
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start"
                onClick={() => actions.recordAction("Mock player reload requested")}
              >
                <LuRefreshCw className="mr-2 h-3.5 w-3.5" /> Reload player runtime
              </Button>
            </div>
          </Panel>
          <Panel eyebrow="Logs and report bug" title="Package evidence">
            <div className="space-y-2 p-3">
              <ToolButton
                icon={<LuFileText />}
                title="Open span logs"
                description="Filtered to the selected minute"
                onClick={() => actions.recordAction("Selected logs opened")}
              />
              <ToolButton
                icon={<LuBug />}
                title="Create report"
                description="Includes this timeline selection"
                onClick={() => actions.recordAction("Report manifest opened")}
              />
            </div>
          </Panel>
        </aside>
      </div>
      <PrototypeStateStrip variant="b" state={state} />
    </div>
  );
}

function SubjectButton({
  label,
  detail,
  selected,
  icon,
  onClick,
  inset = false,
}: SubjectButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] motion-reduce:transition-none",
        inset && "pl-7",
        selected
          ? "bg-[var(--color-background-elevated)] text-white"
          : "text-[var(--color-foreground-secondary)] hover:bg-[var(--color-background-tertiary)] hover:text-white"
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/25 text-[var(--color-foreground-secondary)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{label}</span>
        <span className="block truncate text-[9px] text-[var(--color-foreground-muted)]">
          {detail}
        </span>
      </span>
      {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
    </button>
  );
}

function SubjectExplorerVariant({ state, actions }: VariantProps) {
  const subjects = [
    { label: "Application", detail: "5 processes, 8 runtimes", icon: <LuLayers /> },
    { label: "Host renderer", detail: "7.2% CPU, 312 MB", icon: <LuMonitor /> },
    { label: "Renderer instrumentation", detail: "66 fps, 8 render probes", icon: <LuActivity /> },
    { label: "StreamSlot 1", detail: "1080p60, focused", icon: <LuVideo /> },
    { label: "StreamSlot 2", detail: "720p60, background", icon: <LuVideo /> },
    { label: "ChatConnection", detail: "twitch, connected", icon: <LuMessageSquare /> },
    { label: "Caption session", detail: "2 chunks queued", icon: <LuCaptions /> },
    { label: "Recording", detail: "01:18:42 captured", icon: <LuRadio /> },
    { label: "Download job", detail: "68%, 7.8 MB/s", icon: <LuDownload /> },
  ];

  return (
    <div className="space-y-4 pb-24" data-prototype-variant="c">
      <VariantHeader
        state={state}
        actions={actions}
        title="Diagnostics explorer"
        description="Choose the part of StreamFusion that feels slow. The page keeps resource, trace, failure, log, and recovery evidence attached to that subject."
      />

      <div className="grid min-h-[720px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside className="border-b border-[var(--color-border)] bg-[var(--color-background)] p-3 xl:border-b-0 xl:border-r">
          <div className="relative mb-3">
            <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-foreground-muted)]" />
            <input
              aria-label="Filter performance subjects"
              placeholder="Filter subjects"
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] pl-9 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            />
          </div>
          <div className="mb-2 flex items-center justify-between px-2 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--color-foreground-muted)]">
            <span>Performance subjects</span>
            <span>8</span>
          </div>
          <div className="space-y-1">
            {subjects.map((subject, index) => (
              <SubjectButton
                key={subject.label}
                label={subject.label}
                detail={subject.detail}
                icon={subject.icon}
                selected={state.selectedSubject === subject.label}
                inset={index > 1}
                onClick={() => actions.selectSubject(subject.label)}
              />
            ))}
          </div>
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <div className="px-2 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--color-foreground-muted)]">
              Source status
            </div>
            <div className="px-2">
              <StatusLine label="Ready" value="9" />
              <StatusLine label="Unsupported" value="1" status="muted" />
              <StatusLine label="Collection gaps" value="1" status="warning" />
            </div>
          </div>
        </aside>

        <main className="min-w-0 border-b border-[var(--color-border)] xl:border-b-0 xl:border-r">
          <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
            <div className="mr-auto min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-foreground-muted)]">
                Managed runtime / PerformanceSubject
              </p>
              <h3 className="truncate text-lg font-bold">{state.selectedSubject}</h3>
            </div>
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
              ready
            </span>
          </header>

          <div className="grid grid-cols-2 border-b border-[var(--color-border)] lg:grid-cols-4">
            {[
              { label: "CPU", value: "31.4%", detail: "p95 38.2%" },
              { label: "Memory", value: "516 MB", detail: "+84 MB / 15m" },
              { label: "Slow frames", value: "4.8%", detail: "142 dropped" },
              { label: "Buffer", value: "0.4 s", detail: "below target" },
            ].map((metric) => (
              <div
                key={metric.label}
                className="border-b border-r border-[var(--color-border)] px-4 py-3 last:border-r-0 lg:border-b-0"
              >
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
                  {metric.label}
                </p>
                <p className="mt-1 text-base font-bold tabular-nums">{metric.value}</p>
                <p className="text-[9px] text-[var(--color-foreground-muted)]">{metric.detail}</p>
              </div>
            ))}
          </div>

          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-foreground-muted)]">
                  Resource monitor and history
                </p>
                <h4 className="text-sm font-bold">Subject timeline</h4>
              </div>
              <WindowControl value={state.timeWindow} onChange={actions.setTimeWindow} />
            </div>
            <ResourceChart />
          </div>

          <div className="grid border-t border-[var(--color-border)] lg:grid-cols-2">
            <div className="border-b border-[var(--color-border)] lg:border-b-0 lg:border-r">
              <div className="px-4 pt-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
                Instrumented application I/O
              </div>
              <IoTable />
            </div>
            <div>
              <div className="px-4 pt-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
                Slowest spans
              </div>
              <TraceTable />
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-foreground-muted)]">
                  Live process tree
                </p>
                <h4 className="text-sm font-bold">Related processes</h4>
              </div>
              <span className="text-[10px] text-[var(--color-foreground-muted)]">
                fresh identity required for signals
              </span>
            </div>
            <ProcessTable onAction={actions.recordAction} />
          </div>
        </main>

        <aside className="min-w-0 bg-[var(--color-background)]">
          <div className="border-b border-[var(--color-border)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <LuWorkflow className="h-4 w-4 text-[var(--color-foreground-secondary)]" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
                  Attribution session
                </p>
                <h4 className="text-sm font-bold">Profile this subject</h4>
              </div>
            </div>
            <CaptureControl state={state} actions={actions} compact />
          </div>
          <div className="border-b border-[var(--color-border)]">
            <div className="px-4 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
                Latest and common failures
              </p>
              <h4 className="text-sm font-bold">Failure evidence</h4>
            </div>
            <FailureList />
          </div>
          <div className="border-b border-[var(--color-border)] p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
              Recovery actions
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => actions.recordAction("Mock SIGINT requested")}
              >
                <LuPause className="mr-2 h-3.5 w-3.5" /> SIGINT
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => actions.recordAction("Mock SIGKILL confirmation opened")}
              >
                SIGKILL
              </Button>
            </div>
          </div>
          <div className="border-b border-[var(--color-border)]">
            <div className="px-4 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
                Developer diagnostics
              </p>
              <h4 className="text-sm font-bold">Renderer and test tools</h4>
            </div>
            <DeveloperTools onAction={actions.recordAction} />
          </div>
          <div className="p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-muted)]">
              Span logs and reports
            </p>
            <div className="space-y-2">
              <ToolButton
                icon={<LuFileText />}
                title="Browse subject logs"
                description="Main, network, and noise"
                onClick={() => actions.recordAction("Subject logs opened")}
              />
              <ToolButton
                icon={<LuBug />}
                title="Report this problem"
                description="Preview selected evidence"
                onClick={() => actions.recordAction("Report manifest opened")}
              />
            </div>
          </div>
        </aside>
      </div>
      <PrototypeStateStrip variant="c" state={state} />
    </div>
  );
}

export function DiagnosticsPrototype() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/_app/settings" });
  const variant: DiagnosticsPrototypeVariant = isPrototypeVariant(search.variant)
    ? search.variant
    : "a";
  const [state, setState] = useState<PrototypeState>({
    timeWindow: 15,
    liveMode: "live",
    selectedSubject: "StreamSlot 2",
    capture: { kind: "idle" },
    lastAction: "No prototype action yet",
  });

  const navigateToVariant = useCallback(
    (nextVariant: DiagnosticsPrototypeVariant) => {
      void navigate({
        to: "/settings",
        search: { tab: "diagnostics", variant: nextVariant },
        replace: true,
      });
    },
    [navigate]
  );

  const showPrevious = useCallback(
    () => navigateToVariant(adjacentVariant(variant, "previous")),
    [navigateToVariant, variant]
  );
  const showNext = useCallback(
    () => navigateToVariant(adjacentVariant(variant, "next")),
    [navigateToVariant, variant]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement) {
        const tagName = event.target.tagName;
        if (tagName === "INPUT" || tagName === "TEXTAREA" || event.target.isContentEditable) {
          return;
        }
      }
      if (event.key === "ArrowLeft") showPrevious();
      if (event.key === "ArrowRight") showNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showNext, showPrevious]);

  const actions: PrototypeActions = {
    setTimeWindow: (timeWindow) => setState((current) => ({ ...current, timeWindow })),
    toggleLiveMode: () =>
      setState((current) => ({
        ...current,
        liveMode: current.liveMode === "live" ? "paused" : "live",
        lastAction: current.liveMode === "live" ? "Live updates paused" : "Live updates resumed",
      })),
    selectSubject: (selectedSubject) =>
      setState((current) => ({
        ...current,
        selectedSubject,
        lastAction: `Selected ${selectedSubject}`,
      })),
    startCapture: (durationSeconds) =>
      setState((current) => ({
        ...current,
        capture: { kind: "running", durationSeconds },
        lastAction: `Started ${durationSeconds}s attribution capture`,
      })),
    stopCapture: () =>
      setState((current) => ({
        ...current,
        capture: { kind: "idle" },
        lastAction: "Attribution capture stopped",
      })),
    recordAction: (lastAction) => setState((current) => ({ ...current, lastAction })),
  };

  return (
    <div data-diagnostics-prototype="true">
      {variant === "a" ? <CommandCenterVariant state={state} actions={actions} /> : null}
      {variant === "b" ? <InvestigationTimelineVariant state={state} actions={actions} /> : null}
      {variant === "c" ? <SubjectExplorerVariant state={state} actions={actions} /> : null}
      <PrototypeSwitcher current={variant} onPrevious={showPrevious} onNext={showNext} />
    </div>
  );
}
