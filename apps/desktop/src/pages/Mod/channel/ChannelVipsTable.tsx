/**
 * ChannelVipsTable — broadcaster-only roster of channel VIPs.
 *
 * Reads from Helix `GET /channels/vips` (first 100). Identical shape to
 * ChannelModeratorsTable — Add/Remove dispatch to the U6 add/removeVip
 * mutations rather than the moderator equivalents.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { TwitchChannelMember } from "@/shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";

interface ChannelVipsTableProps {
  broadcasterId: string;
  refreshCounter?: number;
}

interface ResolvedUser {
  id: string;
  login: string;
  display_name: string;
}

async function resolveLogin(login: string): Promise<ResolvedUser | null> {
  const result = await window.electronAPI.twitch.execute({
    operation: "resolve-channel",
    login: login.trim().toLowerCase(),
  });
  if (!result.ok || !result.data) return null;
  const user = result.data as { id: string; login: string; displayName: string };
  return { id: user.id, login: user.login, display_name: user.displayName };
}

export function ChannelVipsTable({ broadcasterId, refreshCounter }: ChannelVipsTableProps) {
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const [entries, setEntries] = useState<TwitchChannelMember[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Map<string, boolean>>(new Map());

  const refetch = useCallback(async () => {
    if (!broadcasterId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.twitch.execute({
        operation: "get-vips",
        broadcasterId,
      });
      if (!result.ok) {
        setError(`Couldn't load VIPs — ${result.error.message}`);
        setEntries([]);
        setHasMore(false);
        return;
      }
      const page = result.data as { data: TwitchChannelMember[]; pagination: { cursor?: string } };
      setEntries(page.data);
      setHasMore(Boolean(page.pagination.cursor));
    } finally {
      setLoading(false);
    }
  }, [broadcasterId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refreshCounter` is the re-fetch trigger; the body doesn't read it
  useEffect(() => {
    void refetch();
  }, [refetch, refreshCounter]);

  const handleAdd = async () => {
    const trimmed = addInput.trim();
    if (!trimmed) return;
    if (!twitchUser) return;
    setAdding(true);
    try {
      const resolved = await resolveLogin(trimmed);
      if (!resolved) {
        toast.error(`Couldn't find user "${trimmed}"`);
        return;
      }
      const result = await window.electronAPI.twitch.execute({
        operation: "add-vip",
        broadcasterId,
        userId: resolved.id,
      });
      if (!result.ok) {
        toast.error(`Couldn't add VIP — ${result.error.message}`);
        return;
      }
      setEntries((prev) => [
        ...prev,
        {
          user_id: resolved.id,
          user_login: resolved.login,
          user_name: resolved.display_name,
        },
      ]);
      toast.success(`Added ${resolved.display_name} as VIP`);
      setAddInput("");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (row: TwitchChannelMember) => {
    setRemoving((prev) => new Map(prev).set(row.user_id, true));
    try {
      const result = await window.electronAPI.twitch.execute({
        operation: "remove-vip",
        broadcasterId,
        userId: row.user_id,
      });
      if (!result.ok) {
        toast.error(`Couldn't remove VIP — ${result.error.message}`);
        return;
      }
      setEntries((prev) => prev.filter((e) => e.user_id !== row.user_id));
      toast.success(`Removed ${row.user_name || row.user_login}`);
    } finally {
      setRemoving((prev) => {
        const next = new Map(prev);
        next.delete(row.user_id);
        return next;
      });
    }
  };

  return (
    <section data-testid="channel-vips-table">
      <h2 className="text-xl font-semibold mb-3 text-white">VIPs</h2>
      <div className="mb-3 flex gap-2">
        <input
          type="text"
          aria-label="Add VIP by username"
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          placeholder="username"
          disabled={adding}
          className="flex-1 rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding || addInput.trim().length === 0}
          data-testid="add-vip-button"
          className="rounded bg-[#9146FF] px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-300" data-testid="channel-vips-error">
          {error}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-neutral-400">No VIPs yet.</p>
      ) : (
        <ul className="space-y-1" data-testid="channel-vips-results">
          {entries.map((row) => {
            const rowBusy = removing.get(row.user_id) === true;
            return (
              <li
                key={row.user_id}
                data-testid={`vip-row-${row.user_id}`}
                className="flex items-center gap-3 rounded border border-[var(--color-border)] bg-white/5 px-3 py-2 text-sm text-white"
              >
                <span className="font-medium">{row.user_name || row.user_login}</span>
                <button
                  type="button"
                  onClick={() => void handleRemove(row)}
                  disabled={rowBusy}
                  data-testid={`remove-vip-button-${row.user_id}`}
                  className="ml-auto rounded border border-[var(--color-border)] bg-white/5 px-2 py-1 text-xs text-white hover:bg-white/10 disabled:opacity-50"
                >
                  {rowBusy ? "Removing…" : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore ? (
        <p className="mt-2 text-xs text-[var(--color-foreground-muted)]">Showing first 100 VIPs.</p>
      ) : null}
    </section>
  );
}
