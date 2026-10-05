import {
  parseMediaJobSnapshot,
  type MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";

import type { StoreDatabase } from "@mobile/features/storage/data/database-contracts";

import { mediaJobDisplay, parseMediaDisplay } from "../utils/media-display";
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
          JSON.stringify({
            schemaVersion: 2,
            snapshot: {
              ...snapshot,
              intent: {
                schemaVersion: snapshot.intent.schemaVersion,
                jobId: snapshot.intent.jobId,
                kind: snapshot.intent.kind,
                sourceUri: snapshot.intent.sourceUri,
                createdAt: snapshot.intent.createdAt,
              },
            },
            display: mediaJobDisplay(snapshot),
          }),
          snapshot.checkpoint ? JSON.stringify(snapshot.checkpoint) : null,
          Date.parse(
            snapshot.checkpoint?.updatedAt ?? snapshot.intent.createdAt,
          ),
        ],
      );
    },
    async remove(jobId) {
      await database.run("DELETE FROM media_jobs WHERE id = ?", [jobId]);
    },
  };
}

function parseRow(row: MediaJobRow): MediaJobSnapshot | null {
  try {
    const value: unknown = JSON.parse(row.state);
    if (
      typeof value === "object" &&
      value !== null &&
      "schemaVersion" in value &&
      value.schemaVersion === 2 &&
      "snapshot" in value
    ) {
      const snapshot = parseMediaJobSnapshot(value.snapshot);
      const display =
        "display" in value ? parseMediaDisplay(value.display) : null;
      if (!snapshot || !display) return snapshot;
      const intent = { ...snapshot.intent, display };
      return { ...snapshot, intent };
    }
    return parseMediaJobSnapshot(value);
  } catch {
    return null;
  }
}
