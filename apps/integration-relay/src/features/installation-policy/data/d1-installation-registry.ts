import type {
  InstallationRegistry,
  InstallationRegistryRecord,
  RelayEnvironment
} from "../capabilities/installation-registry";

type InstallationRow = {
  readonly active_expires_at_ms: number;
  readonly active_generation: number;
  readonly environment: RelayEnvironment;
  readonly installation_id: string;
  readonly last_registration_id: string;
  readonly registration_generation: number;
  readonly last_rotation_id: string | null;
  readonly replay_expires_at_ms: number | null;
  readonly replay_generation: number | null;
  readonly revision: number;
};

const schema = `
  CREATE TABLE IF NOT EXISTS installation_credentials (
    environment TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    active_generation INTEGER NOT NULL,
    active_expires_at_ms INTEGER NOT NULL,
    last_registration_id TEXT NOT NULL,
    registration_generation INTEGER NOT NULL,
    last_rotation_id TEXT,
    replay_generation INTEGER,
    replay_expires_at_ms INTEGER,
    revision INTEGER NOT NULL,
    PRIMARY KEY (environment, installation_id)
  );
`;

export function createD1InstallationRegistry(
  database: D1Database
): InstallationRegistry {
  let initialized: Promise<void> | null = null;

  async function ensureInitialized(): Promise<void> {
    initialized ??= database
      .prepare(schema)
      .run()
      .then(() => undefined);
    await initialized;
  }

  return {
    async get(input) {
      await ensureInitialized();
      const row = await database
        .prepare(
          `SELECT environment, installation_id, active_generation, active_expires_at_ms,
                  last_registration_id, registration_generation, last_rotation_id, replay_generation,
                  replay_expires_at_ms, revision
             FROM installation_credentials
            WHERE environment = ? AND installation_id = ?`
        )
        .bind(input.environment, input.installationId)
        .first<InstallationRow>();
      return row === null ? null : fromRow(row);
    },

    async insert(input) {
      await ensureInitialized();
      const result = await database
        .prepare(
          `INSERT OR IGNORE INTO installation_credentials (
             environment, installation_id, active_generation, active_expires_at_ms,
             last_registration_id, registration_generation, last_rotation_id, replay_generation,
             replay_expires_at_ms, revision
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          input.environment,
          input.installationId,
          input.activeGeneration,
          input.activeExpiresAtEpochMs,
          input.lastRegistrationId,
          input.registrationGeneration,
          input.lastRotationId,
          input.replayGeneration,
          input.replayExpiresAtEpochMs,
          input.revision
        )
        .run();
      return result.meta.changes === 1;
    },

    async replace(input) {
      await ensureInitialized();
      const result = await database
        .prepare(
          `UPDATE installation_credentials
              SET active_generation = ?, active_expires_at_ms = ?,
                  last_registration_id = ?, registration_generation = ?, last_rotation_id = ?,
                  replay_generation = ?, replay_expires_at_ms = ?, revision = ?
            WHERE environment = ? AND installation_id = ? AND revision = ?`
        )
        .bind(
          input.activeGeneration,
          input.activeExpiresAtEpochMs,
          input.lastRegistrationId,
          input.registrationGeneration,
          input.lastRotationId,
          input.replayGeneration,
          input.replayExpiresAtEpochMs,
          input.revision,
          input.environment,
          input.installationId,
          input.revision - 1
        )
        .run();
      return result.meta.changes === 1;
    }
  };
}

function fromRow(row: InstallationRow): InstallationRegistryRecord {
  return {
    activeExpiresAtEpochMs: row.active_expires_at_ms,
    activeGeneration: row.active_generation,
    environment: row.environment,
    installationId: row.installation_id,
    lastRegistrationId: row.last_registration_id,
    registrationGeneration: row.registration_generation,
    lastRotationId: row.last_rotation_id,
    replayExpiresAtEpochMs: row.replay_expires_at_ms,
    replayGeneration: row.replay_generation,
    revision: row.revision
  };
}
