import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LuArrowLeft, LuLockKeyhole, LuRefreshCw, LuShieldAlert } from "react-icons/lu";
import { useTranslation } from "react-i18next";
import { useChannelByUsername } from "@/features/discovery/data/queries/useChannels";
import {
  useModerationAuthority,
  type ModerationAuthorityState,
} from "@/features/moderation/data/useModerationAuthority";
import { useResolveTwitchChannel } from "@/features/moderation/data/useResolveTwitchChannel";
import type { RetentionScope } from "@shared/mod-log-types";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

import { ChannelWorkspace } from "./workspace/ChannelWorkspace";

export interface ModChannelPageProps {
  platform: "twitch" | "kick";
  /** URL param — broadcaster_login for Twitch, slug for Kick. */
  channel: string;
}

function AuthorityNotice({
  authority,
  platform,
  compact = false,
}: {
  authority: ModerationAuthorityState;
  platform: "twitch" | "kick";
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (authority.state === "authorized") return null;
  if (authority.state === "checking") {
    return (
      <p
        className={compact ? "px-3 py-1 text-xs text-neutral-400" : "text-sm text-neutral-400"}
        data-testid="mod-channel-authority-checking"
      >
        {t("moderation.verifyingAccess")}
      </p>
    );
  }
  if (authority.state === "hidden") {
    return compact ? (
      <p className="px-3 py-1 text-xs text-neutral-400" data-testid="mod-channel-authority-hidden">
        {t("moderation.accessUnconfirmed")}
      </p>
    ) : (
      <section
        className="rounded-lg border border-[var(--color-border)] bg-white/5 p-5"
        data-testid="mod-channel-authority-hidden"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <LuLockKeyhole aria-hidden />
          {t("moderation.accessRequired")}
        </h2>
        <p className="mt-2 text-sm text-neutral-400">{t("moderation.accessUnconfirmed")}</p>
      </section>
    );
  }
  if (authority.state === "unverifiable") {
    return compact ? (
      <div
        className="flex items-center justify-between gap-3 border-b border-amber-300/20 bg-amber-300/5 px-3 py-1.5"
        data-testid="mod-channel-authority-unverifiable"
      >
        <span className="flex items-center gap-2 text-xs text-amber-100">
          <LuShieldAlert aria-hidden />
          {t("moderation.verifyAccessFailed")}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-white hover:bg-white/10"
          onClick={authority.retry}
        >
          <LuRefreshCw aria-hidden size={14} />
          {t("moderation.retry")}
        </button>
      </div>
    ) : (
      <section
        className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-5"
        data-testid="mod-channel-authority-unverifiable"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <LuShieldAlert aria-hidden />
          {t("moderation.verifyAccessFailed")}
        </h2>
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-2 rounded border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10"
          onClick={authority.retry}
        >
          <LuRefreshCw aria-hidden />
          {t("moderation.retry")}
        </button>
      </section>
    );
  }
  return compact ? (
    <div
      className="flex items-center justify-between gap-3 border-b border-amber-300/20 bg-amber-300/5 px-3 py-1.5"
      data-testid="mod-channel-reconnect-required"
    >
      <span className="flex items-center gap-2 text-xs text-amber-100">
        <LuLockKeyhole aria-hidden />
        {t("moderation.reconnect", { platform: platform === "twitch" ? "Twitch" : "Kick" })}
      </span>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/15"
        onClick={authority.reconnect}
      >
        <LuRefreshCw aria-hidden size={14} />
        {t("moderation.reconnect", { platform: platform === "twitch" ? "Twitch" : "Kick" })}
      </button>
    </div>
  ) : (
    <section
      className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-5"
      data-testid="mod-channel-reconnect-required"
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        <LuLockKeyhole aria-hidden />
        {t("moderation.reconnect", { platform: platform === "twitch" ? "Twitch" : "Kick" })}
      </h2>
      <p className="mt-2 text-sm text-neutral-400">{t("moderation.missingPermissions")}</p>
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-2 rounded bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15"
        onClick={authority.reconnect}
      >
        <LuRefreshCw aria-hidden />
        {t("moderation.reconnect", { platform: platform === "twitch" ? "Twitch" : "Kick" })}
      </button>
    </section>
  );
}

export function ModChannelPage({ platform, channel }: ModChannelPageProps) {
  const { t } = useTranslation();
  const [refreshCounter, setRefreshCounter] = useState(0);
  const twitchUser = useAuthStore((s) => s.twitchUser);
  const kickUser = useAuthStore((s) => s.kickUser);
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
  const normalizedChannel = channel.trim().toLowerCase();
  const isOwnBroadcaster =
    platform === "twitch"
      ? Boolean(resolvedTwitch?.id) &&
        (forceBroadcasterIdentity ||
          (Boolean(twitchUser?.id) && twitchUser?.id === resolvedTwitch?.id))
      : kickUser !== null &&
        channelId !== undefined &&
        (String(kickUser.id) === channelId ||
          kickUser.slug.trim().toLowerCase() === normalizedChannel);
  const hasModerationAuthority = moderationAuthority.state === "authorized";
  const canRenderWorkspace =
    Boolean(channelId && retentionScope) && (isOwnBroadcaster || hasModerationAuthority);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0e0e10] text-[#efeff1]">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#18181b] px-4">
        <div className="flex items-center gap-3">
          <Link
            to="/mod"
            aria-label={t("moderation.backToModerationIndex")}
            className="inline-flex h-9 w-9 items-center justify-center rounded border border-[var(--color-border)] bg-white/5 text-white hover:bg-white/10"
          >
            <LuArrowLeft size={18} />
          </Link>
          <h1 className="text-base font-semibold text-white" data-testid="mod-channel-heading">
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
          aria-label={t("moderation.refreshData")}
          className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
        >
          <LuRefreshCw size={16} />
          {t("moderation.refresh")}
        </button>
      </header>

      {isTwitchResolving || isKickResolving ? (
        <p className="text-sm text-neutral-400" data-testid="mod-channel-resolving">
          {t("moderation.resolvingChannel")}
        </p>
      ) : twitchResolveFailed || kickResolveFailed ? (
        <p className="text-sm text-red-300" data-testid="mod-channel-resolve-failed">
          {t("moderation.resolveChannelFailed", {
            platform: platform === "twitch" ? "Twitch" : "Kick",
            channel,
          })}
        </p>
      ) : canRenderWorkspace && channelId && retentionScope ? (
        <>
          {isOwnBroadcaster && (
            <AuthorityNotice authority={moderationAuthority} platform={platform} compact />
          )}
          <ChannelWorkspace
            platform={platform}
            channel={channel}
            channelId={channelId}
            displayName={displayName}
            retentionScope={retentionScope}
            isOwnBroadcaster={isOwnBroadcaster}
            hasModerationAuthority={hasModerationAuthority}
            refreshCounter={refreshCounter}
          />
        </>
      ) : (
        <AuthorityNotice authority={moderationAuthority} platform={platform} />
      )}
    </div>
  );
}
