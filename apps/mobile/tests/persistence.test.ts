import { describe, expect, it } from "vitest";

import type { SecureSecretStore } from "@mobile/capabilities/persistence";
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
