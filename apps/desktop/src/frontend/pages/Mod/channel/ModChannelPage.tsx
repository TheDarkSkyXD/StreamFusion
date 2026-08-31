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
 *   • Kick   — resolve the route slug to its canonical broadcaster user id,
 *     matching the key used by moderation-history writers.
 */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LuArrowLeft, LuLockKeyhole, LuRefreshCw, LuShieldAlert } from "react-icons/lu";
import { useChannelByUsername } from "@/features/discovery/data/queries/useChannels";
import { useModerationAuthority } from "@/features/moderation/data/useModerationAuthority";
import { useResolveTwitchChannel } from "@/features/moderation/data/useResolveTwitchChannel";
import type { RetentionScope } from "@shared/mod-log-types";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

import { ChannelBannedList } from "./ChannelBannedList";
import { ChannelEngagement } from "./ChannelEngagement";
import { ChannelModeratorsTable } from "./ChannelModeratorsTable";
import { ChannelModLogFeed } from "./ChannelModLogFeed";
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
  const resolvedTwitch = useResolveTwitchChannel(platform === "twitch" ? channel : null);
  const resolvedKick = useChannelByUsername(platform === "kick" ? channel : "", "kick");

  const isTwitchResolving = platform === "twitch" && resolvedTwitch === undefined;
  const twitchResolveFailed = platform === "twitch" && resolvedTwitch === null;
  const isKickResolving = platform === "kick" && resolvedKick.isPending;
  const kickResolveFailed =
    platform === "kick" &&
    (resolvedKick.isError || (!resolvedKick.isPending && !resolvedKick.data));

  // Pick the canonical broadcaster identity used for mod-log queries.
  // Twitch: numeric broadcaster_id (waits for resolution).
  // Kick: broadcaster user_id, never the legacy channel/db id.
  const channelId =
    platform === "twitch"
      ? resolvedTwitch?.id
      : (resolvedKick.data?.kickUserId ?? resolvedKick.data?.id);
  const moderationAuthority = useModerationAuthority(platform, channelId ?? "", channel);

  const retentionScope: RetentionScope | null =
    platform === "twitch"
      ? resolvedTwitch
        ? (`channel:${resolvedTwitch.id}` as RetentionScope)
        : null
      : channelId
        ? (`channel:kick:${channel.trim().toLowerCase()}` as RetentionScope)
        : null;

  const displayName = platform === "twitch" ? (resolvedTwitch?.displayName ?? channel) : channel;

  const forceBroadcasterIdentity = useDevModOverrideStore((s) => s.forceBroadcasterIdentity);
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

      {isTwitchResolving || isKickResolving ? (
        <p className="text-sm text-neutral-400" data-testid="mod-channel-resolving">
          Resolving channel…
        </p>
      ) : twitchResolveFailed || kickResolveFailed ? (
        <p className="text-sm text-red-300" data-testid="mod-channel-resolve-failed">
          Couldn&apos;t resolve {platform === "twitch" ? "Twitch" : "Kick"} channel "{channel}".
        </p>
      ) : moderationAuthority.state === "checking" ? (
        <p className="text-sm text-neutral-400" data-testid="mod-channel-authority-checking">
          Verifying moderation access…
        </p>
      ) : moderationAuthority.state === "hidden" ? (
        <section
          className="rounded-lg border border-[var(--color-border)] bg-white/5 p-5"
          data-testid="mod-channel-authority-hidden"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <LuLockKeyhole aria-hidden />
            Moderation access required
          </h2>
          <p className="mt-2 text-sm text-neutral-400">
            StreamFusion could not confirm moderation authority for this channel.
          </p>
        </section>
      ) : moderationAuthority.state === "unverifiable" ? (
        <section
          className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-5"
          data-testid="mod-channel-authority-unverifiable"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <LuShieldAlert aria-hidden />
            Couldn&apos;t verify moderation access
          </h2>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10"
            onClick={moderationAuthority.retry}
          >
            <LuRefreshCw aria-hidden />
            Retry
          </button>
        </section>
      ) : moderationAuthority.state === "reconnect-required" ? (
        <section
          className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-5"
          data-testid="mod-channel-reconnect-required"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <LuLockKeyhole aria-hidden />
            Reconnect {platform === "twitch" ? "Twitch" : "Kick"}
          </h2>
          <p className="mt-2 text-sm text-neutral-400">
            Add the missing permissions in one consent flow before loading moderation data.
          </p>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-2 rounded bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15"
            onClick={moderationAuthority.reconnect}
          >
            <LuRefreshCw aria-hidden />
            Reconnect {platform === "twitch" ? "Twitch" : "Kick"}
          </button>
        </section>
      ) : (
        <>
          <section data-testid="mod-channel-retention">
            <h2 className="text-xl font-semibold mb-3 text-white">Retention</h2>
            <div className="space-y-3">
              {retentionScope ? (
                <RetentionCard scope={retentionScope} title={`This channel (${displayName})`} />
              ) : null}
              <RetentionCard scope="global" title="Global (default)" />
            </div>
          </section>

          {channelId ? (
            <ChannelModLogFeed
              platform={platform}
              channelId={channelId}
              channelSlug={channel}
              refreshCounter={refreshCounter}
            />
          ) : null}

          {isOwnBroadcaster && resolvedTwitch ? (
            <ChannelEngagement broadcasterId={resolvedTwitch.id} refreshCounter={refreshCounter} />
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
              <ChannelVipsTable broadcasterId={resolvedTwitch.id} refreshCounter={refreshCounter} />
            </>
          ) : null}

          <ChannelBannedList
            platform={platform}
            broadcasterId={platform === "twitch" ? resolvedTwitch?.id : undefined}
            refreshCounter={refreshCounter}
          />
        </>
      )}
    </div>
  );
}
