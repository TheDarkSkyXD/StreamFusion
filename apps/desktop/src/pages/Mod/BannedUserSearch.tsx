/**
 * U31 — Cross-channel banned-user search.
 *
 * Free-text username → resolve to user_id → fan out across every channel the
 * signed-in user moderates → render status pills (banned / timed-out /
 * not-banned / error / rate-limited).
 *
 * Per-channel results stream in via the `onResult` callback (progressive
 * rendering); when the fan-out finishes the final sorted array overwrites
 * `results` so the canonical order is honored.
 */

import { useCallback, useState } from "react";

import {
  searchUserAcrossChannels,
  type BanStatus,
  type CrossChannelBanResult,
} from "@/backend/api/platforms/twitch/twitch-helix-bans-cross-channel";
import { getModeratedChannels } from "@/backend/api/platforms/twitch/twitch-helix-moderation";
import { useAuthStore } from "@/store/auth-store";

const STATUS_LABEL: Record<BanStatus, string> = {
  banned: "Banned",
  "timed-out": "Timed out",
  "not-banned": "Not banned",
  error: "Error",
  "rate-limited": "Rate-limited",
};

const STATUS_CLASS: Record<BanStatus, string> = {
  banned: "bg-red-700 text-white",
  "timed-out": "bg-amber-600 text-white",
  "not-banned": "bg-emerald-700 text-white",
  error: "bg-zinc-600 text-white",
  "rate-limited": "bg-zinc-700 text-white",
};

function formatRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "";
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

export function BannedUserSearch() {
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CrossChannelBanResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    if (!twitchUser) {
      setEmptyMessage("Sign in to Twitch to search.");
      return;
    }

    setSearching(true);
    setEmptyMessage(null);
    setResults([]);

    try {
      const token = await window.electronAPI.auth.getToken("twitch");
      const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
      if (!token?.accessToken || !clientId) {
        setEmptyMessage("Missing Twitch credentials.");
        return;
      }

      // Pull broadcaster_login for each moderated channel — the store only
      // tracks ids, so we fetch the full channel list once at search time.
      const channels = await getModeratedChannels(
        twitchUser.id,
        token.accessToken,
        clientId,
      );

      if (channels.length === 0) {
        setEmptyMessage("You don't moderate any channels yet.");
        return;
      }

      const final = await searchUserAcrossChannels({
        username: trimmed,
        channels: channels.map((c) => ({
          broadcasterId: c.broadcaster_id,
          broadcasterLogin: c.broadcaster_login,
        })),
        accessToken: token.accessToken,
        moderatorUserId: twitchUser.id,
        clientId,
        onResult: (r) => {
          setResults((prev) => [...prev, r]);
        },
      });

      if (final.length === 0) {
        setEmptyMessage(`No Twitch user found for "${trimmed}".`);
      }
      // Replace with the sorted final array so the UI honors the canonical
      // order once the fan-out is done.
      setResults(final);
    } finally {
      setSearching(false);
    }
  }, [query, twitchUser]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSearch();
    }
  };

  return (
    <section data-testid="banned-user-search">
      <h2 className="text-xl font-semibold mb-3 text-white">Banned-user search</h2>
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search username across moderated channels"
          aria-label="Username to search"
          className="flex-1 rounded border border-[var(--color-border)] bg-black/30 px-3 py-1.5 text-sm text-white"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={searching || query.trim().length === 0}
          className="rounded bg-[#9146FF] px-3 py-1.5 text-sm text-white hover:bg-[#9146FF]/90 disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {emptyMessage ? (
        <p className="text-gray-400 text-sm" data-testid="banned-search-empty">
          {emptyMessage}
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="space-y-1" data-testid="banned-search-results">
          {results.map((r) => (
            <li
              key={r.channelId}
              className="flex items-center gap-3 rounded border border-[var(--color-border)] bg-white/5 px-3 py-2 text-sm text-white"
              data-testid={`banned-result-${r.channelId}`}
            >
              <span className="font-medium">{r.channelLogin}</span>
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs ${STATUS_CLASS[r.status]}`}
                data-testid={`banned-status-${r.channelId}`}
              >
                {STATUS_LABEL[r.status]}
              </span>
              {r.status === "timed-out" && r.expiresAt ? (
                <span className="text-xs text-[var(--color-foreground-muted)]">
                  {formatRemaining(r.expiresAt)}
                </span>
              ) : null}
              {r.moderatorLogin ? (
                <span className="text-xs text-[var(--color-foreground-muted)]">
                  by {r.moderatorLogin}
                </span>
              ) : null}
              {r.reason ? (
                <span className="ml-auto truncate text-xs text-[var(--color-foreground-muted)]">
                  {r.reason}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
