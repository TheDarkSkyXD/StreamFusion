import type { StoreDatabase } from "./database-contracts";

export interface StoreMigration {
  readonly statements: readonly string[];
  readonly version: number;
}

export const productMigrations: readonly StoreMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS guest_follows (
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_login TEXT NOT NULL,
        display_name TEXT NOT NULL,
        followed_at INTEGER NOT NULL,
        PRIMARY KEY (platform, channel_id)
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS history_items (
        id TEXT PRIMARY KEY NOT NULL,
        platform TEXT NOT NULL,
        content_kind TEXT NOT NULL,
        content_id TEXT NOT NULL,
        title TEXT NOT NULL,
        position_seconds INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS activity_items (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        read_at INTEGER
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS capability_policies (
        id TEXT PRIMARY KEY NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS media_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        checkpoint TEXT,
        updated_at INTEGER NOT NULL
      ) STRICT`,
    ],
  },
];

export const cacheMigrations: readonly StoreMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS remote_cache (
        key TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT`,
      "CREATE INDEX IF NOT EXISTS remote_cache_lru ON remote_cache(last_accessed_at, key)",
    ],
  },
];

export async function readSchemaVersion(
  database: StoreDatabase,
): Promise<number> {
  const row = await database.first<{ readonly user_version: number }>(
    "PRAGMA user_version",
  );
  return row?.user_version ?? 0;
}

export async function applyMigrations(options: {
  readonly database: StoreDatabase;
  readonly migrations: readonly StoreMigration[];
}): Promise<number> {
  const currentVersion = await readSchemaVersion(options.database);
  const targetVersion = options.migrations.at(-1)?.version ?? 0;
  if (currentVersion > targetVersion) {
    throw new Error(
      `Database schema ${currentVersion} is newer than supported schema ${targetVersion}.`,
    );
  }
  const pending = options.migrations.filter(
    (migration) => migration.version > currentVersion,
  );
  if (pending.length === 0) {
    return currentVersion;
  }
  await options.database.transaction(async (transaction) => {
    for (const migration of pending) {
      for (const statement of migration.statements) {
        await transaction.execute(statement);
      }
      await transaction.execute(`PRAGMA user_version = ${migration.version}`);
    }
  });
  return targetVersion;
}
