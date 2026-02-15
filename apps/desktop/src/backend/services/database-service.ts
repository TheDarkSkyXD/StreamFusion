import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { app } from "electron";

export type FollowSource = "guest" | "account";

export class DatabaseService {
  private db: Database.Database | null = null;

  constructor() {
    // Lazy initialization - call initialize() after app setup
  }

  initialize() {
    if (this.db) return; // Already initialized

    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "streamstorm.db");

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
      this.database.exec(`ALTER TABLE local_follows ADD COLUMN source TEXT NOT NULL DEFAULT 'guest'`);
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
    const stmt = this.database.prepare("INSERT OR REPLACE INTO key_value (key, value) VALUES (?, ?)");
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

    // Ensure ID exists — include source to avoid collisions
    if (!follow.id) {
      follow.id = `${follow.platform}-${source}-${follow.channelId}-${Date.now()}`;
    }
    if (!follow.followedAt) {
      follow.followedAt = new Date().toISOString();
    }

    stmt.run({
      id: follow.id,
      platform: follow.platform,
      channelId: follow.channelId,
      channelName: follow.channelName || follow.username,
      displayName: follow.displayName,
      profileImage: follow.profileImage || follow.avatarUrl,
      followedAt: follow.followedAt,
      source,
    });

    return { ...follow, source };
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
    const stmt = this.database.prepare("DELETE FROM local_follows WHERE platform = ? AND source = ?");
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
}

export const dbService = new DatabaseService();
