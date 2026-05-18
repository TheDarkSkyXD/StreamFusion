/**
 * useModLog
 *
 * Renderer-side consumer for U12's mod-log writer. Reads synchronously from
 * `dbService.queryModLog` and exposes a `loading` flag for the first call so
 * surfaces can render a skeleton.
 *
 * Re-queries when any filter changes OR when `refreshCounter` ticks — surfaces
 * that perform a mod action call `setRefreshCounter((n) => n + 1)` to force a
 * read-after-write.
 *
 * NOTE on IPC: like other `dbService` consumers, this hook currently calls
 * into the SQLite singleton directly. Production wiring through an IPC bridge
 * is a separate concern shared with the rest of the renderer-side DB reads.
 */

import { useEffect, useState } from "react";

import { dbService, type ModLogEntry } from "@/backend/services/database-service";
import type { ModLogAction } from "@/backend/services/mod-log-writer";

export interface UseModLogOptions {
  channelId: string;
  targetUserId?: string;
  action?: ModLogAction;
  moderatorUsername?: string;
  limit?: number;
  /** Re-queries when this counter changes. Default = 0. */
  refreshCounter?: number;
}

export function useModLog(opts: UseModLogOptions): {
  entries: ModLogEntry[];
  loading: boolean;
} {
  const {
    channelId,
    targetUserId,
    action,
    moderatorUsername,
    limit,
    refreshCounter = 0,
  } = opts;

  const [entries, setEntries] = useState<ModLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    try {
      const rows = dbService.queryModLog({
        channelId,
        targetUserId,
        action,
        moderatorUsername,
        limit,
      });
      if (!cancelled) {
        setEntries(rows);
        setLoading(false);
      }
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: surfacing query failure
      console.warn("[useModLog] queryModLog failed", err);
      if (!cancelled) {
        setEntries([]);
        setLoading(false);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [channelId, targetUserId, action, moderatorUsername, limit, refreshCounter]);

  return { entries, loading };
}
