/**
 * useModLog
 *
 * Renderer-side consumer for U12's mod-log writer. Queries via the
 * `window.electronAPI.modLog` IPC bridge (the underlying SQLite singleton
 * lives in the main process — see modlog-handlers.ts). Exposes a `loading`
 * flag for the first call so surfaces can render a skeleton.
 *
 * Re-queries when any filter changes OR when `refreshCounter` ticks —
 * surfaces that perform a mod action call `setRefreshCounter((n) => n + 1)`
 * to force a read-after-write.
 */

import { useEffect, useState } from "react";

import type { ModLogAction } from "@/backend/services/mod-log-writer";
import type { ModLogEntry } from "@/shared/mod-log-types";

export type { ModLogEntry };

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
    setLoading(true);

    (async () => {
      try {
        const rows = await window.electronAPI.modLog.query({
          channelId,
          targetUserId,
          action,
          moderatorUsername,
          limit,
        });
        if (!cancelled) {
          // Defensive: an unmocked or misconfigured bridge can return a
          // non-array; render the empty state rather than crashing on `.map`.
          setEntries(Array.isArray(rows) ? rows : []);
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
    })();

    return () => {
      cancelled = true;
    };
  }, [channelId, targetUserId, action, moderatorUsername, limit, refreshCounter]);

  return { entries, loading };
}
