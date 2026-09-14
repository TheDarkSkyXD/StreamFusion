import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type {
  DatabaseRunResult,
  DatabaseValue,
  StoreDatabase,
} from "@mobile/features/storage/data/database-contracts";
import {
  applyMigrations,
  productMigrations,
} from "@mobile/features/storage/data/migrations";

import { emptyMultistreamLayout } from "../capabilities/multistream";
import { createProductMultistreamStore } from "../data/product-multistream-store";
import { addMultistreamSlot, slotFromWatchTarget } from "../domain/multistream-layout";

// Guards: Multistream layout survives schema v5 without a network
// Guards: process-death reopen of the Product file restores configured slots

class SqliteTestDatabase implements StoreDatabase {
  readonly cipherVersion = "SQLite test adapter";
  readonly path: string;
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(filePath = ":memory:") {
    this.path = filePath;
    this.database = new DatabaseSync(filePath);
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
    return Promise.resolve();
  }

  execute(source: string): Promise<void> {
    this.database.exec(source);
    return Promise.resolve();
  }

  first<T>(
    source: string,
    parameters: DatabaseValue[] = [],
  ): Promise<T | null> {
    const row = this.database.prepare(source).get(...parameters);
    return Promise.resolve(row === undefined ? null : (row as T));
  }

  query<T>(source: string, parameters: DatabaseValue[] = []): Promise<T[]> {
    return Promise.resolve(
      this.database.prepare(source).all(...parameters) as T[],
    );
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

const twitch = slotFromWatchTarget({
  channelId: "71092938",
  channelName: "xqc",
  platform: "twitch",
});

describe("product multistream store", () => {
  it("writes and reads a six-slot-safe layout after schema v5", async () => {
    const database = new SqliteTestDatabase();
    await applyMigrations({ database, migrations: productMigrations });
    const store = createProductMultistreamStore(database);
    await expect(store.read()).resolves.toBeNull();
    const added = addMultistreamSlot(emptyMultistreamLayout(), twitch, 12);
    expect(added.kind).toBe("applied");
    if (added.kind !== "applied") return;
    await store.write(added.layout);
    await expect(store.read()).resolves.toEqual(added.layout);
  });

  it("keeps configured slots after a process-death reopen of the same Product file", async () => {
    const directory = mkdtempSync("multistream-layout-");
    const filePath = `${directory}/product.sqlite`;
    const first = new SqliteTestDatabase(filePath);
    try {
      await applyMigrations({ database: first, migrations: productMigrations });
      const added = addMultistreamSlot(emptyMultistreamLayout(), twitch, 20);
      expect(added.kind).toBe("applied");
      if (added.kind !== "applied") return;
      await createProductMultistreamStore(first).write(added.layout);
      await first.close();
      const second = new SqliteTestDatabase(filePath);
      try {
        await applyMigrations({
          database: second,
          migrations: productMigrations,
        });
        await expect(
          createProductMultistreamStore(second).read(),
        ).resolves.toEqual(added.layout);
      } finally {
        await second.close();
      }
    } finally {
      await first.close().catch(() => undefined);
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
