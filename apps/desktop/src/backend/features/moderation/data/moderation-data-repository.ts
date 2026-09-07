import Database from "better-sqlite3";

import { Platform } from "@streamfusion/core/platform";
import type {
  ModLogCoverageRecord,
  ModLogEntry,
  ModLogQueryFilters,
  ModLogWriteEntry,
  RetentionScope,
} from "@shared/mod-log-types";
import { dbService } from "@backend/services/database-service";

interface ModLogDbRow {
  id: number;
  platform: Platform | null;
  channel_id: string;
  channel_slug: string;
  action: string;
  target_user_id: string;
  target_username: string;
  moderator_user_id: string;
  moderator_username: string;
  duration_seconds: number | null;
  reason: string | null;
  provenance: ModLogEntry["provenance"] | null;
  provider_event_id: string | null;
  occurred_at: number | null;
  observed_at: number | null;
  created_at: number;
}

interface ModLogCoverageDbRow {
  platform: Platform;
  channel_id: string;
  coverage: ModLogCoverageRecord["coverage"];
  source: string;
  coverage_start_at: number | null;
  coverage_end_at: number | null;
  observed_at: number;
}

type LegacyModLogWriteEntry = Omit<
  ModLogEntry,
  "id" | "platform" | "provenance" | "providerEventId" | "occurredAt" | "observedAt"
> & { createdAt: number };

function isModLogDbRow(value: unknown): value is ModLogDbRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value;
  return (
    "id" in row && typeof row.id === "number" &&
    "platform" in row && (row.platform === null || row.platform === "kick" || row.platform === "twitch") &&
    "channel_id" in row && typeof row.channel_id === "string" &&
    "channel_slug" in row && typeof row.channel_slug === "string" &&
    "action" in row && typeof row.action === "string" &&
    "target_user_id" in row && typeof row.target_user_id === "string" &&
    "target_username" in row && typeof row.target_username === "string" &&
    "moderator_user_id" in row && typeof row.moderator_user_id === "string" &&
    "moderator_username" in row && typeof row.moderator_username === "string" &&
    "duration_seconds" in row && (typeof row.duration_seconds === "number" || row.duration_seconds === null) &&
    "reason" in row && (typeof row.reason === "string" || row.reason === null) &&
    "provenance" in row && (typeof row.provenance === "string" || row.provenance === null) &&
    "provider_event_id" in row && (typeof row.provider_event_id === "string" || row.provider_event_id === null) &&
    "occurred_at" in row && (typeof row.occurred_at === "number" || row.occurred_at === null) &&
    "observed_at" in row && (typeof row.observed_at === "number" || row.observed_at === null) &&
    "created_at" in row && typeof row.created_at === "number"
  );
}

function isModLogCoverageDbRow(value: unknown): value is ModLogCoverageDbRow {
  if (typeof value !== "object" || value === null) return false;
  return (
    "platform" in value && (value.platform === "kick" || value.platform === "twitch") &&
    "channel_id" in value && typeof value.channel_id === "string" &&
    "coverage" in value && (value.coverage === "complete" || value.coverage === "partial") &&
    "source" in value && typeof value.source === "string" &&
    "coverage_start_at" in value && (typeof value.coverage_start_at === "number" || value.coverage_start_at === null) &&
    "coverage_end_at" in value && (typeof value.coverage_end_at === "number" || value.coverage_end_at === null) &&
    "observed_at" in value && typeof value.observed_at === "number"
  );
}

export class ModerationDataRepository {
  constructor(private readonly connection: () => Database.Database = () => dbService.getConnection()) {}

  initialize(): void {
    const database = this.connection();
    database.exec(`
      CREATE TABLE IF NOT EXISTS mod_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, channel_id TEXT NOT NULL,
        channel_slug TEXT NOT NULL, action TEXT NOT NULL, target_user_id TEXT NOT NULL,
        target_username TEXT NOT NULL, moderator_user_id TEXT NOT NULL,
        moderator_username TEXT NOT NULL, duration_seconds INTEGER, reason TEXT,
        provenance TEXT, provider_event_id TEXT, occurred_at INTEGER, observed_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mod_log_channel_created ON mod_log(channel_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mod_log_channel_target ON mod_log(channel_id, target_user_id);
    `);
    const columns = new Set((database.pragma("table_info(mod_log)") as { name: string }[]).map(({ name }) => name));
    for (const [column, sql] of [
      ["platform", "ALTER TABLE mod_log ADD COLUMN platform TEXT"],
      ["provenance", "ALTER TABLE mod_log ADD COLUMN provenance TEXT"],
      ["provider_event_id", "ALTER TABLE mod_log ADD COLUMN provider_event_id TEXT"],
      ["occurred_at", "ALTER TABLE mod_log ADD COLUMN occurred_at INTEGER"],
      ["observed_at", "ALTER TABLE mod_log ADD COLUMN observed_at INTEGER"],
    ] as const) if (!columns.has(column)) database.exec(sql);
    database.exec(`
      UPDATE mod_log SET provenance = COALESCE(provenance, 'legacy-unattributed'),
        occurred_at = COALESCE(occurred_at, created_at), observed_at = COALESCE(observed_at, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_log_provider_event ON mod_log(platform, provider_event_id)
        WHERE platform IS NOT NULL AND provider_event_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS mod_log_coverage (
        platform TEXT NOT NULL, channel_id TEXT NOT NULL, coverage TEXT NOT NULL CHECK(coverage IN ('complete', 'partial')),
        source TEXT NOT NULL, coverage_start_at INTEGER, coverage_end_at INTEGER, observed_at INTEGER NOT NULL,
        PRIMARY KEY(platform, channel_id)
      );
      CREATE TABLE IF NOT EXISTS retention_settings (scope TEXT PRIMARY KEY, retention_days INTEGER);
    `);
  }

  insert(entry: ModLogWriteEntry | LegacyModLogWriteEntry): number {
    const database = this.connection();
    const occurredAt = "occurredAt" in entry ? entry.occurredAt : entry.createdAt;
    if (!Number.isFinite(occurredAt)) throw new Error("Mod-log entry requires a valid occurredAt timestamp");
    const observedAt = "observedAt" in entry && Number.isFinite(entry.observedAt) ? entry.observedAt : Date.now();
    const platform = "platform" in entry ? entry.platform : null;
    const providerEventId = "providerEventId" in entry ? entry.providerEventId : null;
    if (platform && providerEventId) {
      const existing = database.prepare("SELECT id FROM mod_log WHERE platform = ? AND provider_event_id = ?").get(platform, providerEventId) as { id: number } | undefined;
      if (existing) return existing.id;
    }
    const info = database.prepare(`INSERT INTO mod_log (platform, channel_id, channel_slug, action, target_user_id, target_username, moderator_user_id, moderator_username, duration_seconds, reason, provenance, provider_event_id, occurred_at, observed_at, created_at) VALUES (@platform, @channelId, @channelSlug, @action, @targetUserId, @targetUsername, @moderatorUserId, @moderatorUsername, @durationSeconds, @reason, @provenance, @providerEventId, @occurredAt, @observedAt, @createdAt)`).run({ platform, channelId: entry.channelId, channelSlug: entry.channelSlug, action: entry.action, targetUserId: entry.targetUserId, targetUsername: entry.targetUsername, moderatorUserId: entry.moderatorUserId, moderatorUsername: entry.moderatorUsername, durationSeconds: entry.durationSeconds ?? null, reason: entry.reason ?? null, provenance: "provenance" in entry ? entry.provenance : "legacy-unattributed", providerEventId, occurredAt, observedAt, createdAt: occurredAt });
    return Number(info.lastInsertRowid);
  }

  query(filters: ModLogQueryFilters): ModLogEntry[] {
    const where: string[] = ["channel_id = ?"];
    const params: Array<string | number> = [filters.channelId];
    if (filters.platform) { where.push("platform = ?"); params.push(filters.platform); }
    if (filters.targetUserId) { where.push("target_user_id = ?"); params.push(filters.targetUserId); }
    if (filters.actions !== undefined) { if (filters.actions.length === 0) where.push("1 = 0"); else { where.push(`action IN (${filters.actions.map(() => "?").join(", ")})`); params.push(...filters.actions); } } else if (filters.action) { where.push("action = ?"); params.push(filters.action); }
    if (filters.moderatorUsername) { where.push("moderator_username = ?"); params.push(filters.moderatorUsername); }
    params.push(filters.limit ?? 100, filters.offset ?? 0);
    return (this.connection().prepare(`SELECT * FROM mod_log WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params) as unknown[]).map((row) => this.map(row));
  }

  private map(row: unknown): ModLogEntry {
    if (!isModLogDbRow(row)) throw new Error("Invalid mod log row");
    return { id: row.id, platform: row.platform, channelId: row.channel_id, channelSlug: row.channel_slug, action: row.action, targetUserId: row.target_user_id, targetUsername: row.target_username, moderatorUserId: row.moderator_user_id, moderatorUsername: row.moderator_username, durationSeconds: row.duration_seconds, reason: row.reason, provenance: row.provenance ?? "legacy-unattributed", providerEventId: row.provider_event_id ?? null, occurredAt: row.occurred_at ?? row.created_at, observedAt: row.observed_at ?? row.created_at, createdAt: row.occurred_at ?? row.created_at };
  }

  setCoverage(record: ModLogCoverageRecord): void { this.connection().prepare(`INSERT INTO mod_log_coverage (platform, channel_id, coverage, source, coverage_start_at, coverage_end_at, observed_at) VALUES (@platform, @channelId, @coverage, @source, @coverageStartAt, @coverageEndAt, @observedAt) ON CONFLICT(platform, channel_id) DO UPDATE SET coverage = excluded.coverage, source = excluded.source, coverage_start_at = excluded.coverage_start_at, coverage_end_at = excluded.coverage_end_at, observed_at = excluded.observed_at`).run({ ...record, coverageStartAt: record.coverageStartAt ?? null, coverageEndAt: record.coverageEndAt ?? null }); }
  getCoverage(platform: ModLogCoverageRecord["platform"], channelId: string): ModLogCoverageRecord | null { const row = this.connection().prepare("SELECT * FROM mod_log_coverage WHERE platform = ? AND channel_id = ?").get(platform, channelId); if (!row) return null; if (!isModLogCoverageDbRow(row)) throw new Error("Invalid mod log coverage row"); return { platform: row.platform, channelId: row.channel_id, coverage: row.coverage, source: row.source, coverageStartAt: row.coverage_start_at ?? null, coverageEndAt: row.coverage_end_at ?? null, observedAt: row.observed_at }; }
  sweepRetention(now: number = Date.now()): number { const database = this.connection(); const settings = database.prepare("SELECT scope, retention_days FROM retention_settings").all() as { scope: string; retention_days: number | null }[]; let globalDays: number | null | undefined; const channelDays = new Map<string, number | null>(); for (const row of settings) { if (row.scope === "global") globalDays = row.retention_days; else if (row.scope.startsWith("channel:")) channelDays.set(row.scope.slice("channel:".length), row.retention_days); } let deleted = 0; const remove = database.prepare("DELETE FROM mod_log WHERE channel_id = ? AND created_at < ?"); for (const { channel_id } of database.prepare("SELECT DISTINCT channel_id FROM mod_log").all() as { channel_id: string }[]) { const days = channelDays.has(channel_id) ? channelDays.get(channel_id) : globalDays; if (days === null || days === undefined) continue; deleted += remove.run(channel_id, now - days * 86_400_000).changes; } return deleted; }
  getRetention(scope: RetentionScope): number | null | undefined { const row = this.connection().prepare("SELECT retention_days FROM retention_settings WHERE scope = ?").get(scope) as { retention_days: number | null } | undefined; return row?.retention_days; }
  setRetention(scope: RetentionScope, days: number | null): void { this.connection().prepare("INSERT INTO retention_settings (scope, retention_days) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET retention_days = excluded.retention_days").run(scope, days); }
}

export const moderationDataRepository = new ModerationDataRepository();
