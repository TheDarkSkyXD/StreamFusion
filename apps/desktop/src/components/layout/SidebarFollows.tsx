import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LuHeart, LuRefreshCw } from "react-icons/lu";
import { toast } from "sonner";

import type { UnifiedChannel, UnifiedStream } from "@/backend/api/unified/platform-types";
import { StreamVerifiedBadge } from "@/components/stream/stream-verified-badge";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useFollowedChannels } from "@/hooks/queries/useChannels";
import { useFollowedStreams } from "@/hooks/queries/useStreams";
import { prefetchStreamPlayback } from "@/hooks/useStreamPlayback";
import {
  dedupeChannelsByIdentity,
  dedupeStreamsByChannelIdentity,
  getChannelKey,
  getChannelNameKey,
  getStreamKey,
} from "@/lib/id-utils";
import { cn, formatViewerCount } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { usePipStore } from "@/store/pip-store";

import { ScrollArea } from "../ui/scroll-area";

interface SidebarFollowsProps {
  collapsed: boolean;
}

const KICK_PLAYBACK_PREFETCH_LIMIT = 6;
const PLATFORM_LABELS: Record<Platform, string> = {
  twitch: "Twitch",
  kick: "Kick",
};

function getActiveStreamRoute(pathname: string): { platform: string; channel: string } | null {
  const match = pathname.match(/^\/stream\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;

  return {
    platform: decodeURIComponent(match[1]).toLowerCase(),
    channel: decodeURIComponent(match[2]).toLowerCase(),
  };
}

export function SidebarFollows({ collapsed }: SidebarFollowsProps) {
  // Use individual selectors to prevent re-renders when unrelated state changes
  const twitchConnected = useAuthStore((state) => state.twitchConnected);
  const kickConnected = useAuthStore((state) => state.kickConnected);
  const syncConnectedFollows = useAuthStore((state) => state.syncConnectedFollows);
  const followSyncInProgress = useAuthStore((state) => state.followSyncInProgress);
  const followSyncLastSyncedAt = useAuthStore((state) => state.followSyncLastSyncedAt);
  const localFollows = useFollowStore((state) => state.localFollows);
  const getFollowSource = useFollowStore((state) => state.getFollowSource);
  const currentPipStream = usePipStore((state) => state.currentStream);
  const isPipActive = usePipStore((state) => state.isPipActive);
  const location = useLocation();
  const activeStreamRoute = getActiveStreamRoute(location.pathname);
  const activePipStream =
    isPipActive && currentPipStream
      ? {
          platform: currentPipStream.platform,
          channel: currentPipStream.channelName.toLowerCase(),
        }
      : null;
  const hasLocalTwitchFollows = localFollows.some((follow) => follow.platform === "twitch");
  const hasLocalKickFollows = localFollows.some((follow) => follow.platform === "kick");
  const connectedPlatforms = useMemo(
    () =>
      [twitchConnected ? "twitch" : null, kickConnected ? "kick" : null].filter(
        (platform): platform is Platform => platform !== null
      ),
    [twitchConnected, kickConnected]
  );
  const hasConnectedPlatforms = connectedPlatforms.length > 0;
  const followSyncTitle = useMemo(() => {
    if (!hasConnectedPlatforms) return "Connect Twitch or Kick to sync follows";
    if (followSyncInProgress) return "Syncing follows";

    const oldestSynced = connectedPlatforms
      .map((platform) => ({ platform, syncedAt: followSyncLastSyncedAt[platform] }))
      .filter((entry): entry is { platform: Platform; syncedAt: string } => Boolean(entry.syncedAt))
      .sort((a, b) => new Date(a.syncedAt).getTime() - new Date(b.syncedAt).getTime())[0];

    if (!oldestSynced) {
      return `Sync follows with ${connectedPlatforms.map((p) => PLATFORM_LABELS[p]).join(" and ")}`;
    }

    const syncedTime = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(oldestSynced.syncedAt));
    return `${PLATFORM_LABELS[oldestSynced.platform]} last synced ${syncedTime}. Sync follows`;
  }, [connectedPlatforms, followSyncInProgress, followSyncLastSyncedAt, hasConnectedPlatforms]);

  const handleSyncFollows = async () => {
    if (!hasConnectedPlatforms || followSyncInProgress) return;

    const result = await syncConnectedFollows();
    if (result.failed.length > 0) {
      toast("Couldn't sync follows", {
        description: `Failed to sync ${result.failed
          .map((platform) => PLATFORM_LABELS[platform])
          .join(" and ")}. Existing follows were preserved.`,
      });
    }
  };

  const renderSyncButton = (compact: boolean) =>
    hasConnectedPlatforms ? (
      <button
        type="button"
        aria-label="Sync follows"
        title={followSyncTitle}
        disabled={followSyncInProgress}
        onClick={handleSyncFollows}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md text-[var(--color-foreground-muted)] transition-colors hover:bg-[var(--color-background-tertiary)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60",
          compact ? "w-8 h-8" : "w-7 h-7"
        )}
      >
        <LuRefreshCw className={cn("w-4 h-4", followSyncInProgress && "animate-spin")} />
      </button>
    ) : null;

  // Fetch data
  const { data: twitchFollows } = useFollowedChannels("twitch", { enabled: twitchConnected });
  const { data: kickFollows } = useFollowedChannels("kick", { enabled: kickConnected });
  const { data: twitchLiveStreams, isLoading: twitchStreamsLoading } = useFollowedStreams(
    "twitch",
    100,
    {
      enabled: twitchConnected || hasLocalTwitchFollows,
    }
  );
  const { data: kickLiveStreams, isLoading: kickStreamsLoading } = useFollowedStreams("kick", 100, {
    enabled: kickConnected || hasLocalKickFollows,
  });
  const liveStreams = useMemo(() => {
    const streams = dedupeStreamsByChannelIdentity([
      ...(twitchLiveStreams ?? []),
      ...(kickLiveStreams ?? []),
    ]);
    streams.sort((a, b) => b.viewerCount - a.viewerCount);
    return streams;
  }, [twitchLiveStreams, kickLiveStreams]);
  const isLoading = twitchStreamsLoading || kickStreamsLoading;
  const [visibleCount, setVisibleCount] = useState(10);

  // Merge and sort channels
  const { liveChannels, offlineChannels } = useMemo(() => {
    const channelMap = new Map<string, UnifiedChannel>();

    // 1. Add Local Follows (using centralized key generation). When Kick is
    // connected, show cached account-confirmed Kick rows immediately, but keep
    // hiding app-only Kick rows until the account sync verifies them.
    localFollows
      .filter((c) => !(kickConnected && c.platform === "kick" && getFollowSource(c) !== "kick"))
      .forEach((c) => channelMap.set(getChannelKey(c), c));

    // 2. Add Remote Follows (overwrite local if dupes to get fresh data)
    if (twitchFollows) twitchFollows.forEach((c) => channelMap.set(getChannelKey(c), c));
    if (kickFollows) kickFollows.forEach((c) => channelMap.set(getChannelKey(c), c));

    const allChannels = dedupeChannelsByIdentity(Array.from(channelMap.values()));

    // Map live streams by platform-aware keys for flexible matching
    // Different API endpoints return different ID formats, so we match by both
    // Uses centralized key generation from id-utils
    const streamByIdMap = new Map<string, UnifiedStream>();
    const streamByNameMap = new Map<string, UnifiedStream>();
    if (liveStreams) {
      liveStreams.forEach((s) => {
        // Use centralized key generation for consistency
        streamByIdMap.set(getStreamKey(s), s);
        if (s.channelName) {
          streamByNameMap.set(getChannelNameKey(s.platform, s.channelName), s);
        }
      });
    }

    const live: UnifiedStream[] = [];
    const offline: UnifiedChannel[] = [];
    const addedStreamIds = new Set<string>(); // Track added streams to prevent duplicates

    allChannels.forEach((c) => {
      // Try matching by platform-ID first, then by platform-username (slug)
      let stream = streamByIdMap.get(getChannelKey(c));
      if (!stream && c.username) {
        stream = streamByNameMap.get(getChannelNameKey(c.platform, c.username));
      }

      if (stream) {
        // Prevent duplicate streams (same stream matched by different channels)
        const streamKey = getStreamKey(stream);
        if (addedStreamIds.has(streamKey)) {
          return; // Skip - already added this stream
        }
        addedStreamIds.add(streamKey);

        // Hydrate avatar and display name if missing or lowercase (slug) on stream but proper on channel
        // Create a new object to avoid mutating React Query cache
        let streamToAdd = stream;
        const needsAvatar = !stream.channelAvatar && c.avatarUrl;
        const needsVerifiedBadge = !stream.channelIsVerified && (c.isVerified || c.isPartner);
        // Prefer channel displayName if stream's is just the lowercase slug
        const needsDisplayName =
          c.displayName &&
          stream.channelDisplayName === stream.channelName &&
          c.displayName !== stream.channelName;

        if (needsAvatar || needsDisplayName || needsVerifiedBadge) {
          streamToAdd = {
            ...stream,
            ...(needsAvatar && { channelAvatar: c.avatarUrl }),
            ...(needsDisplayName && { channelDisplayName: c.displayName }),
            ...(needsVerifiedBadge && { channelIsVerified: true }),
          };
        }
        live.push(streamToAdd);
      } else {
        offline.push(c);
      }
    });

    // Sort live by viewers
    live.sort((a, b) => b.viewerCount - a.viewerCount);

    // Sort offline alpha
    offline.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return { liveChannels: live, offlineChannels: offline };
  }, [localFollows, twitchFollows, kickFollows, liveStreams, kickConnected, getFollowSource]);

  const currentItems = useMemo(
    () => [
      ...liveChannels.map((c) => ({ type: "live" as const, data: c })),
      ...offlineChannels.map((c) => ({ type: "offline" as const, data: c })),
    ],
    [liveChannels, offlineChannels]
  );
  const allItems = currentItems;

  const visibleItems = useMemo(() => {
    if (collapsed) return allItems;

    let visible = allItems.slice(0, visibleCount);
    const hasVisibleKick = visible.some((item) => item.data.platform === "kick");
    if (!hasVisibleKick && allItems.some((item) => item.data.platform === "kick")) {
      const visibleKeys = new Set(
        visible.map((item) =>
          item.type === "live" ? getStreamKey(item.data) : getChannelKey(item.data)
        )
      );
      const kickFill = allItems
        .filter((item) => item.data.platform === "kick")
        .filter((item) => {
          const key = item.type === "live" ? getStreamKey(item.data) : getChannelKey(item.data);
          return !visibleKeys.has(key);
        })
        .slice(0, Math.min(2, visibleCount));

      if (kickFill.length > 0) {
        visible = [...visible.slice(0, visibleCount - kickFill.length), ...kickFill];
      }
    }

    return visible;
  }, [allItems, visibleCount, collapsed]);

  useEffect(() => {
    const kickSlugs = visibleItems
      .filter((item) => item.data.platform === "kick")
      .map((item) => (item.type === "live" ? item.data.channelName : item.data.username))
      .filter((slug): slug is string => Boolean(slug))
      .slice(0, KICK_PLAYBACK_PREFETCH_LIMIT);

    if (kickSlugs.length === 0) return;

    const prefetchVisibleKickStreams = () => {
      for (const slug of kickSlugs) {
        void prefetchStreamPlayback("kick", slug);
      }
    };

    if (import.meta.env.MODE === "test") {
      prefetchVisibleKickStreams();
      return;
    }

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(prefetchVisibleKickStreams, { timeout: 2000 });
      return () => window.cancelIdleCallback(idleId);
    }

    // timer-allowlist: idle fallback for non-Chromium-compatible environments
    const timeoutId = globalThis.setTimeout(prefetchVisibleKickStreams, 1000);
    return () => globalThis.clearTimeout(timeoutId);
  }, [visibleItems]);

  // Handlers for Show More/Less
  const handleShowMore = () => setVisibleCount((prev) => prev + 5);
  const handleShowLess = () => setVisibleCount((prev) => Math.max(10, prev - 5));

  if (isLoading && allItems.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {!collapsed && <Skeleton className="h-4 w-20 mb-2" />}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            {!collapsed && (
              <div className="flex flex-col gap-1 overflow-hidden w-full">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2 w-12" />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (allItems.length === 0) {
    if (collapsed) {
      if (!hasConnectedPlatforms) return null;

      return (
        <div className="flex w-16 justify-center p-2" data-testid="sidebar-follows">
          {renderSyncButton(true)}
        </div>
      );
    }

    return (
      <div
        className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden"
        data-testid="sidebar-follows"
      >
        <div className="px-3 py-2 font-bold text-white tracking-wider flex justify-between items-center">
          <span className="text-base">Following</span>
          <div className="flex items-center gap-1.5">
            {renderSyncButton(false)}
            <span className="bg-[var(--color-background-tertiary)] text-[var(--color-foreground)] px-1.5 py-0.5 rounded text-xs">
              0
            </span>
          </div>
        </div>
        <div className="p-4 text-center text-[var(--color-foreground-muted)] text-xs">
          <LuHeart className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p>Follow channels to see them here</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden"
      data-testid="sidebar-follows"
    >
      {!collapsed && (
        <div className="px-3 py-2 font-bold text-white tracking-wider flex justify-between items-center">
          <span className="text-base">Following</span>
          <div className="flex items-center gap-1.5">
            {renderSyncButton(false)}
            <span className="bg-[var(--color-background-tertiary)] text-[var(--color-foreground)] px-1.5 py-0.5 rounded text-xs">
              {allItems.length}
            </span>
          </div>
        </div>
      )}

      {/* Since sidebar is a flex col, we want this list to scroll effectively */}
      <ScrollArea className="min-w-0 max-w-full flex-1">
        <div
          className={cn(
            "box-border max-w-full overflow-hidden pb-2 space-y-1",
            collapsed ? "w-16 px-2" : "w-56 pl-2 pr-4"
          )}
        >
          {collapsed && hasConnectedPlatforms && (
            <div className="flex justify-center pb-1">{renderSyncButton(true)}</div>
          )}
          {visibleItems.map((item) => {
            if (item.type === "live") {
              const stream = item.data;
              const showPartnerBadge = !!stream.channelIsVerified;
              const isRouteActive =
                activeStreamRoute?.platform === stream.platform &&
                activeStreamRoute.channel === stream.channelName.toLowerCase();
              const isPipStreamActive =
                activePipStream?.platform === stream.platform &&
                activePipStream.channel === stream.channelName.toLowerCase();
              const isActive = isRouteActive || isPipStreamActive;

              return (
                <Link
                  key={`${stream.platform}-${stream.channelId}`}
                  to="/stream/$platform/$channel"
                  params={{ platform: stream.platform, channel: stream.channelName }}
                  search={{ tab: "home" }}
                  className={cn(
                    "flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden p-1.5 rounded-md border-l-2 transition-colors group relative",
                    isActive
                      ? cn(
                          "bg-neutral-700/80 text-white ring-1 ring-white/10",
                          stream.platform === "kick" ? "border-l-[#53FC18]" : "border-l-[#9146FF]"
                        )
                      : "border-l-transparent hover:bg-[var(--color-background-tertiary)]",
                    collapsed ? "justify-center" : ""
                  )}
                  aria-current={isRouteActive ? "page" : isPipStreamActive ? "true" : undefined}
                  title={
                    collapsed
                      ? `${stream.channelDisplayName} (Live: ${formatViewerCount(stream.viewerCount)})`
                      : undefined
                  }
                >
                  <div className="relative shrink-0">
                    <PlatformAvatar
                      src={stream.channelAvatar}
                      alt={stream.channelDisplayName}
                      platform={stream.platform}
                      size="w-8 h-8"
                      className={cn(
                        "ring-2 ring-transparent transition-all",
                        "grayscale-0", // Live is always colored
                        collapsed && "group-hover:ring-[var(--color-primary)]"
                      )}
                    />
                    {/* Live dot for collapsed view mostly, but good for expanded too */}
                    {collapsed && (
                      <span className="absolute -top-1 -right-1 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                      </span>
                    )}
                  </div>

                  {!collapsed && (
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate font-bold text-sm text-white group-hover:text-[var(--color-primary)] transition-colors">
                          {stream.channelDisplayName}
                        </span>
                        {showPartnerBadge && <StreamVerifiedBadge platform={stream.platform} />}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center text-xs font-bold">
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-extrabold leading-none tabular-nums text-white ring-1 ring-white/10"
                          title={`${stream.viewerCount.toLocaleString()} viewers`}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              stream.platform === "kick" ? "bg-[#53FC18]" : "bg-red-500"
                            )}
                          />
                          {formatViewerCount(stream.viewerCount)}
                        </span>
                      </div>
                      {stream.categoryName && (
                        <span
                          className="mt-0.5 block min-w-0 truncate text-xs font-bold text-[#b2b2b2]"
                          title={stream.categoryName}
                        >
                          {stream.categoryName}
                        </span>
                      )}
                    </div>
                  )}
                </Link>
              );
            } else {
              const channel = item.data;
              const showPartnerBadge = channel.isPartner || channel.isVerified;
              const isRouteActive =
                activeStreamRoute?.platform === channel.platform &&
                activeStreamRoute.channel === channel.username.toLowerCase();
              const isPipStreamActive =
                activePipStream?.platform === channel.platform &&
                activePipStream.channel === channel.username.toLowerCase();
              const isActive = isRouteActive || isPipStreamActive;

              return (
                <Link
                  key={`${channel.platform}-${channel.id}`}
                  to="/stream/$platform/$channel"
                  params={{ platform: channel.platform, channel: channel.username }}
                  search={{ tab: "home" }}
                  className={cn(
                    "flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden p-1.5 rounded-md border-l-2 transition-colors group",
                    isActive
                      ? cn(
                          "bg-neutral-700/80 text-white opacity-100 ring-1 ring-white/10",
                          channel.platform === "kick" ? "border-l-[#53FC18]" : "border-l-[#9146FF]"
                        )
                      : "border-l-transparent opacity-70 hover:bg-[var(--color-background-tertiary)] hover:opacity-100",
                    collapsed ? "justify-center" : ""
                  )}
                  aria-current={isRouteActive ? "page" : isPipStreamActive ? "true" : undefined}
                  title={collapsed ? channel.displayName : undefined}
                >
                  <PlatformAvatar
                    src={channel.avatarUrl}
                    alt={channel.displayName}
                    platform={channel.platform}
                    size="w-8 h-8"
                    className="grayscale group-hover:grayscale-0 transition-all"
                  />

                  {!collapsed && (
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate font-bold text-sm text-white group-hover:text-[var(--color-foreground)] transition-colors">
                          {channel.displayName}
                        </span>
                        {showPartnerBadge && <StreamVerifiedBadge platform={channel.platform} />}
                      </div>
                      <span
                        className={cn(
                          "block truncate text-xs",
                          isActive
                            ? "font-semibold text-white/70"
                            : "text-[var(--color-foreground-muted)]"
                        )}
                      >
                        Offline
                      </span>
                    </div>
                  )}
                </Link>
              );
            }
          })}
        </div>
      </ScrollArea>

      {/* Show More / Show Less Buttons */}
      {!collapsed && allItems.length > 10 && (
        <div className="flex items-center px-3 py-3 bg-[var(--color-background-secondary)] shrink-0">
          {visibleCount < allItems.length && (
            <button
              onClick={handleShowMore}
              className="text-xs font-bold text-[var(--color-primary)] text-left mr-auto cursor-pointer"
            >
              Show More
            </button>
          )}
          {visibleCount > 10 && (
            <button
              onClick={handleShowLess}
              className="text-xs font-bold text-[var(--color-primary)] text-right ml-auto cursor-pointer"
            >
              Show Less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
