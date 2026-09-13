import {
  parseMediaJobSnapshot,
  type MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";

import type { StoreDatabase } from "@mobile/features/storage/data/database-contracts";

import type { MediaJobRepository } from "../capabilities/media-jobs";

interface MediaJobRow {
  readonly checkpoint: string | null;
  readonly id: string;
  readonly kind: string;
  readonly state: string;
  readonly updated_at: number;
}

export function createProductMediaJobStore(
  database: StoreDatabase,
): MediaJobRepository {
  return {
    async get(jobId) {
      const row = await database.first<MediaJobRow>(
        "SELECT id, kind, state, checkpoint, updated_at FROM media_jobs WHERE id = ?",
        [jobId],
      );
      return row ? parseRow(row) : null;
    },
    async list() {
      const rows = await database.query<MediaJobRow>(
        "SELECT id, kind, state, checkpoint, updated_at FROM media_jobs ORDER BY updated_at DESC, id ASC",
      );
      return rows.flatMap((row) => {
        const snapshot = parseRow(row);
        return snapshot ? [snapshot] : [];
      });
    },
    async put(snapshot) {
      await database.run(
        `INSERT INTO media_jobs (id, kind, state, checkpoint, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           state = excluded.state,
           checkpoint = excluded.checkpoint,
           updated_at = excluded.updated_at`,
        [
          snapshot.intent.jobId,
          snapshot.intent.kind,
          JSON.stringify(snapshot),
          snapshot.checkpoint ? JSON.stringify(snapshot.checkpoint) : null,
          Date.parse(snapshot.checkpoint?.updatedAt ?? snapshot.intent.createdAt),
        ],
      );
    },
  };
}

function parseRow(row: MediaJobRow): MediaJobSnapshot | null {
  try {
    return parseMediaJobSnapshot(JSON.parse(row.state));
  } catch {
    return null;
  }
}
