import { describe, expect, it } from "vitest";

import type {
  ActivityRepository,
  SecureSecretStore,
} from "@mobile/capabilities/persistence";
import {
  markActivityReadSafely,
  markAllActivityReadSafely,
  recordActivitySafely,
} from "@mobile/features/activity/activity-operations";
import { persistenceViewModel } from "@mobile/features/development/persistence-controller";
import { CacheStore } from "@mobile/persistence/cache-store";
import {
  type DatabaseRunResult,
  type DatabaseValue,
  type EncryptedDatabaseDriver,
  SqlCipherUnavailableError,
  type StoreDatabase,
} from "@mobile/persistence/database-contracts";
import {
  applyMigrations,
  productMigrations,
  readSchemaVersion,
} from "@mobile/persistence/migrations";
import { ProductStore } from "@mobile/persistence/product-store";
import { createMobileStoreRuntime } from "@mobile/persistence/store-runtime";

class MigrationDatabase implements StoreDatabase {
  readonly cipherVersion = "SQLCipher 4";
  readonly path = "memory";
  readonly statements: string[] = [];
  private userVersion = 0;

  close(): Promise<void> {
    return Promise.resolve();
  }
  execute(source: string): Promise<void> {
    if (source.includes("THIS IS NOT VALID SQL"))
      return Promise.reject(new Error("invalid SQL"));
    this.statements.push(source);
    const match = /PRAGMA user_version = (\d+)/u.exec(source);
    if (match) this.userVersion = Number(match[1]);
    return Promise.resolve();
  }
  first<T>(source: string): Promise<T | null> {
    if (source === "PRAGMA user_version")
      return Promise.resolve({ user_version: this.userVersion } as T);
    return Promise.resolve(null);
  }
  query<T>(): Promise<T[]> {
    return Promise.resolve([]);
  }
  run(): Promise<DatabaseRunResult> {
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  }
  async transaction(
    operation: (database: StoreDatabase) => Promise<void>,
  ): Promise<void> {
    const version = this.userVersion;
    const count = this.statements.length;
    try {
      await operation(this);
    } catch (error) {
      this.userVersion = version;
      this.statements.splice(count);
      throw error;
    }
  }
}

class CacheRecordingDatabase extends MigrationDatabase {
  readonly runs: {
    readonly parameters: DatabaseValue[];
    readonly source: string;
  }[] = [];
  override run(
    source: string,
    parameters: DatabaseValue[] = [],
  ): Promise<DatabaseRunResult> {
    this.runs.push({ parameters, source });
    return Promise.resolve({ changes: 1, lastInsertRowId: 0 });
  }
}

interface ActivityRow {
  id: string;
  kind: string;
  payload: string;
  occurred_at: number;
  read_at: number | null;
}

class ActivityMemoryDatabase extends MigrationDatabase {
  readonly rows = new Map<string, ActivityRow>();

  override first<T>(
    source: string,
    parameters: DatabaseValue[] = [],
  ): Promise<T | null> {
    if (source.includes("FROM activity_items WHERE id = ?")) {
      return Promise.resolve(
        (this.rows.get(String(parameters[0])) ?? null) as T | null,
      );
    }
    return super.first<T>(source);
  }

  override query<T>(source: string): Promise<T[]> {
    if (!source.includes("FROM activity_items")) return Promise.resolve([]);
    return Promise.resolve(
      [...this.rows.values()].sort(
        (left, right) =>
          right.occurred_at - left.occurred_at ||
          left.id.localeCompare(right.id),
      ) as T[],
    );
  }

  override run(
    source: string,
    parameters: DatabaseValue[] = [],
  ): Promise<DatabaseRunResult> {
    if (source.includes("INSERT INTO activity_items")) {
      const [id, kind, payload, occurredAt, readAt] = parameters;
      this.rows.set(String(id), {
        id: String(id),
        kind: String(kind),
        payload: String(payload),
        occurred_at: Number(occurredAt),
        read_at: readAt === null ? null : Number(readAt),
      });
      return Promise.resolve({ changes: 1, lastInsertRowId: 0 });
    }
    if (source.includes("SET read_at = ? WHERE id = ?")) {
      const row = this.rows.get(String(parameters[1]));
      if (!row || row.read_at !== null)
        return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
      row.read_at = Number(parameters[0]);
      return Promise.resolve({ changes: 1, lastInsertRowId: 0 });
    }
    if (source.includes("SET read_at = ? WHERE read_at IS NULL")) {
      let changes = 0;
      for (const row of this.rows.values()) {
        if (row.read_at !== null) continue;
        row.read_at = Number(parameters[0]);
        changes += 1;
      }
      return Promise.resolve({ changes, lastInsertRowId: 0 });
    }
    if (source.includes("DELETE FROM activity_items")) {
      return Promise.resolve({
        changes: this.rows.delete(String(parameters[0])) ? 1 : 0,
        lastInsertRowId: 0,
      });
    }
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
  }
}

function activityItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    schemaVersion: 1,
    eventId: "device:ready:v1",
    kind: "system",
    event: "device-health",
    source: "local",
    occurredAt: "2026-09-01T00:00:00.000Z" as SerializedTimestamp,
    readAt: null,
    title: "Ready",
    body: "Local device is ready.",
    destination: { kind: "diagnostics" },
    ...overrides,
  } as ActivityItem;
}

function memorySecrets(
  initial: Readonly<Record<string, string>> = {},
): SecureSecretStore & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    delete(key) {
      values.delete(key);
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(values.get(key) ?? null);
    },
    isAvailable() {
      return Promise.resolve(true);
    },
    set(key, value) {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

const random = {
  databaseKey: () => Promise.resolve("a".repeat(64)),
  uuid: () => "proofid",
};

describe("encrypted store policy", () => {
  it("contains rejected Activity mutations for retryable UI state", async () => {
    const unavailable: ActivityRepository = {
      list: () => Promise.resolve([]),
      markAllRead: () => Promise.reject(new Error("unavailable")),
      markRead: () => Promise.reject(new Error("unavailable")),
      record: () => Promise.reject(new Error("unavailable")),
    };
    const timestamp = "2026-09-02T00:00:00.000Z" as SerializedTimestamp;
    await expect(
      markActivityReadSafely(unavailable, "event:1", timestamp),
    ).resolves.toEqual({ kind: "failed" });
    await expect(
      markAllActivityReadSafely(unavailable, timestamp),
    ).resolves.toEqual({ kind: "failed" });
    await expect(
      recordActivitySafely(unavailable, activityItem()),
    ).resolves.toEqual({ kind: "failed" });
  });

  it("deduplicates Activity events, preserves occurrence, and resets unread state", async () => {
    const database = new ActivityMemoryDatabase();
    const store = new ProductStore(database);
    await expect(store.recordActivity(activityItem())).resolves.toMatchObject({
      kind: "created",
    });
    await store.markActivityRead(
      "device:ready:v1",
      "2026-09-02T00:00:00.000Z" as SerializedTimestamp,
    );
    await expect(
      store.recordActivity(
        activityItem({
          occurredAt: "2026-09-03T00:00:00.000Z" as SerializedTimestamp,
          title: "Ready again",
        }),
      ),
    ).resolves.toMatchObject({
      kind: "reconciled",
      item: {
        occurredAt: "2026-09-01T00:00:00.000Z",
        readAt: null,
        title: "Ready again",
      },
    });
    await expect(store.listActivity()).resolves.toHaveLength(1);
  });

  it("skips malformed persisted Activity timestamps without failing the list", async () => {
    const database = new ActivityMemoryDatabase();
    database.rows.set("corrupt", {
      id: "corrupt",
      kind: "system",
      payload: JSON.stringify(activityItem({ eventId: "corrupt" })),
      occurred_at: Number.POSITIVE_INFINITY,
      read_at: 9e20,
    });
    database.rows.set("valid", {
      id: "valid",
      kind: "system",
      payload: JSON.stringify(activityItem({ eventId: "valid" })),
      occurred_at: Date.parse("2026-09-01T00:00:00.000Z"),
      read_at: null,
    });

    await expect(
      new ProductStore(database).listActivity(),
    ).resolves.toMatchObject([{ eventId: "valid" }]);
  });

  it("applies Product migrations transactionally and idempotently", async () => {
    const database = new MigrationDatabase();
    await expect(
      applyMigrations({ database, migrations: productMigrations }),
    ).resolves.toBe(2);
    const statements = database.statements.length;
    await expect(
      applyMigrations({ database, migrations: productMigrations }),
    ).resolves.toBe(2);
    expect(database.statements).toHaveLength(statements);
  });

  it("rolls back a failed migration without advancing user_version", async () => {
    const database = new MigrationDatabase();
    await expect(
      applyMigrations({
        database,
        migrations: [
          {
            version: 1,
            statements: [
              "CREATE TABLE proof (id INTEGER)",
              "THIS IS NOT VALID SQL",
            ],
          },
        ],
      }),
    ).rejects.toThrow("invalid SQL");
    await expect(readSchemaVersion(database)).resolves.toBe(0);
    expect(database.statements).toEqual([]);
  });

  it("rejects a database newer than the supported schema", async () => {
    const database = new MigrationDatabase();
    await database.execute("PRAGMA user_version = 3");
    await expect(
      applyMigrations({ database, migrations: productMigrations }),
    ).rejects.toThrow("newer than supported");
  });

  it("deletes expired cache entries before applying the LRU budget", async () => {
    const database = new CacheRecordingDatabase();
    const cache = new CacheStore(database, {
      maximumBytes: 10,
      now: () => 100,
    });
    await cache.put({ key: "proof", payload: "payload" });
    expect(database.runs[1]?.source).toContain("expires_at <=");
    expect(database.runs[2]?.source).toContain("retained_bytes >");
  });

  it("preserves an existing Product database when its SecureStore key is missing", async () => {
    const driver: EncryptedDatabaseDriver = {
      backup: async () => undefined,
      containsBytes: async () => false,
      corrupt: async () => undefined,
      delete: async () => undefined,
      deleteQuarantines: async () => undefined,
      exists: (name) => name.endsWith("product.db"),
      open: async () => {
        throw new Error("must not open");
      },
      quarantine: async () => "artifact",
      restore: async () => undefined,
    };
    const state = await createMobileStoreRuntime({
      backupExcluded: true,
      databaseDriver: driver,
      random,
      secretStore: memorySecrets(),
    }).initialize();
    expect(state).toMatchObject({
      kind: "recovery-required",
      reason: "product-key-missing",
    });
  });

  it("fails closed and removes new keys when SQLCipher is unavailable", async () => {
    const deleted: string[] = [];
    const secrets = memorySecrets();
    const driver: EncryptedDatabaseDriver = {
      backup: async () => undefined,
      containsBytes: async () => false,
      corrupt: async () => undefined,
      delete: async (name) => {
        deleted.push(name);
      },
      deleteQuarantines: async () => undefined,
      exists: () => false,
      open: async () => {
        throw new SqlCipherUnavailableError();
      },
      quarantine: async () => "artifact",
      restore: async () => undefined,
    };
    const state = await createMobileStoreRuntime({
      backupExcluded: true,
      databaseDriver: driver,
      random,
      secretStore: secrets,
    }).initialize();
    expect(state).toMatchObject({
      kind: "unavailable",
      reason: "sqlcipher-unavailable",
    });
    expect(secrets.values.size).toBe(0);
    expect(deleted.some((name) => name.endsWith("product.db"))).toBe(true);
  });

  it("shows native proof results only from a ready runtime", () => {
    const allPassed = {
      backupExcluded: true,
      cacheEviction: true,
      cacheIsolation: true,
      encryptedAtRest: true,
      migrationRecovery: true,
      offlineRead: true,
      secureStore: true,
      wrongKeyRejected: true,
    };
    const ready = persistenceViewModel(
      {
        kind: "ready",
        cacheSchemaVersion: 1,
        cipherVersion: "SQLCipher 4.6.1",
        productSchemaVersion: 2,
        recoveredProductStore: false,
      },
      allPassed,
      false,
    );
    expect(ready.proofDetail).toBe("8/8 native storage checks passed.");
    expect(ready.canRunProof).toBe(true);
  });

  it("surfaces proof failure after cleanup without disabling retry", () => {
    const ready = persistenceViewModel(
      {
        kind: "ready",
        cacheSchemaVersion: 1,
        cipherVersion: "SQLCipher 4.6.1",
        productSchemaVersion: 2,
        recoveredProductStore: false,
      },
      null,
      false,
      true,
    );
    expect(ready.proofDetail).toContain("Temporary proof data was removed");
    expect(ready.canRunProof).toBe(true);
  });

  it("never exposes proof actions in recovery-required state", () => {
    const model = persistenceViewModel(
      {
        kind: "recovery-required",
        reason: "product-store-unrecoverable",
        artifact: "file:///recovery/product.db",
        message: "Export before reset.",
      },
      null,
      false,
    );
    expect(model.canRunProof).toBe(false);
    expect(model.proofDetail).toContain("file:///recovery/product.db");
  });
});
