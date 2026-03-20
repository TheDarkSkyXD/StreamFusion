import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LuHeart, LuSearch } from "react-icons/lu";

import type { UnifiedChannel, UnifiedStream } from "@/backend/api/unified/platform-types";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { StreamGrid } from "@/components/stream/stream-grid";
import { Button } from "@/components/ui/button";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useFollowedChannels } from "@/hooks/queries/useChannels";
import { useFollowedStreams } from "@/hooks/queries/useStreams";
import { getChannelKey, getChannelNameKey, getStreamKey } from "@/lib/id-utils";
import { cn } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";

export function FollowingPage() {
  const [filter, setFilter] = useState<Platform | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Auth status
  const { twitchConnected, kickConnected } = useAuthStore();

  // 1. Local follows
  const { localFollows } = useFollowStore();

  // 2. Remote follows
  // Only fetch if connected to respective platform
  const { data: twitchFollows, isLoading: isLoadingTwitch } = useFollowedChannels("twitch", {
    enabled: twitchConnected,
  });
  const { data: kickFollows, isLoading: isLoadingKick } = useFollowedChannels("kick", {
    enabled: kickConnected,
  });

  // 3. Live streams (All platforms)
  // Backend now handles fetching streams for local follows even if disconnected
  const { data: liveStreams, isLoading: isLoadingStreams } = useFollowedStreams();

  // Combine channels logic
  const { liveChannels, offlineChannels, isLoading } = useMemo(() => {
    // Collect all channels from local and remote sources
    // Key by platform-channelId to deduplicate while preventing cross-platform collisions
    // Uses centralized key generation from id-utils
    const channelMap = new Map<string, UnifiedChannel>();

    // Add local follows
    localFollows.forEach((channel) => {
      // LocalFollows store now returns UnifiedChannel[] (hydrated from backend)
      channelMap.set(getChannelKey(channel), channel);
    });

    // Add remote follows (Twitch) - overwrites local if exists (fresh data)
    if (twitchFollows) {
      twitchFollows.forEach((c) => channelMap.set(getChannelKey(c), c));
    }

    // Add remote follows (Kick)
    if (kickFollows) {
      kickFollows.forEach((c) => channelMap.set(getChannelKey(c), c));
    }

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

    // Sort and filter
    allChannels.forEach((c) => {
      // Filter by Platform
      if (filter !== "all" && c.platform !== filter) return;

      // Try matching by platform-ID first, then by platform-username (slug)
      let stream = streamByIdMap.get(getChannelKey(c));
      if (!stream && c.username) {
        stream = streamByNameMap.get(getChannelNameKey(c.platform, c.username));
      }

      // Filter by LuSearch
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName =
          c.displayName.toLowerCase().includes(q) || c.username.toLowerCase().includes(q);
        const matchesGame =
          stream?.categoryName?.toLowerCase().includes(q) ||
          stream?.title?.toLowerCase().includes(q);
        if (!matchesName && !matchesGame) return;
      }

      if (stream) {
        // Prevent duplicate streams (same stream matched by different channels)
        const streamKey = getStreamKey(stream);
        if (addedStreamIds.has(streamKey)) {
          return; // Skip - already added this stream
        }
        addedStreamIds.add(streamKey);

        // Channel is live
        // Ensure stream has avatar if missing (fallback to channel avatar)
        // Create a new object to avoid mutating React Query cache
        const streamToAdd =
          !stream.channelAvatar && c.avatarUrl ? { ...stream, channelAvatar: c.avatarUrl } : stream;
        live.push(streamToAdd);
      } else {
        // Channel is offline
        offline.push(c);
      }
    });

    // Sort live by viewer count
    live.sort((a, b) => b.viewerCount - a.viewerCount);

    // Sort offline by name
    offline.sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Determine loading state
    const loadingTwitch = twitchConnected && isLoadingTwitch && !twitchFollows;
    const loadingKick = kickConnected && isLoadingKick && !kickFollows;

    return {
      liveChannels: live,
      offlineChannels: offline,
      isLoading: isLoadingStreams || loadingTwitch || loadingKick,
    };
  }, [
    localFollows,
    twitchFollows,
    kickFollows,
    liveStreams,
    filter,
    searchQuery,
    isLoadingStreams,
    isLoadingTwitch,
    isLoadingKick,
    twitchConnected,
    kickConnected,
  ]);

  return (
    <div className="p-6 h-full flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <LuHeart className="fill-red-500 text-red-500" />
          Following
        </h1>
        <p className="text-[var(--color-foreground-secondary)]">
          Channels you follow across Twitch and Kick
        </p>
      </div>

      {/* Filter and LuSearch Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-[var(--color-background-secondary)] p-4 rounded-xl border border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setFilter("all")}
            className={filter === "all" ? "bg-white text-black hover:bg-white/90" : ""}
            size="sm"
          >
            All
          </Button>
          <Button
            variant={filter === "twitch" ? "default" : "secondary"}
            onClick={() => setFilter("twitch")}
            className={filter === "twitch" ? "bg-[#9146FF] hover:bg-[#9146FF]/90 text-white" : ""}
            size="sm"
          >
            <TwitchIcon className="mr-2 h-4 w-4" />
            Twitch
          </Button>
          <Button
            variant={filter === "kick" ? "default" : "secondary"}
            onClick={() => setFilter("kick")}
            className={filter === "kick" ? "bg-[#53FC18] hover:bg-[#53FC18]/90 text-black" : ""}
            size="sm"
          >
            <KickIcon className="mr-2 h-4 w-4" />
            Kick
          </Button>
        </div>

        <div className="relative w-full sm:w-64">
          <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-foreground-muted)]" />
          <input
            type="text"
            placeholder="Search followed channels..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-4 rounded-md bg-[var(--color-background-tertiary)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-white transition-all placeholder:text-[var(--color-foreground-muted)]"
          />
        </div>
      </div>

      <div className="space-y-8 flex-1 overflow-y-auto pr-2 pb-10">
        {isLoading ? (
          <div className="space-y-8">
            <div className="space-y-4">
              <Skeleton className="h-7 w-32" />
              <StreamGrid isLoading={true} skeletons={4} />
            </div>

            <div className="space-y-4">
              <Skeleton className="h-7 w-24" />
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2">
                    <Skeleton className="w-16 h-16 rounded-full" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Live Section */}
            {liveChannels.length > 0 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Live Now
                  <span className="text-sm font-normal text-[var(--color-foreground-muted)] ml-2">
                    ({liveChannels.length})
                  </span>
                </h2>
                <StreamGrid streams={liveChannels} />
              </div>
            )}

            {/* Offline Section */}
            {offlineChannels.length > 0 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                <h2 className="text-xl font-semibold text-white">
                  Offline
                  <span className="text-sm font-normal text-[var(--color-foreground-muted)] ml-2">
                    ({offlineChannels.length})
                  </span>
                </h2>
                <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4 pt-2">
                  {offlineChannels.map((channel) => (
                    <div key={`${channel.platform}-${channel.id}`} className="relative group">
                      <Link
                        to="/stream/$platform/$channel"
                        params={{ platform: channel.platform, channel: channel.username }}
                        search={{ tab: "videos" }}
                        className="flex flex-col items-center text-center p-3 rounded-xl hover:bg-[var(--color-background-secondary)] transition-all"
                      >
                        <div className="relative mb-2">
                          <PlatformAvatar
                            src={channel.avatarUrl}
                            alt={channel.displayName}
                            platform={channel.platform}
                            size="w-20 h-20"
                            className="ring-2 ring-transparent group-hover:ring-[var(--color-primary)] transition-all"
                          />
                          <div
                            className={cn(
                              "absolute bottom-0 right-0 p-1 rounded-full bg-[var(--color-background)] border-2 border-[var(--color-background)]",
                              channel.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]"
                            )}
                          >
                            {channel.platform === "twitch" ? (
                              <TwitchIcon size={12} />
                            ) : (
                              <KickIcon size={12} />
                            )}
                          </div>
                        </div>
                        <h3 className="font-medium text-sm truncate w-full group-hover:text-[var(--color-primary)] transition-colors">
                          {channel.displayName}
                        </h3>
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {liveChannels.length === 0 && offlineChannels.length === 0 && (
              <div className="text-center py-24 flex flex-col items-center gap-4 text-[var(--color-foreground-muted)] animate-in fade-in zoom-in duration-300">
                <div className="w-16 h-16 rounded-full bg-[var(--color-background-secondary)] flex items-center justify-center mb-2">
                  <LuHeart className="w-8 h-8 text-[var(--color-foreground-muted)]" />
                </div>
                <h3 className="text-xl font-semibold text-[var(--color-foreground)]">
                  No followed channels found
                </h3>
                <p>
                  {searchQuery
                    ? `No matches for "${searchQuery}"`
                    : "Follow channels to see them here!"}
                </p>
                {!searchQuery && (
                  <Link to="/" className="mt-4">
                    <Button variant="default">Browse Channels</Button>
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
