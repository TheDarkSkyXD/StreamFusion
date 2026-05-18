/**
 * RaidTargetPicker
 *
 * Typeahead picker plugged into the {@link ModActionConfirmDialog} extraSlot
 * when the moderator clicks the strip's Raid action. Filters the user's
 * followed Twitch channels and surfaces a short "Recent" list pulled from
 * the key/value store under `recent-raids-<selfBroadcasterId>`.
 *
 * Recent-raids storage is the caller's responsibility: this component only
 * READS the list. The TwitchChat onConfirm branch is what appends a
 * successfully-raided target back to the store.
 */

import { useEffect, useMemo, useState } from "react";

import { useFollowStore } from "@/store/follow-store";

export interface RaidTarget {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
}

export interface RaidTargetPickerProps {
  selfBroadcasterId: string;
  disabled: boolean;
  onChange: (target: RaidTarget | null) => void;
}

export function recentRaidsKey(selfBroadcasterId: string): string {
  return `recent-raids-${selfBroadcasterId}`;
}

const RECENT_LIMIT = 10;

export function RaidTargetPicker({
  selfBroadcasterId,
  disabled,
  onChange,
}: RaidTargetPickerProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RaidTarget | null>(null);
  const [recent, setRecent] = useState<RaidTarget[]>([]);

  // Pull the recent-raids list once on mount. Errors are swallowed — a stale
  // empty list just means the moderator types out their target.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await window.electronAPI.store.get<RaidTarget[]>(
          recentRaidsKey(selfBroadcasterId),
        );
        if (!cancelled && Array.isArray(stored)) {
          setRecent(stored.slice(0, RECENT_LIMIT));
        }
      } catch {
        // Ignore — empty list is the right fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selfBroadcasterId]);

  // Follows are kept in-memory by useFollowStore so we can filter
  // synchronously as the moderator types.
  const follows = useFollowStore((state) => state.localFollows);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const twitchFollows = follows.filter((c) => c.platform === "twitch");
    if (!trimmed) return twitchFollows.slice(0, 25);
    return twitchFollows
      .filter((c) => {
        const u = c.username?.toLowerCase() ?? "";
        const d = c.displayName?.toLowerCase() ?? "";
        return u.includes(trimmed) || d.includes(trimmed);
      })
      .slice(0, 25);
  }, [follows, query]);

  const handlePick = (target: RaidTarget) => {
    setSelected(target);
    setQuery(target.broadcasterName || target.broadcasterLogin);
    onChange(target);
  };

  return (
    <div className="space-y-3" data-testid="raid-target-picker">
      <label className="block text-sm font-medium text-[#EFEFF1]">
        Raid target
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Clearing the input also clears the lifted selection so the
            // dialog's confirm button can stay disabled on empty.
            if (selected) {
              setSelected(null);
              onChange(null);
            }
          }}
          disabled={disabled}
          placeholder="Search your follows"
          aria-label="Raid target search"
          className="mt-1 w-full px-2 py-1.5 bg-white/5 border border-[var(--color-border)] rounded text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-400 disabled:opacity-50"
        />
      </label>

      {filtered.length > 0 ? (
        <ul
          className="max-h-40 overflow-y-auto rounded border border-[var(--color-border)] bg-white/5 divide-y divide-[var(--color-border)]"
          data-testid="raid-target-picker-results"
        >
          {filtered.map((channel) => {
            const target: RaidTarget = {
              broadcasterId: channel.id,
              broadcasterLogin: channel.username,
              broadcasterName: channel.displayName || channel.username,
            };
            return (
              <li key={channel.id || channel.username}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handlePick(target)}
                  className="w-full text-left px-2 py-1 text-sm text-[#EFEFF1] hover:bg-white/10 disabled:opacity-50"
                >
                  {target.broadcasterName}
                  <span className="text-xs text-gray-400 ml-2">
                    @{target.broadcasterLogin}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-gray-500" data-testid="raid-target-picker-empty">
          No matches
        </p>
      )}

      {recent.length > 0 ? (
        <div data-testid="raid-target-picker-recent">
          <p className="text-xs font-semibold text-gray-400 mb-1">Recent</p>
          <ul className="space-y-0.5">
            {recent.slice(0, RECENT_LIMIT).map((target) => (
              <li key={target.broadcasterId}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handlePick(target)}
                  className="w-full text-left px-2 py-1 text-xs text-[#EFEFF1] hover:bg-white/10 rounded disabled:opacity-50"
                >
                  {target.broadcasterName}
                  <span className="text-gray-500 ml-2">
                    @{target.broadcasterLogin}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Append a freshly-raided target to the recent-raids list, dedupe by
 * broadcasterId, keep newest first, cap at {@link RECENT_LIMIT}. Safe to
 * call from a Promise context — failures are swallowed.
 */
export async function appendRecentRaid(
  selfBroadcasterId: string,
  target: RaidTarget,
): Promise<void> {
  try {
    const key = recentRaidsKey(selfBroadcasterId);
    const existing =
      (await window.electronAPI.store.get<RaidTarget[]>(key)) ?? [];
    const deduped = [target, ...existing.filter((t) => t.broadcasterId !== target.broadcasterId)];
    await window.electronAPI.store.set(key, deduped.slice(0, RECENT_LIMIT));
  } catch {
    // Best-effort — recent-raids is a convenience surface, not load-bearing.
  }
}
