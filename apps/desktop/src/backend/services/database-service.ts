import Database from "better-sqlite3";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { initializeFollowSchema } from "../features/authentication/data/follow-repository";

import { logger } from "@shared/utils/cross-logger";

export type JsonReadResult =
  { kind: "missing" } | { kind: "invalid" } | { kind: "value"; value: unknown };

export interface KeyValueMigrationEntry {
  key: string;
  value: unknown;
}
export interface KeyValueMigration {
  entries: readonly KeyValueMigrationEntry[];
  deleteKeys: readonly string[];
}

export class DatabaseService {
  private db: Database.Database | null = null;

  initialize(): void {
    if (this.db) return; // Already initialized

    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "streamfusion.db");

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    logger.debug("Service:DB", "Initializing SQLite database", { dbPath });

    const existedBeforeStartup = fs.existsSync(dbPath);
    let backupPath: string | null = null;
    try {
      this.db = new Database(dbPath);
      this.errCheck();
      this.assertIntegrity();

      if (existedBeforeStartup) {
        // Flush WAL pages before making the recovery copy. Never overwrite the
        // backup with a database that failed the integrity check above.
        this.database.pragma("wal_checkpoint(FULL)");
        const candidateBackupPath = `${dbPath}.pre-migration.bak`;
        try {
          fs.copyFileSync(dbPath, candidateBackupPath);
          backupPath = candidateBackupPath;
        } catch (error) {
          // The schema transaction below is still atomic. A locked or
          // unwritable backup target should reduce recovery options, not turn
          // an otherwise healthy database into a startup outage.
          logger.warn("Service:DB", "Could not create pre-migration backup", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Schema changes are one unit: a failed migration rolls back instead of
      // leaving half-created tables that break every later launch.
      this.database.transaction(() => this.init())();
      this.assertIntegrity();
    } catch (error) {
      try {
        this.db?.close();
      } catch {
        // Keep the original initialization failure as the actionable cause.
      }
      this.db = null;
      logger.error("Service:DB", "Database initialization failed", {
        error: error instanceof Error ? error.message : String(error),
        backupPath,
      });
      throw error;
    }
  }

  private get database(): Database.Database {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
    return this.db;
  }

  /** Shared SQLite connection for feature-owned repositories. */
  getConnection(): Database.Database {
    return this.database;
  }

  private errCheck() {
    // Enable WAL mode for better concurrency/performance
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = NORMAL");
  }

  private assertIntegrity(): void {
    const rows = this.database.pragma("quick_check") as Array<Record<string, unknown>>;
    const results = rows.flatMap((row) => Object.values(row));
    if (results.length === 0 || results.some((value) => value !== "ok")) {
      throw new Error("SQLite integrity check failed");
    }
  }

  private init() {
    // 1. Key-Value Store
    this.database.exec(`
            CREATE TABLE IF NOT EXISTS key_value (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

    initializeFollowSchema(this.database);
    logger.debug("Service:DB", "SQLite Schema initialized");
  }

  // ========== Key-Value Operations ==========

  getJson(key: string): JsonReadResult {
    const stmt = this.database.prepare("SELECT value FROM key_value WHERE key = ?");
    const row = stmt.get(key) as { value: string } | undefined;
    if (!row) return { kind: "missing" };
    try {
      return { kind: "value", value: JSON.parse(row.value) };
    } catch {
      return { kind: "invalid" };
    }
  }

  get<T>(key: string, parse: (value: unknown) => T | null): T | null {
    const result = this.getJson(key);
    return result.kind === "value" ? parse(result.value) : null;
  }

  set(key: string, value: unknown): void {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("SQLite key-value data must be JSON serializable");
    }
    const stmt = this.database.prepare(
      "INSERT OR REPLACE INTO key_value (key, value) VALUES (?, ?)"
    );
    stmt.run(key, serialized);
  }

  migrateKeyValues({ entries, deleteKeys }: KeyValueMigration, migrateRelated?: () => void): void {
    const serializedEntries = entries.map(({ key, value }) => {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new TypeError("SQLite key-value data must be JSON serializable");
      }
      return { key, serialized };
    });
    const insert = this.database.prepare(
      "INSERT OR IGNORE INTO key_value (key, value) VALUES (?, ?)"
    );
    const remove = this.database.prepare("DELETE FROM key_value WHERE key = ?");
    this.database.transaction(() => {
      for (const { key, serialized } of serializedEntries) insert.run(key, serialized);
      for (const key of deleteKeys) remove.run(key);
      migrateRelated?.();
    })();
  }

  delete(key: string): void {
    const stmt = this.database.prepare("DELETE FROM key_value WHERE key = ?");
    stmt.run(key);
  }

  clearKeyValue(): void {
    this.database.exec("DELETE FROM key_value");
  }

  // ========== Local Follows Operations ==========
}

export const dbService = new DatabaseService();
