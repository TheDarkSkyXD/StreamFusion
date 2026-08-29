/**
 * UserModHistory (U17)
 *
 * Renders the user's mod-log history scoped to the current channel.
 * Rows are presentation-only (clicking does nothing — the popout is
 * already scoped to this user). Newest-first via the underlying
 * `useModLog` query's `ORDER BY created_at DESC`.
 */

import { AlertCircle, RefreshCw } from "lucide-react";

import { useModLog } from "@/features/moderation/data/useModLog";
import type { Platform } from "@shared/auth-types";

interface UserModHistoryProps {
  platform: Platform;
  channelId: string;
  channelSlug: string;
  targetUserId: string;
  /** Bump to force a re-query after a mod action lands. */
  refreshCounter?: number;
  limit?: number;
}

function formatRelative(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return ` (${seconds}s)`;
  if (seconds < 3600) return ` (${Math.floor(seconds / 60)}m)`;
  if (seconds < 86_400) return ` (${Math.floor(seconds / 3600)}h)`;
  return ` (${Math.floor(seconds / 86_400)}d)`;
}

export function UserModHistory({
  platform,
  channelId,
  channelSlug,
  targetUserId,
  refreshCounter = 0,
  limit = 5,
}: UserModHistoryProps) {
  const { result, entries, retry } = useModLog({
    platform,
    channelId,
    channelSlug,
    targetUserId,
    limit,
    refreshCounter,
  });

  if (result.state === "loading") {
    return (
      <div
        className="text-xs text-[var(--color-foreground-muted)] py-2"
        data-testid="user-mod-history-loading"
      >
        Loading history…
      </div>
    );
  }
  if (result.state === "error") {
    return (
      <div
        className="rounded-md border border-red-300/20 bg-red-300/5 px-3 py-2"
        data-testid="user-mod-history-error"
      >
        {result.retryable ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={retry}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Couldn’t load <span>·</span> Retry
          </button>
        ) : (
          <p className="flex items-center gap-2 text-xs text-red-200">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            Couldn’t load
          </p>
        )}
      </div>
    );
  }
  if (result.state === "verified-empty") {
    return (
      <div
        className="text-xs text-[var(--color-foreground-muted)] py-2"
        data-testid="user-mod-history-empty"
      >
        No moderation actions available
      </div>
    );
  }
  return (
    <div>
      {result.state === "partial" ? (
        <p className="mb-2 text-xs text-amber-200" data-testid="user-mod-history-partial">
          Showing observed history only
        </p>
      ) : null}
      <ul
        className="space-y-1 max-h-40 overflow-y-auto no-scrollbar"
        data-testid="user-mod-history-list"
      >
        {entries.map((entry) => (
          <li
            key={entry.id ?? `${entry.occurredAt}-${entry.action}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded border border-white/5 bg-white/5 px-2 py-1 text-xs"
          >
            <span className="text-[var(--color-foreground-muted)] whitespace-nowrap">
              {formatRelative(entry.occurredAt)}
            </span>
            <span className="font-medium text-white">
              {entry.action}
              {formatDuration(entry.durationSeconds)}
            </span>
            <span className="text-[var(--color-foreground-muted)] truncate ml-auto">
              by @{entry.moderatorUsername}
            </span>
            {entry.reason ? (
              <span
                className="basis-full truncate text-[var(--color-foreground-muted)]"
                aria-label={`Reason: ${entry.reason}`}
              >
                {entry.reason}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
