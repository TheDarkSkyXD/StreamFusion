/**
 * ChannelUnbanRequests — pending (and other-status) unban requests for a
 * channel. Any moderator with the scope can review; not broadcaster-gated.
 *
 * Twitch requires the GET to specify a single `status` filter — we expose
 * a dropdown defaulting to "pending". Approve/Deny open a small inline
 * textarea for optional resolution text → PATCH /moderation/unban_requests.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { withTwitchHelixRetry } from "@/backend/api/platforms/twitch/helix-retry";
import {
  getUnbanRequests,
  resolveUnbanRequest,
  type UnbanRequest,
  type UnbanRequestStatus,
} from "@/backend/api/platforms/twitch/twitch-helix-unban-requests";
import { useAuthStore } from "@/store/auth-store";

interface ChannelUnbanRequestsProps {
  broadcasterId: string;
  refreshCounter?: number;
}

const STATUS_OPTIONS: UnbanRequestStatus[] = [
  "pending",
  "approved",
  "denied",
  "acknowledged",
  "canceled",
];

type Pending = { requestId: string; status: "approved" | "denied" };

export function ChannelUnbanRequests({
  broadcasterId,
  refreshCounter,
}: ChannelUnbanRequestsProps) {
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const [statusFilter, setStatusFilter] = useState<UnbanRequestStatus>("pending");
  const [entries, setEntries] = useState<UnbanRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    if (!broadcasterId || !twitchUser) return;
    setLoading(true);
    setError(null);
    try {
      const accessToken = await window.electronAPI.auth.getValidTwitchToken();
      const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
      if (!accessToken || !clientId) {
        setError("Missing Twitch credentials.");
        return;
      }
      const result = await withTwitchHelixRetry(
        {
          accessToken,
          clientId,
          broadcasterId,
          moderatorId: twitchUser.id,
          status: statusFilter,
        },
        getUnbanRequests,
      );
      if (!result.ok) {
        setError(`Couldn't load unban requests — ${result.kind}`);
        setEntries([]);
        return;
      }
      setEntries(result.payload.data);
    } finally {
      setLoading(false);
    }
  }, [broadcasterId, twitchUser, statusFilter]);

  useEffect(() => {
    void refetch();
  }, [refetch, refreshCounter]);

  const openPending = (requestId: string, status: "approved" | "denied") => {
    setPending({ requestId, status });
    setResolutionText("");
  };

  const cancelPending = () => {
    setPending(null);
    setResolutionText("");
  };

  const confirmPending = async () => {
    if (!pending || !twitchUser) return;
    setBusy(true);
    try {
      const token = await window.electronAPI.auth.getToken("twitch");
      const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
      if (!token?.accessToken || !clientId) {
        toast.error("Couldn't resolve — missing Twitch credentials");
        return;
      }
      const result = await resolveUnbanRequest({
        accessToken: token.accessToken,
        clientId,
        broadcasterId,
        moderatorId: twitchUser.id,
        unbanRequestId: pending.requestId,
        status: pending.status,
        resolutionText: resolutionText.trim().length > 0 ? resolutionText.trim() : undefined,
      });
      if (!result.ok) {
        toast.error(`Couldn't ${pending.status === "approved" ? "approve" : "deny"} — ${result.kind}`);
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== pending.requestId));
      toast.success(pending.status === "approved" ? "Unban approved" : "Unban denied");
      cancelPending();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="channel-unban-requests">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Pending unban requests</h2>
        <select
          aria-label="Status filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as UnbanRequestStatus)}
          data-testid="unban-requests-status-filter"
          className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </header>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-300" data-testid="channel-unban-requests-error">
          {error}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-400">No pending unban requests.</p>
      ) : (
        <ul className="space-y-2" data-testid="channel-unban-requests-results">
          {entries.map((row) => (
            <li
              key={row.id}
              data-testid={`unban-request-row-${row.id}`}
              className="rounded border border-[var(--color-border)] bg-white/5 px-3 py-2 text-sm text-white"
            >
              <div className="mb-1 flex items-center gap-3">
                <span className="font-medium">{row.user_name || row.user_login}</span>
                <span className="text-xs text-[var(--color-foreground-muted)]">
                  {row.created_at}
                </span>
              </div>
              <p className="mb-2 whitespace-pre-wrap text-sm text-[var(--color-foreground)]">
                {row.text}
              </p>
              {pending && pending.requestId === row.id ? (
                <div className="flex flex-col gap-2" data-testid={`unban-pending-${row.id}`}>
                  <textarea
                    aria-label="Resolution text"
                    value={resolutionText}
                    onChange={(e) => setResolutionText(e.target.value)}
                    placeholder="Optional resolution text"
                    className="rounded border border-[var(--color-border)] bg-black/30 px-2 py-1 text-sm text-white"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmPending()}
                      disabled={busy}
                      data-testid={`unban-confirm-${pending.status}-${row.id}`}
                      className="rounded bg-[#9146FF] px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {busy
                        ? "Working…"
                        : pending.status === "approved"
                          ? "Confirm approve"
                          : "Confirm deny"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelPending}
                      disabled={busy}
                      className="rounded border border-[var(--color-border)] bg-white/5 px-3 py-1 text-xs text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openPending(row.id, "approved")}
                    data-testid={`unban-approve-button-${row.id}`}
                    className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => openPending(row.id, "denied")}
                    data-testid={`unban-deny-button-${row.id}`}
                    className="rounded bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-600"
                  >
                    Deny
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
