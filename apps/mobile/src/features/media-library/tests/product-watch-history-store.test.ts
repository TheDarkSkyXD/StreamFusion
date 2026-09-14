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

import { createProductWatchHistoryStore } from "../data/product-watch-history-store";
import type { WatchHistoryItem } from "../capabilities/watch-history";

// Guards: History survives schema v4 and stays readable without a network
// Guards: upsert replaces the same typed identity instead of duplicating it
// Guards: process-death reopen of the Product file keeps typed History rows

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

const item: WatchHistoryItem = {
  avatarUrl: "https://example.test/avatar.png",
  channelDisplayName: "xQc",
  channelId: "71092938",
  channelLogin: "xqc",
  contentId: "vod-1",
  durationSeconds: 120,
  id: "twitch-video-vod-1",
  kind: "video",
  platform: "twitch",
  positionSeconds: 12,
  thumbnailUrl: "https://example.test/vod.png",
  title: "Yesterday",
  updatedAt: 100,
};

describe("product watch history store", () => {
  it("migrates v1 history rows and upserts progress on the same identity", async () => {
    const database = new SqliteTestDatabase();
    await applyMigrations({
      database,
      migrations: productMigrations.slice(0, 1),
    });
    await database.run(
      `INSERT INTO history_items (id, platform, content_kind, content_id, title, position_seconds, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.platform, item.kind, item.contentId, "Old", 1, 1],
    );
    await applyMigrations({ database, migrations: productMigrations });
    const store = createProductWatchHistoryStore(database);
    await store.upsert(item);
    await expect(store.list()).resolves.toEqual([item]);
    await store.remove(item.id);
    await expect(store.list()).resolves.toEqual([]);
  });

  it("keeps typed History after a process-death reopen of the same Product file", async () => {
    const directory = mkdtempSync("watch-history-");
    const filePath = `${directory}/product.sqlite`;
    const first = new SqliteTestDatabase(filePath);
    try {
      await applyMigrations({ database: first, migrations: productMigrations });
      await createProductWatchHistoryStore(first).upsert(item);
      await first.close();
      const second = new SqliteTestDatabase(filePath);
      try {
        await applyMigrations({
          database: second,
          migrations: productMigrations,
        });
        await expect(createProductWatchHistoryStore(second).list()).resolves.toEqual(
          [item],
        );
      } finally {
        await second.close();
      }
    } finally {
      await first.close().catch(() => undefined);
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
