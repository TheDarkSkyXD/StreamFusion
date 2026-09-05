import {
  activityItemSchema,
  markActivityItemRead,
  reconcileActivityItem,
  selectRetainedActivityEventIds,
  toSerializedTimestamp,
  type ActivityItem,
  type SerializedTimestamp,
} from "@streamfusion/core/activity";

import type {
  ActivityFilter,
  ActivityWriteResult,
} from "@mobile/capabilities/persistence";

import type { StoreDatabase } from "./database-contracts";

export interface ProductSetting {
  readonly key: string;
  readonly updatedAt: number;
  readonly value: string;
}

interface ProductSettingRow {
  readonly key: string;
  readonly updated_at: number;
  readonly value: string;
}

interface ActivityItemRow {
  readonly id: string;
  readonly kind: string;
  readonly payload: string;
  readonly occurred_at: number;
  readonly read_at: number | null;
}

function rowToActivityItem(row: ActivityItemRow): ActivityItem | null {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const occurredAt = databaseTimestamp(row.occurred_at);
  const readAt = row.read_at === null ? null : databaseTimestamp(row.read_at);
  if (!occurredAt || (row.read_at !== null && !readAt)) return null;
  const candidate = {
    ...payload,
    eventId: row.id,
    kind: row.kind,
    occurredAt,
    readAt,
  };
  return activityItemSchema.is(candidate) ? candidate : null;
}

function databaseTimestamp(value: unknown): SerializedTimestamp | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  try {
    return toSerializedTimestamp(new Date(value).toISOString());
  } catch {
    return null;
  }
}

async function readActivityItems(
  database: StoreDatabase,
): Promise<ActivityItem[]> {
  const rows = await database.query<ActivityItemRow>(
    `SELECT id, kind, payload, occurred_at, read_at
     FROM activity_items
     ORDER BY occurred_at DESC, id ASC`,
  );
  return rows.flatMap((row) => {
    const item = rowToActivityItem(row);
    return item ? [item] : [];
  });
}

export class ProductStore {
  constructor(private readonly database: StoreDatabase) {}

  close(): Promise<void> {
    return this.database.close();
  }

  async getSetting(key: string): Promise<ProductSetting | null> {
    const row = await this.database.first<ProductSettingRow>(
      "SELECT key, value, updated_at FROM settings WHERE key = ?",
      [key],
    );
    return row
      ? { key: row.key, updatedAt: row.updated_at, value: row.value }
      : null;
  }

  async setSetting(setting: ProductSetting): Promise<void> {
    await this.database.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [setting.key, setting.value, setting.updatedAt],
    );
  }

  async deleteSetting(key: string): Promise<void> {
    await this.database.run("DELETE FROM settings WHERE key = ?", [key]);
  }

  async listActivity(filter: ActivityFilter = "all"): Promise<ActivityItem[]> {
    const items = await readActivityItems(this.database);
    if (filter === "channels")
      return items.filter((item) => item.kind === "channel");
    if (filter === "jobs") return items.filter((item) => item.kind === "job");
    return items;
  }

  async recordActivity(
    incoming: ActivityItem,
    nowMs = Date.now(),
  ): Promise<ActivityWriteResult> {
    let result: ActivityWriteResult | undefined;
    await this.database.transaction(async (database) => {
      const existingRow = await database.first<ActivityItemRow>(
        `SELECT id, kind, payload, occurred_at, read_at
         FROM activity_items WHERE id = ?`,
        [incoming.eventId],
      );
      const existing = existingRow ? rowToActivityItem(existingRow) : null;
      const item = existing
        ? reconcileActivityItem(existing, incoming)
        : incoming;
      await database.run(
        `INSERT INTO activity_items (id, kind, payload, occurred_at, read_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           payload = excluded.payload,
           occurred_at = excluded.occurred_at,
           read_at = excluded.read_at`,
        [
          item.eventId,
          item.kind,
          JSON.stringify(item),
          Date.parse(item.occurredAt),
          item.readAt === null ? null : Date.parse(item.readAt),
        ],
      );

      const activityItems = await readActivityItems(database);
      const retained = new Set(
        selectRetainedActivityEventIds(activityItems, { nowMs }),
      );
      for (const activityItem of activityItems) {
        if (!retained.has(activityItem.eventId)) {
          await database.run("DELETE FROM activity_items WHERE id = ?", [
            activityItem.eventId,
          ]);
        }
      }
      result = { item, kind: existing ? "reconciled" : "created" };
    });
    if (!result) throw new Error("The Activity transaction did not complete.");
    return result;
  }

  async markActivityRead(
    eventId: string,
    readAt: SerializedTimestamp,
  ): Promise<ActivityItem | null> {
    const row = await this.database.first<ActivityItemRow>(
      `SELECT id, kind, payload, occurred_at, read_at
       FROM activity_items WHERE id = ?`,
      [eventId],
    );
    const existing = row ? rowToActivityItem(row) : null;
    if (!existing) return null;
    const item = markActivityItemRead(existing, readAt);
    if (item !== existing) {
      await this.database.run(
        "UPDATE activity_items SET read_at = ? WHERE id = ? AND read_at IS NULL",
        [Date.parse(item.readAt ?? readAt), eventId],
      );
      const storedRow = await this.database.first<ActivityItemRow>(
        `SELECT id, kind, payload, occurred_at, read_at
         FROM activity_items WHERE id = ?`,
        [eventId],
      );
      return storedRow ? rowToActivityItem(storedRow) : null;
    }
    return item;
  }

  async markAllActivityRead(readAt: SerializedTimestamp): Promise<number> {
    const result = await this.database.run(
      "UPDATE activity_items SET read_at = ? WHERE read_at IS NULL",
      [Date.parse(readAt)],
    );
    return result.changes;
  }
}
