import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import React, { useEffect, useState } from "react";
import { LuClock, LuUsers } from "react-icons/lu";

import type { UnifiedChannel, UnifiedStream } from "@shared/platform-types";
import { FollowButton } from "@/components/ui/follow-button";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUnifiedCategoryLink } from "@/features/discovery/data/queries/useCategories";
import { useUserInfo } from "@/features/auth/data/useAuth";
import { useInterval } from "@/hooks/useInterval";
import {
  formatLanguageLabel,
  formatRelativeTime,
  formatUptime,
  formatViewerCount,
} from "@/lib/utils";
import type { KickUser, TwitchUser } from "@shared/auth-types";
import { StreamVerifiedBadge } from "@/features/discovery/components/stream/stream-verified-badge";

/**
 * Isolated uptime counter component to prevent re-rendering parent every second
 * Performance: Reduces StreamInfo re-renders from 60/min to 0 (except when data changes)
 */
const UptimeCounter = React.memo(({ startedAt }: { startedAt: string }) => {
  const [uptime, setUptime] = useState(() => formatUptime(startedAt));

  // Update immediately when startedAt changes
  useEffect(() => {
    setUptime(formatUptime(startedAt));
  }, [startedAt]);

  // Update every second
  useInterval(() => {
    setUptime(formatUptime(startedAt));
  }, 1000);

  return <span className="font-semibold tabular-nums text-white">{uptime}</span>;
});

interface StreamInfoProps {
  channel: UnifiedChannel | null | undefined;
  stream: UnifiedStream | null | undefined;
  isLoading: boolean;
  recordingAction?: React.ReactNode;
}

function normalizeAccountValue(value: string | number | null | undefined): string {
  return value?.toString().trim().toLowerCase() ?? "";
}

function isAuthenticatedChannel(
  channel: UnifiedChannel | null | undefined,
  twitchUser: TwitchUser | null,
  kickUser: KickUser | null
): boolean {
  if (!channel) return false;

  if (channel.platform === "twitch" && twitchUser) {
    const channelUsername = normalizeAccountValue(channel.username);
    return (
      channel.id === twitchUser.id ||
      channelUsername === normalizeAccountValue(twitchUser.login) ||
      channelUsername === normalizeAccountValue(twitchUser.displayName)
    );
  }

  if (channel.platform === "kick" && kickUser) {
    const channelUsername = normalizeAccountValue(channel.username);
    return (
      channel.kickUserId === kickUser.id.toString() ||
      channelUsername === normalizeAccountValue(kickUser.slug) ||
      channelUsername === normalizeAccountValue(kickUser.username)
    );
  }

  return false;
}

function formatFollowerLabel(followerCount: number | undefined, label: string): string | null {
  if (typeof followerCount !== "number") return null;
  return label.replace("{{value}}", formatViewerCount(followerCount));
}

export function StreamInfo({ channel, stream, isLoading, recordingAction }: StreamInfoProps) {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { twitchUser, kickUser } = useUserInfo();
  // Resolve canonical cross-platform link target so clicking the badge lands on
  // the same merged Categories page as clicking the same category in the grid
  // (e.g. Kick IRL → /categories/twitch/<twitch-id>?otherId=<kick-id>).
  // Safe defaults during loading: the hook returns source values when inputs
  // are empty and the actual Link only renders when categoryId is set.
  const sourceCategoryId = stream?.categoryId ?? channel?.categoryId ?? "";
  const sourceCategoryName = stream?.categoryName ?? channel?.categoryName ?? "";
  const { linkPlatform, linkCategoryId, otherId } = useUnifiedCategoryLink(
    channel?.platform ?? "twitch",
    sourceCategoryId,
    sourceCategoryName
  );
  const displayTitle = stream?.title || channel?.lastStreamTitle || channel?.bio || "Offline";
  const displayCategory = stream?.categoryName || channel?.categoryName || "";
  const isOwnerView = isAuthenticatedChannel(channel, twitchUser, kickUser);
  const isOffline = !stream?.isLive;
  const followerLabel = formatFollowerLabel(channel?.followerCount, t("playback.followerCount"));
  const lastLiveLabel =
    isOffline && channel?.lastLiveAt ? formatRelativeTime(channel.lastLiveAt, locale) : null;

  if (isLoading || !channel) {
    return (
      <div className="flex justify-between items-start gap-4 animate-pulse">
        <Skeleton className="w-16 h-16 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <Skeleton className="w-32 h-10 rounded-full" />
          <Skeleton className="w-40 h-5" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-start gap-4">
      <PlatformAvatar
        src={channel.avatarUrl}
        alt={channel.displayName}
        platform={channel.platform}
        size="w-16 h-16"
        className={`shrink-0 text-xl font-bold shadow-lg ring-offset-2 ring-offset-[var(--color-background)] ${
          channel.platform === "twitch" ? "ring-2 ring-[#9146FF]" : "ring-[3px] ring-[#53FC18]"
        }`}
        isLive={stream?.isLive}
        liveStatusType={channel.platform === "kick" ? "badge" : "dot"}
        disablePlatformBorder={true}
      />
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-bold flex items-center gap-2 truncate">
          <span className="truncate">{channel.displayName}</span>
          {(stream?.channelIsVerified || channel.isVerified || channel.isPartner) && (
            <StreamVerifiedBadge platform={channel.platform} className="h-5 w-5" />
          )}
        </h1>
        {(isOffline || isOwnerView) && followerLabel && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-foreground-muted)]">
            <LuUsers className="w-4 h-4" />
            <span className="font-semibold text-white">{followerLabel}</span>
          </div>
        )}
        {lastLiveLabel && (
          <p className="mt-1 text-sm font-bold text-white">
            {t("playback.lastLive")} {lastLiveLabel}
          </p>
        )}
        {!isOffline && !isOwnerView && (
          <>
            {/* Prefer the current title, with channel metadata as a live-data fallback. */}
            <p className="text-white font-bold whitespace-normal break-words pr-4">
              {displayTitle}
            </p>
            <div className="text-[var(--color-foreground-muted)] text-sm capitalize flex flex-wrap items-center gap-2 mt-1">
              {/* Prefer the current category, with the channel's last known category as fallback. */}
              {displayCategory &&
                (linkCategoryId ? (
                  <Link
                    to="/categories/$platform/$categoryId"
                    params={{ platform: linkPlatform, categoryId: linkCategoryId }}
                    search={otherId ? { otherId } : {}}
                    className={`${channel.platform === "twitch" ? "text-[#a970ff] hover:text-[#a970ff]/80" : "text-[#53FC18] hover:text-[#53FC18]/80"} font-semibold hover:underline cursor-pointer transition-colors`}
                  >
                    {displayCategory}
                  </Link>
                ) : (
                  <span
                    className={channel.platform === "twitch" ? "text-[#a970ff]" : "text-[#53FC18]"}
                  >
                    {displayCategory}
                  </span>
                ))}

              {/* Stream Tags - Language, Mature, and Custom Tags - Moved next to category */}
              {stream?.isLive && (
                <>
                  {/* Language Tag */}
                  {stream.language && (
                    <span className="text-xs px-3 py-1 rounded-full font-bold bg-[#4a4d55] text-white hover:bg-[#5a5d66] transition-colors cursor-default">
                      {formatLanguageLabel(stream.language, locale)}
                    </span>
                  )}
                  {/* Mature Content Tag */}
                  {stream.isMature && (
                    <span className="text-xs px-3 py-1 rounded-full font-bold bg-[#4a4d55] text-white hover:bg-[#5a5d66] transition-colors cursor-default">
                      18+
                    </span>
                  )}
                  {/* Custom Tags from API - filter out language duplicates */}
                  {stream.tags &&
                    stream.tags.length > 0 &&
                    (() => {
                      // Get the display name of the stream's language to filter duplicates
                      const languageDisplayName = stream.language
                        ? formatLanguageLabel(stream.language, locale).toLowerCase()
                        : null;

                      return stream.tags
                        .filter((tag) => {
                          // Filter out tags that match the language display name (case insensitive)
                          const tagLower = tag.toLowerCase();
                          return tagLower !== languageDisplayName;
                        })
                        .map((tag, index) => (
                          <span
                            key={`${tag}-${index}`}
                            className="text-xs px-3 py-1 rounded-full font-bold bg-[#4a4d55] text-white hover:bg-[#5a5d66] transition-colors cursor-default"
                          >
                            {tag}
                          </span>
                        ));
                    })()}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right side: Follow button and live stats */}
      <div className="flex flex-col items-end gap-3">
        {(recordingAction || !isOwnerView) && (
          <div className="flex items-center gap-2">
            {recordingAction}
            {!isOwnerView && <FollowButton channel={channel} size="default" />}
          </div>
        )}
        {!isOwnerView && (
          <>
            {/* Live stats: Viewer count and Uptime */}
            {stream?.isLive && (
              <div className="flex items-center gap-4 text-sm">
                {/* Viewer count */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 cursor-default">
                      <LuUsers className="w-4 h-4 text-white" />
                      <span className="font-semibold text-white">
                        {formatViewerCount(stream.viewerCount)}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("playback.viewerCount", {
                      value: stream.viewerCount.toLocaleString(locale),
                      defaultValue: "{{value}} viewers",
                    })}
                  </TooltipContent>
                </Tooltip>

                {/* Uptime */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 cursor-default">
                      <LuClock className="w-4 h-4 text-white" />
                      {stream.startedAt && <UptimeCounter startedAt={stream.startedAt} />}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("playback.streamUptime")}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
