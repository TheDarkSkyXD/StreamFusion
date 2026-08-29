import { Link, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, memo } from "react";
import { LuImageOff, LuLock, LuPlay, LuSparkles } from "react-icons/lu";

import type { UnifiedChannel } from "@shared/platform-types";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { ProxiedImage } from "@/components/ui/proxied-image";
import type { Platform } from "@shared/auth-types";

import { VodProgressBar } from "../vod-progress-bar";

import type { VideoOrClip } from "./types";
import { formatTimeAgo, formatViews } from "./utils";

interface VideoCardProps {
  video: VideoOrClip;
  platform: Platform;
  channelName: string;
  channelData: UnifiedChannel | null | undefined;
  showWatchProgress?: boolean;
}

function ThumbnailUnavailable() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--color-background-tertiary)] text-sm font-medium text-[var(--color-foreground-muted)]">
      <LuImageOff aria-hidden="true" className="h-5 w-5" />
      <span>Thumbnail unavailable</span>
    </div>
  );
}

// Memoized to prevent re-renders when parent list updates
export const VideoCard = memo(function VideoCard({
  video,
  platform,
  channelName,
  channelData,
  showWatchProgress = false,
}: VideoCardProps) {
  // Route as VOD when:
  // - not live, OR
  // - live with a real duration AND a source URL (stream just ended; Kick keeps is_live=true briefly)
  // A currently-live stream also has a source URL (live HLS), but its duration is "0:00",
  // so we use duration !== "0:00" to distinguish a finished recording from an active stream.
  const routeAsVod = !video.isLive || (Boolean(video.source) && video.duration !== "0:00");

  const navigate = useNavigate();

  const destination = {
    to: routeAsVod ? "/video/$platform/$videoId" : "/stream/$platform/$channel",
    params: routeAsVod
      ? {
          platform: platform || "twitch",
          videoId: video.id,
        }
      : {
          platform: platform || "twitch",
          channel: channelName,
        },
    search: routeAsVod
      ? {
          src: video.source || undefined,
          title: video.title,
          channelName: video.channelName || video.channelSlug || channelName,
          channelDisplayName: video.channelName || channelData?.displayName || channelName,
          channelAvatar: video.channelAvatar || channelData?.avatarUrl || undefined,
          thumbnail: video.thumbnailUrl || undefined,
          views: video.views,
          date: video.created_at || video.date,
          category: video.category || video.gameName || undefined,
          duration: video.duration,
          isSubOnly: video.isSubOnly || undefined,
          tags: video.tags || undefined,
          language: video.language || undefined,
          isMature: video.isMature || undefined,
          shareUrl: video.shareUrl || undefined,
        }
      : undefined,
  };

  const linkProps = {
    ...destination,
    onClick: async (e: MouseEvent) => {
      if (!routeAsVod) {
        e.preventDefault();
        try {
          await navigate(destination);
        } catch {
          return;
        }
        document
          .getElementById("main-content-scroll-area")
          ?.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
  };

  const categoryName = video.category || video.gameName;

  return (
    <Card className="overflow-hidden border border-transparent bg-[var(--color-background-secondary)] hover:border-[var(--color-border)] transition-colors h-full group flex flex-col">
      {/* Thumbnail Section */}
      <Link
        {...linkProps}
        className="block relative aspect-video bg-[var(--color-background-tertiary)] overflow-hidden"
      >
        {video.thumbnailUrl ? (
          <ProxiedImage
            src={video.thumbnailUrl}
            alt={video.title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            fallback={<ThumbnailUnavailable />}
          />
        ) : (
          <ThumbnailUnavailable />
        )}

        {/* Duration: Top Left */}
        <div
          className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-xs font-medium ${!routeAsVod ? "bg-red-600 text-white" : "bg-black/80 text-white"}`}
        >
          {!routeAsVod ? "LIVE" : video.duration}
        </div>

        {/* Sub Only Badge: Top Right - Keep for Twitch, move for Kick */}
        {video.isSubOnly && platform !== "kick" && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-600 text-white flex items-center gap-1">
            <LuLock className="w-3 h-3" />
            SUB ONLY
          </div>
        )}

        {/* Views: Bottom Left */}
        <div className="absolute bottom-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-xs text-white font-medium">
          {formatViews(video.views)} views
        </div>

        {/* Date: Bottom Right */}
        <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-xs text-white font-medium">
          {!routeAsVod ? "Today" : formatTimeAgo(video.created_at || video.date)}
        </div>

        {showWatchProgress && routeAsVod && (
          <VodProgressBar platform={platform} videoId={video.id} />
        )}

        {/* Hover overlay - show lock for sub-only, play for regular */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="flex h-12 w-12 scale-90 items-center justify-center rounded-full border border-white/35 bg-black/70 text-white backdrop-blur-sm transition-all group-hover:scale-100 group-hover:bg-white group-hover:text-black">
            {video.isSubOnly ? (
              <LuLock className="h-5 w-5" />
            ) : (
              <LuPlay className="h-5 w-5 fill-current" />
            )}
          </div>
        </div>
      </Link>

      <CardContent className="pt-3 flex gap-3 relative">
        {/* Avatar */}
        <div className="shrink-0 mt-0.5">
          <PlatformAvatar
            src={video.channelAvatar || channelData?.avatarUrl}
            alt={video.channelName || channelData?.displayName || channelName}
            platform={platform}
            size="w-9 h-9"
          />
        </div>

        <div className="flex-1 min-w-0">
          <Link {...linkProps} className="block">
            <h3 className="font-medium text-sm line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors text-white">
              {video.title}
            </h3>
          </Link>

          {/* Category Link */}
          {categoryName && (
            <Link
              to="/categories/$platform/$categoryId"
              params={{
                platform: platform || "twitch",
                categoryId: video.gameId || categoryName,
              }}
              className="text-xs font-bold text-[#b2b2b2] hover:text-[var(--color-primary)] hover:underline mt-1 truncate transition-colors w-fit block"
            >
              {categoryName}
            </Link>
          )}

          {/* Kick Sub Only Badge - Moved to info card */}
          {video.isSubOnly && platform === "kick" && (
            <div className="mt-2 flex items-center">
              <div className="px-1.5 py-1 rounded-md text-[11px] font-semibold bg-[#2b2b2b] text-white flex items-center gap-1.5">
                <LuSparkles className="w-3 h-3 text-white" />
                <span>Sub-only</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
