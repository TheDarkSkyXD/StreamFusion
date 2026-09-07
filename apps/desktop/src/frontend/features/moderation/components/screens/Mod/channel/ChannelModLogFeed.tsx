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

import { useModLog } from "@/features/moderation/components/hooks/useModLog";
import { Platform } from "@streamfusion/core/platform";
import {
  ALL_MOD_ACTION_FILTER_IDS,
  ModActionFilterMenu,
  selectedModLogActions,
} from "./ModActionFilterMenu";

const PAGE_INCREMENT = 50;

export interface ChannelModLogFeedProps {
  platform: Platform;
  channelId: string;
  channelSlug: string;
  /** Optional bump to force a re-fetch (refresh button). */
  refreshCounter?: number;
  presentation?: "standalone" | "embedded";
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
  presentation = "standalone",
}: ChannelModLogFeedProps) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [selectedActionFilters, setSelectedActionFilters] = useState([
    ...ALL_MOD_ACTION_FILTER_IDS,
  ]);
  const [moderatorFilter, setModeratorFilter] = useState<string>("");
  const [limit, setLimit] = useState<number>(PAGE_INCREMENT);

  const trimmedModerator = moderatorFilter.trim();
  const actions = useMemo(
    () => selectedModLogActions(selectedActionFilters),
    [selectedActionFilters]
  );

  const { result, entries, retry } = useModLog({
    platform,
    channelId,
    channelSlug,
    actions,
    moderatorUsername: trimmedModerator.length > 0 ? trimmedModerator : undefined,
    limit,
    refreshCounter,
  });

  const canLoadMore = useMemo(() => entries.length === limit, [entries.length, limit]);
  const isEmbedded = presentation === "embedded";

  return (
    <section
      data-testid="channel-mod-log-feed"
      className={
        isEmbedded
          ? "flex h-full min-h-0 flex-col"
          : "overflow-hidden rounded-md border border-[#303034] bg-[#18181b]"
      }
    >
      {!isEmbedded ? (
        <header className="flex h-10 items-center bg-[#252529] px-3">
          <h2 className="text-sm font-semibold text-white">{t("moderation.modLog")}</h2>
        </header>
      ) : null}
      <div className={isEmbedded ? "flex min-h-0 flex-1 flex-col" : ""}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#303034] bg-[#18181b] p-2">
          <ModActionFilterMenu
            platform={platform}
            selectedIds={selectedActionFilters}
            onSelectedIdsChange={(selectedIds) => {
              setSelectedActionFilters(selectedIds);
              setLimit(PAGE_INCREMENT);
            }}
            moderatorFilter={moderatorFilter}
            onModeratorFilterChange={(value) => {
              setModeratorFilter(value);
              setLimit(PAGE_INCREMENT);
            }}
          />
        </div>

        <div className={`min-h-0 overflow-y-auto ${isEmbedded ? "flex-1" : "max-h-[400px]"}`}>
          {result.state === "loading" ? (
            <div className="p-4 text-xs text-[#adadb8]" role="status">
              {t("moderation.loading")}
            </div>
          ) : result.state === "error" ? (
            <div className="flex items-center justify-between gap-2 p-4 text-xs text-[#ffb9b9]">
              <span>{t("moderation.historyNotVerified")}</span>
              {result.retryable ? (
                <button
                  type="button"
                  className="h-7 rounded-md bg-[#30263f] px-2 text-xs font-semibold text-[#e5d5ff] hover:bg-[#423052] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf94ff]"
                  onClick={retry}
                >
                  {t("moderation.retry")}
                </button>
              ) : null}
            </div>
          ) : result.state === "verified-empty" ? (
            <div className="p-5 text-center text-xs text-[#adadb8]">
              {t("moderation.noModLogEntries")}
            </div>
          ) : (
            <div className="divide-y divide-[#2b2b30]">
              {result.state === "partial" ? (
                <p className="bg-[#2b2415] px-3 py-2 text-xs text-[#f4d48d]">
                  {t("moderation.observedHistoryOnly")}
                </p>
              ) : null}
              <ul>
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    data-testid="modlog-row"
                    data-action={entry.action}
                    className="grid grid-cols-[minmax(5rem,auto)_minmax(5rem,1fr)_minmax(5rem,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-xs text-[#efeff1] sm:grid-cols-[7.5rem_7rem_minmax(7rem,1fr)_minmax(6rem,1fr)]"
                  >
                    <time
                      className="text-[#777780]"
                      dateTime={new Date(entry.createdAt).toISOString()}
                    >
                      {formatTimestamp(entry.createdAt, locale)}
                    </time>
                    <span className="font-semibold text-[#d7c2ff]">{entry.action}</span>
                    <span className="font-medium text-white" data-testid="modlog-target-username">
                      {entry.targetUsername}
                    </span>
                    <span className="text-[#adadb8]">{entry.moderatorUsername}</span>
                    {entry.durationSeconds ? (
                      <span className="col-span-full text-[#adadb8]">
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
          <div className="flex justify-center border-t border-[#303034] p-2">
            <button
              type="button"
              data-testid="modlog-load-more"
              onClick={() => setLimit((n) => n + PAGE_INCREMENT)}
              className="h-8 rounded-md border border-[#3d3d43] bg-[#252529] px-3 text-xs font-semibold text-white hover:bg-[#303034] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf94ff]"
            >
              {t("moderation.loadMore")}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
