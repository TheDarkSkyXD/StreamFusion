import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { app } from "electron";

import type { ModLogEntry, ModLogQueryFilters, RetentionScope } from "../../shared/mod-log-types";

export type FollowSource = "guest" | "account";

export type PendingFollowAction = "follow" | "unfollow";

/**
 * Tombstone-equivalent row tracking a push-sync write that hasn't yet been
 * confirmed by the platform. Reconciliation (background sync) consults this
 * to distinguish "user intended unfollow, push failed" (don't re-adopt the
 * platform row) from "user never followed this on platform" (adopt as
 * account-source per existing import behavior).
 *
 * The `slug` column is essential for Kick rows where `channelId` may carry
 * a stale `user_id` from the dual-id problem; `removePendingFollowWrite`
 * matches via the `channelsMatch` primitive (platform AND (id OR slug)).
 */
export interface PendingFollowWrite {
  id: number;
  platform: string;
  channelId: string;
  slug: string;
  action: PendingFollowAction;
  attemptedAt: string;
  lastError: string | null;
}

// Re-export shared types so existing main-process imports
// (`import { ModLogEntry } from "database-service"`) keep working.
export type { ModLogEntry, ModLogQueryFilters, RetentionScope };

export class DatabaseService {
  private db: Database.Database | null = null;

  initialize() {
    if (this.db) return; // Already initialized

    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "streamfusion.db");

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    console.debug(`📂 Initializing SQLite database at: ${dbPath}`);

    this.db = new Database(dbPath);
    this.errCheck();

    this.init();
  }

  private get database(): Database.Database {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  private errCheck() {
    // Enable WAL mode for better concurrency/performance
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = NORMAL");
  }

  private init() {
    // 1. Key-Value Store
    this.database.exec(`
            CREATE TABLE IF NOT EXISTS key_value (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

    // 2. Local Follows
    // Check if 'source' column exists — if not, migrate
    const tableInfo = this.database.pragma("table_info(local_follows)") as { name: string }[];
    const hasSourceColumn = tableInfo.some((col) => col.name === "source");

    if (!hasSourceColumn && tableInfo.length > 0) {
      // Table exists but without source column — migrate
      console.debug("🔄 Migrating local_follows: adding source column...");
      this.database.exec(
        `ALTER TABLE local_follows ADD COLUMN source TEXT NOT NULL DEFAULT 'guest'`
      );
      // Drop old unique constraint and recreate with source
      // SQLite doesn't support DROP CONSTRAINT, so we recreate the table
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS local_follows_new (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          channel_name TEXT NOT NULL,
          display_name TEXT,
          profile_image TEXT,
          followed_at TEXT,
          source TEXT NOT NULL DEFAULT 'guest',
          UNIQUE(platform, channel_id, source)
        );
        INSERT OR IGNORE INTO local_follows_new SELECT id, platform, channel_id, channel_name, display_name, profile_image, followed_at, source FROM local_follows;
        DROP TABLE local_follows;
        ALTER TABLE local_follows_new RENAME TO local_follows;
      `);
      console.debug("✅ Migration complete: source column added");
    } else if (tableInfo.length === 0) {
      // Fresh install — create with source column
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS local_follows (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          channel_name TEXT NOT NULL,
          display_name TEXT,
          profile_image TEXT,
          followed_at TEXT,
          source TEXT NOT NULL DEFAULT 'guest',
          UNIQUE(platform, channel_id, source)
        );
      `);
    }

    // Ensure indexes exist
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_follows_platform ON local_follows(platform);
      CREATE INDEX IF NOT EXISTS idx_follows_channel_id ON local_follows(channel_id);
      CREATE INDEX IF NOT EXISTS idx_follows_source ON local_follows(source);
    `);

    // 3. Mod Log
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS mod_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        channel_slug TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        target_username TEXT NOT NULL,
        moderator_user_id TEXT NOT NULL,
        moderator_username TEXT NOT NULL,
        duration_seconds INTEGER,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mod_log_channel_created
        ON mod_log(channel_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mod_log_channel_target
        ON mod_log(channel_id, target_user_id);
    `);

    // 4. Retention Settings
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS retention_settings (
        scope TEXT PRIMARY KEY,
        retention_days INTEGER
      );
    `);

    // 5. Pending Follow Writes (push-sync reconciliation tombstone table)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pending_follow_writes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('follow', 'unfollow')),
        attempted_at TEXT NOT NULL,
        last_error TEXT,
        UNIQUE(platform, channel_id, action)
      );
      CREATE INDEX IF NOT EXISTS idx_pending_writes_platform
        ON pending_follow_writes(platform);
    `);

    console.debug("✅ SQLite Schema initialized");
  }

  // ========== Key-Value Operations ==========

  get<T>(key: string): T | null {
    const stmt = this.database.prepare("SELECT value FROM key_value WHERE key = ?");
    const row = stmt.get(key) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  set(key: string, value: any): void {
    const stmt = this.database.prepare(
      "INSERT OR REPLACE INTO key_value (key, value) VALUES (?, ?)"
    );
    stmt.run(key, JSON.stringify(value));
  }

  delete(key: string): void {
    const stmt = this.database.prepare("DELETE FROM key_value WHERE key = ?");
    stmt.run(key);
  }

  clearKeyValue(): void {
    this.database.exec("DELETE FROM key_value");
  }

  // ========== Local Follows Operations ==========

  getAllFollows(): any[] {
    const stmt = this.database.prepare("SELECT * FROM local_follows ORDER BY followed_at DESC");
    return stmt.all().map(this.mapFollowFromDb);
  }

  getFollowsByPlatform(platform: string): any[] {
    const stmt = this.database.prepare(
      "SELECT * FROM local_follows WHERE platform = ? ORDER BY followed_at DESC"
    );
    return stmt.all(platform).map(this.mapFollowFromDb);
  }

  /**
   * Get follows filtered by platform AND source
   */
  getFollowsByPlatformAndSource(platform: string, source: FollowSource): any[] {
    const stmt = this.database.prepare(
      "SELECT * FROM local_follows WHERE platform = ? AND source = ? ORDER BY followed_at DESC"
    );
    return stmt.all(platform, source).map(this.mapFollowFromDb);
  }

  /**
   * Check if account-source follows exist for a platform
   */
  hasAccountFollows(platform: string): boolean {
    const stmt = this.database.prepare(
      "SELECT 1 FROM local_follows WHERE platform = ? AND source = 'account' LIMIT 1"
    );
    return !!stmt.get(platform);
  }

  addFollow(follow: any, source: FollowSource = "guest"): any {
    const stmt = this.database.prepare(`
      INSERT OR REPLACE INTO local_follows (id, platform, channel_id, channel_name, display_name, profile_image, followed_at, source)
      VALUES (@id, @platform, @channelId, @channelName, @displayName, @profileImage, @followedAt, @source)
    `);

    // When the upstream canonical id is unknown (transformer sentinel — kick
    // DOM scrape, or the VOD-page pre-resolve flow), fall back to the slug
    // as the effective channel_id. Without this, two slug-only follows for
    // different channels both write channel_id="" and the second silently
    // replaces the first via UNIQUE(platform, channel_id, source).
    const slugFallback = (follow.channelName || follow.username || "").toLowerCase();
    const effectiveChannelId = follow.channelId || slugFallback;

    // Ensure ID exists — include source to avoid collisions
    if (!follow.id) {
      follow.id = `${follow.platform}-${source}-${effectiveChannelId}-${Date.now()}`;
    }
    if (!follow.followedAt) {
      follow.followedAt = new Date().toISOString();
    }

    stmt.run({
      id: follow.id,
      platform: follow.platform,
      channelId: effectiveChannelId,
      channelName: follow.channelName || follow.username,
      displayName: follow.displayName ?? "",
      // Default to "" not undefined — better-sqlite3 accepts undefined as
      // NULL but the test-time node:sqlite shim rejects it. The DB column
      // is nullable; we still coerce to "" for consistency with the rest
      // of the row shape (rows always come back as strings).
      profileImage: follow.profileImage || follow.avatarUrl || "",
      followedAt: follow.followedAt,
      source,
    });

    return { ...follow, source };
  }

  /**
   * Atomically replace all account-source follows for a platform with a new
   * batch. Wraps clear + insert-loop in a single transaction so a mid-batch
   * crash leaves the existing rows intact rather than half-deleted with no
   * recovery path.
   */
  replaceAccountFollows(platform: string, follows: any[]): void {
    const replace = this.database.transaction((rows: any[]) => {
      const clearStmt = this.database.prepare(
        "DELETE FROM local_follows WHERE platform = ? AND source = 'account'"
      );
      clearStmt.run(platform);
      for (const follow of rows) {
        this.addFollow(follow, "account");
      }
    });
    replace(follows);
  }

  removeFollow(id: string): boolean {
    const stmt = this.database.prepare("DELETE FROM local_follows WHERE id = ?");
    const info = stmt.run(id);
    return info.changes > 0;
  }

  isFollowing(platform: string, channelId: string): boolean {
    const stmt = this.database.prepare(
      "SELECT 1 FROM local_follows WHERE platform = ? AND channel_id = ? LIMIT 1"
    );
    return !!stmt.get(platform, channelId);
  }

  /**
   * Check if following with a specific source
   */
  isFollowingWithSource(platform: string, channelId: string, source: FollowSource): boolean {
    const stmt = this.database.prepare(
      "SELECT 1 FROM local_follows WHERE platform = ? AND channel_id = ? AND source = ? LIMIT 1"
    );
    return !!stmt.get(platform, channelId, source);
  }

  /**
   * Clear follows for a specific platform and source
   */
  clearFollowsByPlatformAndSource(platform: string, source: FollowSource): void {
    const stmt = this.database.prepare(
      "DELETE FROM local_follows WHERE platform = ? AND source = ?"
    );
    stmt.run(platform, source);
  }

  clearFollowsByPlatform(platform: string): void {
    const stmt = this.database.prepare("DELETE FROM local_follows WHERE platform = ?");
    stmt.run(platform);
  }

  clearFollows(): void {
    this.database.exec("DELETE FROM local_follows");
  }

  // Helper to map snake_case DB columns to camelCase JS objects
  private mapFollowFromDb(row: any): any {
    return {
      id: row.id,
      platform: row.platform,
      channelId: row.channel_id,
      channelName: row.channel_name,
      displayName: row.display_name,
      profileImage: row.profile_image,
      followedAt: row.followed_at,
      source: row.source || "guest",
    };
  }

  // ========== Pending Follow Writes (Push-Sync Reconciliation) ==========

  /**
   * Insert or update a pending follow/unfollow write. On UNIQUE conflict
   * (same platform + channel_id + action), refreshes `attempted_at` and
   * `last_error` rather than creating a duplicate row.
   */
  addPendingFollowWrite(input: {
    platform: string;
    channelId: string;
    slug: string;
    action: PendingFollowAction;
    lastError?: string | null;
  }): void {
    const stmt = this.database.prepare(`
      INSERT INTO pending_follow_writes (platform, channel_id, slug, action, attempted_at, last_error)
      VALUES (@platform, @channelId, @slug, @action, @attemptedAt, @lastError)
      ON CONFLICT(platform, channel_id, action) DO UPDATE SET
        attempted_at = excluded.attempted_at,
        last_error = excluded.last_error,
        slug = excluded.slug
    `);
    stmt.run({
      platform: input.platform,
      channelId: input.channelId,
      slug: input.slug,
      action: input.action,
      attemptedAt: new Date().toISOString(),
      lastError: input.lastError ?? null,
    });
  }

  /**
   * Delete a pending write by composite key. Matches via dual-id pattern
   * (channel_id OR slug) so a row inserted with channel_id=numeric-user-id
   * is still findable for cleanup when the retry path passes channel_id=slug.
   * See: docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md
   */
  removePendingFollowWrite(input: {
    platform: string;
    channelId: string;
    slug: string;
    action: PendingFollowAction;
  }): boolean {
    const stmt = this.database.prepare(`
      DELETE FROM pending_follow_writes
      WHERE platform = ? AND (channel_id = ? OR slug = ?) AND action = ?
    `);
    const info = stmt.run(input.platform, input.channelId, input.slug, input.action);
    return info.changes > 0;
  }

  getAllPendingFollowWrites(): PendingFollowWrite[] {
    const stmt = this.database.prepare(
      "SELECT * FROM pending_follow_writes ORDER BY attempted_at ASC"
    );
    return stmt.all().map(this.mapPendingWriteFromDb);
  }

  getPendingFollowWritesByPlatform(platform: string): PendingFollowWrite[] {
    const stmt = this.database.prepare(
      "SELECT * FROM pending_follow_writes WHERE platform = ? ORDER BY attempted_at ASC"
    );
    return stmt.all(platform).map(this.mapPendingWriteFromDb);
  }

  private mapPendingWriteFromDb(row: any): PendingFollowWrite {
    return {
      id: Number(row.id),
      platform: row.platform,
      channelId: row.channel_id,
      slug: row.slug,
      action: row.action,
      attemptedAt: row.attempted_at,
      lastError: row.last_error ?? null,
    };
  }

  // ========== Mod Log Operations ==========

  insertModLog(entry: Omit<ModLogEntry, "id">): number {
    const stmt = this.database.prepare(`
      INSERT INTO mod_log (
        channel_id, channel_slug, action,
        target_user_id, target_username,
        moderator_user_id, moderator_username,
        duration_seconds, reason, created_at
      ) VALUES (
        @channelId, @channelSlug, @action,
        @targetUserId, @targetUsername,
        @moderatorUserId, @moderatorUsername,
        @durationSeconds, @reason, @createdAt
      )
    `);
    const info = stmt.run({
      channelId: entry.channelId,
      channelSlug: entry.channelSlug,
      action: entry.action,
      targetUserId: entry.targetUserId,
      targetUsername: entry.targetUsername,
      moderatorUserId: entry.moderatorUserId,
      moderatorUsername: entry.moderatorUsername,
      durationSeconds: entry.durationSeconds ?? null,
      reason: entry.reason ?? null,
      createdAt: entry.createdAt,
    });
    return Number(info.lastInsertRowid);
  }

  queryModLog(filters: ModLogQueryFilters): ModLogEntry[] {
    const where: string[] = ["channel_id = ?"];
    const params: any[] = [filters.channelId];

    if (filters.targetUserId) {
      where.push("target_user_id = ?");
      params.push(filters.targetUserId);
    }
    if (filters.action) {
      where.push("action = ?");
      params.push(filters.action);
    }
    if (filters.moderatorUsername) {
      where.push("moderator_username = ?");
      params.push(filters.moderatorUsername);
    }

    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const sql = `
      SELECT * FROM mod_log
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const rows = this.database.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapModLogFromDb(row));
  }

  private mapModLogFromDb(row: any): ModLogEntry {
    return {
      id: row.id,
      channelId: row.channel_id,
      channelSlug: row.channel_slug,
      action: row.action,
      targetUserId: row.target_user_id,
      targetUsername: row.target_username,
      moderatorUserId: row.moderator_user_id,
      moderatorUsername: row.moderator_username,
      durationSeconds: row.duration_seconds,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }

  sweepModLogRetention(now: number = Date.now()): number {
    // Resolve retention windows per channel.
    // channel:<id> override beats global.
    const settings = this.database
      .prepare("SELECT scope, retention_days FROM retention_settings")
      .all() as { scope: string; retention_days: number | null }[];

    let globalDays: number | null | undefined;
    const channelDays = new Map<string, number | null>();
    for (const row of settings) {
      if (row.scope === "global") {
        globalDays = row.retention_days;
      } else if (row.scope.startsWith("channel:")) {
        channelDays.set(row.scope.slice("channel:".length), row.retention_days);
      }
    }

    // Distinct channels currently in mod_log.
    const channels = this.database.prepare("SELECT DISTINCT channel_id FROM mod_log").all() as {
      channel_id: string;
    }[];

    let deleted = 0;
    const del = this.database.prepare(
      "DELETE FROM mod_log WHERE channel_id = ? AND created_at < ?"
    );

    for (const { channel_id } of channels) {
      const days = channelDays.has(channel_id) ? channelDays.get(channel_id) : globalDays;
      // null/undefined means "forever" — skip.
      if (days === null || days === undefined) continue;
      const cutoff = now - days * 86_400_000;
      const info = del.run(channel_id, cutoff);
      deleted += info.changes;
    }

    return deleted;
  }

  // ========== Retention Settings ==========

  getRetentionSetting(scope: RetentionScope): number | null | undefined {
    const row = this.database
      .prepare("SELECT retention_days FROM retention_settings WHERE scope = ?")
      .get(scope) as { retention_days: number | null } | undefined;
    if (!row) return undefined;
    return row.retention_days;
  }

  setRetentionSetting(scope: RetentionScope, days: number | null): void {
    this.database
      .prepare(
        `INSERT INTO retention_settings (scope, retention_days)
         VALUES (?, ?)
         ON CONFLICT(scope) DO UPDATE SET retention_days = excluded.retention_days`
      )
      .run(scope, days);
  }
}

export const dbService = new DatabaseService();
