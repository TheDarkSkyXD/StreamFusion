import { Link, useSearch } from "@tanstack/react-router";
import React from "react";
import { LuClapperboard, LuPlay } from "react-icons/lu";

import type {
  UnifiedChannel,
  UnifiedClip,
  UnifiedVideo,
} from "@/backend/api/unified/platform-types";
import { CategoryGrid } from "@/components/discovery/category-grid";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { StreamGrid } from "@/components/stream/stream-grid";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchAll } from "@/hooks/queries/useSearch";
import { cn, formatDuration } from "@/lib/utils";

/* CATEGORIES SECTION */
type SearchTab = "all" | "channels" | "streams" | "videos" | "clips" | "categories";

// Platform-agnostic unified search
export function SearchPage() {
  const search: any = useSearch({ from: "/_app/search" });
  const q = search.q as string;
  const [activeTab, setActiveTab] = React.useState<SearchTab>("all");
  const [platformFilter, setPlatformFilter] = React.useState<"all" | "twitch" | "kick">("all");
  const [liveOnly, setLiveOnly] = React.useState(false);
  const [selectedClip, setSelectedClip] = React.useState<UnifiedClip | null>(null);

  // Pass platform filter to the query. Pass undefined if 'all'.
  const { data, isLoading } = useSearchAll(
    q,
    platformFilter === "all" ? undefined : platformFilter,
    20
  );

  const results = data;

  // Apply Client-Side Filtering (Live Only)
  // Note: Platform filtering is handled by the API via useSearchAll
  const filteredChannels = React.useMemo(() => {
    const channels = results?.channels || [];
    if (liveOnly) {
      return channels.filter((c) => c.isLive);
    }
    return channels;
  }, [results?.channels, liveOnly]);

  const filteredStreams = results?.streams || []; // Streams are inherently live

  const filteredCategories = results?.categories || []; // Categories don't have a live state

  const filteredVideos = React.useMemo(() => {
    const videos = results?.videos || [];
    if (liveOnly) return []; // Hide videos when looking for live content
    return videos;
  }, [results?.videos, liveOnly]);

  const filteredClips = React.useMemo(() => {
    const clips = results?.clips || [];
    if (liveOnly) return []; // Hide clips when looking for live content
    return clips;
  }, [results?.clips, liveOnly]);

  // Identify Best Matches from Filtered Results
  const { topMatches, otherMatches } = React.useMemo(() => {
    if (!filteredChannels || !q) return { topMatches: [], otherMatches: filteredChannels || [] };

    const normalizedQuery = q.toLowerCase().trim();
    const top: UnifiedChannel[] = [];
    const others: UnifiedChannel[] = [];

    filteredChannels.forEach((channel) => {
      const isExact =
        channel.username.toLowerCase() === normalizedQuery ||
        channel.displayName.toLowerCase() === normalizedQuery;
      if (isExact) {
        top.push(channel);
      } else {
        others.push(channel);
      }
    });

    return { topMatches: top, otherMatches: others };
  }, [filteredChannels, q]);

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

  const showTopMatches = (activeTab === "all" || activeTab === "channels") && topMatches.length > 0;
  const showChannels = (activeTab === "all" || activeTab === "channels") && otherMatches.length > 0;
  const showCategories =
    (activeTab === "all" || activeTab === "categories") && filteredCategories.length > 0;
  const showStreams =
    (activeTab === "all" || activeTab === "streams") && filteredStreams.length > 0;
  const showVideos = (activeTab === "all" || activeTab === "videos") && filteredVideos.length > 0;
  const showClips = (activeTab === "all" || activeTab === "clips") && filteredClips.length > 0;

  // Calculate total count based on filtered results
  const totalResults =
    filteredChannels.length +
    filteredStreams.length +
    filteredVideos.length +
    filteredClips.length +
    filteredCategories.length;

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
                    "px-3 py-1.5 text-sm font-medium transition-all rounded-lg whitespace-nowrap",
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
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
                  platformFilter === "all"
                    ? "bg-[var(--color-foreground-secondary)] text-black"
                    : "text-[var(--color-foreground-muted)] hover:text-white"
                )}
              >
                ALL
              </button>
              <button
                onClick={() => setPlatformFilter("twitch")}
                className={cn(
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
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
                  "px-3 py-1 text-xs font-bold rounded-md transition-all",
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
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all",
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

      {/* BEST MATCHES SECTION */}
      {showTopMatches && (
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            Best Matches
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {topMatches.map((channel) => (
              <Link
                key={`${channel.platform}-${channel.id}`}
                to="/stream/$platform/$channel"
                params={{ platform: channel.platform, channel: channel.username }}
                search={{ tab: "videos" }}
                className="flex flex-col items-center text-center p-4 rounded-xl transition-all group"
              >
                <div className="relative mb-3">
                  <PlatformAvatar
                    src={channel.avatarUrl}
                    alt={channel.displayName}
                    platform={channel.platform}
                    size="w-24 h-24"
                    className="transition-transform group-hover:scale-105"
                    showBadge={false}
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
                <h3 className="font-bold text-lg truncate w-full group-hover:text-[var(--color-primary)] transition-colors">
                  {channel.displayName}
                </h3>
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
      {showChannels && (
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">Channels</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {otherMatches.map((channel) => (
              <Link
                key={`${channel.platform}-${channel.id}`}
                to="/stream/$platform/$channel"
                params={{ platform: channel.platform, channel: channel.username }}
                search={{ tab: "videos" }}
                className="flex flex-col items-center text-center p-4 rounded-xl transition-all group"
              >
                <div className="relative mb-3">
                  <PlatformAvatar
                    src={channel.avatarUrl}
                    alt={channel.displayName}
                    platform={channel.platform}
                    size="w-20 h-20"
                    className="ring-2 ring-transparent group-hover:ring-[var(--color-primary)] transition-all"
                    showBadge={false}
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
                <h3 className="font-bold text-base truncate w-full group-hover:text-[var(--color-primary)] transition-colors">
                  {channel.displayName}
                </h3>
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

      {/* CATEGORIES SECTION */}
      {(showCategories || isLoading) && (
        <section>
          {!isLoading && showCategories && (
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              Categories
            </h2>
          )}
          {isLoading && <Skeleton className="h-8 w-32 mb-4" />}

          <CategoryGrid
            categories={filteredCategories}
            isLoading={isLoading}
            skeletons={12}
            className={!showCategories && !isLoading ? "hidden" : ""}
          />
        </section>
      )}

      {/* STREAMS SECTION */}
      {(showStreams || isLoading) && (
        <section>
          {!isLoading && showStreams && (
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">Streams</h2>
          )}
          {isLoading && <Skeleton className="h-8 w-32 mb-4" />}

          <StreamGrid
            streams={filteredStreams}
            isLoading={isLoading}
            skeletons={6}
            className={!showStreams && !isLoading ? "hidden" : ""}
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
            {filteredVideos.map((video: UnifiedVideo) => (
              <Link
                to="/video/$platform/$videoId"
                params={{ platform: video.platform, videoId: video.id }}
                key={`${video.platform}-${video.id}`}
                className="group block rounded-xl overflow-hidden bg-[var(--color-background-secondary)] transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-storm-primary)]/10"
              >
                <div className="relative aspect-video">
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs backdrop-blur-sm">
                    {formatDuration(video.duration)}
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex gap-3">
                    <img
                      src={video.channelAvatar}
                      alt={video.channelName}
                      className="w-10 h-10 rounded-full"
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
            {filteredClips.map((clip: UnifiedClip) => (
              <div
                onClick={() => setSelectedClip(clip)}
                key={`${clip.platform}-${clip.id}`}
                className="group cursor-pointer rounded-xl overflow-hidden bg-[var(--color-background-secondary)] transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-storm-primary)]/10"
              >
                <div className="relative aspect-video">
                  <img
                    src={clip.thumbnailUrl}
                    alt={clip.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <LuPlay className="w-5 h-5 text-white fill-white" />
                    </div>
                  </div>

                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs backdrop-blur-sm">
                    {formatDuration(clip.duration)}
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex gap-2.5">
                    <img
                      src={clip.channelAvatar}
                      alt={clip.channelName}
                      className="w-8 h-8 rounded-full"
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
              </div>
            ))}
          </div>
        </section>
      )}

      {/* EMPTY STATE */}
      {results &&
        filteredChannels.length === 0 &&
        filteredStreams.length === 0 &&
        filteredCategories.length === 0 &&
        filteredVideos.length === 0 &&
        filteredClips.length === 0 && (
          <div className="text-center py-20 bg-[var(--color-background-secondary)]/30 rounded-2xl border border-[var(--color-border)] border-dashed">
            <p className="text-xl text-[var(--color-foreground-secondary)] font-medium">
              No results found for "{q}"
            </p>
            <p className="text-[var(--color-foreground-muted)] mt-2">
              Try adjusting your filters or checking your spelling.
            </p>
          </div>
        )}
      <Dialog open={!!selectedClip} onOpenChange={(open) => !open && setSelectedClip(null)}>
        <DialogContent className="max-w-4xl bg-black border-[var(--color-border)] p-0 overflow-hidden">
          {selectedClip && (
            <>
              <div className="aspect-video bg-black relative flex items-center justify-center">
                {/* Placeholder for clip player */}
                <div className="text-center">
                  <p className="text-white font-bold text-lg mb-2">
                    Playing Clip: {selectedClip.title}
                  </p>
                  <p className="text-[var(--color-foreground-muted)]">
                    Source: {selectedClip.embedUrl}
                  </p>
                </div>
              </div>
              <DialogHeader className="hidden">
                <DialogTitle>{selectedClip.title}</DialogTitle>
              </DialogHeader>
              <div className="p-4 bg-[var(--color-background-secondary)]">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  {selectedClip.title}
                </h2>
                <div className="flex items-center gap-2 mt-2">
                  <img src={selectedClip.channelAvatar} className="w-6 h-6 rounded-full" />
                  <span className="text-sm text-[var(--color-foreground-secondary)]">
                    Clipped by {selectedClip.channelDisplayName}
                  </span>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
