import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { DiagnosticPlatform } from "../../shared/diagnostics-types";

const PROCESS_SET_REFRESH_MS = 30_000;
const PROCESS_SET_SETTLE_MS = 2_000;
const RESTART_AFTER_FAILURE_MS = 2_000;
const MAX_BUFFER_LENGTH = 2 * 1_024 * 1_024;

export interface ProcessIoCounters {
  readonly parentPid: number | null;
  readonly readBytesPerSecond: number;
  readonly writeBytesPerSecond: number;
}

export type ProcessIoSnapshot =
  | {
      readonly kind: "ready";
      readonly observedAtMs: number;
      readonly countersByPid: ReadonlyMap<number, ProcessIoCounters>;
    }
  | { readonly kind: "unavailable"; readonly sinceMs: number }
  | { readonly kind: "unsupported" };

export interface ProcessIoSampler {
  setIntervalMs(intervalMs: number | null): void;
  refreshProcessSet(): void;
  snapshot(): ProcessIoSnapshot;
  stop(): void;
}

type CounterKind = "pid" | "parent" | "read" | "write";

interface CounterColumn {
  readonly index: number;
  readonly instance: string;
  readonly kind: CounterKind;
}

interface TypeperfCollector {
  readonly child: ChildProcessWithoutNullStreams;
  headerLine: string | null;
  buffer: string;
}

function parseCsvLine(line: string): readonly string[] | null {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      fields.push(field);
      field = "";
      continue;
    }
    field += character;
  }
  if (quoted) return null;
  fields.push(field);
  return fields;
}

function counterColumn(header: string, index: number): CounterColumn | null {
  const processMarker = "\\Process(";
  const processStart = header.lastIndexOf(processMarker);
  const instanceEnd = header.lastIndexOf(")\\");
  if (processStart < 0 || instanceEnd <= processStart) return null;
  const instance = header.slice(processStart + processMarker.length, instanceEnd);
  if (instance === "_Total") return null;

  const counter = header.slice(instanceEnd + 2);
  const kind: CounterKind | null =
    counter === "ID Process"
      ? "pid"
      : counter === "Creating Process ID"
        ? "parent"
        : counter === "IO Read Bytes/sec"
          ? "read"
          : counter === "IO Write Bytes/sec"
            ? "write"
            : null;
  return kind ? { index, instance, kind } : null;
}

export function parseTypeperfProcessIoSample(
  headerLine: string,
  sampleLine: string
): ReadonlyMap<number, ProcessIoCounters> | null {
  const headers = parseCsvLine(headerLine);
  const values = parseCsvLine(sampleLine);
  if (!headers || !values || headers.length !== values.length) return null;

  const byInstance = new Map<string, Partial<Record<CounterKind, number>>>();
  for (let index = 1; index < headers.length; index += 1) {
    const column = counterColumn(headers[index], index);
    if (!column) continue;
    const value = Number(values[index]);
    if (!Number.isFinite(value)) continue;
    const counters = byInstance.get(column.instance) ?? {};
    counters[column.kind] = value;
    byInstance.set(column.instance, counters);
  }

  const byPid = new Map<number, ProcessIoCounters>();
  for (const counters of byInstance.values()) {
    if (counters.pid === undefined || counters.pid <= 0) continue;
    if (counters.read === undefined || counters.write === undefined) continue;
    byPid.set(Math.round(counters.pid), {
      parentPid:
        counters.parent === undefined || counters.parent <= 0 ? null : Math.round(counters.parent),
      readBytesPerSecond: Math.max(0, counters.read),
      writeBytesPerSecond: Math.max(0, counters.write),
    });
  }
  return byPid;
}

class UnsupportedProcessIoSampler implements ProcessIoSampler {
  setIntervalMs(_intervalMs: number | null): void {}
  refreshProcessSet(): void {}
  snapshot(): ProcessIoSnapshot {
    return { kind: "unsupported" };
  }
  stop(): void {}
}

class WindowsProcessIoSampler implements ProcessIoSampler {
  readonly #nowMs: () => number;
  readonly #onFailure: (message: string) => void;
  #intervalMs: number | null = null;
  #activeCollector: TypeperfCollector | null = null;
  #replacementCollector: TypeperfCollector | null = null;
  #latest: ProcessIoSnapshot;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #processSetRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshRequestedWhileReplacing = false;
  #failureReported = false;

  constructor(nowMs: () => number, onFailure: (message: string) => void) {
    this.#nowMs = nowMs;
    this.#onFailure = onFailure;
    this.#latest = { kind: "unavailable", sinceMs: nowMs() };
  }

  setIntervalMs(intervalMs: number | null): void {
    const normalized = intervalMs === null ? null : Math.max(1_000, Math.round(intervalMs));
    if (this.#intervalMs === normalized) return;
    this.#intervalMs = normalized;
    this.#clearScheduledWork();
    this.#stopCollectors();
    this.#latest = { kind: "unavailable", sinceMs: this.#nowMs() };
    if (normalized !== null) this.#start();
  }

  snapshot(): ProcessIoSnapshot {
    if (this.#latest.kind !== "ready" || this.#intervalMs === null) return this.#latest;
    const staleAfterMs = Math.max(5_000, this.#intervalMs * 3);
    if (this.#nowMs() - this.#latest.observedAtMs <= staleAfterMs) return this.#latest;
    return { kind: "unavailable", sinceMs: this.#latest.observedAtMs };
  }

  refreshProcessSet(): void {
    if (this.#intervalMs === null) return;
    if (this.#processSetRefreshTimer) clearTimeout(this.#processSetRefreshTimer);
    // timer-allowlist: coalesces process churn without interrupting the active typeperf stream
    this.#processSetRefreshTimer = setTimeout(() => {
      this.#processSetRefreshTimer = null;
      this.#beginRefresh();
    }, PROCESS_SET_SETTLE_MS);
  }

  stop(): void {
    this.#intervalMs = null;
    this.#clearScheduledWork();
    this.#stopCollectors();
  }

  #start(): void {
    if (this.#intervalMs === null || this.#activeCollector) return;
    this.#activeCollector = this.#spawnCollector();
    this.#schedulePeriodicRefresh();
  }

  #spawnCollector(): TypeperfCollector {
    const intervalMs = this.#intervalMs ?? 1_000;
    const intervalSeconds = Math.max(1, Math.round(intervalMs / 1_000));
    const child = spawn(
      "typeperf",
      [
        "\\Process(*)\\ID Process",
        "\\Process(*)\\Creating Process ID",
        "\\Process(*)\\IO Read Bytes/sec",
        "\\Process(*)\\IO Write Bytes/sec",
        "-si",
        String(intervalSeconds),
      ],
      { windowsHide: true }
    );
    const collector: TypeperfCollector = { child, headerLine: null, buffer: "" };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consume(collector, chunk));
    child.once("error", (error) => this.#handleFailure(collector, error.message));
    child.once("close", (code) => {
      this.#handleFailure(collector, `typeperf exited with code ${String(code)}`);
    });
    return collector;
  }

  #consume(collector: TypeperfCollector, chunk: string): void {
    if (collector !== this.#activeCollector && collector !== this.#replacementCollector) return;
    collector.buffer += chunk;
    if (collector.buffer.length > MAX_BUFFER_LENGTH) {
      this.#handleFailure(collector, "typeperf output exceeded the diagnostics buffer limit");
      return;
    }
    const lines = collector.buffer.split(/\r?\n/);
    collector.buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (collector.headerLine === null) {
        if (line.includes("(PDH-CSV")) collector.headerLine = line;
        continue;
      }
      const countersByPid = parseTypeperfProcessIoSample(collector.headerLine, line);
      if (!countersByPid || countersByPid.size === 0) continue;
      if (collector === this.#replacementCollector) this.#promoteReplacement(collector);
      if (collector !== this.#activeCollector) return;
      this.#latest = { kind: "ready", observedAtMs: this.#nowMs(), countersByPid };
      this.#failureReported = false;
    }
  }

  #beginRefresh(): void {
    if (this.#intervalMs === null) return;
    if (!this.#activeCollector) {
      this.#start();
      return;
    }
    if (this.#replacementCollector) {
      this.#refreshRequestedWhileReplacing = true;
      return;
    }
    this.#replacementCollector = this.#spawnCollector();
  }

  #promoteReplacement(collector: TypeperfCollector): void {
    if (this.#replacementCollector !== collector) return;
    const previous = this.#activeCollector;
    this.#activeCollector = collector;
    this.#replacementCollector = null;
    this.#stopCollector(previous);
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = null;
    this.#schedulePeriodicRefresh();
    if (this.#refreshRequestedWhileReplacing) {
      this.#refreshRequestedWhileReplacing = false;
      this.refreshProcessSet();
    }
  }

  #handleFailure(collector: TypeperfCollector, message: string): void {
    const isReplacement = collector === this.#replacementCollector;
    if (!isReplacement && collector !== this.#activeCollector) return;
    this.#stopCollector(collector);
    if (isReplacement) {
      this.#replacementCollector = null;
    } else {
      this.#activeCollector = null;
      this.#latest = { kind: "unavailable", sinceMs: this.#nowMs() };
    }
    if (!this.#failureReported) {
      this.#failureReported = true;
      this.#onFailure(message);
    }
    if (this.#intervalMs === null || this.#restartTimer) return;
    // timer-allowlist: retries a failed native counter source without a polling loop
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#activeCollector) this.#beginRefresh();
      else this.#start();
    }, RESTART_AFTER_FAILURE_MS);
  }

  #schedulePeriodicRefresh(): void {
    if (this.#intervalMs === null || this.#refreshTimer) return;
    // timer-allowlist: refreshes typeperf's wildcard process set so newly spawned renderers appear
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      this.#beginRefresh();
    }, PROCESS_SET_REFRESH_MS);
  }

  #clearScheduledWork(): void {
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
    if (this.#processSetRefreshTimer) clearTimeout(this.#processSetRefreshTimer);
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#refreshTimer = null;
    this.#processSetRefreshTimer = null;
    this.#restartTimer = null;
  }

  #stopCollectors(): void {
    this.#stopCollector(this.#replacementCollector);
    this.#stopCollector(this.#activeCollector);
    this.#replacementCollector = null;
    this.#activeCollector = null;
    this.#refreshRequestedWhileReplacing = false;
  }

  #stopCollector(collector: TypeperfCollector | null): void {
    if (!collector) return;
    const { child } = collector;
    child.removeAllListeners();
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    child.kill();
  }
}

export function createProcessIoSampler(input: {
  readonly platform: DiagnosticPlatform;
  readonly nowMs?: () => number;
  readonly onFailure?: (message: string) => void;
}): ProcessIoSampler {
  if (input.platform !== "win32") return new UnsupportedProcessIoSampler();
  return new WindowsProcessIoSampler(input.nowMs ?? Date.now, input.onFailure ?? (() => {}));
}
