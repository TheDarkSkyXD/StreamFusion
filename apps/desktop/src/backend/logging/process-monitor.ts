/**
 * Process-resource monitor — emits a Valo-style `[ProcessMonitor]` line on a
 * fixed interval. The body shape is grep-stable (`rss=NMB heap=NMB/NMB
 * cpu=N% load=N.N/N.N/N.N procs=[pid:type:rssMB ...]`) so log scrapers can
 * rely on substring positions.
 *
 * The `procs=[...]` suffix samples Electron's `app.getAppMetrics()` so each
 * tick records per-process working-set RSS for the host renderer, GPU
 * process, and every utility / WCV child. Per-process heap is not in
 * `ProcessMetric` and the main process heap is already in the `heap=`
 * prefix, so this slice only ships RSS — slot-aware tagging arrives once
 * StreamSlot processes exist (slice 06).
 *
 * CPU is computed across the wall-clock interval (cpuMs / intervalMs * 100 /
 * cores) using `process.cpuUsage()` deltas — no native bindings, no probe
 * delay, and the figure is bounded by the actual time elapsed so a spike on
 * one core can't produce a >100% reading on a one-core box.
 *
 * Only one interval is ever active at a time: a second `startProcessMonitor`
 * call clears the previous interval first. The returned stop function is
 * idempotent and only targets the interval it was issued for, so a leftover
 * stop from a superseded start is a safe no-op.
 */

import os from "node:os";

import { app } from "electron";

import { logger } from "@backend/logging/logger";

const DEFAULT_INTERVAL_MS = 30_000;
const BYTES_PER_MB = 1024 * 1024;
const KB_PER_MB = 1024;

// Subset of Electron's `ProcessMetric` we actually read. Importing the full
// type pulls electron into the test harness; this surface keeps the seam
// narrow and lets tests inject plain objects.
interface ProcessMetricLike {
  pid: number;
  type: string;
  name?: string;
  memory: {
    /** In KB per Electron docs. */
    workingSetSize: number;
  };
}

export interface MonitorOpts {
  /** Tick interval in ms. Default 30000. */
  intervalMs?: number;
  /**
   * Source of per-process metrics. Defaults to Electron's `app.getAppMetrics`.
   * Injected in tests so we don't need a real Electron runtime.
   */
  getAppMetrics?: () => ProcessMetricLike[];
}

export interface ProcessSnapshot {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  /** 0-100 over the last interval, averaged across all CPU cores. */
  cpuPercent: number;
  /** os.loadavg() — [1, 5, 15] minute averages. Windows returns [0, 0, 0]. */
  load: [number, number, number];
}

interface ActiveMonitor {
  timer: ReturnType<typeof setInterval>;
  lastCpuUsage: NodeJS.CpuUsage;
  lastTimestampMs: number;
}

// Module-level singleton — guarantees only one interval is ever firing,
// matching the lifecycle expectation of a process-wide resource probe.
let active: ActiveMonitor | null = null;

function bytesToMB(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}

export function formatSnapshot(s: ProcessSnapshot): string {
  const rss = bytesToMB(s.rssBytes);
  const heapUsed = bytesToMB(s.heapUsedBytes);
  const heapTotal = bytesToMB(s.heapTotalBytes);
  const cpu = Math.round(s.cpuPercent);
  const load = s.load.map((n) => n.toFixed(1)).join("/");
  return `rss=${rss}MB heap=${heapUsed}MB/${heapTotal}MB cpu=${cpu}% load=${load}`;
}

/**
 * Format `app.getAppMetrics()` output into a compact, grep-stable suffix that
 * lives inside the existing ProcessMonitor line. One token per process:
 * `pid:type:rssMB`. RSS is `workingSetSize` (KB) rounded to the nearest MB.
 *
 * Per-process heap is intentionally absent: Electron's `ProcessMetric.memory`
 * only carries RSS-shaped values; V8 heap stats are only available for the
 * current process, and the main heap is already in the `heap=` prefix.
 */
export function formatProcessMetrics(metrics: ProcessMetricLike[]): string {
  const entries = metrics.map((m) => {
    const rss = Math.round(m.memory.workingSetSize / KB_PER_MB);
    const base = `${m.pid}:${m.type}:${rss}`;
    if (!m.name) return base;
    // Whitespace would break grep tools that split log lines on spaces, so
    // collapse runs of whitespace inside utility names into a single `_`.
    const safeName = m.name.replace(/\s+/g, "_");
    return `${base}:${safeName}`;
  });
  return `procs=[${entries.join(" ")}]`;
}

function takeSnapshot(cpuPercent: number): ProcessSnapshot {
  const mem = process.memoryUsage();
  const [l1, l5, l15] = os.loadavg();
  return {
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    cpuPercent,
    load: [l1, l5, l15],
  };
}

export function startProcessMonitor(opts?: MonitorOpts): () => void {
  // A previous interval auto-clears so we never accumulate ticks across
  // multiple starts. The previous stop closure remains safe to call (it will
  // observe that `active` no longer matches its timer).
  if (active !== null) {
    clearInterval(active.timer);
    active = null;
  }

  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  // Default to Electron's app.getAppMetrics; tests inject a fake. Bound
  // lazily so importing this module in unit tests doesn't crash when the
  // Electron `app` object isn't ready.
  const getAppMetrics = opts?.getAppMetrics ?? (() => app.getAppMetrics());
  const cpuCount = Math.max(1, os.cpus().length);

  const initialCpu = process.cpuUsage();
  const initialTimestamp = Date.now();

  // timer-allowlist: process-resource probe with explicit single-instance lifecycle and idempotent stop — managed-interval's recovery semantics are unnecessary here
  const timer = setInterval(() => {
    if (active === null) return;
    const nowMs = Date.now();
    const cpuDelta = process.cpuUsage(active.lastCpuUsage);
    const elapsedMs = Math.max(1, nowMs - active.lastTimestampMs);
    // cpuDelta is in microseconds (user + system); divide by 1000 for ms,
    // then by elapsed wall-clock and core count to get a 0-100 percent.
    const cpuMs = (cpuDelta.user + cpuDelta.system) / 1000;
    const cpuPercent = ((cpuMs / elapsedMs) * 100) / cpuCount;

    active.lastCpuUsage = process.cpuUsage();
    active.lastTimestampMs = nowMs;

    const snapshot = takeSnapshot(cpuPercent);
    // Per-process probe must never crash the tick — a failure here would
    // silently kill the resource monitor for the rest of the session.
    let procSegment = "";
    try {
      const metrics = getAppMetrics();
      procSegment = ` ${formatProcessMetrics(metrics)}`;
    } catch (error) {
      // Collapse whitespace so the error tag remains a single
      // whitespace-delimited token in the grep-stable line.
      const safe = String(error).replace(/\s+/g, "_");
      procSegment = ` procs=err:${safe}`;
    }
    logger.info("ProcessMonitor", `${formatSnapshot(snapshot)}${procSegment}`);
  }, intervalMs);

  const handle: ActiveMonitor = {
    timer,
    lastCpuUsage: initialCpu,
    lastTimestampMs: initialTimestamp,
  };
  active = handle;

  return () => {
    // Only clear if WE are still the active interval — a superseded handle's
    // stop closure must be a no-op so callers can safely chain start/stop.
    if (active === handle) {
      clearInterval(handle.timer);
      active = null;
    }
  };
}
