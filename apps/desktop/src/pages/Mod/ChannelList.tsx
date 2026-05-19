/**
 * ChannelList — index for /mod.
 *
 * One card per channel the signed-in user can moderate. Each card links to
 * the per-channel mod admin page.
 *
 * Twitch: enumerates `useModeratedChannelsStore.twitchModeratedChannelIds`
 *   plus the signed-in user's own channel (broadcaster-as-mod bridge).
 *   Channel logins are not cached in the store — we fetch via Helix
 *   /moderation/channels once on mount to get the `broadcaster_login` for
 *   each id (needed for the link param).
 *
 * Kick: broadcaster-only coverage. If a Kick user is signed in, we render
 *   one card for their own channel. Cross-channel Kick moderation is a
 *   separate gap (see useIsKickMod).
 *
 * Empty state: "You don't moderate any channels yet."
 */

import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LuShield } from "react-icons/lu";

import {
  getModeratedChannels,
  type ModeratedChannel,
} from "@/backend/api/platforms/twitch/twitch-helix-moderation";
import { useAuthStore } from "@/store/auth-store";

interface ChannelEntry {
  platform: "twitch" | "kick";
  /** Login (Twitch) or slug (Kick); used as the URL param. */
  channelParam: string;
  /** Pretty display name. */
  displayName: string;
}

export function ChannelList() {
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const kickUser = useAuthStore((s) => s.kickUser);
  const [twitchChannels, setTwitchChannels] = useState<ModeratedChannel[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!twitchUser) {
      setTwitchChannels([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const token = await window.electronAPI.auth.getToken("twitch");
        const clientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
        if (!token?.accessToken || !clientId) return;
        const channels = await getModeratedChannels(
          twitchUser.id,
          token.accessToken,
          clientId,
        );
        if (!cancelled) setTwitchChannels(channels);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [twitchUser]);

  const entries: ChannelEntry[] = [];
  // Twitch broadcaster's own channel (Helix doesn't include it).
  if (twitchUser) {
    entries.push({
      platform: "twitch",
      channelParam: twitchUser.login,
      displayName: twitchUser.displayName,
    });
  }
  for (const c of twitchChannels) {
    entries.push({
      platform: "twitch",
      channelParam: c.broadcaster_login,
      displayName: c.broadcaster_name,
    });
  }
  if (kickUser) {
    entries.push({
      platform: "kick",
      channelParam: kickUser.slug ?? kickUser.username,
      displayName: kickUser.username,
    });
  }

  return (
    <section data-testid="mod-channel-list">
      <h2 className="text-xl font-semibold mb-3 text-white">Your channels</h2>
      {loading && entries.length === 0 ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-400" data-testid="mod-channel-list-empty">
          You don't moderate any channels yet.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="mod-channel-list-grid">
          {entries.map((e) => (
            <li key={`${e.platform}:${e.channelParam}`}>
              <Link
                to={
                  e.platform === "twitch"
                    ? "/mod/twitch/$channel"
                    : "/mod/kick/$channel"
                }
                params={{ channel: e.channelParam }}
                data-testid={`mod-channel-card-${e.platform}-${e.channelParam}`}
                className="flex items-center gap-3 rounded border border-[var(--color-border)] bg-white/5 p-3 hover:bg-white/10"
              >
                <LuShield
                  className={`h-5 w-5 ${
                    e.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]"
                  }`}
                />
                <span className="flex-1 text-sm font-medium text-white">
                  {e.displayName}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold ${
                    e.platform === "twitch"
                      ? "bg-[#9146FF]/20 text-[#9146FF]"
                      : "bg-[#53FC18]/20 text-[#53FC18]"
                  }`}
                >
                  {e.platform === "twitch" ? "Twitch" : "Kick"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
