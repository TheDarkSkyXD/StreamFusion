import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LuHeart } from "react-icons/lu";

import type { UnifiedChannel, UnifiedStream } from "@/backend/api/unified/platform-types";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useFollowedChannels } from "@/hooks/queries/useChannels";
import { useFollowedStreams } from "@/hooks/queries/useStreams";
import { getChannelKey, getChannelNameKey, getStreamKey } from "@/lib/id-utils";
import { cn, formatViewerCount } from "@/lib/utils";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";

import { ScrollArea } from "../ui/scroll-area";

interface SidebarFollowsProps {
  collapsed: boolean;
}

export function SidebarFollows({ collapsed }: SidebarFollowsProps) {
  // Use individual selectors to prevent re-renders when unrelated state changes
  const twitchConnected = useAuthStore((state) => state.twitchConnected);
  const kickConnected = useAuthStore((state) => state.kickConnected);
  const localFollows = useFollowStore((state) => state.localFollows);

  // Fetch data
  const { data: twitchFollows } = useFollowedChannels("twitch", { enabled: twitchConnected });
  const { data: kickFollows } = useFollowedChannels("kick", { enabled: kickConnected });
  const { data: liveStreams, isLoading } = useFollowedStreams();
  const [visibleCount, setVisibleCount] = useState(10);

  // Merge and sort channels
  const { liveChannels, offlineChannels } = useMemo(() => {
    const channelMap = new Map<string, UnifiedChannel>();

    // 1. Add Local Follows (using centralized key generation)
    localFollows.forEach((c) => channelMap.set(getChannelKey(c), c));

    // 2. Add Remote Follows (overwrite local if dupes to get fresh data)
    if (twitchFollows) twitchFollows.forEach((c) => channelMap.set(getChannelKey(c), c));
    if (kickFollows) kickFollows.forEach((c) => channelMap.set(getChannelKey(c), c));

    const allChannels = Array.from(channelMap.values());

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
        // Prefer channel displayName if stream's is just the lowercase slug
        const needsDisplayName =
          c.displayName &&
          stream.channelDisplayName === stream.channelName &&
          c.displayName !== stream.channelName;

        if (needsAvatar || needsDisplayName) {
          streamToAdd = {
            ...stream,
            ...(needsAvatar && { channelAvatar: c.avatarUrl }),
            ...(needsDisplayName && { channelDisplayName: c.displayName }),
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
  }, [localFollows, twitchFollows, kickFollows, liveStreams]);

  const allItems = useMemo(
    () => [
      ...liveChannels.map((c) => ({ type: "live" as const, data: c })),
      ...offlineChannels.map((c) => ({ type: "offline" as const, data: c })),
    ],
    [liveChannels, offlineChannels]
  );

  const visibleItems = useMemo(
    () => (collapsed ? allItems : allItems.slice(0, visibleCount)),
    [allItems, visibleCount, collapsed]
  );

  // Handlers for Show More/Less
  const handleShowMore = () => setVisibleCount((prev) => prev + 5);
  const handleShowLess = () => setVisibleCount((prev) => Math.max(10, prev - 5));

  if (isLoading && !liveChannels.length && !offlineChannels.length) {
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

  if (liveChannels.length === 0 && offlineChannels.length === 0) {
    if (collapsed) return null;

    return (
      <div className="p-4 text-center text-[var(--color-foreground-muted)] text-xs">
        <LuHeart className="w-8 h-8 mx-auto mb-2 opacity-20" />
        <p>Follow channels to see them here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!collapsed && (
        <div className="px-3 py-2 font-bold text-white tracking-wider flex justify-between items-center">
          <span className="text-base">Following</span>
          <span className="bg-[var(--color-background-tertiary)] text-[var(--color-foreground)] px-1.5 py-0.5 rounded text-xs">
            {liveChannels.length + offlineChannels.length}
          </span>
        </div>
      )}

      {/* Since sidebar is a flex col, we want this list to scroll effectively */}
      <ScrollArea className="flex-1">
        <div className="pl-2 pr-4 pb-2 space-y-1">
          {visibleItems.map((item) => {
            if (item.type === "live") {
              const stream = item.data;
              return (
                <Link
                  key={`${stream.platform}-${stream.channelId}`}
                  to="/stream/$platform/$channel"
                  params={{ platform: stream.platform, channel: stream.channelName }}
                  search={{ tab: "videos" }}
                  className={cn(
                    "flex items-center gap-3 p-1.5 rounded-md hover:bg-[var(--color-background-tertiary)] transition-colors group relative",
                    collapsed ? "justify-center" : ""
                  )}
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
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex justify-between items-center gap-1">
                        <span className="truncate font-bold text-sm text-white group-hover:text-[var(--color-primary)] transition-colors flex-1">
                          {stream.channelDisplayName}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={cn(
                              "flex h-2 w-2 rounded-full shrink-0",
                              stream.platform === "kick" ? "bg-[#53FC18]" : "bg-red-500"
                            )}
                          />
                          <span className="text-sm font-bold text-white">
                            {formatViewerCount(stream.viewerCount)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center text-xs text-[#b2b2b2] font-bold">
                        <span className="truncate" title={stream.categoryName}>
                          {stream.categoryName && stream.categoryName.length > 24
                            ? `${stream.categoryName.slice(0, 15)}...`
                            : stream.categoryName}
                        </span>
                      </div>
                    </div>
                  )}
                </Link>
              );
            } else {
              const channel = item.data;
              return (
                <Link
                  key={`${channel.platform}-${channel.id}`}
                  to="/stream/$platform/$channel"
                  params={{ platform: channel.platform, channel: channel.username }}
                  search={{ tab: "videos" }}
                  className={cn(
                    "flex items-center gap-3 p-1.5 rounded-md hover:bg-[var(--color-background-tertiary)] transition-colors group opacity-70 hover:opacity-100",
                    collapsed ? "justify-center" : ""
                  )}
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
                    <div className="min-w-0 flex-1">
                      <span className="truncate font-bold text-sm text-white group-hover:text-[var(--color-foreground)] transition-colors block">
                        {channel.displayName}
                      </span>
                      <span className="text-xs text-[var(--color-foreground-muted)] truncate block">
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
