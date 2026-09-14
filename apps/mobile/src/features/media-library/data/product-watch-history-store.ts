import type { StoreDatabase } from "@mobile/features/storage/data/database-contracts";

import type {
  WatchHistoryItem,
  WatchHistoryKind,
  WatchHistoryRepository,
} from "../capabilities/watch-history";
import { MAX_WATCH_HISTORY_ITEMS } from "../capabilities/watch-history";

const HISTORY_COLUMNS = `id, platform, content_kind, content_id, title, position_seconds,
                updated_at, thumbnail_url, avatar_url, channel_id, channel_login,
                channel_display_name, duration_seconds`;

interface HistoryItemRow {
  readonly avatar_url: string;
  readonly channel_display_name: string;
  readonly channel_id: string;
  readonly channel_login: string;
  readonly content_id: string;
  readonly content_kind: string;
  readonly duration_seconds: number;
  readonly id: string;
  readonly platform: string;
  readonly position_seconds: number;
  readonly thumbnail_url: string;
  readonly title: string;
  readonly updated_at: number;
}

export function createProductWatchHistoryStore(
  database: StoreDatabase,
): WatchHistoryRepository {
  return {
    async clear() {
      await database.run("DELETE FROM history_items");
    },
    async list() {
      const rows = await database.query<HistoryItemRow>(
        `SELECT ${HISTORY_COLUMNS}
         FROM history_items
         ORDER BY updated_at DESC, id ASC`,
      );
      return rows.flatMap((row) => {
        const item = itemFromRow(row);
        return item ? [item] : [];
      });
    },
    async remove(id) {
      await database.run("DELETE FROM history_items WHERE id = ?", [id]);
    },
    async upsert(item) {
      await database.run(
        `INSERT INTO history_items (${HISTORY_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           platform = excluded.platform,
           content_kind = excluded.content_kind,
           content_id = excluded.content_id,
           title = excluded.title,
           position_seconds = excluded.position_seconds,
           updated_at = excluded.updated_at,
           thumbnail_url = excluded.thumbnail_url,
           avatar_url = excluded.avatar_url,
           channel_id = excluded.channel_id,
           channel_login = excluded.channel_login,
           channel_display_name = excluded.channel_display_name,
           duration_seconds = excluded.duration_seconds`,
        [
          item.id,
          item.platform,
          item.kind,
          item.contentId,
          item.title,
          item.positionSeconds,
          item.updatedAt,
          item.thumbnailUrl,
          item.avatarUrl,
          item.channelId,
          item.channelLogin,
          item.channelDisplayName,
          item.durationSeconds,
        ],
      );
      await database.run(
        `DELETE FROM history_items WHERE id NOT IN (
           SELECT id FROM history_items ORDER BY updated_at DESC, id ASC LIMIT ?
         )`,
        [MAX_WATCH_HISTORY_ITEMS],
      );
    },
  };
}

function itemFromRow(row: HistoryItemRow): WatchHistoryItem | null {
  if (!isHistoryPlatform(row.platform) || !isHistoryKind(row.content_kind)) {
    return null;
  }
  return {
    avatarUrl: row.avatar_url,
    channelDisplayName: row.channel_display_name,
    channelId: row.channel_id,
    channelLogin: row.channel_login,
    contentId: row.content_id,
    durationSeconds: Math.max(0, Math.floor(row.duration_seconds)),
    id: row.id,
    kind: row.content_kind,
    platform: row.platform,
    positionSeconds: Math.max(0, Math.floor(row.position_seconds)),
    thumbnailUrl: row.thumbnail_url,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function isHistoryPlatform(
  value: string,
): value is WatchHistoryItem["platform"] {
  return value === "twitch" || value === "kick";
}

function isHistoryKind(value: string): value is WatchHistoryKind {
  return value === "clip" || value === "stream" || value === "video";
}
