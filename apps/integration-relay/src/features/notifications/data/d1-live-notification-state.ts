import { safeNotificationPayloadSchema } from "@streamfusion/core/relay";

import type {
  LiveNotificationState,
  PendingLiveDelivery
} from "../capabilities/live-notification-state";

type ObservationRow = {
  pair_key: string;
  observed_ms: number;
  session_key: string | null;
};
type OutboxRow = {
  event_id: string;
  installation_id: string;
  pair_key: string;
  payload_json: string;
  attempts: number;
  expires_ms: number;
};

const schema = [
  `CREATE TABLE IF NOT EXISTS live_observations (
  pair_key TEXT PRIMARY KEY, state TEXT NOT NULL, session_key TEXT,
  observed_ms INTEGER NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS live_events (
  event_id TEXT PRIMARY KEY, created_ms INTEGER NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS live_outbox (
  event_id TEXT NOT NULL, installation_id TEXT NOT NULL, pair_key TEXT NOT NULL,
  payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL, lease_token TEXT, lease_until_ms INTEGER,
  PRIMARY KEY (event_id, installation_id)
);`,
  `CREATE INDEX IF NOT EXISTS live_outbox_due ON live_outbox(status, next_attempt_ms);`,
  `CREATE TABLE IF NOT EXISTS live_last_alert (
  installation_id TEXT NOT NULL, pair_key TEXT NOT NULL, sent_ms INTEGER NOT NULL,
  PRIMARY KEY (installation_id, pair_key)
);`
];

const RETENTION_MS = 24 * 60 * 60 * 1000;
const DELIVERY_WINDOW_MS = 15 * 60 * 1000;
const LEASE_MS = 120_000;

export function createD1LiveNotificationState(
  database: D1Database
): LiveNotificationState {
  let initialized: Promise<void> | null = null;
  async function ensureInitialized() {
    initialized ??= database
      .batch(schema.map((statement) => database.prepare(statement)))
      .then(() => undefined);
    await initialized;
  }
  return {
    async lastObserved() {
      await ensureInitialized();
      const result = await database
        .prepare(
          "SELECT pair_key, observed_ms, session_key FROM live_observations"
        )
        .all<ObservationRow>();
      return new Map(
        (result.results ?? []).map((row) => [
          row.pair_key,
          { observedAtMs: row.observed_ms, sessionKey: row.session_key }
        ])
      );
    },
    async observe(observation) {
      await ensureInitialized();
      const pairKey = `${observation.pair.platform}:${observation.pair.channelId}`;
      const state = observation.sessionKey === null ? "offline" : "live";
      const statements: D1PreparedStatement[] = [
        database
          .prepare(
            `INSERT OR IGNORE INTO live_observations (pair_key, state, session_key, observed_ms)
          VALUES (?, ?, ?, ?)`
          )
          .bind(
            pairKey,
            state,
            observation.sessionKey,
            observation.observedAtMs
          )
      ];
      if (observation.eventId !== null && observation.payload !== null) {
        statements.push(
          database
            .prepare(
              `INSERT OR IGNORE INTO live_events (event_id, created_ms)
          SELECT ?, ? FROM live_observations
          WHERE pair_key = ? AND observed_ms < ?
            AND (state = 'offline' OR (state = 'live' AND session_key <> ?))`
            )
            .bind(
              observation.eventId,
              observation.observedAtMs,
              pairKey,
              observation.observedAtMs,
              observation.sessionKey
            )
        );
        statements.push(
          database
            .prepare(
              `INSERT OR IGNORE INTO live_outbox
            (event_id, installation_id, pair_key, payload_json, next_attempt_ms, expires_ms)
            SELECT event.event_id, registration.installation_id, ?, ?, ?, ?
            FROM live_events event
            JOIN native_push_tokens registration ON registration.remote_delivery_enabled = 1
            JOIN json_each(registration.projection_json, '$.pairs') pair
            WHERE event.event_id = ? AND event.created_ms = ?
              AND json_extract(pair.value, '$.platform') = ?
              AND json_extract(pair.value, '$.channelId') = ?`
            )
            .bind(
              pairKey,
              JSON.stringify(observation.payload),
              observation.observedAtMs,
              observation.observedAtMs + DELIVERY_WINDOW_MS,
              observation.eventId,
              observation.observedAtMs,
              observation.pair.platform,
              observation.pair.channelId
            )
        );
      }
      statements.push(
        database
          .prepare(
            `UPDATE live_observations SET state = ?, session_key = ?, observed_ms = ?
        WHERE pair_key = ? AND observed_ms < ?`
          )
          .bind(
            state,
            observation.sessionKey,
            observation.observedAtMs,
            pairKey,
            observation.observedAtMs
          )
      );
      await database.batch(statements);
    },
    async claimDue(nowMs, limit) {
      await ensureInitialized();
      const rows = await database
        .prepare(
          `SELECT event_id, installation_id, pair_key, payload_json, attempts, expires_ms
        FROM live_outbox due WHERE due.status = 'pending' AND due.next_attempt_ms <= ?
          AND expires_ms > ?
          AND (lease_until_ms IS NULL OR lease_until_ms <= ?)
          AND NOT EXISTS (SELECT 1 FROM live_outbox active
            WHERE active.installation_id = due.installation_id
              AND active.pair_key = due.pair_key
              AND active.lease_until_ms > ?)
        ORDER BY next_attempt_ms, event_id, installation_id LIMIT ?`
        )
        .bind(nowMs, nowMs, nowMs, nowMs, limit)
        .all<OutboxRow>();
      const claimed: PendingLiveDelivery[] = [];
      for (const row of rows.results ?? []) {
        let payload: unknown;
        try {
          payload = JSON.parse(row.payload_json);
        } catch {
          payload = null;
        }
        if (!safeNotificationPayloadSchema.is(payload)) {
          await database
            .prepare(
              `UPDATE live_outbox SET status = 'skipped'
            WHERE event_id = ? AND installation_id = ? AND status = 'pending'`
            )
            .bind(row.event_id, row.installation_id)
            .run();
          continue;
        }
        const leaseToken = crypto.randomUUID();
        const result = await database
          .prepare(
            `UPDATE live_outbox AS target SET lease_token = ?, lease_until_ms = ?
          WHERE target.event_id = ? AND target.installation_id = ? AND target.status = 'pending'
            AND target.next_attempt_ms <= ?
            AND (target.lease_until_ms IS NULL OR target.lease_until_ms <= ?)
            AND NOT EXISTS (SELECT 1 FROM live_outbox active
              WHERE active.installation_id = target.installation_id
                AND active.pair_key = target.pair_key
                AND active.lease_until_ms > ?)`
          )
          .bind(
            leaseToken,
            nowMs + LEASE_MS,
            row.event_id,
            row.installation_id,
            nowMs,
            nowMs,
            nowMs
          )
          .run();
        if (result.meta.changes !== 1) continue;
        claimed.push({
          eventId: row.event_id,
          installationId: row.installation_id,
          pairKey: row.pair_key,
          payload,
          attempts: row.attempts,
          expiresAtMs: row.expires_ms,
          leaseToken
        });
      }
      return claimed;
    },
    async release(delivery) {
      await ensureInitialized();
      await database
        .prepare(
          `UPDATE live_outbox SET lease_token = NULL, lease_until_ms = NULL
           WHERE event_id = ? AND installation_id = ? AND lease_token = ?`
        )
        .bind(delivery.eventId, delivery.installationId, delivery.leaseToken)
        .run();
    },
    async lastAlertAt(installationId, pairKey) {
      await ensureInitialized();
      const row = await database
        .prepare(
          "SELECT sent_ms FROM live_last_alert WHERE installation_id = ? AND pair_key = ?"
        )
        .bind(installationId, pairKey)
        .first<{ sent_ms: number }>();
      return row?.sent_ms ?? null;
    },
    async oldestDuePendingCreatedAt(nowMs) {
      await ensureInitialized();
      const row = await database
        .prepare(
          `SELECT MIN(expires_ms) AS oldest_expires_ms FROM live_outbox
          WHERE status = 'pending' AND next_attempt_ms <= ? AND expires_ms > ?
            AND (lease_until_ms IS NULL OR lease_until_ms <= ?)`
        )
        .bind(nowMs, nowMs, nowMs)
        .first<{ oldest_expires_ms: number | null }>();
      return row?.oldest_expires_ms === null || row === null
        ? null
        : row.oldest_expires_ms - DELIVERY_WINDOW_MS;
    },
    async complete(delivery, nowMs, outcome, retryAfterMs = 0) {
      await ensureInitialized();
      const status =
        outcome === "retry" &&
        delivery.attempts + 1 < 5 &&
        nowMs < delivery.expiresAtMs
          ? "pending"
          : outcome === "accepted"
            ? "accepted"
            : "skipped";
      const nextAttempt =
        status === "pending"
          ? Math.min(delivery.expiresAtMs, nowMs + retryAfterMs)
          : nowMs;
      const update = database
        .prepare(
          `UPDATE live_outbox SET status = ?, attempts = attempts + 1,
        next_attempt_ms = ?, lease_token = ?, lease_until_ms = NULL
        WHERE event_id = ? AND installation_id = ? AND lease_token = ?`
        )
        .bind(
          status,
          nextAttempt,
          status === "accepted" ? delivery.leaseToken : null,
          delivery.eventId,
          delivery.installationId,
          delivery.leaseToken
        );
      if (status === "accepted") {
        await database.batch([
          update,
          database
            .prepare(
              `INSERT INTO live_last_alert (installation_id, pair_key, sent_ms)
          SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM live_outbox WHERE event_id = ? AND installation_id = ? AND status = 'accepted' AND lease_token = ?)
          ON CONFLICT(installation_id, pair_key) DO UPDATE SET sent_ms = excluded.sent_ms`
            )
            .bind(
              delivery.installationId,
              delivery.pairKey,
              nowMs,
              delivery.eventId,
              delivery.installationId,
              delivery.leaseToken
            )
        ]);
      } else {
        await update.run();
      }
    },
    async cleanup(nowMs) {
      await ensureInitialized();
      await database.batch([
        database
          .prepare(
            "DELETE FROM live_outbox WHERE rowid IN (SELECT rowid FROM live_outbox WHERE expires_ms < ? LIMIT 100)"
          )
          .bind(nowMs - RETENTION_MS),
        database
          .prepare(
            "DELETE FROM live_events WHERE event_id IN (SELECT event_id FROM live_events WHERE created_ms < ? AND NOT EXISTS (SELECT 1 FROM live_outbox WHERE live_outbox.event_id = live_events.event_id) LIMIT 100)"
          )
          .bind(nowMs - RETENTION_MS),
        database.prepare(`DELETE FROM live_observations WHERE rowid IN (
          SELECT observation.rowid FROM live_observations observation
          WHERE NOT EXISTS (
            SELECT 1 FROM native_push_tokens registration,
              json_each(registration.projection_json, '$.pairs') pair
            WHERE registration.remote_delivery_enabled = 1
              AND (json_extract(pair.value, '$.platform') || ':' ||
                json_extract(pair.value, '$.channelId')) = observation.pair_key
          ) LIMIT 100)`),
        database.prepare(`DELETE FROM live_last_alert WHERE rowid IN (
          SELECT alert.rowid FROM live_last_alert alert
          WHERE NOT EXISTS (
            SELECT 1 FROM native_push_tokens registration,
              json_each(registration.projection_json, '$.pairs') pair
            WHERE registration.remote_delivery_enabled = 1
              AND registration.installation_id = alert.installation_id
              AND (json_extract(pair.value, '$.platform') || ':' ||
                json_extract(pair.value, '$.channelId')) = alert.pair_key
          ) LIMIT 100)`)
      ]);
    }
  };
}
