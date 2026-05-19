/**
 * ChannelModLogFeed — paginated mod_log feed for a single channel.
 *
 * The in-chat `ModLogTab` (src/components/chat/mod/tabs/ModLogTab.tsx) is the
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

import type { ModLogAction } from "@/backend/services/mod-log-writer";
import { useModLog } from "@/hooks/useModLog";

const ACTION_OPTIONS: Array<{ value: "" | ModLogAction; label: string }> = [
  { value: "", label: "All actions" },
  { value: "ban", label: "Ban" },
  { value: "timeout", label: "Timeout" },
  { value: "unban", label: "Unban" },
  { value: "delete", label: "Delete" },
  { value: "clear", label: "Chat mode" },
  { value: "raid", label: "Raid" },
];

const PAGE_INCREMENT = 50;

export interface ChannelModLogFeedProps {
  channelId: string;
  /** Optional bump to force a re-fetch (refresh button). */
  refreshCounter?: number;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function ChannelModLogFeed({ channelId, refreshCounter }: ChannelModLogFeedProps) {
  const [actionFilter, setActionFilter] = useState<"" | ModLogAction>("");
  const [moderatorFilter, setModeratorFilter] = useState<string>("");
  const [limit, setLimit] = useState<number>(PAGE_INCREMENT);

  const trimmedModerator = moderatorFilter.trim();

  const { entries, loading } = useModLog({
    channelId,
    action: actionFilter === "" ? undefined : actionFilter,
    moderatorUsername:
      trimmedModerator.length > 0 ? trimmedModerator : undefined,
    limit,
    refreshCounter,
  });

  const canLoadMore = useMemo(
    () => entries.length === limit,
    [entries.length, limit],
  );

  return (
    <section data-testid="channel-mod-log-feed">
      <h2 className="text-xl font-semibold mb-3 text-white">Mod log</h2>
      <div className="rounded border border-[var(--color-border)] bg-white/5">
        <div className="flex flex-wrap gap-2 p-2 border-b border-[var(--color-border)]">
          <select
            aria-label="Filter by action"
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
                {opt.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Moderator username"
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
          {loading ? (
            <div className="text-sm text-gray-400 p-2">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-gray-400 p-2">No mod-log entries.</div>
          ) : (
            <ul className="space-y-1">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  data-testid="modlog-row"
                  data-action={entry.action}
                  className="text-xs text-gray-200 border-b border-white/5 py-1 flex flex-wrap gap-2 items-baseline"
                >
                  <span className="text-gray-500">
                    {formatTimestamp(entry.createdAt)}
                  </span>
                  <span className="text-purple-300 font-medium">
                    {entry.moderatorUsername}
                  </span>
                  <span className="text-yellow-200">{entry.action}</span>
                  <span
                    className="text-white"
                    data-testid="modlog-target-username"
                  >
                    {entry.targetUsername}
                  </span>
                  {entry.durationSeconds ? (
                    <span className="text-gray-400">
                      ({formatDuration(entry.durationSeconds)})
                    </span>
                  ) : null}
                  {entry.reason ? (
                    <span className="text-gray-400 italic">
                      — {entry.reason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
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
              Load more
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
