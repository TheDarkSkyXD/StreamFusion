/**
 * UserModHistory (U17)
 *
 * Renders the user's mod-log history scoped to the current channel.
 * Rows are presentation-only (clicking does nothing — the popout is
 * already scoped to this user). Newest-first via the underlying
 * `useModLog` query's `ORDER BY created_at DESC`.
 */

import { useModLog } from "@/hooks/useModLog";

interface UserModHistoryProps {
  channelId: string;
  targetUserId: string;
  /** Bump to force a re-query after a mod action lands. */
  refreshCounter?: number;
  limit?: number;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
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
  channelId,
  targetUserId,
  refreshCounter = 0,
  limit = 50,
}: UserModHistoryProps) {
  const { entries, loading } = useModLog({
    channelId,
    targetUserId,
    limit,
    refreshCounter,
  });

  if (loading) {
    return (
      <div
        className="text-xs text-[var(--color-foreground-muted)] py-2"
        data-testid="user-mod-history-loading"
      >
        Loading history…
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div
        className="text-xs text-[var(--color-foreground-muted)] py-2"
        data-testid="user-mod-history-empty"
      >
        No mod history
      </div>
    );
  }
  return (
    <ul
      className="space-y-1 max-h-40 overflow-y-auto no-scrollbar"
      data-testid="user-mod-history-list"
    >
      {entries.map((entry) => (
        <li
          key={entry.id ?? `${entry.createdAt}-${entry.action}`}
          className="text-xs flex items-baseline gap-2 px-2 py-1 rounded bg-white/5 border border-white/5"
        >
          <span className="text-[var(--color-foreground-muted)] whitespace-nowrap">
            {formatRelative(entry.createdAt)}
          </span>
          <span className="font-medium text-white">
            {entry.action}
            {formatDuration(entry.durationSeconds)}
          </span>
          <span className="text-[var(--color-foreground-muted)] truncate ml-auto">
            by @{entry.moderatorUsername}
          </span>
        </li>
      ))}
    </ul>
  );
}
