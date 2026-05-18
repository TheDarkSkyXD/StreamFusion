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

import type { ModLogAction } from "@/backend/services/mod-log-writer";
import { useModLog } from "@/hooks/useModLog";

import { useOpenUserPopout } from "../UserPopout/UserPopoutProvider";

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

export interface ModLogTabProps {
  channelId: string;
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

export function ModLogTab({ channelId }: ModLogTabProps) {
  const [actionFilter, setActionFilter] = useState<"" | ModLogAction>("");
  const [moderatorFilter, setModeratorFilter] = useState<string>("");
  const [limit, setLimit] = useState<number>(PAGE_INCREMENT);

  const openUserPopout = useOpenUserPopout();

  const trimmedModerator = moderatorFilter.trim();

  const { entries, loading } = useModLog({
    channelId,
    action: actionFilter === "" ? undefined : actionFilter,
    moderatorUsername:
      trimmedModerator.length > 0 ? trimmedModerator : undefined,
    limit,
  });

  // If a Load More query returned fewer than `limit` rows, the table is
  // exhausted — hide the button.
  const canLoadMore = useMemo(
    () => entries.length === limit,
    [entries.length, limit],
  );

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <div className="flex flex-wrap gap-2 p-2 border-b border-[var(--color-border)] bg-white/5">
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

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
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
                <button
                  type="button"
                  data-testid="modlog-target-username"
                  onClick={() =>
                    openUserPopout({
                      userId: entry.targetUserId,
                      username: entry.targetUsername,
                      // Best-effort: we don't carry platform in mod_log rows.
                      // Default to twitch for now; popout handles both.
                      platform: "twitch",
                      channelId: entry.channelId,
                      channelSlug: entry.channelSlug,
                    })
                  }
                  className="text-white hover:underline"
                >
                  {entry.targetUsername}
                </button>
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
  );
}
