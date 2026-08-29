/**
 * ChannelBannedList — single-channel banned-user list.
 *
 * Twitch:  Helix `GET /moderation/banned?broadcaster_id=...&first=100`.
 * Kick:    no public banned-users endpoint — renders an informational note.
 *
 * Each row carries an inline Unban button (Twitch only). Clicking calls the
 * Helix DELETE /moderation/bans helper from U6 with the row's user_id, the
 * signed-in user's id as moderator_id, and optimistically drops the row on
 * success. Failures keep the row and surface a sonner toast.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { TwitchBannedUser } from "@shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";

interface ChannelBannedListProps {
  platform: "twitch" | "kick";
  /** Numeric broadcaster_id for Twitch; ignored for Kick. */
  broadcasterId?: string;
  /** Bumped by parent's refresh button. */
  refreshCounter?: number;
}

function formatRemaining(expiresAt: string | ""): string {
  if (!expiresAt) return "Permanent";
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return "";
  const remaining = end - Date.now();
  if (remaining <= 0) return "expired";
  const sec = Math.floor(remaining / 1000);
  if (sec < 60) return `${sec}s left`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m left`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h left`;
  const day = Math.floor(hr / 24);
  return `${day}d left`;
}

export function ChannelBannedList({
  platform,
  broadcasterId,
  refreshCounter,
}: ChannelBannedListProps) {
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const [entries, setEntries] = useState<TwitchBannedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Map<string, boolean>>(new Map());

  const isTwitch = platform === "twitch";

  const refetch = useCallback(async () => {
    if (!isTwitch) return;
    if (!broadcasterId || !twitchUser) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.twitch.execute({
        operation: "get-banned-users",
        broadcasterId,
      });
      if (!result.ok) {
        setError(result.error.message);
        setEntries([]);
        return;
      }
      setEntries((result.data as { data: TwitchBannedUser[] }).data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Network error: ${msg}`);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [isTwitch, broadcasterId, twitchUser]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshCounter` is the re-fetch trigger; the body doesn't read it
  useEffect(() => {
    void refetch();
  }, [refetch, refreshCounter]);

  const setRowBusy = (userId: string, value: boolean) => {
    setBusy((prev) => {
      const next = new Map(prev);
      if (value) next.set(userId, true);
      else next.delete(userId);
      return next;
    });
  };

  const handleUnban = async (row: TwitchBannedUser) => {
    if (!broadcasterId || !twitchUser) return;
    setRowBusy(row.user_id, true);
    try {
      const result = await window.electronAPI.twitch.execute({
        operation: "unban-user",
        broadcasterId,
        moderatorId: twitchUser.id,
        userId: row.user_id,
      });
      if (!result.ok) {
        toast.error(`Couldn't unban — ${result.error.message}`);
        return;
      }
      setEntries((prev) => prev.filter((e) => e.user_id !== row.user_id));
      toast.success(`Unbanned ${row.user_name || row.user_login}`);
    } finally {
      setRowBusy(row.user_id, false);
    }
  };

  if (!isTwitch) {
    return (
      <section data-testid="channel-banned-list-kick">
        <h2 className="text-xl font-semibold mb-3 text-white">Banned users</h2>
        <p className="text-sm text-neutral-400">
          Kick doesn't expose a public banned-users list endpoint.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="channel-banned-list">
      <h2 className="text-xl font-semibold mb-3 text-white">Banned users</h2>
      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-300" data-testid="channel-banned-list-error">
          {error}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-neutral-400">No banned users.</p>
      ) : (
        <ul className="space-y-1" data-testid="channel-banned-list-results">
          {entries.map((row) => {
            const rowBusy = busy.get(row.user_id) === true;
            return (
              <li
                key={row.user_id}
                data-testid={`banned-row-${row.user_id}`}
                className="flex items-center gap-3 rounded border border-[var(--color-border)] bg-white/5 px-3 py-2 text-sm text-white"
              >
                <span className="font-medium">{row.user_login}</span>
                <span className="text-xs text-[var(--color-foreground-muted)]">
                  {formatRemaining(row.expires_at)}
                </span>
                {row.moderator_login ? (
                  <span className="text-xs text-[var(--color-foreground-muted)]">
                    by {row.moderator_login}
                  </span>
                ) : null}
                {row.reason ? (
                  <span className="truncate text-xs text-[var(--color-foreground-muted)]">
                    {row.reason}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleUnban(row)}
                  disabled={rowBusy}
                  data-testid={`unban-button-${row.user_id}`}
                  className="ml-auto rounded border border-[var(--color-border)] bg-white/5 px-2 py-1 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                >
                  {rowBusy ? "Unbanning…" : "Unban"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
