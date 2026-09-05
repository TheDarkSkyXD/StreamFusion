import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";

import { historyRangePreset } from "../../shared/diagnostics-types";
import type {
  CollectionGap,
  DiagnosticsActivityReport,
  DiagnosticsHistoricalActivity,
  DiagnosticsHistoricalContributor,
  DiagnosticsHistoricalRendererEvidence,
  DiagnosticsHistoryBucket,
  DiagnosticsHistoryContext,
  DiagnosticsHistoryIncident,
  DiagnosticsHistoryQuery,
  DiagnosticsHistorySelection,
  DiagnosticsHistorySeries,
  ProcessObservation,
  ResourcePoint,
} from "../../shared/diagnostics-types";

const RAW_RETENTION_MS = 60 * 60_000;
const MINUTE_RETENTION_MS = 7 * 24 * 60 * 60_000;
const HOUR_RETENTION_MS = 90 * 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const MAX_STORAGE_BYTES = 64 * 1024 * 1024;
const MAX_CONTRIBUTORS = 8;
const MAX_CONTEXT_ROWS = 12;
const MAX_INCIDENTS = 32;
const RETRY_DELAY_MS = 5_000;
const INCIDENT_RADIUS_MS = 5 * 60_000;
const MEMORY_GROWTH_WINDOW_MS = 30 * 60_000;

export interface RecordedResourceSample {
  readonly instanceId: string;
  readonly observedAtMs: number;
  readonly point: ResourcePoint;
  readonly observedDurationMs?: number;
  readonly processes: readonly ProcessObservation[];
  readonly activity: DiagnosticsActivityReport | null;
  readonly gaps: readonly CollectionGap[];
}

export interface DiagnosticsHistoryRecorder {
  start(instanceId: string, atMs: number): void;
  record(sample: RecordedResourceSample): void;
  queryHistory(query: Omit<DiagnosticsHistoryQuery, "leaseId">): DiagnosticsHistorySeries;
  queryContext(selection: DiagnosticsHistorySelection): DiagnosticsHistoryContext | null;
  stop(atMs: number, clean: boolean): void;
}

type RecorderState =
  | { readonly kind: "ready"; readonly lastFailureAtMs: null }
  | {
      readonly kind: "degraded" | "unavailable";
      readonly reason: string;
      readonly lastFailureAtMs: number;
    };

interface AggregateRow {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly averageCpuPercent: number;
  readonly maximumCpuPercent: number;
  readonly maximumCpuAtMs: number;
  readonly averageResidentBytes: number;
  readonly maximumResidentBytes: number;
  readonly maximumResidentAtMs: number;
  readonly sampleCount: number;
  readonly observedDurationMs: number;
  readonly gapDurationMs: number;
}

function minuteAt(atMs: number): number {
  return Math.floor(atMs / 60_000) * 60_000;
}

function hourAt(atMs: number): number {
  return Math.floor(atMs / HOUR_MS) * HOUR_MS;
}

type ResourceSummaryTable = "resource_raw" | "resource_minute" | "resource_hour";

function summaryResolution(table: ResourceSummaryTable): "raw" | "minute" | "hour" {
  if (table === "resource_raw") return "raw";
  if (table === "resource_minute") return "minute";
  return "hour";
}

function finite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function asRows<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

/** A disposable, main-owned evidence store. Queries never expose rows or paths. */
export class SqliteDiagnosticsHistoryRecorder implements DiagnosticsHistoryRecorder {
  readonly #path: string;
  readonly #maximumStorageBytes: number;
  #maximumPages = MAX_STORAGE_BYTES / 4096;
  #db: Database.Database | null = null;
  #instanceId: string | null = null;
  #state: RecorderState = { kind: "unavailable", reason: "not started", lastFailureAtMs: 0 };
  #nextRetryAtMs = 0;
  #lastMemoryBytes: number | null = null;
  #lastCpuPercent: number | null = null;
  #lastObservedAtMs: number | null = null;
  #startedAtMs = 0;
  #lastPrunedAtMs = 0;
  #memoryBaseline: { atMs: number; bytes: number } | null = null;
  readonly #incidentTimes = new Map<string, number>();
  readonly #statements = new Map<string, Database.Statement>();

  #prepare(db: Database.Database, sql: string): Database.Statement {
    const existing = this.#statements.get(sql);
    if (existing) return existing;
    if (this.#statements.size >= 128) this.#statements.clear();
    const statement = db.prepare(sql);
    this.#statements.set(sql, statement);
    return statement;
  }

  constructor(path: string, maximumStorageBytes = MAX_STORAGE_BYTES) {
    this.#path = path;
    this.#maximumStorageBytes = maximumStorageBytes;
  }

  start(instanceId: string, atMs: number): void {
    this.#instanceId = instanceId;
    this.#startedAtMs = atMs;
    let openedDatabase: Database.Database | null = null;
    try {
      const db = new Database(this.#path);
      openedDatabase = db;
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      db.pragma("wal_autocheckpoint = 256");
      db.pragma("journal_size_limit = 1048576");
      db.pragma("auto_vacuum = INCREMENTAL");
      const pageSize = (db.pragma("page_size") as readonly { page_size: number }[])[0].page_size;
      this.#maximumPages = Math.max(32, Math.floor(this.#maximumStorageBytes / pageSize));
      db.pragma(`max_page_count = ${this.#maximumPages}`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_instance (instance_id TEXT PRIMARY KEY, started_at_ms INTEGER NOT NULL, stopped_at_ms INTEGER, clean INTEGER);
        CREATE TABLE IF NOT EXISTS resource_raw (observed_at_ms INTEGER PRIMARY KEY, cpu REAL NOT NULL, resident_bytes INTEGER NOT NULL, process_count INTEGER NOT NULL, duration_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS raw_contributor (observed_at_ms INTEGER NOT NULL, observation_id TEXT NOT NULL, pid INTEGER NOT NULL, started_at_ms INTEGER NOT NULL, display_name TEXT NOT NULL, category TEXT NOT NULL, cpu REAL NOT NULL, resident_bytes INTEGER NOT NULL, PRIMARY KEY(observed_at_ms, observation_id));
        CREATE TABLE IF NOT EXISTS activity_raw (observed_at_ms INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, failures INTEGER NOT NULL, PRIMARY KEY(observed_at_ms, name));
        CREATE TABLE IF NOT EXISTS renderer_evidence (observed_at_ms INTEGER PRIMARY KEY, route TEXT NOT NULL, heap_used_bytes INTEGER, dom_node_count INTEGER NOT NULL, chat_events INTEGER NOT NULL, active_stream_slots INTEGER NOT NULL, active_video_elements INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS resource_minute (started_at_ms INTEGER PRIMARY KEY, cpu_sum REAL NOT NULL, resident_sum REAL NOT NULL, sample_count INTEGER NOT NULL, observed_duration_ms INTEGER NOT NULL, gap_duration_ms INTEGER NOT NULL, maximum_cpu REAL NOT NULL, maximum_cpu_at_ms INTEGER NOT NULL, maximum_resident_bytes INTEGER NOT NULL, maximum_resident_at_ms INTEGER NOT NULL, first_observed_at_ms INTEGER NOT NULL, last_observed_at_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS resource_hour (started_at_ms INTEGER PRIMARY KEY, cpu_sum REAL NOT NULL, resident_sum REAL NOT NULL, sample_count INTEGER NOT NULL, observed_duration_ms INTEGER NOT NULL, gap_duration_ms INTEGER NOT NULL, maximum_cpu REAL NOT NULL, maximum_cpu_at_ms INTEGER NOT NULL, maximum_resident_bytes INTEGER NOT NULL, maximum_resident_at_ms INTEGER NOT NULL, first_observed_at_ms INTEGER NOT NULL, last_observed_at_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS minute_contributor (started_at_ms INTEGER NOT NULL, observation_id TEXT NOT NULL, pid INTEGER NOT NULL, started_process_at_ms INTEGER NOT NULL, display_name TEXT NOT NULL, category TEXT NOT NULL, first_observed_at_ms INTEGER NOT NULL, last_observed_at_ms INTEGER NOT NULL, cpu_sum REAL NOT NULL, sample_count INTEGER NOT NULL, maximum_cpu REAL NOT NULL, maximum_cpu_at_ms INTEGER NOT NULL, first_resident_bytes INTEGER NOT NULL, last_resident_bytes INTEGER NOT NULL, maximum_resident_bytes INTEGER NOT NULL, maximum_resident_at_ms INTEGER NOT NULL, PRIMARY KEY(started_at_ms, observation_id));
        CREATE TABLE IF NOT EXISTS hour_contributor (started_at_ms INTEGER NOT NULL, observation_id TEXT NOT NULL, pid INTEGER NOT NULL, started_process_at_ms INTEGER NOT NULL, display_name TEXT NOT NULL, category TEXT NOT NULL, first_observed_at_ms INTEGER NOT NULL, last_observed_at_ms INTEGER NOT NULL, cpu_sum REAL NOT NULL, sample_count INTEGER NOT NULL, maximum_cpu REAL NOT NULL, maximum_cpu_at_ms INTEGER NOT NULL, first_resident_bytes INTEGER NOT NULL, last_resident_bytes INTEGER NOT NULL, maximum_resident_bytes INTEGER NOT NULL, maximum_resident_at_ms INTEGER NOT NULL, PRIMARY KEY(started_at_ms, observation_id));
        CREATE TABLE IF NOT EXISTS activity_minute (started_at_ms INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, first_observed_at_ms INTEGER NOT NULL, last_observed_at_ms INTEGER NOT NULL, count INTEGER NOT NULL, failures INTEGER NOT NULL, PRIMARY KEY(started_at_ms, name));
        CREATE TABLE IF NOT EXISTS activity_hour (started_at_ms INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, first_observed_at_ms INTEGER NOT NULL, last_observed_at_ms INTEGER NOT NULL, count INTEGER NOT NULL, failures INTEGER NOT NULL, PRIMARY KEY(started_at_ms, name));
        CREATE TABLE IF NOT EXISTS renderer_hour (started_at_ms INTEGER PRIMARY KEY, observed_at_ms INTEGER NOT NULL, route TEXT NOT NULL, heap_used_bytes INTEGER, dom_node_count INTEGER NOT NULL, chat_events INTEGER NOT NULL, active_stream_slots INTEGER NOT NULL, active_video_elements INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS process_instance (observation_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, started_at_ms INTEGER NOT NULL, display_name TEXT NOT NULL, category TEXT NOT NULL, first_observed_at_ms INTEGER NOT NULL, last_observed_at_ms INTEGER NOT NULL, exited_at_ms INTEGER);
        CREATE TABLE IF NOT EXISTS collection_gap (started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER NOT NULL, cause TEXT NOT NULL, sources TEXT NOT NULL, PRIMARY KEY(started_at_ms, ended_at_ms));
        CREATE TABLE IF NOT EXISTS incident (incident_id TEXT PRIMARY KEY, kind TEXT NOT NULL, observed_at_ms INTEGER NOT NULL, label TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS resource_raw_at ON resource_raw(observed_at_ms);
        CREATE INDEX IF NOT EXISTS resource_minute_at ON resource_minute(started_at_ms);
        CREATE INDEX IF NOT EXISTS resource_hour_at ON resource_hour(started_at_ms);
        CREATE INDEX IF NOT EXISTS raw_contributor_at ON raw_contributor(observed_at_ms);
        CREATE INDEX IF NOT EXISTS minute_contributor_at ON minute_contributor(started_at_ms);
        CREATE INDEX IF NOT EXISTS hour_contributor_at ON hour_contributor(started_at_ms);
        CREATE INDEX IF NOT EXISTS activity_raw_at ON activity_raw(observed_at_ms);
        CREATE INDEX IF NOT EXISTS activity_minute_at ON activity_minute(started_at_ms);
        CREATE INDEX IF NOT EXISTS activity_hour_at ON activity_hour(started_at_ms);
        CREATE INDEX IF NOT EXISTS process_instance_at ON process_instance(last_observed_at_ms);
        CREATE INDEX IF NOT EXISTS incident_at ON incident(observed_at_ms);
      `);
      this.#backfillHourlySummaries(db);
      const priorSession = this.#prepare(
        db,
        `SELECT instance_id instanceId, stopped_at_ms stoppedAtMs, clean,
          (SELECT MAX(last_observed_at_ms) FROM resource_minute
            WHERE last_observed_at_ms >= runtime_instance.started_at_ms) lastObservedAtMs
        FROM runtime_instance WHERE instance_id <> ?
        ORDER BY COALESCE(stopped_at_ms, lastObservedAtMs, started_at_ms) DESC LIMIT 1`
      ).get(instanceId) as
        | {
            instanceId: string;
            stoppedAtMs: number | null;
            clean: number | null;
            lastObservedAtMs: number | null;
          }
        | undefined;
      const uncleanInstances = asRows<{ instanceId: string }>(
        this.#prepare(
          db,
          "SELECT instance_id instanceId FROM runtime_instance WHERE stopped_at_ms IS NULL AND instance_id <> ?"
        ).all(instanceId)
      );
      this.#prepare(
        db,
        "UPDATE runtime_instance SET stopped_at_ms = ?, clean = 0 WHERE stopped_at_ms IS NULL"
      ).run(atMs);
      for (const instance of uncleanInstances) {
        this.#prepare(db, "INSERT OR IGNORE INTO incident VALUES (?, ?, ?, ?)").run(
          `unclean:${instance.instanceId}:${atMs}`,
          "unclean-exit",
          atMs,
          "Previous app session ended unexpectedly"
        );
      }
      const previousEndedAtMs =
        priorSession?.clean === 1 ? priorSession.stoppedAtMs : priorSession?.lastObservedAtMs;
      if (
        previousEndedAtMs !== null &&
        previousEndedAtMs !== undefined &&
        previousEndedAtMs < atMs
      ) {
        this.#prepare(db, "INSERT OR IGNORE INTO collection_gap VALUES (?, ?, ?, ?)").run(
          previousEndedAtMs,
          atMs,
          "app-closed",
          JSON.stringify(["collector"])
        );
      }
      this.#prepare(
        db,
        "INSERT OR IGNORE INTO runtime_instance(instance_id, started_at_ms, stopped_at_ms, clean) VALUES (?, ?, NULL, NULL)"
      ).run(instanceId, atMs);
      this.#db = db;
      this.#lastObservedAtMs = (
        this.#prepare(db, "SELECT MAX(last_observed_at_ms) atMs FROM resource_minute").get() as {
          atMs: number | null;
        }
      ).atMs;
      this.#state = { kind: "ready", lastFailureAtMs: null };
    } catch (error) {
      if (openedDatabase !== this.#db) openedDatabase?.close();
      this.#statements.clear();
      this.#markFailure(atMs, error);
    }
  }

  record(sample: RecordedResourceSample): void {
    if (sample.observedAtMs < this.#nextRetryAtMs) return;
    if (!this.#db && sample.observedAtMs >= this.#nextRetryAtMs)
      this.start(sample.instanceId, sample.observedAtMs);
    const db = this.#db;
    if (!db) return;
    try {
      const startedAtMs = minuteAt(sample.observedAtMs);
      const previousMemoryBytes = this.#lastMemoryBytes;
      if (sample.observedAtMs - this.#lastPrunedAtMs >= 60_000 || this.#state.kind !== "ready") {
        this.#prune(db, sample.observedAtMs);
        this.#lastPrunedAtMs = sample.observedAtMs;
      }
      const write = db.transaction(() => {
        const inferredDurationMs =
          this.#lastObservedAtMs === null ? 1_000 : sample.observedAtMs - this.#lastObservedAtMs;
        const durationMs = Math.max(
          1,
          Math.min(5_000, sample.observedDurationMs ?? inferredDurationMs)
        );
        if (this.#lastObservedAtMs !== null && inferredDurationMs > 15_000) {
          this.#prepare(db, "INSERT OR IGNORE INTO collection_gap VALUES (?, ?, ?, ?)").run(
            this.#lastObservedAtMs + 5_000,
            sample.observedAtMs,
            "source-failure",
            JSON.stringify(["collector"])
          );
        }
        this.#prepare(db, "INSERT OR REPLACE INTO resource_raw VALUES (?, ?, ?, ?, ?)").run(
          sample.observedAtMs,
          finite(sample.point.cpuPercent),
          finite(sample.point.residentMemoryBytes),
          sample.point.processCount,
          durationMs
        );
        for (const aggregate of [
          { table: "resource_minute", startedAtMs },
          { table: "resource_hour", startedAtMs: hourAt(sample.observedAtMs) },
        ] as const) {
          this.#prepare(
            db,
            `INSERT INTO ${aggregate.table} VALUES (?,
          ?,
          ?,
          1,
          ?,
          0,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?)
          ON CONFLICT(started_at_ms)
        DO UPDATE SET cpu_sum = cpu_sum + excluded.cpu_sum,
          resident_sum = resident_sum + excluded.resident_sum,
          sample_count = sample_count + 1,
          observed_duration_ms = observed_duration_ms + excluded.observed_duration_ms,
          maximum_cpu = MAX(maximum_cpu,
          excluded.maximum_cpu),
          maximum_cpu_at_ms = CASE WHEN excluded.maximum_cpu >= maximum_cpu THEN excluded.maximum_cpu_at_ms ELSE maximum_cpu_at_ms END,
          maximum_resident_bytes = MAX(maximum_resident_bytes,
          excluded.maximum_resident_bytes),
          maximum_resident_at_ms = CASE WHEN excluded.maximum_resident_bytes >= maximum_resident_bytes THEN excluded.maximum_resident_at_ms ELSE maximum_resident_at_ms END,
          first_observed_at_ms = MIN(first_observed_at_ms,
          excluded.first_observed_at_ms),
          last_observed_at_ms = MAX(last_observed_at_ms,
          excluded.last_observed_at_ms)`
          ).run(
            aggregate.startedAtMs,
            finite(sample.point.cpuPercent),
            finite(sample.point.residentMemoryBytes),
            durationMs,
            finite(sample.point.cpuPercent),
            sample.observedAtMs,
            finite(sample.point.residentMemoryBytes),
            sample.observedAtMs,
            sample.observedAtMs,
            sample.observedAtMs
          );
        }
        const byCpu = [...sample.processes].sort(
          (left, right) => right.currentCpuPercent - left.currentCpuPercent
        );
        const byMemory = [...sample.processes].sort(
          (left, right) => right.residentBytes - left.residentBytes
        );
        const contributors = [
          ...new Map(
            [
              ...byCpu.slice(0, MAX_CONTRIBUTORS / 2),
              ...byMemory.slice(0, MAX_CONTRIBUTORS / 2),
            ].map((process) => [process.observationId, process])
          ).values(),
        ];
        for (const process of contributors) {
          this.#prepare(
            db,
            "INSERT OR REPLACE INTO raw_contributor VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(
            sample.observedAtMs,
            process.observationId,
            process.pid,
            process.startedAtMs,
            process.displayName,
            process.category,
            finite(process.currentCpuPercent),
            finite(process.residentBytes)
          );
          for (const aggregate of [
            { table: "minute_contributor", startedAtMs },
            { table: "hour_contributor", startedAtMs: hourAt(sample.observedAtMs) },
          ] as const) {
            this.#prepare(
              db,
              `INSERT INTO ${aggregate.table} VALUES (?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          1,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?)
            ON CONFLICT(started_at_ms,
          observation_id)
        DO UPDATE SET last_observed_at_ms = excluded.last_observed_at_ms,
          cpu_sum = cpu_sum + excluded.cpu_sum,
          sample_count = sample_count + 1,
          maximum_cpu = MAX(maximum_cpu,
          excluded.maximum_cpu),
          maximum_cpu_at_ms = CASE WHEN excluded.maximum_cpu >= maximum_cpu THEN excluded.maximum_cpu_at_ms ELSE maximum_cpu_at_ms END,
          last_resident_bytes = excluded.last_resident_bytes,
          maximum_resident_bytes = MAX(maximum_resident_bytes,
          excluded.maximum_resident_bytes),
          maximum_resident_at_ms = CASE WHEN excluded.maximum_resident_bytes >= maximum_resident_bytes THEN excluded.maximum_resident_at_ms ELSE maximum_resident_at_ms END`
            ).run(
              aggregate.startedAtMs,
              process.observationId,
              process.pid,
              process.startedAtMs,
              process.displayName,
              process.category,
              sample.observedAtMs,
              sample.observedAtMs,
              finite(process.currentCpuPercent),
              finite(process.currentCpuPercent),
              sample.observedAtMs,
              finite(process.residentBytes),
              finite(process.residentBytes),
              finite(process.residentBytes),
              sample.observedAtMs
            );
          }
          this.#prepare(
            db,
            `INSERT INTO process_instance VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(observation_id) DO UPDATE SET last_observed_at_ms = excluded.last_observed_at_ms, exited_at_ms = NULL`
          ).run(
            process.observationId,
            process.pid,
            process.startedAtMs,
            process.displayName,
            process.category,
            sample.observedAtMs,
            sample.observedAtMs
          );
        }
        const allProcesses = sample.processes;
        for (const process of allProcesses) {
          this.#prepare(
            db,
            `INSERT INTO process_instance VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(observation_id) DO UPDATE SET last_observed_at_ms = excluded.last_observed_at_ms, exited_at_ms = NULL`
          ).run(
            process.observationId,
            process.pid,
            process.startedAtMs,
            process.displayName,
            process.category,
            sample.observedAtMs,
            sample.observedAtMs
          );
        }
        if (allProcesses.length > 0) {
          const placeholders = allProcesses.map(() => "?").join(",");
          this.#prepare(
            db,
            `UPDATE process_instance SET exited_at_ms = ? WHERE exited_at_ms IS NULL AND observation_id NOT IN (${placeholders})`
          ).run(sample.observedAtMs, ...allProcesses.map((process) => process.observationId));
        } else {
          this.#prepare(
            db,
            "UPDATE process_instance SET exited_at_ms = ? WHERE exited_at_ms IS NULL"
          ).run(sample.observedAtMs);
        }
        if (sample.activity)
          this.#writeActivity(db, sample.activity, startedAtMs, hourAt(sample.observedAtMs));
        for (const gap of sample.gaps)
          this.#prepare(db, "INSERT OR IGNORE INTO collection_gap VALUES (?, ?, ?, ?)").run(
            gap.startedAtMs,
            gap.endedAtMs,
            gap.cause,
            JSON.stringify(gap.sources)
          );
        this.#writeIncident(db, sample, previousMemoryBytes);
      });
      write();
      this.#lastMemoryBytes = sample.point.residentMemoryBytes;
      this.#lastCpuPercent = sample.point.cpuPercent;
      this.#lastObservedAtMs = sample.observedAtMs;
      this.#state = { kind: "ready", lastFailureAtMs: null };
    } catch (error) {
      this.#markFailure(sample.observedAtMs, error);
    }
  }

  queryHistory(query: Omit<DiagnosticsHistoryQuery, "leaseId">): DiagnosticsHistorySeries {
    const db = this.#db;
    const preset = historyRangePreset(query.range);
    const requested = {
      startAtMs: Math.max(0, query.endAtMs - preset.durationMs),
      endAtMs: query.endAtMs,
    };
    if (!db)
      return {
        range: query.range,
        resolution: preset.resolution,
        requested,
        available: { oldestAtMs: null, newestAtMs: null },
        recorder: this.#publicState(),
        buckets: [],
        incidents: [],
        gaps: [],
      };
    try {
      const latestObservedAtMs = Math.max(
        this.#startedAtMs,
        this.#lastObservedAtMs ??
          (
            this.#prepare(db, "SELECT MAX(last_observed_at_ms) atMs FROM resource_hour").get() as {
              atMs: number | null;
            }
          ).atMs ??
          query.endAtMs
      );
      const table: ResourceSummaryTable =
        requested.startAtMs >= latestObservedAtMs - RAW_RETENTION_MS
          ? "resource_raw"
          : requested.startAtMs >= latestObservedAtMs - MINUTE_RETENTION_MS
            ? "resource_minute"
            : "resource_hour";
      const effectiveBucketMs =
        table === "resource_hour"
          ? Math.max(HOUR_MS, preset.bucketMs)
          : table === "resource_minute"
            ? Math.max(60_000, preset.bucketMs)
            : preset.bucketMs;
      const resolution =
        table === "resource_hour" && preset.bucketMs < HOUR_MS
          ? "hour"
          : table === "resource_minute" && preset.bucketMs < 60_000
            ? "minute"
            : preset.resolution;
      const sourceStartAtMs =
        table === "resource_hour"
          ? hourAt(requested.startAtMs)
          : table === "resource_minute"
            ? minuteAt(requested.startAtMs)
            : requested.startAtMs;
      const rows = asRows<AggregateRow>(
        this.#prepare(db, this.#aggregateSql(table)).all(
          effectiveBucketMs,
          effectiveBucketMs,
          sourceStartAtMs,
          requested.endAtMs,
          effectiveBucketMs
        )
      );
      const availability = this.#prepare(
        db,
        "SELECT MIN(first_observed_at_ms) oldestAtMs, MAX(last_observed_at_ms) newestAtMs FROM resource_hour"
      ).get() as { oldestAtMs: number | null; newestAtMs: number | null } | undefined;
      const incidents = asRows<DiagnosticsHistoryIncident>(
        this.#prepare(
          db,
          "SELECT incident_id incidentId, kind, observed_at_ms observedAtMs, label FROM incident WHERE observed_at_ms BETWEEN ? AND ? ORDER BY observed_at_ms DESC LIMIT ?"
        ).all(requested.startAtMs, requested.endAtMs, MAX_INCIDENTS)
      );
      const gaps = asRows<{
        startedAtMs: number;
        endedAtMs: number;
        cause: CollectionGap["cause"];
        sources: string;
      }>(
        this.#prepare(
          db,
          "SELECT started_at_ms startedAtMs, ended_at_ms endedAtMs, cause, sources FROM collection_gap WHERE ended_at_ms >= ? AND started_at_ms <= ? ORDER BY started_at_ms LIMIT 128"
        ).all(requested.startAtMs, requested.endAtMs)
      ).map((gap) => ({ ...gap, sources: this.#safeSources(gap.sources) }));
      return {
        range: query.range,
        resolution,
        requested,
        available: {
          oldestAtMs: availability?.oldestAtMs ?? null,
          newestAtMs: availability?.newestAtMs ?? null,
        },
        recorder: this.#publicState(),
        buckets: rows,
        incidents,
        gaps,
      };
    } catch (error) {
      this.#markFailure(query.endAtMs, error);
      return {
        range: query.range,
        resolution: preset.resolution,
        requested,
        available: { oldestAtMs: null, newestAtMs: null },
        recorder: this.#publicState(),
        buckets: [],
        incidents: [],
        gaps: [],
      };
    }
  }

  queryContext(selection: DiagnosticsHistorySelection): DiagnosticsHistoryContext | null {
    const db = this.#db;
    if (!db) return null;
    const resolved =
      selection.kind === "bucket" ? selection : this.#incidentSelection(db, selection.incidentId);
    if (!resolved) return null;
    const durationMs = resolved.endedAtMs - resolved.startedAtMs;
    const rawAvailable =
      (
        this.#prepare(
          db,
          "SELECT 1 present FROM resource_raw WHERE observed_at_ms BETWEEN ? AND ? LIMIT 1"
        ).get(resolved.startedAtMs, resolved.endedAtMs) as { present?: number } | undefined
      )?.present === 1;
    const latestObservedAtMs = Math.max(
      this.#startedAtMs,
      this.#lastObservedAtMs ?? resolved.endedAtMs
    );
    const resourceTable: ResourceSummaryTable =
      rawAvailable &&
      (selection.kind === "incident" ||
        resolved.startedAtMs >= latestObservedAtMs - RAW_RETENTION_MS)
        ? "resource_raw"
        : resolved.startedAtMs >= latestObservedAtMs - MINUTE_RETENTION_MS
          ? "resource_minute"
          : "resource_hour";
    const contributorTable =
      resourceTable === "resource_raw"
        ? "raw_contributor"
        : resourceTable === "resource_minute"
          ? "minute_contributor"
          : "hour_contributor";
    const activityTable =
      resourceTable === "resource_raw"
        ? "activity_raw"
        : resourceTable === "resource_minute"
          ? "activity_minute"
          : "activity_hour";
    const bucket = this.#bucketForContext(db, resolved, resourceTable);
    if (!bucket) return null;
    const detailSelection = resolved;
    const detailStartedAtMs =
      resourceTable === "resource_hour"
        ? hourAt(detailSelection.startedAtMs)
        : resourceTable === "resource_minute"
          ? minuteAt(detailSelection.startedAtMs)
          : detailSelection.startedAtMs;
    const contributors = asRows<DiagnosticsHistoricalContributor>(
      this.#prepare(db, this.#contributorSql(contributorTable)).all(
        detailStartedAtMs,
        detailSelection.endedAtMs,
        MAX_CONTEXT_ROWS
      )
    );
    const activity = asRows<DiagnosticsHistoricalActivity>(
      this.#prepare(db, this.#activitySql(activityTable)).all(
        detailStartedAtMs,
        detailSelection.endedAtMs,
        MAX_CONTEXT_ROWS
      )
    );
    const incident =
      selection.kind === "incident" ? this.#incidentById(db, selection.incidentId) : null;
    const rendererTable = resourceTable === "resource_hour" ? "renderer_hour" : "renderer_evidence";
    const renderer =
      (this.#prepare(
        db,
        `SELECT route, heap_used_bytes heapUsedBytes, dom_node_count domNodeCount, chat_events chatEvents, active_stream_slots activeStreamSlots, active_video_elements activeVideoElements, observed_at_ms observedAtMs FROM ${rendererTable} WHERE observed_at_ms BETWEEN ? AND ? ORDER BY observed_at_ms DESC LIMIT 1`
      ).get(Math.max(0, detailSelection.startedAtMs - 30_000), detailSelection.endedAtMs) as
        DiagnosticsHistoricalRendererEvidence | undefined) ?? null;
    const minimumBucketMs =
      resourceTable === "resource_raw"
        ? 10_000
        : resourceTable === "resource_minute"
          ? 60_000
          : HOUR_MS;
    const sampleBucketMs = Math.max(
      minimumBucketMs,
      Math.ceil(durationMs / 359 / minimumBucketMs) * minimumBucketMs
    );
    const samples = asRows<DiagnosticsHistoryBucket>(
      this.#prepare(db, this.#aggregateSql(resourceTable)).all(
        sampleBucketMs,
        sampleBucketMs,
        detailStartedAtMs,
        resolved.endedAtMs,
        sampleBucketMs
      )
    );
    const maximumProcessCount =
      (
        this.#prepare(
          db,
          "SELECT MAX(process_count) count FROM resource_raw WHERE observed_at_ms BETWEEN ? AND ?"
        ).get(resolved.startedAtMs, resolved.endedAtMs) as { count: number | null }
      ).count ?? 0;
    return {
      selection,
      bucket,
      samples,
      detailResolution: summaryResolution(resourceTable),
      contributors,
      activity,
      renderer,
      incident,
      detailComplete:
        resourceTable === "resource_raw" &&
        maximumProcessCount <= MAX_CONTRIBUTORS / 2 &&
        bucket.observedDurationMs >= durationMs * 0.9 &&
        contributors.length < MAX_CONTEXT_ROWS &&
        activity.length < MAX_CONTEXT_ROWS,
    };
  }

  stop(atMs: number, clean: boolean): void {
    const db = this.#db;
    if (!db || !this.#instanceId) return;
    try {
      this.#prepare(
        db,
        "UPDATE process_instance SET exited_at_ms = ? WHERE exited_at_ms IS NULL"
      ).run(atMs);
      this.#prepare(
        db,
        "UPDATE runtime_instance SET stopped_at_ms = ?, clean = ? WHERE instance_id = ?"
      ).run(atMs, clean ? 1 : 0, this.#instanceId);
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch (error) {
      this.#markFailure(atMs, error);
    } finally {
      db.close();
      this.#db = null;
      this.#statements.clear();
    }
  }

  #backfillHourlySummaries(db: Database.Database): void {
    db.exec(`
      INSERT OR IGNORE INTO resource_hour
      WITH eligible AS (
        SELECT CAST(started_at_ms / ${HOUR_MS} AS INTEGER) * ${HOUR_MS} hour,
          * FROM resource_minute
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY hour ORDER BY maximum_cpu DESC, maximum_cpu_at_ms ASC) cpu_rank,
          ROW_NUMBER() OVER (PARTITION BY hour ORDER BY maximum_resident_bytes DESC, maximum_resident_at_ms ASC) memory_rank
        FROM eligible
      ) SELECT hour, SUM(cpu_sum), SUM(resident_sum), SUM(sample_count), SUM(observed_duration_ms),
        SUM(gap_duration_ms), MAX(maximum_cpu), MIN(CASE WHEN cpu_rank = 1 THEN maximum_cpu_at_ms END),
        MAX(maximum_resident_bytes), MIN(CASE WHEN memory_rank = 1 THEN maximum_resident_at_ms END),
        MIN(first_observed_at_ms), MAX(last_observed_at_ms)
      FROM ranked GROUP BY hour;

      INSERT OR IGNORE INTO hour_contributor
      WITH eligible AS (
        SELECT CAST(started_at_ms / ${HOUR_MS} AS INTEGER) * ${HOUR_MS} hour,
          * FROM minute_contributor
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY hour, observation_id ORDER BY first_observed_at_ms ASC) first_rank,
          ROW_NUMBER() OVER (PARTITION BY hour, observation_id ORDER BY last_observed_at_ms DESC) last_rank,
          ROW_NUMBER() OVER (PARTITION BY hour, observation_id ORDER BY maximum_cpu DESC, maximum_cpu_at_ms ASC) cpu_rank,
          ROW_NUMBER() OVER (PARTITION BY hour, observation_id ORDER BY maximum_resident_bytes DESC, maximum_resident_at_ms ASC) memory_rank
        FROM eligible
      ) SELECT hour, observation_id, MIN(pid), MIN(started_process_at_ms), MIN(display_name), MIN(category),
        MIN(first_observed_at_ms), MAX(last_observed_at_ms), SUM(cpu_sum), SUM(sample_count), MAX(maximum_cpu),
        MIN(CASE WHEN cpu_rank = 1 THEN maximum_cpu_at_ms END),
        MIN(CASE WHEN first_rank = 1 THEN first_resident_bytes END),
        MIN(CASE WHEN last_rank = 1 THEN last_resident_bytes END), MAX(maximum_resident_bytes),
        MIN(CASE WHEN memory_rank = 1 THEN maximum_resident_at_ms END)
      FROM ranked GROUP BY hour, observation_id;

      INSERT OR IGNORE INTO activity_hour
      SELECT CAST(started_at_ms / ${HOUR_MS} AS INTEGER) * ${HOUR_MS}, name, MIN(kind),
        MIN(first_observed_at_ms), MAX(last_observed_at_ms), SUM(count), SUM(failures)
      FROM activity_minute GROUP BY CAST(started_at_ms / ${HOUR_MS} AS INTEGER), name;

      INSERT OR IGNORE INTO renderer_hour
      WITH ranked AS (
        SELECT CAST(observed_at_ms / ${HOUR_MS} AS INTEGER) * ${HOUR_MS} hour, *,
          ROW_NUMBER() OVER (PARTITION BY CAST(observed_at_ms / ${HOUR_MS} AS INTEGER) ORDER BY observed_at_ms DESC) latest_rank
        FROM renderer_evidence
      ) SELECT hour, observed_at_ms, route, heap_used_bytes, dom_node_count, chat_events,
        active_stream_slots, active_video_elements FROM ranked WHERE latest_rank = 1;
    `);
  }

  #writeActivity(
    db: Database.Database,
    activity: DiagnosticsActivityReport,
    startedAtMs: number,
    hourStartedAtMs: number
  ): void {
    this.#prepare(db, "INSERT OR REPLACE INTO renderer_evidence VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      activity.observedAtMs,
      activity.route,
      activity.heapUsedBytes,
      activity.domNodeCount,
      activity.chatEvents,
      activity.activeStreamSlots,
      activity.activeVideoElements
    );
    const rows: readonly {
      readonly name: string;
      readonly kind: DiagnosticsHistoricalActivity["kind"];
      readonly count: number;
    }[] = [
      { name: `Route ${activity.route}`, kind: "renderer", count: 1 },
      { name: "Chat operations", kind: "renderer", count: activity.chatEvents },
    ];
    this.#prepare(
      db,
      `INSERT INTO renderer_hour VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(started_at_ms) DO UPDATE SET observed_at_ms = excluded.observed_at_ms,
        route = excluded.route, heap_used_bytes = excluded.heap_used_bytes,
        dom_node_count = excluded.dom_node_count, chat_events = excluded.chat_events,
        active_stream_slots = excluded.active_stream_slots,
        active_video_elements = excluded.active_video_elements
      WHERE excluded.observed_at_ms >= renderer_hour.observed_at_ms`
    ).run(
      hourStartedAtMs,
      activity.observedAtMs,
      activity.route,
      activity.heapUsedBytes,
      activity.domNodeCount,
      activity.chatEvents,
      activity.activeStreamSlots,
      activity.activeVideoElements
    );
    for (const row of rows) {
      this.#prepare(db, "INSERT OR REPLACE INTO activity_raw VALUES (?, ?, ?, ?, 0)").run(
        activity.observedAtMs,
        row.name,
        row.kind,
        row.count
      );
      for (const aggregate of [
        { table: "activity_minute", startedAtMs },
        { table: "activity_hour", startedAtMs: hourStartedAtMs },
      ] as const) {
        this.#prepare(
          db,
          `INSERT INTO ${aggregate.table} VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(started_at_ms, name) DO UPDATE SET last_observed_at_ms = excluded.last_observed_at_ms, count = count + excluded.count`
        ).run(
          aggregate.startedAtMs,
          row.name,
          row.kind,
          activity.observedAtMs,
          activity.observedAtMs,
          row.count
        );
      }
    }
  }

  #writeIncident(
    db: Database.Database,
    sample: RecordedResourceSample,
    previousMemoryBytes: number | null
  ): void {
    const memoryGrowth =
      previousMemoryBytes === null ? 0 : sample.point.residentMemoryBytes - previousMemoryBytes;
    const cpuJump =
      this.#lastCpuPercent === null ? 0 : sample.point.cpuPercent - this.#lastCpuPercent;
    const baseline = this.#memoryBaseline;
    const elapsedMs = baseline ? sample.observedAtMs - baseline.atMs : 0;
    const gradualGrowth =
      baseline !== null &&
      elapsedMs >= 5 * 60_000 &&
      elapsedMs <= MEMORY_GROWTH_WINDOW_MS &&
      sample.point.residentMemoryBytes - baseline.bytes >= 256 * 1024 * 1024;
    if (
      !baseline ||
      elapsedMs > MEMORY_GROWTH_WINDOW_MS ||
      sample.point.residentMemoryBytes < baseline.bytes ||
      gradualGrowth
    ) {
      this.#memoryBaseline = { atMs: sample.observedAtMs, bytes: sample.point.residentMemoryBytes };
    }
    const incidents = [
      {
        kind: "cpu-spike",
        detected:
          sample.point.cpuPercent >= 10 &&
          cpuJump >= 5 &&
          sample.point.cpuPercent >= Math.max(1, this.#lastCpuPercent ?? 0) * 2,
        label: "Observed CPU spike",
      },
      {
        kind: "memory-growth",
        detected: memoryGrowth >= 256 * 1024 * 1024 || gradualGrowth,
        label: gradualGrowth ? "Sustained RAM growth" : "Observed RAM growth",
      },
    ];
    for (const incident of incidents) {
      if (
        !incident.detected ||
        sample.observedAtMs - (this.#incidentTimes.get(incident.kind) ?? 0) < INCIDENT_RADIUS_MS
      )
        continue;
      const incidentId = `${sample.instanceId}:${sample.observedAtMs}:${incident.kind}`;
      this.#prepare(db, "INSERT OR IGNORE INTO incident VALUES (?, ?, ?, ?)").run(
        incidentId,
        incident.kind,
        sample.observedAtMs,
        incident.label
      );
      this.#incidentTimes.set(incident.kind, sample.observedAtMs);
    }
  }

  #prune(db: Database.Database, atMs: number): void {
    const rawCutoff = atMs - RAW_RETENTION_MS - 60_000;
    const minuteCutoff = atMs - MINUTE_RETENTION_MS;
    this.#prepare(db, "DELETE FROM incident WHERE observed_at_ms < ?").run(
      atMs - HOUR_RETENTION_MS
    );
    this.#prepare(
      db,
      "DELETE FROM incident WHERE incident_id IN (SELECT incident_id FROM incident ORDER BY observed_at_ms DESC LIMIT -1 OFFSET ?)"
    ).run(MAX_INCIDENTS);
    for (const table of ["resource_raw", "raw_contributor", "activity_raw"] as const) {
      this.#prepare(
        db,
        `DELETE FROM ${table} WHERE observed_at_ms < ? AND NOT EXISTS (SELECT 1 FROM incident WHERE ${table}.observed_at_ms BETWEEN incident.observed_at_ms - ? AND incident.observed_at_ms + ?)`
      ).run(rawCutoff, INCIDENT_RADIUS_MS, INCIDENT_RADIUS_MS);
    }
    for (const [table, column] of [
      ["renderer_evidence", "observed_at_ms"],
      ["resource_minute", "started_at_ms"],
      ["resource_hour", "started_at_ms"],
      ["minute_contributor", "started_at_ms"],
      ["hour_contributor", "started_at_ms"],
      ["activity_minute", "started_at_ms"],
      ["activity_hour", "started_at_ms"],
      ["renderer_hour", "started_at_ms"],
      ["collection_gap", "ended_at_ms"],
    ] as const)
      this.#prepare(db, `DELETE FROM ${table} WHERE ${column} < ?`).run(
        table.includes("hour") || table === "collection_gap"
          ? atMs - HOUR_RETENTION_MS
          : minuteCutoff
      );
    this.#prepare(
      db,
      "DELETE FROM process_instance WHERE last_observed_at_ms < ? AND exited_at_ms IS NOT NULL"
    ).run(atMs - HOUR_RETENTION_MS);
    this.#prepare(
      db,
      "DELETE FROM runtime_instance WHERE stopped_at_ms < ? AND stopped_at_ms IS NOT NULL"
    ).run(atMs - HOUR_RETENTION_MS);
    const pages = db.pragma("page_count") as readonly { page_count?: number }[];
    if ((pages[0]?.page_count ?? 0) >= this.#maximumPages * 0.9) {
      const oldestIncident = this.#prepare(
        db,
        "SELECT incident_id FROM incident ORDER BY observed_at_ms LIMIT 1"
      ).get() as { incident_id: string } | undefined;
      if (oldestIncident)
        this.#prepare(db, "DELETE FROM incident WHERE incident_id = ?").run(
          oldestIncident.incident_id
        );
      for (const table of ["resource_raw", "raw_contributor", "activity_raw"] as const) {
        this.#prepare(
          db,
          `DELETE FROM ${table} WHERE observed_at_ms < ? AND NOT EXISTS (SELECT 1 FROM incident WHERE ${table}.observed_at_ms BETWEEN incident.observed_at_ms - ? AND incident.observed_at_ms + ?)`
        ).run(rawCutoff, INCIDENT_RADIUS_MS, INCIDENT_RADIUS_MS);
      }
      this.#prepare(db, "INSERT OR IGNORE INTO collection_gap VALUES (?, ?, ?, ?)").run(
        Math.max(0, minuteCutoff),
        atMs,
        "budget-shed",
        JSON.stringify(["collector"])
      );
      db.pragma("incremental_vacuum");
    }
    db.pragma("wal_checkpoint(PASSIVE)");
  }

  #aggregateSql(table: ResourceSummaryTable): string {
    if (table === "resource_raw")
      return `WITH eligible AS (SELECT CAST(observed_at_ms / ? AS INTEGER) * ? bucket,
          observed_at_ms,
          cpu,
          resident_bytes,
          duration_ms
        FROM resource_raw
        WHERE observed_at_ms BETWEEN ? AND ?),
          ranked AS (SELECT *,
          ROW_NUMBER() OVER (PARTITION BY bucket
        ORDER BY cpu DESC,
          observed_at_ms ASC) cpu_rank,
          ROW_NUMBER() OVER (PARTITION BY bucket
        ORDER BY resident_bytes DESC,
          observed_at_ms ASC) memory_rank
        FROM eligible) SELECT bucket startedAtMs,
          bucket + ? endedAtMs,
          AVG(cpu) averageCpuPercent,
          MAX(cpu) maximumCpuPercent,
          MIN(CASE WHEN cpu_rank = 1 THEN observed_at_ms END) maximumCpuAtMs,
          AVG(resident_bytes) averageResidentBytes,
          MAX(resident_bytes) maximumResidentBytes,
          MIN(CASE WHEN memory_rank = 1 THEN observed_at_ms END) maximumResidentAtMs,
          COUNT(*) sampleCount,
          SUM(duration_ms) observedDurationMs,
          0 gapDurationMs
        FROM ranked
        GROUP BY bucket
        ORDER BY bucket LIMIT 361`;
    return `WITH eligible AS (SELECT CAST(started_at_ms / ? AS INTEGER) * ? bucket,
          maximum_cpu,
          maximum_cpu_at_ms,
          maximum_resident_bytes,
          maximum_resident_at_ms,
          cpu_sum,
          resident_sum,
          sample_count,
          observed_duration_ms,
          gap_duration_ms
        FROM ${table}
        WHERE started_at_ms BETWEEN ? AND ?),
          ranked AS (SELECT *,
          ROW_NUMBER() OVER (PARTITION BY bucket
        ORDER BY maximum_cpu DESC,
          maximum_cpu_at_ms ASC) cpu_rank,
          ROW_NUMBER() OVER (PARTITION BY bucket
        ORDER BY maximum_resident_bytes DESC,
          maximum_resident_at_ms ASC) memory_rank
        FROM eligible) SELECT bucket startedAtMs,
          bucket + ? endedAtMs,
          SUM(cpu_sum) / MAX(1,
          SUM(sample_count)) averageCpuPercent,
          MAX(maximum_cpu) maximumCpuPercent,
          MIN(CASE WHEN cpu_rank = 1 THEN maximum_cpu_at_ms END) maximumCpuAtMs,
          SUM(resident_sum) / MAX(1,
          SUM(sample_count)) averageResidentBytes,
          MAX(maximum_resident_bytes) maximumResidentBytes,
          MIN(CASE WHEN memory_rank = 1 THEN maximum_resident_at_ms END) maximumResidentAtMs,
          SUM(sample_count) sampleCount,
          SUM(observed_duration_ms) observedDurationMs,
          SUM(gap_duration_ms) gapDurationMs
        FROM ranked
        GROUP BY bucket
        ORDER BY bucket LIMIT 361`;
  }

  #bucketForContext(
    db: Database.Database,
    selection: Extract<DiagnosticsHistorySelection, { kind: "bucket" }>,
    table: ResourceSummaryTable
  ): DiagnosticsHistoryBucket | null {
    const bucketMs = Number.MAX_SAFE_INTEGER;
    const startedAtMs =
      table === "resource_hour"
        ? hourAt(selection.startedAtMs)
        : table === "resource_minute"
          ? minuteAt(selection.startedAtMs)
          : selection.startedAtMs;
    const rows = asRows<AggregateRow>(
      this.#prepare(db, this.#aggregateSql(table)).all(
        bucketMs,
        bucketMs,
        startedAtMs,
        selection.endedAtMs,
        bucketMs
      )
    );
    const row = rows[0];
    return row
      ? { ...row, startedAtMs: selection.startedAtMs, endedAtMs: selection.endedAtMs }
      : null;
  }

  #contributorSql(table: string): string {
    const raw = table === "raw_contributor";
    const contributors = raw
      ? `WITH eligible AS (SELECT *,
          ROW_NUMBER() OVER (PARTITION BY observation_id
        ORDER BY observed_at_ms ASC) first_rank,
          ROW_NUMBER() OVER (PARTITION BY observation_id
        ORDER BY observed_at_ms DESC) last_rank,
          ROW_NUMBER() OVER (PARTITION BY observation_id
        ORDER BY cpu DESC,
          observed_at_ms ASC) cpu_rank,
          ROW_NUMBER() OVER (PARTITION BY observation_id
        ORDER BY resident_bytes DESC,
          observed_at_ms ASC) memory_rank
        FROM raw_contributor
        WHERE observed_at_ms BETWEEN ? AND ?) SELECT rc.observation_id observationId,
          rc.display_name displayName,
          rc.category category,
          rc.pid pid,
          rc.started_at_ms startedAtMs,
          MIN(rc.observed_at_ms) firstObservedAtMs,
          MAX(rc.observed_at_ms) lastObservedAtMs,
          pi.exited_at_ms exitedAtMs,
          AVG(rc.cpu) averageCpuPercent,
          MAX(rc.cpu) maximumCpuPercent,
          MIN(CASE WHEN cpu_rank = 1 THEN rc.observed_at_ms END) maximumCpuAtMs,
          MIN(CASE WHEN first_rank = 1 THEN rc.resident_bytes END) firstResidentBytes,
          MIN(CASE WHEN last_rank = 1 THEN rc.resident_bytes END) lastResidentBytes,
          MAX(rc.resident_bytes) maximumResidentBytes,
          MIN(CASE WHEN memory_rank = 1 THEN rc.observed_at_ms END) maximumResidentAtMs
        FROM eligible rc LEFT JOIN process_instance pi ON pi.observation_id = rc.observation_id
        GROUP BY rc.observation_id`
      : `WITH eligible AS (SELECT *,
          ROW_NUMBER() OVER (PARTITION BY observation_id
        ORDER BY started_at_ms ASC) first_rank,
          ROW_NUMBER() OVER (PARTITION BY observation_id
        ORDER BY started_at_ms DESC) last_rank,
          ROW_NUMBER() OVER (PARTITION BY observation_id
        ORDER BY maximum_cpu DESC,
          maximum_cpu_at_ms ASC) cpu_rank,
          ROW_NUMBER() OVER (PARTITION BY observation_id
        ORDER BY maximum_resident_bytes DESC,
          maximum_resident_at_ms ASC) memory_rank
        FROM ${table}
        WHERE started_at_ms BETWEEN ? AND ?) SELECT mc.observation_id observationId,
          mc.display_name displayName,
          mc.category category,
          mc.pid pid,
          mc.started_process_at_ms startedAtMs,
          MIN(mc.first_observed_at_ms) firstObservedAtMs,
          MAX(mc.last_observed_at_ms) lastObservedAtMs,
          pi.exited_at_ms exitedAtMs,
          SUM(mc.cpu_sum) / MAX(1,
          SUM(mc.sample_count)) averageCpuPercent,
          MAX(mc.maximum_cpu) maximumCpuPercent,
          MIN(CASE WHEN cpu_rank = 1 THEN mc.maximum_cpu_at_ms END) maximumCpuAtMs,
          MIN(CASE WHEN first_rank = 1 THEN mc.first_resident_bytes END) firstResidentBytes,
          MIN(CASE WHEN last_rank = 1 THEN mc.last_resident_bytes END) lastResidentBytes,
          MAX(mc.maximum_resident_bytes) maximumResidentBytes,
          MIN(CASE WHEN memory_rank = 1 THEN mc.maximum_resident_at_ms END) maximumResidentAtMs
        FROM eligible mc LEFT JOIN process_instance pi ON pi.observation_id = mc.observation_id
        GROUP BY mc.observation_id`;
    return `SELECT *
        FROM (${contributors})
     
        ORDER BY MAX(
        maximumCpuPercent / MAX(1,
          MAX(maximumCpuPercent) OVER ()),
        maximumResidentBytes * 1.0 / MAX(1,
          MAX(maximumResidentBytes) OVER ())
      ) DESC,
          maximumCpuPercent DESC LIMIT ?`;
  }

  #activitySql(table: string): string {
    return table === "activity_raw"
      ? `SELECT kind, name, MIN(observed_at_ms) firstObservedAtMs, MAX(observed_at_ms) lastObservedAtMs, SUM(count) count, SUM(failures) failures FROM activity_raw WHERE observed_at_ms BETWEEN ? AND ? GROUP BY name ORDER BY count DESC LIMIT ?`
      : `SELECT kind, name, MIN(first_observed_at_ms) firstObservedAtMs, MAX(last_observed_at_ms) lastObservedAtMs, SUM(count) count, SUM(failures) failures FROM ${table} WHERE started_at_ms BETWEEN ? AND ? GROUP BY name ORDER BY count DESC LIMIT ?`;
  }

  #incidentSelection(
    db: Database.Database,
    incidentId: string
  ): Extract<DiagnosticsHistorySelection, { kind: "bucket" }> | null {
    const incident = this.#incidentById(db, incidentId);
    return incident
      ? {
          kind: "bucket",
          startedAtMs: incident.observedAtMs - 5 * 60_000,
          endedAtMs: incident.observedAtMs + 5 * 60_000,
        }
      : null;
  }

  #incidentById(db: Database.Database, incidentId: string): DiagnosticsHistoryIncident | null {
    return (
      (this.#prepare(
        db,
        "SELECT incident_id incidentId, kind, observed_at_ms observedAtMs, label FROM incident WHERE incident_id = ?"
      ).get(incidentId) as DiagnosticsHistoryIncident | undefined) ?? null
    );
  }

  #safeSources(value: string): readonly CollectionGap["sources"][number][] {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter(
            (source): source is CollectionGap["sources"][number] => typeof source === "string"
          )
        : [];
    } catch {
      return [];
    }
  }

  #markFailure(atMs: number, error: unknown): void {
    const reason = error instanceof Error ? error.message.slice(0, 160) : "storage unavailable";
    this.#state = { kind: "degraded", reason, lastFailureAtMs: atMs };
    this.#nextRetryAtMs = atMs + RETRY_DELAY_MS;
  }

  #publicState(): DiagnosticsHistorySeries["recorder"] {
    const databaseBytes = [this.#path, `${this.#path}-wal`, `${this.#path}-shm`].reduce(
      (total, path) => total + (existsSync(path) ? statSync(path).size : 0),
      0
    );
    return {
      ...this.#state,
      rawRetentionMs: RAW_RETENTION_MS,
      summaryRetentionMs: HOUR_RETENTION_MS,
      samplingIntervalMs: 5_000,
      databaseBytes,
    };
  }
}
