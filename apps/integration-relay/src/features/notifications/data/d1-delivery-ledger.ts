import type {
  DeliveryLedger,
  DeliveryRecord
} from "../capabilities/delivery-ledger";

type DeliveryRow = {
  readonly event_id: string;
  readonly mode: DeliveryRecord["mode"];
  readonly target: string;
  readonly outcome: DeliveryRecord["outcome"];
  readonly recorded_at: string;
};

const schema = `
  CREATE TABLE IF NOT EXISTS native_push_deliveries (
    event_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    target TEXT NOT NULL,
    outcome TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (event_id, mode, target)
  );
`;

export function createD1DeliveryLedger(database: D1Database): DeliveryLedger {
  let initialized: Promise<void> | null = null;

  async function ensureInitialized(): Promise<void> {
    initialized ??= database
      .prepare(schema)
      .run()
      .then(() => undefined);
    await initialized;
  }

  return {
    async get(eventId, mode, target) {
      await ensureInitialized();
      const row = await database
        .prepare(
          `SELECT event_id, mode, target, outcome, recorded_at
             FROM native_push_deliveries
            WHERE event_id = ? AND mode = ? AND target = ?`
        )
        .bind(eventId, mode, target)
        .first<DeliveryRow>();
      return row === null ? null : fromRow(row);
    },

    async put(record) {
      await ensureInitialized();
      await database
        .prepare(
          `INSERT INTO native_push_deliveries (
             event_id, mode, target, outcome, recorded_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(event_id, mode, target) DO UPDATE SET
             outcome = excluded.outcome,
             recorded_at = excluded.recorded_at`
        )
        .bind(
          record.eventId,
          record.mode,
          record.target,
          record.outcome,
          record.recordedAt
        )
        .run();
    }
  };
}

function fromRow(row: DeliveryRow): DeliveryRecord {
  return {
    eventId: row.event_id,
    mode: row.mode,
    target: row.target,
    outcome: row.outcome,
    recordedAt: row.recorded_at
  };
}
