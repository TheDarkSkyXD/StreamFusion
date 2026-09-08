import type { RelayRateLimiter } from "../capabilities/installation-registry";

export function createD1RelayRateLimiter(
  database: D1Database
): RelayRateLimiter {
  let initialized: Promise<void> | null = null;
  let lastPrunedBucketStart = Number.NEGATIVE_INFINITY;

  async function ensureInitialized(): Promise<void> {
    initialized ??= database
      .prepare(
        `CREATE TABLE IF NOT EXISTS relay_rate_limits (
        scope TEXT NOT NULL,
        bucket_start_ms INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (scope, bucket_start_ms)
      );`
      )
      .run()
      .then(() => undefined);
    await initialized;
  }

  return {
    async consume(input) {
      await ensureInitialized();
      const bucketStart =
        Math.floor(input.nowEpochMs / input.windowMs) * input.windowMs;
      if (bucketStart > lastPrunedBucketStart) {
        await database
          .prepare("DELETE FROM relay_rate_limits WHERE bucket_start_ms < ?")
          .bind(bucketStart - 2 * input.windowMs)
          .run();
        lastPrunedBucketStart = bucketStart;
      }
      const row = await database
        .prepare(
          `INSERT INTO relay_rate_limits (scope, bucket_start_ms, count)
             VALUES (?, ?, 1)
           ON CONFLICT(scope, bucket_start_ms) DO UPDATE SET count = count + 1
           RETURNING count`
        )
        .bind(input.scope, bucketStart)
        .first<{ readonly count: number }>();
      return row !== null && row.count <= input.limit;
    }
  };
}
