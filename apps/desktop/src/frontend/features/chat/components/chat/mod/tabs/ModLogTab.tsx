/**
 * U22 — Mod log tab.
 *
 * Renders the local `mod_log` rows for the current channel with two filters
 * (action type + moderator username) and a Load More button. Username
 * clicks open the user popout via U18 (`useOpenUserPopout`).
 *
 * Backfill from Helix is intentionally out of scope (see U12.1 follow-up
 * territory). This view shows what's already in the local table — the
 * writer side (U12) is the source of truth.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ModLogAction } from "@backend/services/mod-log-writer";
import { useModLog } from "@/features/moderation/data/useModLog";
import { Platform } from "@streamfusion/core/platform";

import { useOpenUserPopout } from "../UserPopout/UserPopoutProvider";

const ACTION_OPTIONS = [
  { value: "", labelKey: "chatModeration.allActions" },
  { value: "ban", labelKey: "chatModeration.ban" },
  { value: "timeout", labelKey: "chatModeration.timeout" },
  { value: "unban", labelKey: "chatModeration.unban" },
  { value: "delete", labelKey: "chatModeration.delete" },
  { value: "clear", labelKey: "chatModeration.chatMode" },
  { value: "raid", labelKey: "chatModeration.raid" },
] as const satisfies ReadonlyArray<{
  value: "" | ModLogAction;
  labelKey: `chatModeration.${string}`;
}>;

const PAGE_INCREMENT = 50;

export interface ModLogTabProps {
  platform: Platform;
  channelId: string;
  channelSlug: string;
}

function formatTimestamp(ms: number, language: string): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(language)} ${d.toLocaleTimeString(language)}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function ModLogTab({ platform, channelId, channelSlug }: ModLogTabProps) {
  const { i18n, t } = useTranslation();
  const [actionFilter, setActionFilter] = useState<"" | ModLogAction>("");
  const [moderatorFilter, setModeratorFilter] = useState<string>("");
  const [limit, setLimit] = useState<number>(PAGE_INCREMENT);

  const openUserPopout = useOpenUserPopout();

  const trimmedModerator = moderatorFilter.trim();

  const { result, entries, retry } = useModLog({
    platform,
    channelId,
    channelSlug,
    action: actionFilter === "" ? undefined : actionFilter,
    moderatorUsername: trimmedModerator.length > 0 ? trimmedModerator : undefined,
    limit,
  });

  // If a Load More query returned fewer than `limit` rows, the table is
  // exhausted — hide the button.
  const canLoadMore = useMemo(() => entries.length === limit, [entries.length, limit]);

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div className="flex flex-wrap gap-2 p-2 border-b border-[var(--color-border)] bg-white/5">
        <select
          aria-label={t("chatModeration.filterByAction")}
          data-testid="modlog-action-filter"
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value as "" | ModLogAction);
            setLimit(PAGE_INCREMENT);
          }}
          className="bg-[var(--color-background-tertiary,#1a1a1a)] text-xs text-white border border-[var(--color-border)] rounded px-2 py-1"
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder={t("chatModeration.moderatorUsername")}
          data-testid="modlog-moderator-filter"
          value={moderatorFilter}
          onChange={(e) => {
            setModeratorFilter(e.target.value);
            setLimit(PAGE_INCREMENT);
          }}
          className="bg-[var(--color-background-tertiary,#1a1a1a)] text-xs text-white border border-[var(--color-border)] rounded px-2 py-1 flex-1 min-w-[150px]"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {result.state === "loading" ? (
          <div className="text-sm text-neutral-400 p-2">{t("chatModeration.loading")}</div>
        ) : result.state === "error" ? (
          <div className="flex items-center justify-between gap-2 p-2 text-sm text-red-300">
            <span>{t("chatModeration.historyUnavailable")}</span>
            {result.retryable ? (
              <button type="button" className="rounded px-2 py-1 text-white" onClick={retry}>
                {t("chatModeration.retry")}
              </button>
            ) : null}
          </div>
        ) : result.state === "verified-empty" ? (
          <div className="text-sm text-neutral-400 p-2">{t("chatModeration.noModLogEntries")}</div>
        ) : (
          <div>
            {result.state === "partial" ? (
              <p className="p-2 text-xs text-amber-200">
                {t("chatModeration.observedHistoryOnly")}
              </p>
            ) : null}
            <ul className="space-y-1">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  data-testid="modlog-row"
                  data-action={entry.action}
                  className="text-xs text-neutral-200 border-b border-white/5 py-1 flex flex-wrap gap-2 items-baseline"
                >
                  <span className="text-neutral-500">
                    {formatTimestamp(entry.createdAt, i18n.resolvedLanguage ?? i18n.language)}
                  </span>
                  <span className="text-purple-300 font-medium">{entry.moderatorUsername}</span>
                  <span className="text-yellow-200">
                    {t(
                      ACTION_OPTIONS.find((option) => option.value === entry.action)?.labelKey ??
                        "chatModeration.allActions"
                    )}
                  </span>
                  <button
                    type="button"
                    data-testid="modlog-target-username"
                    onClick={() =>
                      openUserPopout({
                        userId: entry.targetUserId,
                        username: entry.targetUsername,
                        platform: entry.platform ?? platform,
                        channelId: entry.channelId,
                        channelSlug: entry.channelSlug,
                      })
                    }
                    className="text-white hover:underline"
                  >
                    {entry.targetUsername}
                  </button>
                  {entry.durationSeconds ? (
                    <span className="text-neutral-400">
                      ({formatDuration(entry.durationSeconds)})
                    </span>
                  ) : null}
                  {entry.reason ? (
                    <span className="text-neutral-400 italic">— {entry.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {canLoadMore ? (
        <div className="border-t border-[var(--color-border)] p-2 flex justify-center">
          <button
            type="button"
            data-testid="modlog-load-more"
            onClick={() => setLimit((n) => n + PAGE_INCREMENT)}
            className="text-xs bg-white/5 hover:bg-white/10 text-white rounded px-3 py-1 border border-[var(--color-border)]"
          >
            {t("chatModeration.loadMore")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
