import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { app } from "electron";

import { logger } from "@/lib/cross-logger";
import {
  firstValidKickBroadcasterUserId,
  getKickBroadcasterUserIdFromAvatar,
} from "@/lib/kick-channel-identity";
import type { Platform } from "../../shared/auth-types";
import type {
  ModLogCoverageRecord,
  ModLogEntry,
  ModLogQueryFilters,
  ModLogWriteEntry,
  RetentionScope,
} from "../../shared/mod-log-types";

/**
 * Source tag on `local_follows`. Three values:
 *   - "guest"   : local follow. Visible when no live platform token exists.
 *   - "kick"    : Kick account follow confirmed by sync. Visible only when signed in to Kick.
 *   - "twitch"  : Twitch account follow confirmed by sync. Visible only when signed in to Twitch.
 *
 * Platform-tagged rows are written by account sync. Successful sync is
 * authoritative: rows absent from the fetched account list are pruned so
 * external unfollows and failed local-only follows do not masquerade as
 * account follows.
 *
 * Pre-2026-05-29 schemas used "account" and "local" as separate sources; the
 * migration in `init()` collapses them to the row's platform value.
 */
export type FollowSource = "guest" | Platform;

export type PendingFollowAction = "follow" | "unfollow";
export type PendingFollowWriteStatus = "pending" | "retrying" | "auth-paused" | "failed";

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
  status: PendingFollowWriteStatus;
  createdAt: string;
  attemptedAt: string;
  nextAttemptAt: string;
  expiresAt: string;
  attemptCount: number;
  lastError: string | null;
}

interface PendingFollowWriteDbRow {
  id: number;
  platform: string;
  channel_id: string;
  slug: string;
  action: PendingFollowAction;
  status: PendingFollowWriteStatus;
  created_at: string;
  attempted_at: string;
  next_attempt_at: string;
  expires_at: string;
  attempt_count: number;
  last_error: string | null;
}

interface SyncedFollowInput {
  platform: Platform;
  channelId: string;
  channelName: string;
  displayName?: string;
  profileImage?: string;
}

function normalizedFollowSlug(channelName: string): string {
  return channelName.trim().toLowerCase();
}

function getStableKickFollowIdentity(
  follow: Pick<SyncedFollowInput, "channelId" | "profileImage">
): string | null {
  return firstValidKickBroadcasterUserId(
    getKickBroadcasterUserIdFromAvatar(follow.profileImage),
    follow.channelId
  );
}

function isPendingFollowWriteDbRow(value: unknown): value is PendingFollowWriteDbRow {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "number" &&
    "platform" in value &&
    typeof value.platform === "string" &&
    "channel_id" in value &&
    typeof value.channel_id === "string" &&
    "slug" in value &&
    typeof value.slug === "string" &&
    "action" in value &&
    (value.action === "follow" || value.action === "unfollow") &&
    "status" in value &&
    (value.status === "pending" ||
      value.status === "retrying" ||
      value.status === "auth-paused" ||
      value.status === "failed") &&
    "created_at" in value &&
    typeof value.created_at === "string" &&
    "attempted_at" in value &&
    typeof value.attempted_at === "string" &&
    "next_attempt_at" in value &&
    typeof value.next_attempt_at === "string" &&
    "expires_at" in value &&
    typeof value.expires_at === "string" &&
    "attempt_count" in value &&
    typeof value.attempt_count === "number" &&
    "last_error" in value &&
    (typeof value.last_error === "string" || value.last_error === null)
  );
}

/**
 * Internal compatibility shape for callers that predate provenance tracking.
 * These rows are intentionally persisted without invented platform/provider
 * metadata and are marked as legacy-unattributed.
 */
type LegacyModLogWriteEntry = Omit<
  ModLogEntry,
  "id" | "platform" | "provenance" | "providerEventId" | "occurredAt" | "observedAt"
> & {
  createdAt: number;
};

// Re-export shared types so existing main-process imports
// (`import { ModLogEntry } from "database-service"`) keep working.
export type {
  ModLogCoverageRecord,
  ModLogEntry,
  ModLogQueryFilters,
  ModLogWriteEntry,
  RetentionScope,
};

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

    logger.debug("Service:DB", "Initializing SQLite database", { dbPath });

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
      logger.debug("Service:DB", "Migrating local_follows: adding source column");
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
      logger.debug("Service:DB", "Migration complete: source column added");
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

    // Migration (2026-05-29): collapse {account, local} → platform-named source.
    // After this runs, source ∈ {guest, kick, twitch} and matches the row's
    // platform column for all non-guest rows. Idempotent — re-running on
    // already-migrated data is a no-op because the WHERE clause finds no rows.
    const legacyRow = this.database
      .prepare("SELECT 1 FROM local_follows WHERE source IN ('account', 'local') LIMIT 1")
      .get();
    if (legacyRow) {
      logger.debug(
        "Service:DB",
        "Migrating local_follows source values: 'account'/'local' → platform name"
      );
      this.database.exec(`
        -- Step 1: drop the redundant 'local' row when a same-channel 'account' row exists.
        -- Both would collapse to source=platform and collide on UNIQUE(platform,channel_id,source).
        -- The account row carries fresher sync-imported metadata, so it wins.
        DELETE FROM local_follows
        WHERE source = 'local'
          AND EXISTS (
            SELECT 1 FROM local_follows AS other
            WHERE other.platform = local_follows.platform
              AND other.channel_id = local_follows.channel_id
              AND other.source = 'account'
          );

        -- Step 2: rename source to platform value.
        UPDATE local_follows SET source = platform WHERE source IN ('account', 'local');
      `);
      logger.debug("Service:DB", "Migration complete: source values are now {guest, kick, twitch}");
    }

    // Older readers could store one Kick channel twice: once by numeric ID
    // and once by slug. Remove invalid/duplicate rows before installing the
    // persistence-level invariant that protects every writer.
    const invalidFollowCleanup = this.database
      .prepare("DELETE FROM local_follows WHERE trim(channel_name) = ''")
      .run();
    const duplicateFollowCleanup = this.database
      .prepare(
        `DELETE FROM local_follows
         WHERE EXISTS (
           SELECT 1 FROM local_follows AS keeper
           WHERE keeper.platform = local_follows.platform
             AND keeper.source = local_follows.source
             AND lower(trim(keeper.channel_name)) = lower(trim(local_follows.channel_name))
             AND (
               (CASE WHEN keeper.channel_id GLOB '[1-9]*'
                           AND keeper.channel_id NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END) >
               (CASE WHEN local_follows.channel_id GLOB '[1-9]*'
                           AND local_follows.channel_id NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END)
               OR (
                 (CASE WHEN keeper.channel_id GLOB '[1-9]*'
                             AND keeper.channel_id NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END) =
                 (CASE WHEN local_follows.channel_id GLOB '[1-9]*'
                             AND local_follows.channel_id NOT GLOB '*[^0-9]*' THEN 1 ELSE 0 END)
                 AND (
                   COALESCE(keeper.followed_at, '') > COALESCE(local_follows.followed_at, '')
                   OR (COALESCE(keeper.followed_at, '') = COALESCE(local_follows.followed_at, '')
                       AND keeper.rowid > local_follows.rowid)
                 )
               )
             )
         )`
      )
      .run();
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_platform_slug_source
        ON local_follows(platform, lower(trim(channel_name)), source)
        WHERE trim(channel_name) <> '';
    `);
    if (duplicateFollowCleanup.changes > 0) {
      logger.info("Service:DB", "Collapsed duplicate follow identities", {
        removedCount: duplicateFollowCleanup.changes,
      });
    }
    if (invalidFollowCleanup.changes > 0) {
      logger.warn("Service:DB", "Removed invalid follow rows without channel slugs", {
        removedCount: invalidFollowCleanup.changes,
      });
    }

    // 3. Mod Log
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS mod_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT,
        channel_id TEXT NOT NULL,
        channel_slug TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        target_username TEXT NOT NULL,
        moderator_user_id TEXT NOT NULL,
        moderator_username TEXT NOT NULL,
        duration_seconds INTEGER,
        reason TEXT,
        provenance TEXT,
        provider_event_id TEXT,
        occurred_at INTEGER,
        observed_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mod_log_channel_created
        ON mod_log(channel_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mod_log_channel_target
        ON mod_log(channel_id, target_user_id);
    `);

    const modLogColumns = new Set(
      (this.database.pragma("table_info(mod_log)") as { name: string }[]).map(
        (column) => column.name
      )
    );
    const modLogMigrations = [
      ["platform", "ALTER TABLE mod_log ADD COLUMN platform TEXT"],
      ["provenance", "ALTER TABLE mod_log ADD COLUMN provenance TEXT"],
      ["provider_event_id", "ALTER TABLE mod_log ADD COLUMN provider_event_id TEXT"],
      ["occurred_at", "ALTER TABLE mod_log ADD COLUMN occurred_at INTEGER"],
      ["observed_at", "ALTER TABLE mod_log ADD COLUMN observed_at INTEGER"],
    ] as const;
    for (const [column, sql] of modLogMigrations) {
      if (!modLogColumns.has(column)) this.database.exec(sql);
    }
    this.database.exec(`
      UPDATE mod_log
      SET provenance = COALESCE(provenance, 'legacy-unattributed'),
          occurred_at = COALESCE(occurred_at, created_at),
          observed_at = COALESCE(observed_at, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_log_provider_event
        ON mod_log(platform, provider_event_id)
        WHERE platform IS NOT NULL AND provider_event_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS mod_log_coverage (
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        coverage TEXT NOT NULL CHECK(coverage IN ('complete', 'partial')),
        source TEXT NOT NULL,
        coverage_start_at INTEGER,
        coverage_end_at INTEGER,
        observed_at INTEGER NOT NULL,
        PRIMARY KEY(platform, channel_id)
      );
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
        status TEXT NOT NULL CHECK(status IN ('pending', 'retrying', 'auth-paused', 'failed')),
        created_at TEXT NOT NULL,
        attempted_at TEXT NOT NULL,
        next_attempt_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        UNIQUE(platform, channel_id, action)
      );
      CREATE INDEX IF NOT EXISTS idx_pending_writes_platform
        ON pending_follow_writes(platform);
    `);

    const pendingFollowWriteColumnInfo: unknown = this.database.pragma(
      "table_info(pending_follow_writes)"
    );
    const pendingFollowWriteColumns = new Set(
      (Array.isArray(pendingFollowWriteColumnInfo) ? pendingFollowWriteColumnInfo : []).flatMap(
        (column: unknown) =>
          typeof column === "object" &&
          column !== null &&
          "name" in column &&
          typeof column.name === "string"
            ? [column.name]
            : []
      )
    );
    const pendingFollowWriteMigrations: ReadonlyArray<readonly [string, string]> = [
      [
        "status",
        "ALTER TABLE pending_follow_writes ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'retrying', 'auth-paused', 'failed'))",
      ],
      ["created_at", "ALTER TABLE pending_follow_writes ADD COLUMN created_at TEXT"],
      ["next_attempt_at", "ALTER TABLE pending_follow_writes ADD COLUMN next_attempt_at TEXT"],
      ["expires_at", "ALTER TABLE pending_follow_writes ADD COLUMN expires_at TEXT"],
      [
        "attempt_count",
        "ALTER TABLE pending_follow_writes ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
      ],
    ];
    for (const [column, sql] of pendingFollowWriteMigrations) {
      if (!pendingFollowWriteColumns.has(column)) this.database.exec(sql);
    }
    this.database.exec(`
      UPDATE pending_follow_writes
      SET created_at = COALESCE(created_at, attempted_at),
          next_attempt_at = COALESCE(next_attempt_at, attempted_at),
          expires_at = COALESCE(
            expires_at,
            strftime('%Y-%m-%dT%H:%M:%fZ', attempted_at, '+10 minutes')
          );
    `);

    logger.debug("Service:DB", "SQLite Schema initialized");
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
   * Check if platform-source (synced or in-app-followed-while-signed-in) rows
   * exist for a platform. Returns true when a sync has imported at least one
   * row for the platform OR the user has clicked Follow in-app while signed
   * in to it.
   */
  hasAccountFollows(platform: string): boolean {
    const stmt = this.database.prepare(
      "SELECT 1 FROM local_follows WHERE platform = ? AND source = ? LIMIT 1"
    );
    return !!stmt.get(platform, platform);
  }

  addFollow(follow: any, source: FollowSource = "guest"): any {
    const channelName = String(follow.channelName || follow.username || "").trim();
    if (!channelName) throw new Error("Follow channel name must not be empty");
    if (source !== "guest" && source !== follow.platform) {
      throw new Error(`Follow source ${source} must match platform ${follow.platform}`);
    }

    // Every writer converges here. Prefer a current canonical Kick identity,
    // then a previously resolved one for this slug, and use the slug only
    // when neither source can prove a stable broadcaster ID.
    const slugFallback = normalizedFollowSlug(channelName);
    const requestedChannelId = String(follow.channelId || "").trim() || slugFallback;
    const existingRow = this.database
      .prepare(
        `SELECT * FROM local_follows
         WHERE platform = ? AND source = ? AND lower(trim(channel_name)) = ?
         LIMIT 1`
      )
      .get(follow.platform, source, slugFallback);
    const existingFollow = existingRow ? this.mapFollowFromDb(existingRow) : null;
    const existingStableKickIdentity =
      follow.platform === "kick" && existingFollow
        ? getStableKickFollowIdentity(existingFollow)
        : null;
    const requestedStableKickIdentity =
      follow.platform === "kick"
        ? getStableKickFollowIdentity({
            channelId: requestedChannelId,
            profileImage: follow.profileImage || follow.avatarUrl,
          })
        : null;
    const effectiveChannelId =
      follow.platform === "kick"
        ? (requestedStableKickIdentity ?? existingStableKickIdentity ?? requestedChannelId)
        : requestedChannelId;
    const id =
      follow.id ??
      existingFollow?.id ??
      `${follow.platform}-${source}-${effectiveChannelId}-${Date.now()}`;
    const followedAt = follow.followedAt ?? existingFollow?.followedAt ?? new Date().toISOString();

    const stmt = this.database.prepare(`
      INSERT OR REPLACE INTO local_follows (id, platform, channel_id, channel_name, display_name, profile_image, followed_at, source)
      VALUES (@id, @platform, @channelId, @channelName, @displayName, @profileImage, @followedAt, @source)
    `);

    stmt.run({
      id,
      platform: follow.platform,
      channelId: effectiveChannelId,
      channelName,
      displayName: follow.displayName ?? "",
      // Default to "" not undefined — better-sqlite3 accepts undefined as
      // NULL but the test-time node:sqlite shim rejects it. The DB column
      // is nullable; we still coerce to "" for consistency with the rest
      // of the row shape (rows always come back as strings).
      profileImage: follow.profileImage || follow.avatarUrl || "",
      followedAt,
      source,
    });

    return {
      ...follow,
      id,
      channelId: effectiveChannelId,
      channelName,
      followedAt,
      source,
    };
  }

  /**
   * Apply the platform's authoritative follow list to local rows.
   *
   * Semantics (post-2026-05-29 source-collapse):
   *   - Upserts every fetched row as `source = platform` (INSERT OR REPLACE).
   *     If a row already exists with the same (platform, channel_id, source)
   *     it gets the fresh display_name / profile_image — metadata-only refresh.
   *   - Keeps every fetched row authoritative even while an unfollow is pending;
   *     intent must not hide a follow the platform still reports as active.
   *   - Removes existing platform-source rows that are absent from a
   *     successful fetched list unless `pruneAbsent` is false.
   *   - Cleans up pending_follow_writes rows that reflect a now-confirmed
   *     external state (pending follow + channel IN fetched = push landed;
   *     pending unfollow + channel NOT in fetched = unfollow landed).
   *
   * Dual-id matching for pending-row lookups per
   * docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md:
   * platform AND (channel_id match OR slug/channel_name match, case-insensitive).
   *
   * @returns accountCount: total platform-source rows for this platform after the sync;
   *          pendingCount: rows remaining in pending_follow_writes for platform;
   *          addedCount: count of fetched-and-adopted channels that DIDN'T already
   *          have a platform-source row pre-sync. Drives the renderer's decision
   *          to refetch the followed-channels query. Metadata-only syncs report
   *          addedCount = 0.
   *          removedCount: count of stale platform-source rows pruned because
   *          they were absent from the authoritative fetched list. Always 0
   *          when `pruneAbsent` is false.
   */
  upsertSyncedFollows(
    platform: Platform,
    fetchedFollows: SyncedFollowInput[],
    options: { pruneAbsent?: boolean } = {}
  ): { accountCount: number; pendingCount: number; addedCount: number; removedCount: number } {
    const pruneAbsent = options.pruneAbsent ?? true;
    const normalizedFetchedFollows = fetchedFollows.map((follow) => {
      if (follow.platform !== platform) {
        throw new Error(`Sync row platform must match ${platform}`);
      }
      const channelName = follow.channelName.trim();
      if (!channelName) throw new Error("Synced follow channel name must not be empty");
      const slug = normalizedFollowSlug(channelName);
      const channelId = follow.channelId.trim() || slug;
      return {
        ...follow,
        channelId: platform === "kick" && channelId.toLowerCase() === slug ? slug : channelId,
        channelName,
      };
    });
    const pendingRows = this.database
      .prepare(
        "SELECT platform, channel_id, slug, action FROM pending_follow_writes WHERE platform = ?"
      )
      .all(platform) as Array<{
      platform: string;
      channel_id: string;
      slug: string;
      action: PendingFollowAction;
    }>;

    const pendingFollows = pendingRows.filter((p) => p.action === "follow");
    const pendingUnfollows = pendingRows.filter((p) => p.action === "unfollow");

    // Snapshot existing platform-source rows so we can compute addedCount.
    const existingPlatformRows = this.database
      .prepare("SELECT * FROM local_follows WHERE platform = ? AND source = ?")
      .all(platform, platform)
      .map(this.mapFollowFromDb);

    const sameKickStableIdentity = (
      existing: { channelId: string; profileImage?: string },
      fetched: { channelId: string; profileImage?: string }
    ): boolean => {
      if (platform !== "kick") return false;
      const existingIdentity = getKickBroadcasterUserIdFromAvatar(existing.profileImage);
      const fetchedIdentity = getStableKickFollowIdentity(fetched);
      return Boolean(existingIdentity && fetchedIdentity && existingIdentity === fetchedIdentity);
    };

    const existingMatchesPending = (
      existing: { channelId: string; channelName: string },
      pending: { channel_id: string; slug: string }
    ): boolean =>
      existing.channelId === pending.channel_id ||
      Boolean(
        existing.channelName &&
        pending.slug &&
        normalizedFollowSlug(existing.channelName) === normalizedFollowSlug(pending.slug)
      );

    const fetchedMatchesPending = (
      fetched: { channelId: string; channelName: string },
      pending: { channel_id: string; slug: string }
    ): boolean => {
      if (fetched.channelId && fetched.channelId === pending.channel_id) return true;
      if (
        fetched.channelName &&
        pending.slug &&
        normalizedFollowSlug(fetched.channelName) === normalizedFollowSlug(pending.slug)
      ) {
        return true;
      }
      return (
        platform === "kick" &&
        existingPlatformRows.some(
          (existing) =>
            existingMatchesPending(existing, pending) && sameKickStableIdentity(existing, fetched)
        )
      );
    };

    const existingMatchesFetched = (
      existing: { channelId: string; channelName: string; profileImage?: string },
      fetched: { channelId: string; channelName: string; profileImage?: string }
    ): boolean => {
      if (platform === "kick") {
        const existingIdentity = getKickBroadcasterUserIdFromAvatar(existing.profileImage);
        const fetchedIdentity = getStableKickFollowIdentity(fetched);
        if (existingIdentity && fetchedIdentity) {
          return existingIdentity === fetchedIdentity;
        }
      }
      if (existing.channelId && fetched.channelId && existing.channelId === fetched.channelId) {
        return true;
      }
      if (
        existing.channelName &&
        fetched.channelName &&
        normalizedFollowSlug(existing.channelName) === normalizedFollowSlug(fetched.channelName)
      ) {
        return true;
      }
      return false;
    };

    const withStableKickIdentities = normalizedFetchedFollows.map((fetched) => {
      if (platform !== "kick" || getStableKickFollowIdentity(fetched)) return fetched;
      const slug = normalizedFollowSlug(fetched.channelName);
      const existingStableIdentity = existingPlatformRows
        .filter((existing) => normalizedFollowSlug(existing.channelName) === slug)
        .map(getStableKickFollowIdentity)
        .find((identity): identity is string => identity !== null);
      return existingStableIdentity ? { ...fetched, channelId: existingStableIdentity } : fetched;
    });
    const toAdoptBySlug = new Map<string, SyncedFollowInput>();
    const candidateScore = (follow: SyncedFollowInput): number => {
      if (platform !== "kick") return 0;
      const stableIdentity = getStableKickFollowIdentity(follow);
      if (!stableIdentity) return 0;
      return getKickBroadcasterUserIdFromAvatar(follow.profileImage) === stableIdentity ? 2 : 1;
    };
    const candidateKey = (follow: SyncedFollowInput): string =>
      [
        follow.channelId,
        follow.channelName,
        follow.displayName ?? "",
        follow.profileImage ?? "",
      ].join("\u0000");
    for (const candidate of withStableKickIdentities) {
      const slug = normalizedFollowSlug(candidate.channelName);
      const current = toAdoptBySlug.get(slug);
      if (!current) {
        toAdoptBySlug.set(slug, candidate);
        continue;
      }
      const currentIdentity =
        platform === "kick" ? getStableKickFollowIdentity(current) : current.channelId;
      const candidateIdentity =
        platform === "kick" ? getStableKickFollowIdentity(candidate) : candidate.channelId;
      if (currentIdentity && candidateIdentity && currentIdentity !== candidateIdentity) {
        throw new Error(`Conflicting stable channel identities for ${platform}:${slug}`);
      }
      const currentScore = candidateScore(current);
      const nextScore = candidateScore(candidate);
      if (
        nextScore > currentScore ||
        (nextScore === currentScore && candidateKey(candidate) < candidateKey(current))
      ) {
        toAdoptBySlug.set(slug, candidate);
      }
    }
    const toAdopt = [...toAdoptBySlug.values()];

    // Pending rows resolved by external state — clear from the tombstone table.
    const pendingFollowsToRemove = pendingFollows.filter((p) =>
      toAdopt.some((f) => fetchedMatchesPending(f, p))
    );
    const pendingUnfollowsToRemove = pruneAbsent
      ? pendingUnfollows.filter((p) => !toAdopt.some((f) => fetchedMatchesPending(f, p)))
      : [];

    const stalePlatformRows = pruneAbsent
      ? existingPlatformRows.filter(
          (existing) => !toAdopt.some((f) => existingMatchesFetched(existing, f))
        )
      : [];

    const renamedKickRows =
      platform === "kick"
        ? existingPlatformRows.filter((existing) =>
            toAdopt.some(
              (fetched) =>
                sameKickStableIdentity(existing, fetched) &&
                (existing.channelId !== fetched.channelId ||
                  normalizedFollowSlug(existing.channelName) !==
                    normalizedFollowSlug(fetched.channelName))
            )
          )
        : [];
    const rowsToRemove = new Map(
      [...stalePlatformRows, ...renamedKickRows].map((row) => [row.id, row])
    );

    // addedCount = adopted rows that didn't already exist as platform-source.
    const addedCount = toAdopt.filter(
      (f) => !existingPlatformRows.some((existing) => existingMatchesFetched(existing, f))
    ).length;

    const txn = this.database.transaction(() => {
      const delFollow = this.database.prepare("DELETE FROM local_follows WHERE id = ?");
      for (const row of rowsToRemove.values()) {
        delFollow.run(row.id);
      }
      for (const follow of toAdopt) {
        this.addFollow(follow, platform as FollowSource);
      }
      const delPending = this.database.prepare(
        "DELETE FROM pending_follow_writes WHERE platform = ? AND channel_id = ? AND action = ?"
      );
      for (const p of pendingFollowsToRemove) {
        delPending.run(platform, p.channel_id, "follow");
      }
      for (const p of pendingUnfollowsToRemove) {
        delPending.run(platform, p.channel_id, "unfollow");
      }
    });
    txn();

    const accountCount = (
      this.database
        .prepare("SELECT COUNT(*) as c FROM local_follows WHERE platform = ? AND source = ?")
        .get(platform, platform) as { c: number }
    ).c;
    const pendingCount = (
      this.database
        .prepare("SELECT COUNT(*) as c FROM pending_follow_writes WHERE platform = ?")
        .get(platform) as { c: number }
    ).c;

    return {
      accountCount: Number(accountCount),
      pendingCount: Number(pendingCount),
      addedCount,
      removedCount: rowsToRemove.size,
    };
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
    now?: Date;
    lastError?: string | null;
  }): void {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    const stmt = this.database.prepare(`
      INSERT INTO pending_follow_writes (
        platform, channel_id, slug, action, status, created_at,
        attempted_at, next_attempt_at, expires_at, attempt_count, last_error
      )
      VALUES (
        @platform, @channelId, @slug, @action, @status, @createdAt,
        @attemptedAt, @nextAttemptAt, @expiresAt, @attemptCount, @lastError
      )
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
      status: "pending",
      createdAt: nowIso,
      attemptedAt: nowIso,
      nextAttemptAt: nowIso,
      expiresAt,
      attemptCount: 0,
      lastError: input.lastError ?? null,
    });
  }

  updatePendingFollowWriteState(input: {
    platform: string;
    channelId: string;
    slug: string;
    action: PendingFollowAction;
    status: PendingFollowWriteStatus;
    attemptedAt?: Date;
    nextAttemptAt?: Date;
    attemptCount?: number;
    lastError?: string | null;
  }): boolean {
    const stmt = this.database.prepare(`
      UPDATE pending_follow_writes
      SET status = @status,
          attempted_at = COALESCE(@attemptedAt, attempted_at),
          next_attempt_at = COALESCE(@nextAttemptAt, next_attempt_at),
          attempt_count = COALESCE(@attemptCount, attempt_count),
          last_error = CASE WHEN @hasLastError = 1 THEN @lastError ELSE last_error END
      WHERE platform = @platform
        AND (channel_id = @channelId OR slug = @slug)
        AND action = @action
    `);
    const info = stmt.run({
      platform: input.platform,
      channelId: input.channelId,
      slug: input.slug,
      action: input.action,
      status: input.status,
      attemptedAt: input.attemptedAt?.toISOString() ?? null,
      nextAttemptAt: input.nextAttemptAt?.toISOString() ?? null,
      attemptCount: input.attemptCount ?? null,
      hasLastError: input.lastError === undefined ? 0 : 1,
      lastError: input.lastError ?? null,
    });
    return info.changes > 0;
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

  private mapPendingWriteFromDb(row: unknown): PendingFollowWrite {
    if (!isPendingFollowWriteDbRow(row)) {
      throw new Error("Invalid pending follow write row");
    }
    return {
      id: Number(row.id),
      platform: row.platform,
      channelId: row.channel_id,
      slug: row.slug,
      action: row.action,
      status: row.status,
      createdAt: row.created_at,
      attemptedAt: row.attempted_at,
      nextAttemptAt: row.next_attempt_at,
      expiresAt: row.expires_at,
      attemptCount: row.attempt_count,
      lastError: row.last_error ?? null,
    };
  }

  // ========== Mod Log Operations ==========

  insertModLog(entry: ModLogWriteEntry | LegacyModLogWriteEntry): number {
    const occurredAt = "occurredAt" in entry ? entry.occurredAt : entry.createdAt;
    if (!Number.isFinite(occurredAt)) {
      throw new Error("Mod-log entry requires a valid occurredAt timestamp");
    }
    const observedAt =
      "observedAt" in entry && Number.isFinite(entry.observedAt) ? entry.observedAt : Date.now();
    const platform = "platform" in entry ? entry.platform : null;
    const providerEventId = "providerEventId" in entry ? entry.providerEventId : null;
    if (platform && providerEventId) {
      const existing = this.database
        .prepare("SELECT id FROM mod_log WHERE platform = ? AND provider_event_id = ?")
        .get(platform, providerEventId) as { id: number } | undefined;
      if (existing) return existing.id;
    }
    const stmt = this.database.prepare(`
      INSERT INTO mod_log (
        platform, channel_id, channel_slug, action,
        target_user_id, target_username,
        moderator_user_id, moderator_username,
        duration_seconds, reason, provenance, provider_event_id,
        occurred_at, observed_at, created_at
      ) VALUES (
        @platform, @channelId, @channelSlug, @action,
        @targetUserId, @targetUsername,
        @moderatorUserId, @moderatorUsername,
        @durationSeconds, @reason, @provenance, @providerEventId,
        @occurredAt, @observedAt, @createdAt
      )
    `);
    const info = stmt.run({
      platform,
      channelId: entry.channelId,
      channelSlug: entry.channelSlug,
      action: entry.action,
      targetUserId: entry.targetUserId,
      targetUsername: entry.targetUsername,
      moderatorUserId: entry.moderatorUserId,
      moderatorUsername: entry.moderatorUsername,
      durationSeconds: entry.durationSeconds ?? null,
      reason: entry.reason ?? null,
      provenance: "provenance" in entry ? entry.provenance : "legacy-unattributed",
      providerEventId,
      occurredAt,
      observedAt,
      createdAt: occurredAt,
    });
    return Number(info.lastInsertRowid);
  }

  queryModLog(filters: ModLogQueryFilters): ModLogEntry[] {
    const where: string[] = ["channel_id = ?"];
    const params: any[] = [filters.channelId];

    if (filters.platform) {
      where.push("platform = ?");
      params.push(filters.platform);
    }
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
      ORDER BY occurred_at DESC, id DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const rows = this.database.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapModLogFromDb(row));
  }

  private mapModLogFromDb(row: any): ModLogEntry {
    return {
      id: row.id,
      platform: row.platform,
      channelId: row.channel_id,
      channelSlug: row.channel_slug,
      action: row.action,
      targetUserId: row.target_user_id,
      targetUsername: row.target_username,
      moderatorUserId: row.moderator_user_id,
      moderatorUsername: row.moderator_username,
      durationSeconds: row.duration_seconds,
      reason: row.reason,
      provenance: row.provenance ?? "legacy-unattributed",
      providerEventId: row.provider_event_id ?? null,
      occurredAt: row.occurred_at ?? row.created_at,
      observedAt: row.observed_at ?? row.created_at,
      createdAt: row.occurred_at ?? row.created_at,
    };
  }

  setModLogCoverage(record: ModLogCoverageRecord): void {
    this.database
      .prepare(
        `INSERT INTO mod_log_coverage (
           platform, channel_id, coverage, source,
           coverage_start_at, coverage_end_at, observed_at
         ) VALUES (
           @platform, @channelId, @coverage, @source,
           @coverageStartAt, @coverageEndAt, @observedAt
         )
         ON CONFLICT(platform, channel_id) DO UPDATE SET
           coverage = excluded.coverage,
           source = excluded.source,
           coverage_start_at = excluded.coverage_start_at,
           coverage_end_at = excluded.coverage_end_at,
           observed_at = excluded.observed_at`
      )
      .run({
        ...record,
        coverageStartAt: record.coverageStartAt ?? null,
        coverageEndAt: record.coverageEndAt ?? null,
      });
  }

  getModLogCoverage(
    platform: ModLogCoverageRecord["platform"],
    channelId: string
  ): ModLogCoverageRecord | null {
    const row = this.database
      .prepare("SELECT * FROM mod_log_coverage WHERE platform = ? AND channel_id = ?")
      .get(platform, channelId) as any;
    if (!row) return null;
    return {
      platform: row.platform,
      channelId: row.channel_id,
      coverage: row.coverage,
      source: row.source,
      coverageStartAt: row.coverage_start_at ?? null,
      coverageEndAt: row.coverage_end_at ?? null,
      observedAt: row.observed_at,
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
