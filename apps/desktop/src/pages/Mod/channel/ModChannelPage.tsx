/**
 * ModChannelPage — per-channel moderation admin (shared shell).
 *
 * One page covers both platforms; the route components pass `platform` +
 * `channel` (the URL param — login for Twitch, slug for Kick).
 *
 * Sections rendered:
 *   • Header   — back link to /mod + channel name
 *   • Retention — channel-scoped card + global card (for precedence context)
 *   • Mod log   — ChannelModLogFeed for this channel's mod_log rows
 *   • Banned    — Helix banned-users list (Twitch only; Kick shows a note)
 *   • Engagement — predictions + polls; only renders when the signed-in
 *     user IS the broadcaster (Twitch only)
 *
 * Channel-id resolution:
 *   • Twitch — resolve `broadcaster_login` → numeric id via Helix /users.
 *     Show a loading skeleton until it lands.
 *   • Kick   — the URL slug IS effectively the channel identifier for
 *     mod_log purposes. mod_log writers haven't been wired for Kick yet
 *     (see mod-log-writer.ts comment for source "pusher"); we default to
 *     using the slug as the channel id so the retention scope and mod_log
 *     query line up with whatever Kick chat eventually writes.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LuArrowLeft, LuRefreshCw } from "react-icons/lu";

import { useResolveTwitchChannel } from "@/hooks/useResolveTwitchChannel";
import type { RetentionScope } from "@/shared/mod-log-types";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

import { ChannelBannedList } from "./ChannelBannedList";
import { ChannelEngagement } from "./ChannelEngagement";
import { ChannelModLogFeed } from "./ChannelModLogFeed";
import { ChannelModeratorsTable } from "./ChannelModeratorsTable";
import { ChannelUnbanRequests } from "./ChannelUnbanRequests";
import { ChannelVipsTable } from "./ChannelVipsTable";
import { RetentionCard } from "./RetentionCard";

export interface ModChannelPageProps {
  platform: "twitch" | "kick";
  /** URL param — broadcaster_login for Twitch, slug for Kick. */
  channel: string;
}

export function ModChannelPage({ platform, channel }: ModChannelPageProps) {
  const [refreshCounter, setRefreshCounter] = useState(0);
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const resolvedTwitch = useResolveTwitchChannel(
    platform === "twitch" ? channel : null,
  );

  const isTwitchResolving = platform === "twitch" && resolvedTwitch === undefined;
  const twitchResolveFailed = platform === "twitch" && resolvedTwitch === null;

  // Pick the channel-id used for mod_log queries + retention scope.
  // Twitch: numeric broadcaster_id (waits for resolution).
  // Kick: slug — no Kick mod_log writer wires a numeric id today, so slug
  // is what the read side will line up against.
  const channelId =
    platform === "twitch"
      ? resolvedTwitch?.id
      : channel.toLowerCase();

  const retentionScope: RetentionScope | null =
    platform === "twitch"
      ? resolvedTwitch
        ? (`channel:${resolvedTwitch.id}` as RetentionScope)
        : null
      : (`channel:kick:${channel.toLowerCase()}` as RetentionScope);

  const displayName =
    platform === "twitch"
      ? resolvedTwitch?.displayName ?? channel
      : channel;

  const forceBroadcasterIdentity = useDevModOverrideStore(
    (s) => s.forceBroadcasterIdentity,
  );
  const isOwnBroadcaster =
    platform === "twitch" &&
    Boolean(resolvedTwitch?.id) &&
    (forceBroadcasterIdentity ||
      (Boolean(twitchUser?.id) && twitchUser?.id === resolvedTwitch?.id));

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/mod"
            aria-label="Back to moderation index"
            className="inline-flex h-9 w-9 items-center justify-center rounded border border-[var(--color-border)] bg-white/5 text-white hover:bg-white/10"
          >
            <LuArrowLeft size={18} />
          </Link>
          <h1 className="text-2xl font-bold text-white" data-testid="mod-channel-heading">
            {displayName}
            <span
              className={`ml-2 inline-block rounded px-2 py-0.5 align-middle text-xs font-bold ${
                platform === "twitch"
                  ? "bg-[#9146FF]/20 text-[#9146FF]"
                  : "bg-[#53FC18]/20 text-[#53FC18]"
              }`}
              data-testid="mod-channel-platform-pill"
            >
              {platform === "twitch" ? "Twitch" : "Kick"}
            </span>
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setRefreshCounter((n) => n + 1)}
          aria-label="Refresh moderation data"
          className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
        >
          <LuRefreshCw size={16} />
          Refresh
        </button>
      </header>

      {isTwitchResolving ? (
        <p className="text-sm text-gray-400" data-testid="mod-channel-resolving">
          Resolving channel…
        </p>
      ) : twitchResolveFailed ? (
        <p className="text-sm text-red-300" data-testid="mod-channel-resolve-failed">
          Couldn't resolve Twitch channel "{channel}".
        </p>
      ) : (
        <>
          <section data-testid="mod-channel-retention">
            <h2 className="text-xl font-semibold mb-3 text-white">Retention</h2>
            <div className="space-y-3">
              {retentionScope ? (
                <RetentionCard
                  scope={retentionScope}
                  title={`This channel (${displayName})`}
                />
              ) : null}
              <RetentionCard scope="global" title="Global (default)" />
            </div>
          </section>

          {channelId ? (
            <ChannelModLogFeed
              channelId={channelId}
              refreshCounter={refreshCounter}
            />
          ) : null}

          {isOwnBroadcaster && resolvedTwitch ? (
            <ChannelEngagement
              broadcasterId={resolvedTwitch.id}
              refreshCounter={refreshCounter}
            />
          ) : null}

          {platform === "twitch" && resolvedTwitch ? (
            <ChannelUnbanRequests
              broadcasterId={resolvedTwitch.id}
              refreshCounter={refreshCounter}
            />
          ) : null}

          {isOwnBroadcaster && resolvedTwitch ? (
            <>
              <ChannelModeratorsTable
                broadcasterId={resolvedTwitch.id}
                refreshCounter={refreshCounter}
              />
              <ChannelVipsTable
                broadcasterId={resolvedTwitch.id}
                refreshCounter={refreshCounter}
              />
            </>
          ) : null}

          <ChannelBannedList
            platform={platform}
            broadcasterId={
              platform === "twitch" ? resolvedTwitch?.id : undefined
            }
            refreshCounter={refreshCounter}
          />
        </>
      )}
    </div>
  );
}
