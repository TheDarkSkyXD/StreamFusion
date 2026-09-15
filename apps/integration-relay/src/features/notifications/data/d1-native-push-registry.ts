import type { LiveNotificationProjection } from "@streamfusion/core/relay";

import type {
  NativePushRecord,
  NativePushRegistry
} from "../capabilities/native-push-registry";

type NativePushRow = {
  readonly installation_id: string;
  readonly native_token: string;
  readonly token_hash: string;
  readonly token_type: "fcm";
  readonly projection_json: string;
  readonly remote_delivery_enabled: number;
  readonly registered_at: string;
  readonly rotated_at: string;
};

const schema = `
  CREATE TABLE IF NOT EXISTS native_push_tokens (
    installation_id TEXT PRIMARY KEY,
    native_token TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    token_type TEXT NOT NULL,
    projection_json TEXT NOT NULL,
    remote_delivery_enabled INTEGER NOT NULL,
    registered_at TEXT NOT NULL,
    rotated_at TEXT NOT NULL
  );
`;

export function createD1NativePushRegistry(
  database: D1Database
): NativePushRegistry {
  let initialized: Promise<void> | null = null;

  async function ensureInitialized(): Promise<void> {
    initialized ??= database
      .prepare(schema)
      .run()
      .then(() => undefined);
    await initialized;
  }

  return {
    async get(installationId) {
      await ensureInitialized();
      const row = await database
        .prepare(
          `SELECT installation_id, native_token, token_hash, token_type, projection_json,
                  remote_delivery_enabled, registered_at, rotated_at
             FROM native_push_tokens
            WHERE installation_id = ?`
        )
        .bind(installationId)
        .first<NativePushRow>();
      return row === null ? null : fromRow(row);
    },

    async upsert(record) {
      await ensureInitialized();
      await database
        .prepare(
          `INSERT INTO native_push_tokens (
             installation_id, native_token, token_hash, token_type, projection_json,
             remote_delivery_enabled, registered_at, rotated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(installation_id) DO UPDATE SET
             native_token = excluded.native_token,
             token_hash = excluded.token_hash,
             token_type = excluded.token_type,
             projection_json = excluded.projection_json,
             remote_delivery_enabled = excluded.remote_delivery_enabled,
             registered_at = native_push_tokens.registered_at,
             rotated_at = excluded.rotated_at`
        )
        .bind(
          record.installationId,
          record.nativeToken,
          record.tokenHash,
          record.tokenType,
          JSON.stringify(record.projection),
          record.remoteDeliveryEnabled ? 1 : 0,
          record.registeredAt,
          record.rotatedAt
        )
        .run();
    },

    async disable(installationId, rotatedAt) {
      await ensureInitialized();
      const result = await database
        .prepare(
          `UPDATE native_push_tokens
              SET remote_delivery_enabled = 0, rotated_at = ?
            WHERE installation_id = ?`
        )
        .bind(rotatedAt, installationId)
        .run();
      return result.meta.changes === 1;
    }
  };
}

function fromRow(row: NativePushRow): NativePushRecord {
  return {
    installationId: row.installation_id,
    nativeToken: row.native_token,
    tokenHash: row.token_hash,
    tokenType: row.token_type,
    projection: JSON.parse(row.projection_json) as LiveNotificationProjection,
    remoteDeliveryEnabled: row.remote_delivery_enabled === 1,
    registeredAt: row.registered_at,
    rotatedAt: row.rotated_at
  };
}
