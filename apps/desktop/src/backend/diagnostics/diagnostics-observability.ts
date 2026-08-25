import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  DiagnosticFailure,
  DiagnosticLogObservation,
  LogicalIoObservation,
  SpanNameSummary,
  TraceSpanObservation,
} from "../../shared/diagnostics-types";
import { redactObject, redactString } from "../logging/redactor";

const MAX_SPANS = 4_096;
const MAX_LOGS = 2_048;
const MAX_FAILURE_LOGS = 1_024;
const MAX_IO_OPERATIONS = 256;
const MAX_TEXT_LENGTH = 500;
const TRACE_FILE_PREFIX = "streamfusion-traces-";
const TRACE_FILE_LIMIT_BYTES = 8 * 1_024 * 1_024;

interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
}

interface LogicalIoCounter {
  component: string;
  operation: string;
  logicalReadBytes: number;
  logicalWriteBytes: number;
  count: number;
  durationMs: number;
}

export interface ObservabilitySnapshot {
  readonly io: readonly LogicalIoObservation[];
  readonly spans: readonly TraceSpanObservation[];
  readonly logs: readonly DiagnosticLogObservation[];
  readonly latestFailures: readonly DiagnosticFailure[];
  readonly commonFailures: readonly DiagnosticFailure[];
  readonly topNames: readonly SpanNameSummary[];
}

interface RecordedSpan {
  readonly name: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly outcome: "ok" | "error";
  readonly message?: string;
  readonly traceId?: string;
}

function boundedNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safeLabel(input: string): string {
  return redactString(input)
    .replace(/[^a-zA-Z0-9_.:/@ -]/g, "_")
    .slice(0, 120);
}

export function safeDiagnosticText(input: string): string {
  return redactString(input)
    .replace(
      /\b(password|passwd|secret|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*[^\s,;}]+/gi,
      "$1=[REDACTED]"
    )
    .replace(/\bhttps?:\/\/[^\s]+/gi, (rawUrl) => {
      try {
        const url = new URL(rawUrl);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[URL]";
      }
    })
    .replace(/\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s"']+/gi, "[ABSOLUTE_PATH]")
    .replace(/\/(?:home|Users)\/[^\s"']+/g, "[ABSOLUTE_PATH]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, MAX_TEXT_LENGTH);
}

function failureFingerprint(source: string, cause: string): string {
  const stableCause = cause
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`${source}\0${stableCause}`).digest("hex").slice(0, 20);
}

export class DiagnosticsObservability {
  readonly #context = new AsyncLocalStorage<TraceContext>();
  readonly #spans: TraceSpanObservation[] = [];
  readonly #logs: DiagnosticLogObservation[] = [];
  readonly #failureLogs: DiagnosticLogObservation[] = [];
  readonly #io = new Map<string, LogicalIoCounter>();
  #persistencePath: string | null = null;
  #persistenceBytes = 0;
  #persistenceQueue: Promise<void> = Promise.resolve();

  async initializePersistence(logsDir: string, sessionStamp: string): Promise<void> {
    await fs.mkdir(logsDir, { recursive: true });
    const files = (await fs.readdir(logsDir))
      .filter((name) => name.startsWith(TRACE_FILE_PREFIX) && name.endsWith(".ndjson"))
      .sort()
      .reverse();
    await Promise.all(
      files.slice(3).map((name) => fs.rm(path.join(logsDir, name), { force: true }))
    );
    this.#persistencePath = path.join(
      logsDir,
      `${TRACE_FILE_PREFIX}${sessionStamp.replace(/[:.]/g, "-")}.ndjson`
    );
    this.#persistenceBytes = 0;
  }

  recordIo(input: {
    component: string;
    operation: string;
    logicalReadBytes?: number;
    logicalWriteBytes?: number;
    durationMs?: number;
  }): void {
    const component = safeLabel(input.component);
    const operation = safeLabel(input.operation);
    const key = `${component}\0${operation}`;
    let counter = this.#io.get(key);
    if (!counter) {
      if (this.#io.size >= MAX_IO_OPERATIONS) return;
      counter = {
        component,
        operation,
        logicalReadBytes: 0,
        logicalWriteBytes: 0,
        count: 0,
        durationMs: 0,
      };
      this.#io.set(key, counter);
    }
    counter.logicalReadBytes += boundedNumber(input.logicalReadBytes ?? 0);
    counter.logicalWriteBytes += boundedNumber(input.logicalWriteBytes ?? 0);
    counter.durationMs += boundedNumber(input.durationMs ?? 0);
    counter.count += 1;
  }

  recordLog(input: {
    level: DiagnosticLogObservation["level"];
    source: string;
    message: string;
    observedAtMs?: number;
  }): void {
    const context = this.#context.getStore();
    const log: DiagnosticLogObservation = {
      observedAtMs: input.observedAtMs ?? Date.now(),
      level: input.level,
      source: safeLabel(input.source),
      message: safeDiagnosticText(input.message),
      ...(context ? { traceId: context.traceId } : {}),
    };
    this.#logs.push(log);
    if (this.#logs.length > MAX_LOGS) this.#logs.splice(0, this.#logs.length - MAX_LOGS);
    if (log.level === "error") {
      this.#failureLogs.push(log);
      if (this.#failureLogs.length > MAX_FAILURE_LOGS) {
        this.#failureLogs.splice(0, this.#failureLogs.length - MAX_FAILURE_LOGS);
      }
    }
    this.#persist({ kind: "log", ...log });
  }

  recordSpan(input: RecordedSpan): TraceSpanObservation {
    const parent = this.#context.getStore();
    const span: TraceSpanObservation = {
      spanId: randomUUID(),
      traceId: input.traceId ?? parent?.traceId ?? randomUUID(),
      name: safeLabel(input.name),
      startedAtMs: boundedNumber(input.startedAtMs),
      endedAtMs: boundedNumber(input.endedAtMs),
      durationMs: boundedNumber(input.endedAtMs - input.startedAtMs),
      outcome: input.outcome,
      ...(input.message ? { message: safeDiagnosticText(input.message) } : {}),
    };
    this.#spans.push(span);
    if (this.#spans.length > MAX_SPANS) this.#spans.splice(0, this.#spans.length - MAX_SPANS);
    this.#persist({ kind: "span", ...span });
    return span;
  }

  async runSpan<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const parent = this.#context.getStore();
    const traceId = parent?.traceId ?? randomUUID();
    const spanId = randomUUID();
    const startedAtMs = Date.now();
    try {
      const value = await this.#context.run({ traceId, spanId }, operation);
      this.recordSpan({ name, traceId, startedAtMs, endedAtMs: Date.now(), outcome: "ok" });
      return value;
    } catch (error) {
      this.recordSpan({
        name,
        traceId,
        startedAtMs,
        endedAtMs: Date.now(),
        outcome: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  snapshot(sinceMs: number): ObservabilitySnapshot {
    const spans = this.#spans.filter((span) => span.endedAtMs >= sinceMs);
    const logs = this.#logs.filter((log) => log.observedAtMs >= sinceMs);
    const failureLogs = this.#failureLogs.filter((log) => log.observedAtMs >= sinceMs);
    const topNames = new Map<
      string,
      { count: number; failures: number; total: number; max: number }
    >();
    for (const span of spans) {
      const summary = topNames.get(span.name) ?? { count: 0, failures: 0, total: 0, max: 0 };
      summary.count += 1;
      summary.failures += span.outcome === "error" ? 1 : 0;
      summary.total += span.durationMs;
      summary.max = Math.max(summary.max, span.durationMs);
      topNames.set(span.name, summary);
    }

    const failureGroups = new Map<string, DiagnosticFailure>();
    const latestFailures: DiagnosticFailure[] = [];
    const addFailure = (
      source: string,
      cause: string,
      observedAtMs: number,
      durationMs: number | null,
      traceId?: string
    ) => {
      const fingerprint = failureFingerprint(source, cause);
      const previous = failureGroups.get(fingerprint);
      const failure: DiagnosticFailure = {
        failureId: randomUUID(),
        fingerprint,
        source,
        cause,
        observedAtMs,
        durationMs,
        count: (previous?.count ?? 0) + 1,
        ...(traceId ? { traceId } : {}),
      };
      failureGroups.set(fingerprint, failure);
      latestFailures.push(failure);
    };
    for (const span of spans) {
      if (span.outcome === "error") {
        addFailure(
          span.name,
          span.message ?? "Operation failed",
          span.endedAtMs,
          span.durationMs,
          span.traceId
        );
      }
    }
    for (const log of failureLogs) {
      addFailure(log.source, log.message, log.observedAtMs, null, log.traceId);
    }

    return {
      io: [...this.#io.values()].map((counter) => ({ ...counter })),
      spans,
      logs,
      latestFailures: latestFailures.sort((a, b) => b.observedAtMs - a.observedAtMs).slice(0, 100),
      commonFailures: [...failureGroups.values()]
        .sort((a, b) => b.count - a.count || b.observedAtMs - a.observedAtMs)
        .slice(0, 100),
      topNames: [...topNames.entries()]
        .map(([name, summary]) => ({
          name,
          count: summary.count,
          failures: summary.failures,
          averageDurationMs: summary.count === 0 ? 0 : summary.total / summary.count,
          maxDurationMs: summary.max,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 100),
    };
  }

  #persist(record: Record<string, unknown>): void {
    if (!this.#persistencePath || this.#persistenceBytes >= TRACE_FILE_LIMIT_BYTES) return;
    const line = `${JSON.stringify(redactObject(record))}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.#persistenceBytes + bytes > TRACE_FILE_LIMIT_BYTES) return;
    this.#persistenceBytes += bytes;
    const target = this.#persistencePath;
    this.#persistenceQueue = this.#persistenceQueue
      .then(() => fs.appendFile(target, line, { encoding: "utf8" }))
      .catch(() => undefined);
  }
}

export const diagnosticsObservability = new DiagnosticsObservability();
