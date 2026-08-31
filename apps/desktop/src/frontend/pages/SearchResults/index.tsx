import { Link, useSearch } from "@tanstack/react-router";
import React from "react";
import { LuClapperboard, LuPlay } from "react-icons/lu";

import type { UnifiedChannel, UnifiedClip, UnifiedVideo } from "@shared/platform-types";
import { CategoryGrid } from "@/features/discovery/components/discovery/category-grid";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import type { VideoOrClip } from "@/features/playback/components/related-content/types";
import { StreamGrid } from "@/features/discovery/components/stream/stream-grid";
import { StreamVerifiedBadge } from "@/features/discovery/components/stream/stream-verified-badge";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useProviderIsolatedSearchAll,
  useSearchCategories,
  useSearchChannels,
  useSearchClips,
  useSearchStreams,
  useSearchVideos,
} from "@/features/discovery/data/queries/useSearch";
import { cn, formatDuration } from "@/lib/utils";
import {
  isExactChannelSearchMatch,
  rankSearchChannels,
} from "@/features/discovery/utils/search/channel-search-contract";

/* CATEGORIES SECTION */
type SearchTab = "all" | "channels" | "streams" | "videos" | "clips" | "categories";
const SEARCH_RESULTS_CHANNEL_PAGE_SIZE = 50;
const SEARCH_ALL_CHANNEL_LIMIT = 12;
const SEARCH_ALL_STREAM_LIMIT = 12;
const SEARCH_ALL_CATEGORY_LIMIT = 12;
const SEARCH_ALL_MEDIA_LIMIT = 6;
const ClipDialog = React.lazy(() =>
  import("@/features/playback/components/related-content/ClipDialog").then((module) => ({
    default: module.ClipDialog,
  }))
);

function ChannelDisplayName({
  channel,
  className,
}: {
  channel: UnifiedChannel;
  className: string;
}) {
  const showPartnerBadge = channel.isPartner || channel.isVerified;

  return (
    <div className="flex w-full min-w-0 items-center justify-center gap-1.5">
      <h3 className={cn("min-w-0 truncate transition-colors", className)}>{channel.displayName}</h3>
      {showPartnerBadge && <StreamVerifiedBadge platform={channel.platform} />}
    </div>
  );
}

function InfiniteSearchSentinel({
  enabled,
  fetching,
  fetchNextPage,
  label,
}: {
  enabled: boolean;
  fetching: boolean;
  fetchNextPage: () => Promise<unknown>;
  label: "videos" | "clips";
}) {
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const target = sentinelRef.current;
    if (!enabled || fetching || !target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void fetchNextPage();
      },
      { rootMargin: "320px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, fetchNextPage, fetching]);

  if (!enabled) return null;
  return (
    <div ref={sentinelRef} data-testid={`${label}-infinite-sentinel`} className="h-1" aria-hidden />
  );
}

function SearchVideoCard({ video }: { video: UnifiedVideo }) {
  const [thumbnailFailed, setThumbnailFailed] = React.useState(!video.thumbnailUrl.trim());

  if (thumbnailFailed) return null;

  return (
    <Link
      to="/video/$platform/$videoId"
      params={{ platform: video.platform, videoId: video.id }}
      search={{
        title: video.title,
        channelName: video.channelName,
        channelDisplayName: video.channelDisplayName,
        channelAvatar: video.channelAvatar || undefined,
        thumbnail: video.thumbnailUrl,
        views: String(video.viewCount),
        date: video.publishedAt,
        duration: formatDuration(video.duration),
        shareUrl: video.shareUrl,
      }}
      className="group block overflow-hidden rounded-xl bg-[var(--color-background-secondary)] transition-[transform,box-shadow] hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-storm-primary)]/10"
    >
      <div className="relative aspect-video">
        <ProxiedImage
          src={video.thumbnailUrl}
          alt={video.title}
          className="w-full h-full object-cover"
          onProxyError={() => setThumbnailFailed(true)}
        />
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs backdrop-blur-sm">
          {formatDuration(video.duration)}
        </div>
      </div>
      <div className="p-3">
        <div className="flex gap-3">
          <PlatformAvatar
            src={video.channelAvatar}
            alt={video.channelName}
            platform={video.platform}
            size="w-10 h-10"
          />
          <div className="min-w-0">
            <h3 className="font-bold text-white truncate group-hover:text-[var(--color-storm-primary)] transition-colors">
              {video.title}
            </h3>
            <p className="text-sm text-[var(--color-foreground-secondary)]">
              {video.channelDisplayName}
            </p>
            <p className="text-xs text-[var(--color-foreground-muted)] mt-1">
              {(video.viewCount || 0).toLocaleString()} views •{" "}
              {new Date(video.publishedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Platform-agnostic unified search
export function SearchPage() {
  const search = useSearch({ from: "/_app/search" });
  const q = search.q;
  const [activeTab, setActiveTab] = React.useState<SearchTab>("all");
  const [platformFilter, setPlatformFilter] = React.useState<"all" | "twitch" | "kick">("all");
  const [liveOnly, setLiveOnly] = React.useState(false);
  const [selectedClip, setSelectedClip] = React.useState<UnifiedClip | null>(null);
  const [clipPlaybackUrl, setClipPlaybackUrl] = React.useState<string | null>(null);
  const [clipLoading, setClipLoading] = React.useState(false);
  const [clipError, setClipError] = React.useState<string | null>(null);
  const [channelsExhaustedByRepeat, setChannelsExhaustedByRepeat] = React.useState(false);
  const channelSearchPlatform = platformFilter === "all" ? undefined : platformFilter;
  const channelSearchKey = `${q.trim().toLowerCase()}|${channelSearchPlatform ?? "all"}|${liveOnly}`;

  // Pass platform filter to the query. Pass undefined if 'all'.
  const { data: allResults, isLoading: allLoading } = useProviderIsolatedSearchAll(
    q,
    channelSearchPlatform,
    20,
    activeTab !== "channels"
  );
  const {
    data: channelsInfiniteData,
    isLoading: channelsLoading,
    isFetchingNextPage: channelsFetchingNextPage,
    hasNextPage: channelsHasNextPage,
    fetchNextPage: fetchMoreChannels,
  } = useSearchChannels(
    q,
    channelSearchPlatform,
    SEARCH_RESULTS_CHANNEL_PAGE_SIZE,
    liveOnly,
    activeTab === "channels"
  );
  const streamsQuery = useSearchStreams(
    q,
    channelSearchPlatform,
    20,
    activeTab === "streams",
    liveOnly
  );
  const videosQuery = useSearchVideos(q, channelSearchPlatform, 12, activeTab === "videos");
  const clipsQuery = useSearchClips(q, channelSearchPlatform, 12, activeTab === "clips");
  const categoriesQuery = useSearchCategories(
    q,
    channelSearchPlatform,
    20,
    activeTab === "categories"
  );

  const channelPages = channelsInfiniteData?.pages;
  const categoryPages = categoriesQuery.data?.pages;
  const searchAllChannels = allResults?.channels;
  const rawChannelResults = React.useMemo(
    () =>
      activeTab === "channels"
        ? (channelPages?.flatMap((page) => page.data) ?? [])
        : activeTab === "all"
          ? (searchAllChannels ?? [])
          : [],
    [activeTab, channelPages, searchAllChannels]
  );

  const allChannelResults = React.useMemo(
    () =>
      rankSearchChannels(
        rawChannelResults.filter(
          (channel) =>
            typeof channel?.id === "string" &&
            (channel.platform === "twitch" || channel.platform === "kick") &&
            typeof channel.username === "string" &&
            channel.username.trim().length > 0 &&
            typeof channel.displayName === "string"
        ),
        q
      ),
    [rawChannelResults, q]
  );

  const channelPaginationRef = React.useRef({
    key: "",
    pageCount: 0,
    uniqueCount: 0,
    exhaustedByRepeat: false,
  });

  React.useEffect(() => {
    const pageCount = channelsInfiniteData?.pages.length ?? 0;
    const state = channelPaginationRef.current;

    if (state.key !== channelSearchKey) {
      channelPaginationRef.current = {
        key: channelSearchKey,
        pageCount,
        uniqueCount: allChannelResults.length,
        exhaustedByRepeat: false,
      };
      setChannelsExhaustedByRepeat(false);
      return;
    }

    if (pageCount > state.pageCount && allChannelResults.length === state.uniqueCount) {
      state.exhaustedByRepeat = true;
      setChannelsExhaustedByRepeat(true);
    }
    state.pageCount = pageCount;
    state.uniqueCount = allChannelResults.length;
  }, [allChannelResults.length, channelSearchKey, channelsInfiniteData?.pages.length]);

  React.useEffect(() => {
    if (
      !q.trim() ||
      activeTab !== "channels" ||
      channelsExhaustedByRepeat ||
      !channelsHasNextPage ||
      channelsFetchingNextPage
    ) {
      return;
    }

    void fetchMoreChannels();
  }, [
    q,
    activeTab,
    channelsExhaustedByRepeat,
    channelsFetchingNextPage,
    channelsHasNextPage,
    fetchMoreChannels,
  ]);

  // Apply Client-Side Filtering (Live Only)
  // Note: Platform filtering is handled by the API via useSearchChannels.
  const filteredChannels = React.useMemo(() => {
    const channels = allChannelResults.filter(
      (channel) => typeof channel.username === "string" && channel.username.trim().length > 0
    );
    if (liveOnly) {
      return channels.filter((c) => c.isLive);
    }
    return channels;
  }, [allChannelResults, liveOnly]);

  const filteredStreams = React.useMemo(
    () =>
      (activeTab === "streams"
        ? (streamsQuery.data ?? [])
        : activeTab === "all"
          ? (allResults?.streams ?? [])
          : []
      ).filter(
        (stream) => typeof stream.channelName === "string" && stream.channelName.trim().length > 0
      ),
    [activeTab, allResults?.streams, streamsQuery.data]
  ); // Streams are inherently live

  const filteredCategories = React.useMemo(
    () =>
      activeTab === "categories"
        ? (categoryPages?.flatMap((page) => page.data) ?? [])
        : activeTab === "all"
          ? (allResults?.categories ?? [])
          : [],
    [activeTab, allResults?.categories, categoryPages]
  );

  const filteredVideos = React.useMemo(() => {
    const videos =
      activeTab === "videos"
        ? (videosQuery.data ?? [])
        : activeTab === "all"
          ? (allResults?.videos ?? [])
          : [];
    if (liveOnly) return []; // Hide videos when looking for live content
    return videos;
  }, [activeTab, allResults?.videos, liveOnly, videosQuery.data]);

  const filteredClips = React.useMemo(() => {
    const clips =
      activeTab === "clips"
        ? (clipsQuery.data ?? [])
        : activeTab === "all"
          ? (allResults?.clips ?? [])
          : [];
    if (liveOnly) return []; // Hide clips when looking for live content
    return clips;
  }, [activeTab, allResults?.clips, clipsQuery.data, liveOnly]);

  const selectedClipForDialog: VideoOrClip | null = React.useMemo(() => {
    if (!selectedClip) return null;

    return {
      id: selectedClip.id,
      title: selectedClip.title,
      duration: formatDuration(selectedClip.duration),
      views: (selectedClip.viewCount || 0).toString(),
      date: selectedClip.createdAt,
      created_at: selectedClip.createdAt,
      creatorName: selectedClip.creatorName,
      thumbnailUrl: selectedClip.thumbnailUrl,
      embedUrl: selectedClip.embedUrl || selectedClip.clipUrl,
      url: selectedClip.clipUrl,
      shareUrl: selectedClip.shareUrl || selectedClip.clipUrl,
      gameName: selectedClip.gameName,
      channelSlug: selectedClip.channelName,
      channelName: selectedClip.channelDisplayName || selectedClip.channelName,
      channelAvatar: selectedClip.channelAvatar,
      platform: selectedClip.platform,
    };
  }, [selectedClip]);

  React.useEffect(() => {
    if (!selectedClip) {
      setClipPlaybackUrl(null);
      setClipError(null);
      return;
    }

    let cancelled = false;
    const fetchClipPlayback = async () => {
      setClipLoading(true);
      setClipError(null);

      try {
        const result = await window.electronAPI.clips.getPlaybackUrl({
          platform: selectedClip.platform,
          clipId: selectedClip.id,
          clipUrl: selectedClip.embedUrl || selectedClip.clipUrl,
          thumbnailUrl: selectedClip.thumbnailUrl,
        });

        if (cancelled) return;
        if (result?.success && result?.data?.url) {
          setClipPlaybackUrl(result.data.url);
        } else if (selectedClip.platform === "twitch") {
          setClipPlaybackUrl(null);
        } else {
          setClipError(result?.error || "Failed to load clip");
        }
      } catch (_error) {
        if (cancelled) return;
        if (selectedClip.platform === "twitch") {
          setClipPlaybackUrl(null);
        } else {
          setClipError("Failed to load clip");
        }
      } finally {
        if (!cancelled) setClipLoading(false);
      }
    };

    void fetchClipPlayback();
    return () => {
      cancelled = true;
    };
  }, [selectedClip]);

  // Identify Best Matches from Filtered Results
  const { topMatches, otherMatches } = React.useMemo(() => {
    if (!filteredChannels || !q) return { topMatches: [], otherMatches: filteredChannels || [] };

    const top: UnifiedChannel[] = [];
    const others: UnifiedChannel[] = [];

    filteredChannels.forEach((channel) => {
      if (isExactChannelSearchMatch(channel, q)) {
        top.push(channel);
      } else {
        others.push(channel);
      }
    });

    return { topMatches: top, otherMatches: others };
  }, [filteredChannels, q]);

  const visibleTopMatches =
    activeTab === "all" ? topMatches.slice(0, SEARCH_ALL_CHANNEL_LIMIT) : topMatches;
  const visibleOtherMatches =
    activeTab === "all"
      ? otherMatches.slice(0, Math.max(0, SEARCH_ALL_CHANNEL_LIMIT - visibleTopMatches.length))
      : otherMatches;
  const visibleCategories =
    activeTab === "all"
      ? filteredCategories.slice(0, SEARCH_ALL_CATEGORY_LIMIT)
      : filteredCategories;
  const visibleStreams =
    activeTab === "all" ? filteredStreams.slice(0, SEARCH_ALL_STREAM_LIMIT) : filteredStreams;
  const visibleVideos =
    activeTab === "all" ? filteredVideos.slice(0, SEARCH_ALL_MEDIA_LIMIT) : filteredVideos;
  const visibleClips =
    activeTab === "all" ? filteredClips.slice(0, SEARCH_ALL_MEDIA_LIMIT) : filteredClips;

  if (!q) {
    return (
      <div className="flex flex-col items-center justify-center p-12 mt-12 text-center animate-in fade-in zoom-in duration-300">
        <div className="w-16 h-16 bg-[var(--color-background-secondary)] rounded-full flex items-center justify-center mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-[var(--color-foreground-muted)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Search StreamFusion</h2>
        <p className="text-[var(--color-foreground-secondary)] max-w-sm">
          Search for your favorite channels, streams, and categories across Twitch and Kick.
        </p>
      </div>
    );
  }

  const showTopMatches =
    (activeTab === "all" || activeTab === "channels") && visibleTopMatches.length > 0;
  const showChannels =
    (activeTab === "all" || activeTab === "channels") && visibleOtherMatches.length > 0;
  const showChannelLoading =
    activeTab === "channels" &&
    (channelsLoading ||
      channelsFetchingNextPage ||
      (channelsHasNextPage && !channelsExhaustedByRepeat));
  const activeLoading =
    activeTab === "all"
      ? allLoading
      : activeTab === "channels"
        ? showChannelLoading
        : activeTab === "streams"
          ? streamsQuery.isLoading
          : activeTab === "videos"
            ? videosQuery.isLoading
            : activeTab === "clips"
              ? clipsQuery.isLoading
              : categoriesQuery.isLoading;
  const showCategories =
    (activeTab === "all" || activeTab === "categories") && visibleCategories.length > 0;
  const showStreams = (activeTab === "all" || activeTab === "streams") && visibleStreams.length > 0;
  const showVideos = (activeTab === "all" || activeTab === "videos") && visibleVideos.length > 0;
  const showClips = (activeTab === "all" || activeTab === "clips") && visibleClips.length > 0;

  // Calculate total count based on filtered results
  const totalResults =
    filteredChannels.length +
    filteredStreams.length +
    filteredVideos.length +
    filteredClips.length +
    filteredCategories.length;
  const activeHasResults = totalResults > 0;
  const focusedMediaHasNextPage =
    activeTab === "videos"
      ? videosQuery.hasNextPage
      : activeTab === "clips"
        ? clipsQuery.hasNextPage
        : false;
  const focusedMediaFetchingNextPage =
    activeTab === "videos"
      ? videosQuery.isFetchingNextPage
      : activeTab === "clips"
        ? clipsQuery.isFetchingNextPage
        : false;
  const activeQuerySettled =
    !activeLoading &&
    (activeTab !== "channels" ||
      (!channelsFetchingNextPage && (!channelsHasNextPage || channelsExhaustedByRepeat))) &&
    ((activeTab !== "videos" && activeTab !== "clips") ||
      (!focusedMediaFetchingNextPage && !focusedMediaHasNextPage));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* HEADER & FILTERS */}
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Search Results for "<span className="text-[var(--color-storm-primary)]">{q}</span>"
          </h1>
          <p className="text-[var(--color-foreground-muted)]">Found {totalResults} results</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-[var(--color-background-secondary)]/30 p-4 rounded-xl border border-[var(--color-border)]">
          {/* TABS */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full pb-1 sm:pb-0">
            {(["all", "channels", "streams", "videos", "clips", "categories"] as const).map(
              (tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium transition-colors rounded-lg whitespace-nowrap",
                    activeTab === tab
                      ? "bg-[var(--color-storm-primary)] text-black font-bold shadow-lg shadow-[var(--color-storm-primary)]/20"
                      : "text-[var(--color-foreground-secondary)] hover:bg-white/5 hover:text-white"
                  )}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              )
            )}
          </div>

          {/* FILTERS control group */}
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="h-6 w-px bg-[var(--color-border)] mx-1 hidden sm:block" />

            {/* Platform Filter */}
            <div className="flex items-center gap-1 bg-black/20 p-1 rounded-lg border border-[var(--color-border)]">
              <button
                onClick={() => setPlatformFilter("all")}
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-colors",
                  platformFilter === "all"
                    ? "bg-white text-black"
                    : "text-[var(--color-foreground-muted)] hover:text-white"
                )}
              >
                ALL
              </button>
              <button
                onClick={() => setPlatformFilter("twitch")}
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-colors",
                  platformFilter === "twitch"
                    ? "bg-[#9146FF] text-white"
                    : "text-[var(--color-foreground-muted)] hover:text-[#9146FF]"
                )}
              >
                TWITCH
              </button>
              <button
                onClick={() => setPlatformFilter("kick")}
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-colors",
                  platformFilter === "kick"
                    ? "bg-[#53FC18] text-black"
                    : "text-[var(--color-foreground-muted)] hover:text-[#53FC18]"
                )}
              >
                KICK
              </button>
            </div>

            {/* Live Only Toggle */}
            <button
              onClick={() => setLiveOnly(!liveOnly)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors",
                liveOnly
                  ? "bg-red-500/10 border-red-500 text-red-500"
                  : "bg-transparent border-[var(--color-border)] text-[var(--color-foreground-muted)] hover:border-red-500/50 hover:text-red-500/80"
              )}
            >
              <div className={cn("w-2 h-2 rounded-full bg-current", liveOnly && "animate-pulse")} />
              LIVE ONLY
            </button>
          </div>
        </div>
      </div>

      {(activeTab === "videos" || activeTab === "clips") && (
        <p className="text-sm text-[var(--color-foreground-muted)]">
          Recent content from matching channels.
        </p>
      )}

      {activeLoading && (activeTab === "videos" || activeTab === "clips") && (
        <div
          className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
          aria-label={`Loading ${activeTab}`}
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`${activeTab}-loading-${index}`} className="aspect-video rounded-xl" />
          ))}
        </div>
      )}

      {/* BEST MATCHES SECTION */}
      {showTopMatches && (
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            Best Matches
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {visibleTopMatches.map((channel) => (
              <Link
                key={`${channel.platform}-${channel.id}`}
                to="/stream/$platform/$channel"
                params={{ platform: channel.platform, channel: channel.username }}
                search={{ tab: "home" }}
                className="group flex flex-col items-center rounded-xl p-4 text-center"
              >
                <div className="relative mb-3">
                  <PlatformAvatar
                    src={channel.avatarUrl}
                    alt={channel.displayName}
                    platform={channel.platform}
                    size="w-24 h-24"
                    className="transition-transform group-hover:scale-105"
                  />
                  <div
                    className={cn(
                      "absolute bottom-0 right-0 p-1.5 rounded-full bg-[var(--color-background)] border-2 border-[var(--color-background)]",
                      channel.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]"
                    )}
                  >
                    {channel.platform === "twitch" ? (
                      <TwitchIcon size={16} />
                    ) : (
                      <KickIcon size={16} />
                    )}
                  </div>
                </div>
                <ChannelDisplayName
                  channel={channel}
                  className="font-bold text-lg group-hover:text-[var(--color-primary)]"
                />
                {channel.isLive && (
                  <span className="mt-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-bold uppercase tracking-wider border border-red-500/20">
                    Live
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CHANNELS SECTION */}
      {(showChannels || showChannelLoading) && (
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">Channels</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {visibleOtherMatches.map((channel) => (
              <Link
                key={`${channel.platform}-${channel.id}`}
                to="/stream/$platform/$channel"
                params={{ platform: channel.platform, channel: channel.username }}
                search={{ tab: "home" }}
                className="group flex flex-col items-center rounded-xl p-4 text-center"
              >
                <div className="relative mb-3">
                  <PlatformAvatar
                    src={channel.avatarUrl}
                    alt={channel.displayName}
                    platform={channel.platform}
                    size="w-20 h-20"
                    className="ring-2 ring-transparent transition-shadow group-hover:ring-[var(--color-primary)]"
                  />
                  <div
                    className={cn(
                      "absolute bottom-0 right-0 p-1.5 rounded-full bg-[var(--color-background)] border-2 border-[var(--color-background)]",
                      channel.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]"
                    )}
                  >
                    {channel.platform === "twitch" ? (
                      <TwitchIcon size={14} />
                    ) : (
                      <KickIcon size={14} />
                    )}
                  </div>
                </div>
                <ChannelDisplayName
                  channel={channel}
                  className="font-bold text-base group-hover:text-[var(--color-primary)]"
                />
                {channel.isLive && (
                  <span className="mt-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 text-[10px] font-bold uppercase tracking-wider border border-red-500/20">
                    Live
                  </span>
                )}
              </Link>
            ))}
            {showChannelLoading &&
              Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={`channel-loading-${index}`}
                  className="flex flex-col items-center text-center p-4 rounded-xl"
                >
                  <Skeleton className="w-20 h-20 rounded-full mb-3" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
          </div>
        </section>
      )}

      {/* CATEGORIES SECTION */}
      {(showCategories ||
        (activeTab === "all" && allLoading) ||
        (activeTab === "categories" && activeLoading)) && (
        <section>
          {!activeLoading && showCategories && (
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              Categories
            </h2>
          )}
          {activeLoading && <Skeleton className="h-8 w-32 mb-4" />}

          <CategoryGrid
            categories={visibleCategories}
            isLoading={activeLoading}
            skeletons={12}
            className={!showCategories && !activeLoading ? "hidden" : ""}
          />
        </section>
      )}

      {/* STREAMS SECTION */}
      {(showStreams ||
        (activeTab === "all" && allLoading) ||
        (activeTab === "streams" && activeLoading)) && (
        <section>
          {!activeLoading && showStreams && (
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">Streams</h2>
          )}
          {activeLoading && <Skeleton className="h-8 w-32 mb-4" />}

          <StreamGrid
            streams={visibleStreams}
            isLoading={activeLoading}
            skeletons={6}
            className={!showStreams && !activeLoading ? "hidden" : ""}
          />
        </section>
      )}

      {/* VIDEOS SECTION */}
      {showVideos && (
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <LuPlay className="w-5 h-5 text-[var(--color-storm-primary)]" /> Videos
          </h2>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {visibleVideos.map((video: UnifiedVideo) => (
              <SearchVideoCard key={`${video.platform}-${video.id}`} video={video} />
            ))}
          </div>
        </section>
      )}

      {/* CLIPS SECTION */}
      {showClips && (
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <LuClapperboard className="w-5 h-5 text-white" /> Clips
          </h2>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {visibleClips.map((clip: UnifiedClip) => (
              <button
                type="button"
                onClick={() => setSelectedClip(clip)}
                key={`${clip.platform}-${clip.id}`}
                className="group w-full cursor-pointer overflow-hidden rounded-xl bg-[var(--color-background-secondary)] text-left transition-[transform,box-shadow] hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-storm-primary)]/10"
              >
                <div className="relative aspect-video">
                  <ProxiedImage
                    src={clip.thumbnailUrl}
                    alt={clip.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <div className="flex h-12 w-12 scale-90 items-center justify-center rounded-full border border-white/35 bg-black/70 text-white backdrop-blur-sm transition-[transform,background-color,color] group-hover:scale-100 group-hover:bg-white group-hover:text-black">
                      <LuPlay className="h-5 w-5 fill-current" />
                    </div>
                  </div>

                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs backdrop-blur-sm">
                    {formatDuration(clip.duration)}
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex gap-2.5">
                    <PlatformAvatar
                      src={clip.channelAvatar}
                      alt={clip.channelName}
                      platform={clip.platform}
                      size="w-8 h-8"
                    />
                    <div className="min-w-0">
                      <h3 className="font-bold text-sm text-white truncate group-hover:text-[var(--color-storm-primary)] transition-colors">
                        {clip.title}
                      </h3>
                      <p className="text-xs text-[var(--color-foreground-secondary)]">
                        {clip.channelDisplayName}
                      </p>
                      <p className="text-xs text-[var(--color-foreground-muted)] mt-0.5">
                        {(clip.viewCount || 0).toLocaleString()} views
                      </p>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeTab === "videos" && (
        <InfiniteSearchSentinel
          enabled={Boolean(videosQuery.hasNextPage)}
          fetching={videosQuery.isFetchingNextPage}
          fetchNextPage={videosQuery.fetchNextPage}
          label="videos"
        />
      )}
      {activeTab === "clips" && (
        <InfiniteSearchSentinel
          enabled={Boolean(clipsQuery.hasNextPage)}
          fetching={clipsQuery.isFetchingNextPage}
          fetchNextPage={clipsQuery.fetchNextPage}
          label="clips"
        />
      )}

      {/* EMPTY STATE */}
      {activeQuerySettled && !activeHasResults && (
        <div className="text-center py-20 bg-[var(--color-background-secondary)]/30 rounded-2xl border border-[var(--color-border)] border-dashed">
          <p className="text-xl text-[var(--color-foreground-secondary)] font-medium">
            No results found for "{q}"
          </p>
          <p className="text-[var(--color-foreground-muted)] mt-2">
            Try adjusting your filters or checking your spelling.
          </p>
        </div>
      )}
      {selectedClip && (
        <React.Suspense fallback={null}>
          <ClipDialog
            selectedClip={selectedClipForDialog}
            onClose={() => setSelectedClip(null)}
            clipLoading={clipLoading}
            clipError={clipError}
            clipPlaybackUrl={clipPlaybackUrl}
            platform={selectedClip.platform}
            channelName={selectedClip.channelName}
            channelData={null}
            onPlaybackError={() => setClipError("Failed to play clip")}
          />
        </React.Suspense>
      )}
    </div>
  );
}
