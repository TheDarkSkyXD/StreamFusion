import type {
  PendingFollowAction,
  PendingFollowWrite,
  PendingFollowWriteStatus,
} from "../capabilities/follow-persistence";
import { dbService, type DatabaseService } from "@backend/services/database-service";
import type { FollowSource } from "@streamfusion/core/follows";
import type Database from "better-sqlite3";

import type { LocalFollow } from "@shared/auth-types";
import { logger } from "@shared/utils/cross-logger";
import {
  firstValidKickBroadcasterUserId,
  getKickBroadcasterUserIdFromAvatar,
} from "@shared/utils/kick-channel-identity";
import { Platform } from "@streamfusion/core/platform";

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

type FollowInput = Partial<Pick<LocalFollow, "id" | "followedAt">> &
  Pick<LocalFollow, "platform" | "channelId" | "channelName"> &
  Partial<Pick<LocalFollow, "displayName" | "profileImage">> & {
    username?: string;
    avatarUrl?: string;
  };

type SyncedFollowInput = Pick<LocalFollow, "platform" | "channelId" | "channelName"> &
  Partial<Pick<LocalFollow, "displayName" | "profileImage">>;

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

interface LocalFollowDbRow {
  id: string;
  platform: Platform;
  channel_id: string;
  channel_name: string;
  display_name: string | null;
  profile_image: string | null;
  followed_at: string | null;
  source: FollowSource | null;
}

function isLocalFollowDbRow(value: unknown): value is LocalFollowDbRow {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "platform" in value &&
    (value.platform === "kick" || value.platform === "twitch") &&
    "channel_id" in value &&
    typeof value.channel_id === "string" &&
    "channel_name" in value &&
    typeof value.channel_name === "string" &&
    "display_name" in value &&
    (typeof value.display_name === "string" || value.display_name === null) &&
    "profile_image" in value &&
    (typeof value.profile_image === "string" || value.profile_image === null) &&
    "followed_at" in value &&
    (typeof value.followed_at === "string" || value.followed_at === null) &&
    "source" in value &&
    (value.source === null ||
      value.source === "guest" ||
      value.source === "kick" ||
      value.source === "twitch")
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

export function initializeFollowSchema(database: Database.Database): void {
  // 2. Local Follows
  // Check if 'source' column exists â€” if not, migrate
  const tableInfo = database.pragma("table_info(local_follows)") as { name: string }[];
  const hasSourceColumn = tableInfo.some((col) => col.name === "source");

  if (!hasSourceColumn && tableInfo.length > 0) {
    // Table exists but without source column â€” migrate
    logger.debug("Service:DB", "Migrating local_follows: adding source column");
    database.exec(`ALTER TABLE local_follows ADD COLUMN source TEXT NOT NULL DEFAULT 'guest'`);
    // Drop old unique constraint and recreate with source
    // SQLite doesn't support DROP CONSTRAINT, so we recreate the table
    database.exec(`
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
    // Fresh install â€” create with source column
    database.exec(`
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
  database.exec(`
      CREATE INDEX IF NOT EXISTS idx_follows_platform ON local_follows(platform);
      CREATE INDEX IF NOT EXISTS idx_follows_channel_id ON local_follows(channel_id);
      CREATE INDEX IF NOT EXISTS idx_follows_source ON local_follows(source);
    `);

  // Migration (2026-05-29): collapse {account, local} â†’ platform-named source.
  // After this runs, source âˆˆ {guest, kick, twitch} and matches the row's
  // platform column for all non-guest rows. Idempotent â€” re-running on
  // already-migrated data is a no-op because the WHERE clause finds no rows.
  const legacyRow = database
    .prepare("SELECT 1 FROM local_follows WHERE source IN ('account', 'local') LIMIT 1")
    .get();
  if (legacyRow) {
    logger.debug(
      "Service:DB",
      "Migrating local_follows source values: 'account'/'local' â†’ platform name"
    );
    database.exec(`
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

  // A platform account cannot follow two current channels with the same
  // slug. Older Kick readers could persist the same channel once by numeric
  // broadcaster ID and again by slug, which made raw DB counts exceed the
  // Following page. Prefer the row with a numeric identity, then the newest
  // row, before enforcing the invariant for all future writes.
  const invalidFollowCleanup = database
    .prepare("DELETE FROM local_follows WHERE trim(channel_name) = ''")
    .run();
  const duplicateFollowCleanup = database
    .prepare(
      `
          DELETE FROM local_follows
          WHERE trim(channel_name) <> ''
            AND EXISTS (
              SELECT 1
              FROM local_follows AS keeper
              WHERE keeper.platform = local_follows.platform
                AND keeper.source = local_follows.source
                AND lower(trim(keeper.channel_name)) = lower(trim(local_follows.channel_name))
                AND (
                  (
                    CASE
                      WHEN keeper.channel_id GLOB '[1-9]*'
                        AND keeper.channel_id NOT GLOB '*[^0-9]*'
                      THEN 1 ELSE 0
                    END
                  ) > (
                    CASE
                      WHEN local_follows.channel_id GLOB '[1-9]*'
                        AND local_follows.channel_id NOT GLOB '*[^0-9]*'
                      THEN 1 ELSE 0
                    END
                  )
                  OR (
                    (
                      CASE
                        WHEN keeper.channel_id GLOB '[1-9]*'
                          AND keeper.channel_id NOT GLOB '*[^0-9]*'
                        THEN 1 ELSE 0
                      END
                    ) = (
                      CASE
                        WHEN local_follows.channel_id GLOB '[1-9]*'
                          AND local_follows.channel_id NOT GLOB '*[^0-9]*'
                        THEN 1 ELSE 0
                      END
                    )
                    AND (
                      COALESCE(keeper.followed_at, '') > COALESCE(local_follows.followed_at, '')
                      OR (
                        COALESCE(keeper.followed_at, '') = COALESCE(local_follows.followed_at, '')
                        AND keeper.rowid > local_follows.rowid
                      )
                    )
                  )
                )
            )
        `
    )
    .run();
  database.exec(`
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

  // Pending Follow Writes (push-sync reconciliation tombstone table)
  database.exec(`
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

  const pendingFollowWriteColumnInfo: unknown = database.pragma(
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
    if (!pendingFollowWriteColumns.has(column)) database.exec(sql);
  }
  database.exec(`
      UPDATE pending_follow_writes
      SET created_at = COALESCE(created_at, attempted_at),
          next_attempt_at = COALESCE(next_attempt_at, attempted_at),
          expires_at = COALESCE(
            expires_at,
            strftime('%Y-%m-%dT%H:%M:%fZ', attempted_at, '+10 minutes')
          );
    `);
}

export class FollowRepository {
  constructor(private readonly driver?: Pick<DatabaseService, "getConnection">) {}
  private get database(): Database.Database {
    return (this.driver ?? dbService).getConnection();
  }
  getAllFollows(): LocalFollow[] {
    const stmt = this.database.prepare("SELECT * FROM local_follows ORDER BY followed_at DESC");
    return stmt.all().map(this.mapFollowFromDb);
  }

  getFollowsByPlatform(platform: string): LocalFollow[] {
    const stmt = this.database.prepare(
      "SELECT * FROM local_follows WHERE platform = ? ORDER BY followed_at DESC"
    );
    return stmt.all(platform).map(this.mapFollowFromDb);
  }

  /**
   * Get follows filtered by platform AND source
   */
  getFollowsByPlatformAndSource(platform: string, source: FollowSource): LocalFollow[] {
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

  addFollow(follow: FollowInput, source: FollowSource = "guest"): LocalFollow {
    const channelName = (follow.channelName || follow.username || "").trim();
    if (!channelName) {
      throw new Error("Follow channel name must not be empty");
    }
    if (source !== "guest" && source !== follow.platform) {
      throw new Error(`Follow source ${source} must match platform ${follow.platform}`);
    }

    // Every writer converges here. Prefer a current canonical Kick identity,
    // then a previously resolved one for this slug, and use the slug only
    // when neither source can prove a stable broadcaster ID.
    const slugFallback = normalizedFollowSlug(channelName);
    const requestedChannelId = follow.channelId.trim() || slugFallback;
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
      // Default to "" not undefined â€” better-sqlite3 accepts undefined as
      // NULL but the test-time node:sqlite shim rejects it. The DB column
      // is nullable; we still coerce to "" for consistency with the rest
      // of the row shape (rows always come back as strings).
      profileImage: follow.profileImage || follow.avatarUrl || "",
      followedAt,
      source,
    });

    return {
      id,
      platform: follow.platform,
      channelId: effectiveChannelId,
      channelName,
      displayName: follow.displayName ?? "",
      profileImage: follow.profileImage || follow.avatarUrl || "",
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
   *     it gets the fresh display_name / profile_image â€” metadata-only refresh.
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
      if (!channelName) {
        throw new Error("Synced follow channel name must not be empty");
      }
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

      const normalizedSlug = normalizedFollowSlug(fetched.channelName);
      if (!normalizedSlug) return fetched;
      const existingStableIdentity = existingPlatformRows
        .filter((existing) => normalizedFollowSlug(existing.channelName) === normalizedSlug)
        .map(getStableKickFollowIdentity)
        .find((identity): identity is string => identity !== null);

      return existingStableIdentity ? { ...fetched, channelId: existingStableIdentity } : fetched;
    });

    const syncCandidateScore = (follow: SyncedFollowInput): number => {
      if (platform !== "kick") return 0;
      const stableIdentity = getStableKickFollowIdentity(follow);
      if (!stableIdentity) return 0;
      const avatarIdentity = getKickBroadcasterUserIdFromAvatar(follow.profileImage);
      return avatarIdentity === stableIdentity ? 2 : 1;
    };
    const deterministicCandidateKey = (follow: SyncedFollowInput): string =>
      [
        follow.channelId,
        follow.channelName,
        follow.displayName ?? "",
        follow.profileImage ?? "",
      ].join("\u0000");
    const toAdoptBySlug = new Map<string, SyncedFollowInput>();
    for (const candidate of withStableKickIdentities) {
      const slug = normalizedFollowSlug(candidate.channelName);
      const current = toAdoptBySlug.get(slug);
      if (!current) {
        toAdoptBySlug.set(slug, candidate);
        continue;
      }

      const currentStableIdentity =
        platform === "kick" ? getStableKickFollowIdentity(current) : current.channelId;
      const candidateStableIdentity =
        platform === "kick" ? getStableKickFollowIdentity(candidate) : candidate.channelId;
      if (
        currentStableIdentity &&
        candidateStableIdentity &&
        currentStableIdentity !== candidateStableIdentity
      ) {
        throw new Error(`Conflicting stable channel identities for ${platform}:${slug}`);
      }

      const currentScore = syncCandidateScore(current);
      const candidateScore = syncCandidateScore(candidate);
      if (
        candidateScore > currentScore ||
        (candidateScore === currentScore &&
          deterministicCandidateKey(candidate) < deterministicCandidateKey(current))
      ) {
        toAdoptBySlug.set(slug, candidate);
      }
    }
    const toAdopt = [...toAdoptBySlug.values()];

    // Pending rows resolved by external state â€” clear from the tombstone table.
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
            toAdopt.some((fetched) => {
              const existingAvatarIdentity = getKickBroadcasterUserIdFromAvatar(
                existing.profileImage
              );
              const fetchedIdentity = getStableKickFollowIdentity(fetched);
              const sameSlug =
                normalizedFollowSlug(existing.channelName) ===
                normalizedFollowSlug(fetched.channelName);
              const conflictingProvenIdentities = Boolean(
                existingAvatarIdentity &&
                fetchedIdentity &&
                existingAvatarIdentity !== fetchedIdentity
              );
              const sameCurrentIdentity =
                sameKickStableIdentity(existing, fetched) ||
                (sameSlug && !conflictingProvenIdentities);
              return (
                sameCurrentIdentity &&
                (existing.channelId !== fetched.channelId ||
                  normalizedFollowSlug(existing.channelName) !==
                    normalizedFollowSlug(fetched.channelName))
              );
            })
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
        this.addFollow(follow, platform);
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
  private mapFollowFromDb(row: unknown): LocalFollow {
    if (!isLocalFollowDbRow(row)) throw new Error("Invalid local follow row");
    return {
      id: row.id,
      platform: row.platform,
      channelId: row.channel_id,
      channelName: row.channel_name,
      displayName: row.display_name ?? "",
      profileImage: row.profile_image ?? "",
      followedAt: row.followed_at ?? "",
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

  confirmKickUnfollow(input: { channelId: string; slug: string; localFollowId?: string }): boolean {
    let changed = false;
    const txn = this.database.transaction(() => {
      if (input.localFollowId) {
        const removed = this.database
          .prepare("DELETE FROM local_follows WHERE id = ? AND platform = 'kick'")
          .run(input.localFollowId);
        changed = changed || removed.changes > 0;
      }
      const pending = this.database
        .prepare(
          "DELETE FROM pending_follow_writes WHERE platform = 'kick' AND (channel_id = ? OR slug = ?) AND action = 'unfollow'"
        )
        .run(input.channelId, input.slug);
      changed = changed || pending.changes > 0;
    });
    txn();
    return changed;
  }

  confirmKickFollow(follow: {
    platform: "kick";
    channelId: string;
    channelName: string;
    displayName: string;
    profileImage: string;
  }): LocalFollow {
    let confirmed!: LocalFollow;
    const txn = this.database.transaction(() => {
      confirmed = this.addFollow({ ...follow }, "kick") as LocalFollow;
      this.database
        .prepare(
          "DELETE FROM pending_follow_writes WHERE platform = 'kick' AND (channel_id = ? OR slug = ?) AND action = 'follow'"
        )
        .run(follow.channelId, follow.channelName);
    });
    txn();
    return confirmed;
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
}

export const followRepository = new FollowRepository();

export function importLegacyFollows(
  database: Database.Database,
  legacyFollows: readonly LocalFollow[]
): void {
  const insertLegacyFollow = database.prepare(`
      INSERT OR IGNORE INTO local_follows (
        id, platform, channel_id, channel_name, display_name, profile_image, followed_at, source
      ) VALUES (
        @id, @platform, @channelId, @channelName, @displayName, @profileImage, @followedAt, @source
      )
    `);
  for (const follow of legacyFollows) {
    insertLegacyFollow.run({
      id: follow.id,
      platform: follow.platform,
      channelId: follow.channelId,
      channelName: follow.channelName,
      displayName: follow.displayName,
      profileImage: follow.profileImage,
      followedAt: follow.followedAt,
      source: follow.source,
    });
  }
}
