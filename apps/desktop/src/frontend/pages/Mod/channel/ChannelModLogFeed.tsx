/**
 * ChannelModLogFeed — paginated mod_log feed for a single channel.
 *
 * The in-chat `ModLogTab` (src/frontend/features/chat/components/chat/mod/tabs/ModLogTab.tsx) is the
 * primary surface; it depends on UserPopoutProvider context, which the
 * standalone `/mod` page does not mount. Rather than retrofit that
 * dependency, this is a slim variant that renders the same row shape minus
 * the popout click handler — the row's target username is plain text here.
 *
 * Keep the two in rough lockstep: filter set, page increment, and timestamp
 * formatting mirror the in-chat tab so a mod sees a familiar layout in
 * either place.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { ModLogAction } from "@backend/services/mod-log-writer";
import { useModLog } from "@/features/moderation/data/useModLog";
import { Platform } from "@streamfusion/core/platform";

const ACTION_OPTIONS: Array<{
  value: "" | ModLogAction;
  labelKey: "allActions" | "ban" | "timeout" | "unban" | "delete" | "chatMode" | "raid";
}> = [
  { value: "", labelKey: "allActions" },
  { value: "ban", labelKey: "ban" },
  { value: "timeout", labelKey: "timeout" },
  { value: "unban", labelKey: "unban" },
  { value: "delete", labelKey: "delete" },
  { value: "clear", labelKey: "chatMode" },
  { value: "raid", labelKey: "raid" },
];

const PAGE_INCREMENT = 50;

export interface ChannelModLogFeedProps {
  platform: Platform;
  channelId: string;
  channelSlug: string;
  /** Optional bump to force a re-fetch (refresh button). */
  refreshCounter?: number;
}

function formatTimestamp(ms: number, locale: string): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale)}`;
}

function formatDuration(seconds: number | null | undefined, t: TFunction): string {
  if (!seconds) return "";
  if (seconds < 60) return t("moderation.durationSeconds", { count: seconds });
  if (seconds < 3600) return t("moderation.durationMinutes", { count: Math.floor(seconds / 60) });
  if (seconds < 86_400) return t("moderation.durationHours", { count: Math.floor(seconds / 3600) });
  return t("moderation.durationDays", { count: Math.floor(seconds / 86_400) });
}

export function ChannelModLogFeed({
  platform,
  channelId,
  channelSlug,
  refreshCounter,
}: ChannelModLogFeedProps) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [actionFilter, setActionFilter] = useState<"" | ModLogAction>("");
  const [moderatorFilter, setModeratorFilter] = useState<string>("");
  const [limit, setLimit] = useState<number>(PAGE_INCREMENT);

  const trimmedModerator = moderatorFilter.trim();

  const { result, entries, retry } = useModLog({
    platform,
    channelId,
    channelSlug,
    action: actionFilter === "" ? undefined : actionFilter,
    moderatorUsername: trimmedModerator.length > 0 ? trimmedModerator : undefined,
    limit,
    refreshCounter,
  });

  const canLoadMore = useMemo(() => entries.length === limit, [entries.length, limit]);

  return (
    <section data-testid="channel-mod-log-feed">
      <h2 className="text-xl font-semibold mb-3 text-white">{t("moderation.modLog")}</h2>
      <div className="rounded border border-[var(--color-border)] bg-white/5">
        <div className="flex flex-wrap gap-2 p-2 border-b border-[var(--color-border)]">
          <select
            aria-label={t("moderation.filterByAction")}
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
                {t(`moderation.${opt.labelKey}`)}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder={t("moderation.moderatorUsername")}
            data-testid="modlog-moderator-filter"
            value={moderatorFilter}
            onChange={(e) => {
              setModeratorFilter(e.target.value);
              setLimit(PAGE_INCREMENT);
            }}
            className="bg-[var(--color-background-tertiary,#1a1a1a)] text-xs text-white border border-[var(--color-border)] rounded px-2 py-1 flex-1 min-w-[150px]"
          />
        </div>

        <div className="p-2 max-h-[400px] overflow-y-auto">
          {result.state === "loading" ? (
            <div className="text-sm text-neutral-400 p-2">{t("moderation.loading")}</div>
          ) : result.state === "error" ? (
            <div className="flex items-center justify-between gap-2 p-2 text-sm text-red-300">
              <span>{t("moderation.historyNotVerified")}</span>
              {result.retryable ? (
                <button
                  type="button"
                  className="rounded px-2 py-1 text-white hover:bg-white/10"
                  onClick={retry}
                >
                  {t("moderation.retry")}
                </button>
              ) : null}
            </div>
          ) : result.state === "verified-empty" ? (
            <div className="text-sm text-neutral-400 p-2">{t("moderation.noModLogEntries")}</div>
          ) : (
            <div>
              {result.state === "partial" ? (
                <p className="p-2 text-xs text-amber-200">{t("moderation.observedHistoryOnly")}</p>
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
                      {formatTimestamp(entry.createdAt, locale)}
                    </span>
                    <span className="text-purple-300 font-medium">{entry.moderatorUsername}</span>
                    <span className="text-yellow-200">{entry.action}</span>
                    <span className="text-white" data-testid="modlog-target-username">
                      {entry.targetUsername}
                    </span>
                    {entry.durationSeconds ? (
                      <span className="text-neutral-400">
                        ({formatDuration(entry.durationSeconds, t)})
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
              {t("moderation.loadMore")}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
