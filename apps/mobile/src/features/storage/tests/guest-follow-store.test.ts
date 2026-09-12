import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  parseGuestFollowWrite,
} from "@streamfusion/core/follows";

import type {
  DatabaseRunResult,
  DatabaseValue,
  StoreDatabase,
} from "@mobile/features/storage/data/database-contracts";
import { GuestFollowStore } from "@mobile/features/storage/data/guest-follow-store";
import { LiveNotificationStore } from "@mobile/features/storage/data/live-notification-store";
import {
  applyMigrations,
  productMigrations,
} from "@mobile/features/storage/data/migrations";

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

async function openedStores() {
  const database = new SqliteTestDatabase();
  await applyMigrations({ database, migrations: productMigrations });
  return {
    database,
    follows: new GuestFollowStore(database),
    notifications: new LiveNotificationStore(database),
  };
}

const firstFollowedAt = "2026-09-10T00:00:00.000Z";

function followWrite(overrides: Record<string, unknown> = {}) {
  return {
    platform: "twitch",
    channelId: "71092938",
    channelLogin: "pokimane",
    displayName: "Pokimane",
    followedAt: firstFollowedAt,
    ...overrides,
  };
}

describe("guest follow product store", () => {
  it("upserts Guest Follows idempotently and keeps the original followedAt", async () => {
    const { follows } = await openedStores();
    const created = await follows.upsert(followWrite());
    const updated = await follows.upsert(
      followWrite({
        channelLogin: "PokiMane",
        displayName: "Poki",
        followedAt: "2026-09-12T00:00:00.000Z",
      }),
    );
    expect(created).toEqual(parseGuestFollowWrite(followWrite()));
    expect(updated).toEqual(
      parseGuestFollowWrite(
        followWrite({ displayName: "Poki", followedAt: firstFollowedAt }),
      ),
    );
    await follows.upsert(
      followWrite({
        platform: "kick",
        channelId: "411439",
        channelLogin: "xqc",
        displayName: "xQc",
      }),
    );
    expect((await follows.list()).map((item) => item.channelLogin)).toEqual([
      "xqc",
      "pokimane",
    ]);
  });

  it("removes Guest Follows idempotently and rejects invalid writes", async () => {
    const { follows } = await openedStores();
    await follows.upsert(followWrite());
    await follows.remove({ platform: "twitch", channelId: "71092938" });
    await follows.remove({ platform: "twitch", channelId: "71092938" });
    expect(await follows.list()).toEqual([]);
    await expect(
      follows.upsert(followWrite({ avatarUrl: "https://example" })),
    ).rejects.toThrow(/invalid/i);
  });

  it("persists live-notification preferences including Guest Follow eligibility", async () => {
    const { database, notifications } = await openedStores();
    expect(await notifications.read()).toEqual(
      DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
    );
    await notifications.write({
      guestFollows: false,
      perChannelNotifications: { "twitch:71092938": false },
    });
    const reopened = new LiveNotificationStore(database);
    await expect(reopened.read()).resolves.toMatchObject({
      guestFollows: false,
      liveAlerts: true,
      perChannelNotifications: { "twitch:71092938": false },
    });
    await expect(notifications.write("{not-json")).rejects.toThrow(/invalid/i);
  });
});
