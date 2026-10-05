import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type {
  StoreDatabase,
  DatabaseValue,
  DatabaseRunResult,
} from "@mobile/features/storage/data/database-contracts";
import {
  applyMigrations,
  productMigrations,
} from "@mobile/features/storage/data/migrations";
import {
  createQueuedMediaJobSnapshot,
  asMediaJobId,
} from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import { createProductMediaJobStore } from "../data/product-media-jobs-store";
import { mediaJobDisplay } from "../utils/media-display";
import { filterMediaJobs } from "../domain/media-library-filter";
import {
  measuredTransferRate,
  transferRemainingSeconds,
} from "../domain/transfer-observation";
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

const legacy = createQueuedMediaJobSnapshot({
  schemaVersion: 1,
  jobId: asMediaJobId("dl-old"),
  kind: "download",
  sourceUri: "https://example.test/old.mp4",
  createdAt: toSerializedTimestamp("2026-10-05T00:00:00.000Z"),
});
const display = {
  title: "A recorded broadcast",
  channelName: "Real channel",
  platform: "twitch",
  contentKind: "video",
  sourceIdentity: "twitch:video:123",
  thumbnailUrl: "https://example.test/image.jpg",
} as const;
describe("media display persistence", () => {
  it("reads legacy snapshots and roundtrips display metadata without widening the core snapshot schema", async () => {
    const database = new SqliteTestDatabase();
    try {
      await applyMigrations({ database, migrations: productMigrations });
      await database.run(
        "INSERT INTO media_jobs (id, kind, state, checkpoint, updated_at) VALUES (?, ?, ?, ?, ?)",
        [legacy.intent.jobId, "download", JSON.stringify(legacy), null, 1],
      );
      const store = createProductMediaJobStore(database);
      expect(await store.get("dl-old")).toEqual(legacy);
      const withDisplay = { ...legacy, intent: { ...legacy.intent, display } };
      await store.put(withDisplay);
      const restored = await createProductMediaJobStore(database).get("dl-old");
      expect(restored).toEqual(withDisplay);
      expect(restored && mediaJobDisplay(restored)).toEqual(display);
      expect(filterMediaJobs([withDisplay], "real channel", "video")).toEqual([
        withDisplay,
      ]);
      expect(filterMediaJobs([withDisplay], "no match", "all")).toEqual([]);
      expect(filterMediaJobs([withDisplay], "", "clip")).toEqual([]);
      await store.put({ ...withDisplay, phase: "running" });
      expect(mediaJobDisplay((await store.list())[0]!)).toEqual(display);
    } finally {
      await database.close();
    }
  });
  it("measures only monotonic checkpoints from the same native generation", () => {
    expect(
      measuredTransferRate(
        { generation: 1, bytes: 100, measuredAt: 1000 },
        { generation: 1, bytes: 2100, measuredAt: 3000 },
      ),
    ).toBe(1000);
    expect(
      measuredTransferRate(
        { generation: 1, bytes: 100, measuredAt: 1000 },
        { generation: 2, bytes: 2100, measuredAt: 3000 },
      ),
    ).toBeNull();
    expect(
      measuredTransferRate(
        { generation: 1, bytes: 100, measuredAt: 1000 },
        { generation: 1, bytes: 90, measuredAt: 3000 },
      ),
    ).toBeNull();
    expect(
      transferRemainingSeconds(
        {
          ...legacy,
          phase: "running",
          progress: { transferredBytes: 100, totalBytes: 1100, durationMs: 0 },
        },
        100,
      ),
    ).toBe(10);
    expect(transferRemainingSeconds(legacy, 100)).toBeNull();
  });
});
