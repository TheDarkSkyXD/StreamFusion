import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { DiagnosticPlatform } from "../../shared/diagnostics-types";

const PROCESS_SET_REFRESH_MS = 30_000;
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
  #child: ChildProcessWithoutNullStreams | null = null;
  #headerLine: string | null = null;
  #buffer = "";
  #latest: ProcessIoSnapshot;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.#stopChild();
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
    if (this.#intervalMs !== null) this.#restart();
  }

  stop(): void {
    this.#intervalMs = null;
    this.#clearScheduledWork();
    this.#stopChild();
  }

  #start(): void {
    if (this.#intervalMs === null || this.#child) return;
    const intervalSeconds = Math.max(1, Math.round(this.#intervalMs / 1_000));
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
    this.#child = child;
    this.#headerLine = null;
    this.#buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consume(chunk));
    child.once("error", (error) => this.#handleFailure(child, error.message));
    child.once("close", (code) => {
      if (this.#child !== child) return;
      this.#handleFailure(child, `typeperf exited with code ${String(code)}`);
    });
    // timer-allowlist: refreshes typeperf's wildcard process set so newly spawned renderers appear
    this.#refreshTimer = setTimeout(() => this.#restart(), PROCESS_SET_REFRESH_MS);
  }

  #consume(chunk: string): void {
    this.#buffer += chunk;
    if (this.#buffer.length > MAX_BUFFER_LENGTH) {
      this.#handleFailure(this.#child, "typeperf output exceeded the diagnostics buffer limit");
      return;
    }
    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (this.#headerLine === null) {
        if (line.includes("(PDH-CSV")) this.#headerLine = line;
        continue;
      }
      const countersByPid = parseTypeperfProcessIoSample(this.#headerLine, line);
      if (!countersByPid || countersByPid.size === 0) continue;
      this.#latest = { kind: "ready", observedAtMs: this.#nowMs(), countersByPid };
      this.#failureReported = false;
    }
  }

  #restart(): void {
    if (this.#intervalMs === null) return;
    this.#clearScheduledWork();
    this.#stopChild();
    this.#start();
  }

  #handleFailure(child: ChildProcessWithoutNullStreams | null, message: string): void {
    if (child && this.#child !== child) return;
    this.#stopChild();
    this.#latest = { kind: "unavailable", sinceMs: this.#nowMs() };
    if (!this.#failureReported) {
      this.#failureReported = true;
      this.#onFailure(message);
    }
    if (this.#intervalMs === null || this.#restartTimer) return;
    // timer-allowlist: retries a failed native counter source without a polling loop
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      this.#start();
    }, RESTART_AFTER_FAILURE_MS);
  }

  #clearScheduledWork(): void {
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer);
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#refreshTimer = null;
    this.#restartTimer = null;
  }

  #stopChild(): void {
    const child = this.#child;
    this.#child = null;
    if (!child) return;
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
