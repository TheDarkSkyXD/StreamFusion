import type { StoreDatabase } from "./database-contracts";

export const DEFAULT_CACHE_MAXIMUM_BYTES = 256 * 1024 * 1024;
export const DEFAULT_CACHE_FRESHNESS_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

export type CacheRead =
  | { readonly kind: "miss" }
  | {
      readonly kind: "hit";
      readonly ageMilliseconds: number;
      readonly payload: string;
      readonly stale: boolean;
    };

interface CacheRow {
  readonly created_at: number;
  readonly expires_at: number;
  readonly payload: string;
}

export class CacheStore {
  constructor(
    private readonly database: StoreDatabase,
    private readonly options: {
      readonly maximumBytes: number;
      readonly now: () => number;
    },
  ) {}

  clear(): Promise<void> {
    return this.database.run("DELETE FROM remote_cache").then(() => undefined);
  }

  close(): Promise<void> {
    return this.database.close();
  }

  async get(key: string): Promise<CacheRead> {
    const row = await this.database.first<CacheRow>(
      "SELECT payload, created_at, expires_at FROM remote_cache WHERE key = ?",
      [key],
    );
    if (!row) return { kind: "miss" };
    const now = this.options.now();
    await this.database.run(
      "UPDATE remote_cache SET last_accessed_at = ? WHERE key = ?",
      [now, key],
    );
    return {
      kind: "hit",
      ageMilliseconds: Math.max(0, now - row.created_at),
      payload: row.payload,
      stale: row.expires_at <= now,
    };
  }

  async put(options: {
    readonly freshnessMilliseconds?: number;
    readonly key: string;
    readonly payload: string;
    readonly sizeBytes?: number;
  }): Promise<void> {
    const now = this.options.now();
    const sizeBytes =
      options.sizeBytes ?? new TextEncoder().encode(options.payload).length;
    const freshness =
      options.freshnessMilliseconds ?? DEFAULT_CACHE_FRESHNESS_MILLISECONDS;
    await this.database.transaction(async (transaction) => {
      await transaction.run(
        `INSERT INTO remote_cache
          (key, payload, size_bytes, created_at, last_accessed_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           payload = excluded.payload,
           size_bytes = excluded.size_bytes,
           created_at = excluded.created_at,
           last_accessed_at = excluded.last_accessed_at,
           expires_at = excluded.expires_at`,
        [options.key, options.payload, sizeBytes, now, now, now + freshness],
      );
      await evictToBudget(transaction, this.options.maximumBytes, now);
    });
  }

  async sizeBytes(): Promise<number> {
    const row = await this.database.first<{
      readonly total_bytes: number | null;
    }>("SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM remote_cache");
    return row?.total_bytes ?? 0;
  }
}

async function evictToBudget(
  database: StoreDatabase,
  maximumBytes: number,
  now: number,
): Promise<void> {
  await database.run("DELETE FROM remote_cache WHERE expires_at <= ?", [now]);
  await database.run(
    `DELETE FROM remote_cache
     WHERE key IN (
       SELECT key FROM (
         SELECT key,
                SUM(size_bytes) OVER (
                  ORDER BY last_accessed_at DESC, key DESC
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS retained_bytes
         FROM remote_cache
       ) WHERE retained_bytes > ?
     )`,
    [maximumBytes],
  );
}
