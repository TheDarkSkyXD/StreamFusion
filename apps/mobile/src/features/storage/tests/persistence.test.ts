import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import type {
  ActivityRepository,
  SecureSecretStore,
} from "@mobile/features/storage/capabilities/persistence";
import {
  markActivityReadSafely,
  markAllActivityReadSafely,
  recordActivitySafely,
} from "@mobile/features/activity/domain/activity-operations";
import { persistenceViewModel } from "@mobile/features/diagnostics/components/persistence-controller";
import { CacheStore } from "@mobile/features/storage/data/cache-store";
import {
  type DatabaseRunResult,
  type DatabaseValue,
  type EncryptedDatabaseDriver,
  SqlCipherUnavailableError,
  type StoreDatabase,
} from "@mobile/features/storage/data/database-contracts";
import {
  applyMigrations,
  productMigrations,
  readSchemaVersion,
} from "@mobile/features/storage/data/migrations";
import { ProductStore } from "@mobile/features/storage/data/product-store";
import {
  cleanupMobileStoreNamespace,
  createMobileStoreRuntime,
} from "@mobile/features/storage/composition/store-runtime";

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

class CloseRecordingDatabase extends MigrationDatabase {
  closeCalls = 0;
  failNextClose = false;

  override close(): Promise<void> {
    this.closeCalls += 1;
    if (this.failNextClose) {
      this.failNextClose = false;
      return Promise.reject(new Error("close failed"));
    }
    return Promise.resolve();
  }

  override query<T>(source: string): Promise<T[]> {
    if (source === "PRAGMA quick_check")
      return Promise.resolve([{ quick_check: "ok" } as T]);
    return super.query<T>(source);
  }
}

interface ActivityRow {
  dismissed_at: number | null;
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
      const [id, kind, payload, occurredAt, readAt, dismissedAt] = parameters;
      this.rows.set(String(id), {
        id: String(id),
        kind: String(kind),
        payload: String(payload),
        occurred_at: Number(occurredAt),
        read_at: readAt === null ? null : Number(readAt),
        dismissed_at: dismissedAt === null ? null : Number(dismissedAt),
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
    if (source.includes("SET dismissed_at = ? WHERE id = ?")) {
      const row = this.rows.get(String(parameters[1]));
      if (!row || row.dismissed_at !== null)
        return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
      row.dismissed_at = Number(parameters[0]);
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

class SqliteTestDatabase implements StoreDatabase {
  readonly cipherVersion = "SQLite test adapter";
  readonly path = ":memory:";
  private readonly database = new DatabaseSync(":memory:");

  close(): Promise<void> {
    this.database.close();
    return Promise.resolve();
  }

  execute(source: string): Promise<void> {
    this.database.exec(source);
    return Promise.resolve();
  }

  first<T>(source: string, parameters: DatabaseValue[] = []): Promise<T | null> {
    const row = this.database.prepare(source).get(...parameters);
    return Promise.resolve(row === undefined ? null : (row as T));
  }

  query<T>(source: string, parameters: DatabaseValue[] = []): Promise<T[]> {
    return Promise.resolve(this.database.prepare(source).all(...parameters) as T[]);
  }

  run(
    source: string,
    parameters: DatabaseValue[] = [],
  ): Promise<DatabaseRunResult> {
    const result = this.database.prepare(source).run(...parameters);
    return Promise.resolve({
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    });
  }

  async transaction(
    operation: (database: StoreDatabase) => Promise<void>,
  ): Promise<void> {
    this.database.exec("BEGIN");
    try {
      await operation(this);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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

function jobActivityItem(options: {
  readonly eventId: string;
  readonly state: "active" | "terminal";
}): ActivityItem {
  return {
    body: "A media job changed.",
    destination: { jobId: "job:1", kind: "media-job" },
    eventId: options.eventId,
    job: { id: "job:1", state: { kind: options.state } },
    kind: "job",
    occurredAt: "2026-09-01T00:00:00.000Z" as SerializedTimestamp,
    readAt: null,
    schemaVersion: 1,
    source: "local",
    title: "Media job",
  };
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
  it("rejects every non-proof cleanup namespace before a driver deletion", async () => {
    const deleted: string[] = [];
    const databaseDriver: EncryptedDatabaseDriver = {
      backup: async () => undefined,
      containsBytes: async () => false,
      corrupt: async () => undefined,
      delete: async (name) => void deleted.push(name),
      deleteQuarantines: async (name) => void deleted.push(name),
      exists: () => false,
      open: async () => new MigrationDatabase(),
      quarantine: async () => "artifact",
      restore: async () => undefined,
    };
    const secrets = memorySecrets();

    for (const namespace of ["main", "activity-proof-not-a-uuid", "other-proof-11111111-1111-4111-8111-111111111111"]) {
      await expect(
        cleanupMobileStoreNamespace({
          databaseDriver,
          namespace,
          secretStore: secrets,
        }),
      ).rejects.toThrow("exact Activity proof namespace");
    }

    expect(deleted).toEqual([]);
  });

  it("retries only a failed native store close and never returns a closing Product Store", async () => {
    const product = new CloseRecordingDatabase();
    const cache = new CloseRecordingDatabase();
    product.failNextClose = true;
    const runtime = createMobileStoreRuntime({
      backupExcluded: true,
      databaseDriver: {
        backup: async () => undefined,
        containsBytes: async () => false,
        corrupt: async () => undefined,
        delete: async () => undefined,
        deleteQuarantines: async () => undefined,
        exists: () => false,
        open: async (name) => name.includes("cache") ? cache : product,
        quarantine: async () => "artifact",
        restore: async () => undefined,
      },
      random,
      secretStore: memorySecrets(),
    });
    await expect(runtime.initialize()).resolves.toMatchObject({ kind: "ready" });

    await expect(runtime.close()).rejects.toThrow("close failed");
    await expect(runtime.productState.activity.list()).rejects.toThrow("closing");
    await expect(runtime.close()).resolves.toBeUndefined();
    await expect(runtime.initialize()).rejects.toThrow("closed");

    expect(product.closeCalls).toBe(2);
    expect(cache.closeCalls).toBe(1);
  });

  it("contains rejected Activity mutations for retryable UI state", async () => {
    const unavailable: ActivityRepository = {
      dismissCompleted: () => Promise.reject(new Error("unavailable")),
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

  it("deduplicates read Activity events without resetting persisted read state", async () => {
    const database = new ActivityMemoryDatabase();
    const store = new ProductStore(database);
    const readAt = "2026-09-02T00:00:00.000Z" as SerializedTimestamp;
    await expect(store.recordActivity(activityItem())).resolves.toMatchObject({
      kind: "created",
    });
    await store.markActivityRead("device:ready:v1", readAt);
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
        readAt,
        title: "Ready again",
      },
    });
    const reopened = new ProductStore(database);
    await expect(reopened.listActivity()).resolves.toEqual([
      expect.objectContaining({
        eventId: "device:ready:v1",
        occurredAt: "2026-09-01T00:00:00.000Z",
        readAt,
        title: "Ready again",
      }),
    ]);
    await expect(
      reopened.recordActivity(
        activityItem({
          eventId: "device:new:v1",
          occurredAt: "2026-09-04T00:00:00.000Z" as SerializedTimestamp,
          title: "New event",
        }),
      ),
    ).resolves.toMatchObject({ kind: "created" });
    await expect(reopened.listActivity()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: "device:ready:v1", readAt }),
        expect.objectContaining({ eventId: "device:new:v1", readAt: null }),
      ]),
    );
  });

  it("keeps local dismissal across duplicate delivery and hides only completed Activity", async () => {
    const database = new ActivityMemoryDatabase();
    const store = new ProductStore(database);
    const readAt = "2026-09-02T00:00:00.000Z" as SerializedTimestamp;
    const dismissedAt = "2026-09-03T00:00:00.000Z" as SerializedTimestamp;
    await store.recordActivity(activityItem());
    await store.markActivityRead("device:ready:v1", readAt);
    await expect(
      store.dismissCompletedActivity(["device:ready:v1"], dismissedAt),
    ).resolves.toMatchObject({ dismissedEventIds: ["device:ready:v1"] });
    await expect(store.listActivity()).resolves.toEqual([]);

    await store.recordActivity(
      activityItem({ title: "Reconciled without restoring visibility" }),
    );
    await expect(new ProductStore(database).listActivity()).resolves.toEqual(
      [],
    );
    expect(database.rows.get("device:ready:v1")).toMatchObject({
      dismissed_at: Date.parse(dismissedAt),
      read_at: Date.parse(readAt),
    });
  });

  it("keeps active jobs visible and clears an earlier local dismissal on reactivation", async () => {
    const database = new ActivityMemoryDatabase();
    const store = new ProductStore(database);
    const dismissedAt = "2026-09-03T00:00:00.000Z" as SerializedTimestamp;
    const readAt = "2026-09-02T00:00:00.000Z" as SerializedTimestamp;
    await store.recordActivity(
      jobActivityItem({ eventId: "job:event", state: "terminal" }),
    );
    await store.markActivityRead("job:event", readAt);
    await store.dismissCompletedActivity(["job:event"], dismissedAt);
    await expect(store.listActivity()).resolves.toEqual([]);

    await store.recordActivity(
      jobActivityItem({ eventId: "job:event", state: "active" }),
    );
    const visible = await store.listActivity();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.eventId).toBe("job:event");
    expect(visible[0]?.kind).toBe("job");
    if (visible[0]?.kind === "job") {
      expect(visible[0].job.state.kind).toBe("active");
      expect(visible[0].readAt).toBe(readAt);
    }
    expect(database.rows.get("job:event")?.dismissed_at).toBeNull();
  });

  it("skips malformed persisted Activity timestamps without failing the list", async () => {
    const database = new ActivityMemoryDatabase();
    database.rows.set("corrupt", {
      dismissed_at: null,
      id: "corrupt",
      kind: "system",
      payload: JSON.stringify(activityItem({ eventId: "corrupt" })),
      occurred_at: Number.POSITIVE_INFINITY,
      read_at: 9e20,
    });
    database.rows.set("valid", {
      dismissed_at: null,
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
    ).resolves.toBe(3);
    const statements = database.statements.length;
    await expect(
      applyMigrations({ database, migrations: productMigrations }),
    ).resolves.toBe(3);
    expect(database.statements).toHaveLength(statements);
  });

  it("adds visible local dismissal metadata from the oldest supported Product schema", async () => {
    const database = new MigrationDatabase();
    await expect(
      applyMigrations({ database, migrations: productMigrations.slice(0, 1) }),
    ).resolves.toBe(1);
    await expect(
      applyMigrations({ database, migrations: productMigrations }),
    ).resolves.toBe(3);
    expect(database.statements).toContain(
      "ALTER TABLE activity_items ADD COLUMN dismissed_at INTEGER",
    );
  });

  it("migrates and dismisses a real SQLite Product row without changing duplicate identity", async () => {
    const database = new SqliteTestDatabase();
    const dismissedAt = "2026-09-03T00:00:00.000Z" as SerializedTimestamp;
    try {
      await applyMigrations({
        database,
        migrations: productMigrations.slice(0, 2),
      });
      const original = activityItem();
      await database.run(
        `INSERT INTO activity_items (id, kind, payload, occurred_at, read_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          original.eventId,
          original.kind,
          JSON.stringify(original),
          Date.parse(original.occurredAt),
          null,
        ],
      );
      await applyMigrations({ database, migrations: productMigrations });
      const store = new ProductStore(database);
      await expect(store.listActivity()).resolves.toMatchObject([
        { eventId: original.eventId, readAt: null },
      ]);
      await expect(
        store.dismissCompletedActivity([original.eventId], dismissedAt),
      ).resolves.toMatchObject({ dismissedEventIds: [original.eventId] });
      await store.recordActivity(
        activityItem({ title: "Duplicate stays dismissed" }),
      );
      await expect(store.listActivity()).resolves.toEqual([]);
      await expect(
        database.first<{ readonly dismissed_at: number | null }>(
          "SELECT dismissed_at FROM activity_items WHERE id = ?",
          [original.eventId],
        ),
      ).resolves.toEqual({ dismissed_at: Date.parse(dismissedAt) });
    } finally {
      await database.close();
    }
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
    await database.execute("PRAGMA user_version = 4");
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

  it("returns a sanitized startup diagnostic when opening the Product Store rejects", async () => {
    const driver: EncryptedDatabaseDriver = {
      backup: async () => undefined,
      containsBytes: async () => false,
      corrupt: async () => undefined,
      delete: async () => undefined,
      deleteQuarantines: async () => undefined,
      exists: () => false,
      open: async () => {
        throw new Error("raw storage error must not reach presentation");
      },
      quarantine: async () => "artifact",
      restore: async () => undefined,
    };
    await expect(
      createMobileStoreRuntime({
        backupExcluded: true,
        databaseDriver: driver,
        random,
        secretStore: memorySecrets(),
      }).initialize(),
    ).resolves.toMatchObject({
      kind: "unavailable",
      reason: "storage-initialization-failed",
      diagnostic: {
        category: "storage-startup",
        cause: "product-open",
      },
    });
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
        productSchemaVersion: 3,
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
        productSchemaVersion: 3,
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
