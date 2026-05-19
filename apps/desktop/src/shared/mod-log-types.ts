/**
 * Mod-Log Shared Types
 *
 * Shapes for mod-log entries, query filters, and retention scopes. Mirrors the
 * database-service definitions so the renderer can speak the same vocabulary
 * over IPC without statically importing `database-service.ts` (which would
 * pull `better-sqlite3` into the renderer bundle).
 */

export interface ModLogEntry {
  id?: number;
  channelId: string;
  channelSlug: string;
  action: string;
  targetUserId: string;
  targetUsername: string;
  moderatorUserId: string;
  moderatorUsername: string;
  durationSeconds?: number | null;
  reason?: string | null;
  createdAt: number;
}

export interface ModLogQueryFilters {
  channelId: string;
  targetUserId?: string;
  action?: string;
  moderatorUsername?: string;
  limit?: number;
  offset?: number;
}

export type RetentionScope = "global" | `channel:${string}`;
