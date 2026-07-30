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

import { useQuery } from "@tanstack/react-query";

import type { ModLogAction } from "@/backend/services/mod-log-writer";
import { getModerationDevelopmentHistoryFixture } from "@/dev-relay/moderation-browser-fixtures";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@/shared/auth-types";
import type { ModerationHistoryResult, ModLogEntry } from "@/shared/mod-log-types";

export type { ModLogEntry };

export interface UseModLogOptions {
  platform: Platform;
  channelId: string;
  channelSlug: string;
  targetUserId?: string;
  action?: ModLogAction;
  moderatorUsername?: string;
  limit?: number;
  /** Re-queries when this counter changes. Default = 0. */
  refreshCounter?: number;
}

export function useModLog(opts: UseModLogOptions): {
  result: ModerationHistoryResult;
  entries: ModLogEntry[];
  loading: boolean;
  retry: () => void;
} {
  const {
    platform,
    channelId,
    channelSlug,
    targetUserId,
    action,
    moderatorUsername,
    limit,
    refreshCounter = 0,
  } = opts;

  const query = useQuery({
    queryKey: [
      "modLog",
      platform,
      channelId,
      channelSlug,
      targetUserId,
      action,
      moderatorUsername,
      limit,
      refreshCounter,
    ],
    queryFn: async () => {
      const developmentFixture = getModerationDevelopmentHistoryFixture(
        {
          platform,
          channelId,
          channelSlug,
          targetUserId,
          action,
          moderatorUsername,
          limit,
        },
        window.location.search
      );
      if (developmentFixture) return developmentFixture;
      try {
        const result = await window.electronAPI.modLog.query({
          platform,
          channelId,
          channelSlug,
          targetUserId,
          action,
          moderatorUsername,
          limit,
        });
        if (
          result &&
          typeof result === "object" &&
          "state" in result &&
          ["ready", "verified-empty", "partial", "error"].includes(result.state)
        ) {
          return result;
        }
        return {
          state: "error",
          entries: [],
          code: "query-failed",
          retryable: true,
        } satisfies ModerationHistoryResult;
      } catch (err) {
        logger.warn("Hook:ModLog", "queryModLog failed", {
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
        return {
          state: "error",
          entries: [],
          code: "query-failed",
          retryable: true,
        } satisfies ModerationHistoryResult;
      }
    },
  });

  const result: ModerationHistoryResult = query.isPending
    ? { state: "loading", entries: [] }
    : (query.data ?? {
        state: "error",
        entries: [],
        code: "query-failed",
        retryable: true,
      });

  return {
    result,
    entries: result.entries,
    loading: result.state === "loading",
    retry: () => {
      void query.refetch();
    },
  };
}
