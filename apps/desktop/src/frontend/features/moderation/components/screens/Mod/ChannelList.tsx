import { getModerationServices } from "@/features/moderation/composition/moderation-services";
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
import { LuChevronRight, LuShield } from "react-icons/lu";
import { useTranslation } from "react-i18next";

import type { ModeratedTwitchChannel } from "@shared/twitch-api-types";
import { useAuthStore } from "@/features/auth/components/state/auth-store";

interface ChannelEntry {
  platform: "twitch" | "kick";
  /** Login (Twitch) or slug (Kick); used as the URL param. */
  channelParam: string;
  /** Pretty display name. */
  displayName: string;
}

export function ChannelList() {
  const { t } = useTranslation();
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const kickUser = useAuthStore((s) => s.kickUser);
  const [twitchChannels, setTwitchChannels] = useState<ModeratedTwitchChannel[]>([]);
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
        const result = await getModerationServices().twitch.execute({
          operation: "get-moderated-channels",
          userId: twitchUser.id,
        });
        if (!cancelled && result.ok) {
          setTwitchChannels(result.data as ModeratedTwitchChannel[]);
        }
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
    <section
      data-testid="mod-channel-list"
      className="overflow-hidden rounded-md border border-[#303034] bg-[#18181b]"
    >
      <header className="flex h-10 items-center justify-between border-b border-[#303034] bg-[#252529] px-3">
        <h2 className="text-sm font-semibold text-white">{t("moderation.yourChannels")}</h2>
        <span className="text-xs text-[#adadb8]">{entries.length}</span>
      </header>
      {loading && entries.length === 0 ? (
        <p className="p-3 text-xs text-[#adadb8]" role="status">
          {t("moderation.loading")}
        </p>
      ) : entries.length === 0 ? (
        <p className="p-3 text-xs text-[#adadb8]" data-testid="mod-channel-list-empty">
          {t("moderation.noChannels")}
        </p>
      ) : (
        <ul
          className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2"
          data-testid="mod-channel-list-grid"
        >
          {entries.map((e) => (
            <li key={`${e.platform}:${e.channelParam}`}>
              <Link
                to={e.platform === "twitch" ? "/mod/twitch/$channel" : "/mod/kick/$channel"}
                params={{ channel: e.channelParam }}
                data-testid={`mod-channel-card-${e.platform}-${e.channelParam}`}
                className="group flex min-h-14 items-center gap-2 rounded-md border border-[#303034] bg-[#0e0e10] px-3 py-2 hover:border-[#5c4d79] hover:bg-[#202024] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#bf94ff]"
              >
                <LuShield
                  className={`h-4 w-4 ${
                    e.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                  {e.displayName}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                    e.platform === "twitch"
                      ? "bg-[#9146FF]/20 text-[#9146FF]"
                      : "bg-[#53FC18]/20 text-[#53FC18]"
                  }`}
                >
                  {e.platform === "twitch" ? "Twitch" : "Kick"}
                </span>
                <LuChevronRight
                  className="h-4 w-4 text-[#777780] group-hover:text-[#bf94ff]"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
