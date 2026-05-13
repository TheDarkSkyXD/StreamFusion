import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { LuPlay } from "react-icons/lu";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { ProxiedImage } from "@/components/ui/proxied-image";
import type { Platform } from "@/shared/auth-types";

import type { VideoOrClip } from "./types";
import { formatTimeAgo, formatViews } from "./utils";

interface ClipCardProps {
  clip: VideoOrClip;
  onClick: () => void;
  platform: Platform;
  channelName: string;
  channelData: UnifiedChannel | null | undefined;
}

// Memoized to prevent re-renders when parent list updates
export const ClipCard = memo(function ClipCard({
  clip,
  onClick,
  platform,
  channelName,
  channelData,
}: ClipCardProps) {
  const categoryName = clip.category || clip.gameName;

  return (
    <Card className="overflow-hidden border border-transparent bg-[var(--color-background-secondary)] hover:border-[var(--color-border)] transition-colors h-full group flex flex-col cursor-pointer">
      {/* Thumbnail Section */}
      <div
        onClick={onClick}
        className="block relative aspect-video bg-[var(--color-background-tertiary)] overflow-hidden"
      >
        {clip.thumbnailUrl && (
          <ProxiedImage
            src={clip.thumbnailUrl}
            alt={clip.title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}

        {/* Duration: Top Left */}
        <div className="absolute top-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-xs text-white font-medium">
          {clip.duration}
        </div>

        {/* Views: Bottom Left */}
        <div className="absolute bottom-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-xs text-white font-medium">
          {formatViews(clip.views)} views
        </div>

        {/* Date: Bottom Right */}
        <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-xs text-white font-medium">
          {formatTimeAgo(clip.created_at || clip.date)}
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center scale-90 group-hover:scale-100 transition-transform">
            <LuPlay className="w-5 h-5 text-white fill-white" />
          </div>
        </div>
      </div>

      <CardContent className="pt-3 flex gap-3 relative">
        {/* Avatar */}
        <div className="shrink-0 mt-0.5">
          <PlatformAvatar
            src={clip.channelAvatar || channelData?.avatarUrl}
            alt={clip.channelName || channelData?.displayName || channelName}
            platform={platform}
            size="w-9 h-9"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div onClick={onClick}>
            <h3 className="font-medium text-sm line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors text-white">
              {clip.title}
            </h3>
          </div>

          {/* Category Link */}
          {categoryName && (
            <Link
              to="/categories/$platform/$categoryId"
              params={{
                platform: platform || "twitch",
                categoryId: categoryName,
              }}
              className="text-xs font-bold text-[#b2b2b2] hover:text-[var(--color-primary)] hover:underline mt-1 truncate transition-colors w-fit block"
              onClick={(e) => e.stopPropagation()}
            >
              {categoryName}
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
