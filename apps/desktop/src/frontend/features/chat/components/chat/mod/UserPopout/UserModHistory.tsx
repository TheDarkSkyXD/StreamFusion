/**
 * UserModHistory (U17)
 *
 * Renders the user's mod-log history scoped to the current channel.
 * Rows are presentation-only (clicking does nothing — the popout is
 * already scoped to this user). Newest-first via the underlying
 * `useModLog` query's `ORDER BY created_at DESC`.
 */

import { AlertCircle, RefreshCw } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

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

function formatRelative(ts: number, t: TFunction): string {
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t("chatModeration.secondsAgo", { count: seconds });
  if (seconds < 3600) return t("chatModeration.minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 86_400) return t("chatModeration.hoursAgo", { count: Math.floor(seconds / 3600) });
  return t("chatModeration.daysAgo", { count: Math.floor(seconds / 86_400) });
}

function formatDuration(seconds: number | null | undefined, t: TFunction): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return t("chatModeration.durationSecondsParenthesized", { count: seconds });
  if (seconds < 3600)
    return t("chatModeration.durationMinutesParenthesized", { count: Math.floor(seconds / 60) });
  if (seconds < 86_400)
    return t("chatModeration.durationHoursParenthesized", { count: Math.floor(seconds / 3600) });
  return t("chatModeration.durationDaysParenthesized", { count: Math.floor(seconds / 86_400) });
}

export function UserModHistory({
  platform,
  channelId,
  channelSlug,
  targetUserId,
  refreshCounter = 0,
  limit = 5,
}: UserModHistoryProps) {
  const { t } = useTranslation();
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
        {t("chatModeration.loadingHistory")}
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
            {t("chatModeration.couldntLoadRetry")}
          </button>
        ) : (
          <p className="flex items-center gap-2 text-xs text-red-200">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            {t("chatModeration.couldntLoad")}
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
        {t("chatModeration.noModerationActions")}
      </div>
    );
  }
  return (
    <div>
      {result.state === "partial" ? (
        <p className="mb-2 text-xs text-amber-200" data-testid="user-mod-history-partial">
          {t("chatModeration.showingObservedHistory")}
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
              {formatRelative(entry.occurredAt, t)}
            </span>
            <span className="font-medium text-white">
              {entry.action}
              {formatDuration(entry.durationSeconds, t)}
            </span>
            <span className="text-[var(--color-foreground-muted)] truncate ml-auto">
              {t("chatModeration.moderatedBy", { username: entry.moderatorUsername })}
            </span>
            {entry.reason ? (
              <span
                className="basis-full truncate text-[var(--color-foreground-muted)]"
                aria-label={t("chatModeration.reason", { reason: entry.reason })}
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
