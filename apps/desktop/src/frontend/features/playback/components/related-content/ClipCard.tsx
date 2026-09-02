import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { memo } from "react";
import { LuPlay } from "react-icons/lu";

import type { UnifiedChannel } from "@shared/platform-types";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { ProxiedImage } from "@/components/ui/proxied-image";
import type { Platform } from "@shared/auth-types";

import type { VideoOrClip } from "./types";
import { formatTimeAgo, formatViews } from "./utils";

interface ClipCardProps {
  clip: VideoOrClip;
  onClick: () => void;
  platform: Platform;
  channelName: string;
  channelData: UnifiedChannel | null | undefined;
}

export const ClipCard = memo(function ClipCard({
  clip,
  onClick,
  platform,
  channelName,
  channelData,
}: ClipCardProps) {
  const { t } = useTranslation();
  const categoryName = clip.category || clip.gameName;

  return (
    <Card className="overflow-hidden border border-transparent bg-[var(--color-background-secondary)] hover:border-[var(--color-border)] transition-colors h-full group flex flex-col">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Play clip ${clip.title}`}
        className="block relative aspect-video w-full cursor-pointer overflow-hidden bg-[var(--color-background-tertiary)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
      >
        {clip.thumbnailUrl && (
          <ProxiedImage
            src={clip.thumbnailUrl}
            alt={clip.title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}

        <div className="absolute top-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-xs text-white font-medium">
          {clip.duration}
        </div>

        <div className="absolute bottom-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-xs text-white font-medium">
          {t("playback.viewCount", {
            value: formatViews(clip.views),
            defaultValue: "{{value}} views",
          })}
        </div>

        <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-xs text-white font-medium">
          {formatTimeAgo(clip.created_at || clip.date)}
        </div>

        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="flex h-12 w-12 scale-90 items-center justify-center rounded-full border border-white/35 bg-black/70 text-white backdrop-blur-sm transition-[transform,background-color,color] group-hover:scale-100 group-hover:bg-white group-hover:text-black">
            <LuPlay className="h-5 w-5 fill-current" />
          </div>
        </div>
      </button>

      <CardContent className="pt-3 flex gap-3 relative">
        <div className="shrink-0 mt-0.5">
          <PlatformAvatar
            src={clip.channelAvatar || channelData?.avatarUrl}
            alt={clip.channelName || channelData?.displayName || channelName}
            platform={platform}
            size="w-9 h-9"
          />
        </div>

        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={onClick}
            aria-label={`Open clip ${clip.title}`}
            className="block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <h3 className="font-medium text-sm line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors text-white">
              {clip.title}
            </h3>
          </button>

          {categoryName && (
            <Link
              to="/categories/$platform/$categoryId"
              params={{
                platform: platform || "twitch",
                categoryId: clip.gameId || categoryName,
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
