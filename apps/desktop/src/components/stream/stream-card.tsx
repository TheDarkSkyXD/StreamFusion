import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import React, { useCallback, useEffect, useMemo, useRef } from "react";

import type { UnifiedStream } from "@/backend/api/unified/platform-types";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { CHANNEL_KEYS } from "@/hooks/queries/useChannels";
import { STREAM_KEYS } from "@/hooks/queries/useStreams";
import { formatLanguageLabel, formatViewerCount } from "@/lib/utils";

interface StreamCardProps {
  stream: UnifiedStream;
  showCategory?: boolean;
}

// Hover-debounce window: long enough that wheel-scrolling past cards doesn't
// trigger prefetches, short enough that intentional hovers still warm the
// cache before the user clicks.
const HOVER_PREFETCH_DELAY_MS = 150;

// Memoize StreamCard to prevent re-renders when grid updates but individual stream hasn't changed
export const StreamCard = React.memo(({ stream, showCategory = true }: StreamCardProps) => {
  const PlatformIcon = stream.platform === "twitch" ? TwitchIcon : KickIcon;
  const platformColor = stream.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]";

  const queryClient = useQueryClient();
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: CHANNEL_KEYS.byUsername(stream.channelName, stream.platform),
        queryFn: async () => {
          const response = await window.electronAPI.channels.getByUsername({
            username: stream.channelName,
            platform: stream.platform,
          });
          if (response.error) throw new Error(response.error);
          return response.data;
        },
        staleTime: 1000 * 60 * 5,
      });

      queryClient.prefetchQuery({
        queryKey: STREAM_KEYS.byChannel(stream.channelName, stream.platform),
        queryFn: async () => {
          const response = await window.electronAPI.streams.getByChannel({
            username: stream.channelName,
            platform: stream.platform,
          });
          if (response.error) throw new Error(response.error);
          return response.data;
        },
      });
    }, HOVER_PREFETCH_DELAY_MS);
  }, [queryClient, stream.channelName, stream.platform]);

  const handleMouseLeave = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    };
  }, []);

  const displayTags = useMemo<string[] | null>(() => {
    const tags: string[] = [];

    if (stream.language) {
      tags.push(formatLanguageLabel(stream.language));
    }

    if (stream.tags && stream.tags.length > 0) {
      const langLower = stream.language?.toLowerCase();
      const langNameLower = tags[0]?.toLowerCase();
      for (const tag of stream.tags) {
        const t = tag.toLowerCase();
        if (t !== langLower && t !== langNameLower) {
          tags.push(tag);
        }
      }
    }

    if (tags.length === 0) return null;

    let totalChars = 0;
    const checkCount = Math.min(tags.length, 3);
    for (let i = 0; i < checkCount; i++) {
      totalChars += tags[i].length;
    }

    const maxTags = totalChars > 24 ? 3 : 4;
    return tags.slice(0, maxTags);
  }, [stream.language, stream.tags]);

  return (
    <Link
      to="/stream/$platform/$channel"
      params={{ platform: stream.platform, channel: stream.channelName }}
      search={{ tab: "videos" }}
      className="block group"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Card className="h-full border-transparent bg-transparent hover:bg-[var(--color-background-secondary)] transition-colors duration-200 overflow-hidden group-hover:ring-1 group-hover:ring-[var(--color-border)]">
        {/* Thumbnail Section */}
        <div className="relative aspect-video w-full overflow-hidden rounded-lg">
          <ProxiedImage
            src={stream.thumbnailUrl}
            alt={stream.title}
            className="object-cover w-full h-full transition-transform duration-300 group-hover:scale-105"
            fallback={
              <div className="w-full h-full bg-[var(--color-background-tertiary)] flex items-center justify-center text-[var(--color-foreground-muted)]">
                No Thumbnail
              </div>
            }
          />

          {/* Live Badge */}
          {stream.isLive && (
            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
              Live
            </div>
          )}

          {/* Viewer Count */}
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs font-medium backdrop-blur-sm">
            {formatViewerCount(stream.viewerCount)} viewers
          </div>

          {/* Platform Badge */}
          <div
            className={`absolute top-2 right-2 p-1 rounded bg-black/80 ${platformColor} backdrop-blur-sm`}
          >
            <PlatformIcon size={14} />
          </div>
        </div>

        {/* Info Section */}
        <CardContent className="p-3 pt-3 flex gap-3">
          {/* Avatar */}
          <div className="shrink-0">
            <PlatformAvatar
              src={stream.channelAvatar}
              alt={stream.channelDisplayName}
              platform={stream.platform}
              size="w-10 h-10"
            />
          </div>

          {/* Text Content */}
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <h3 className="font-bold text-sm text-[var(--color-foreground)] truncate leading-tight group-hover:text-[var(--color-primary)] transition-colors">
              {stream.title}
            </h3>
            {showCategory && stream.categoryName && (
              <div className="text-xs font-bold text-[var(--color-foreground)] truncate hover:underline mt-1">
                {stream.categoryName}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-sm font-bold text-[#b5b5b5] truncate leading-none">
                {stream.channelDisplayName}
              </span>
            </div>
            {/* Tags */}
            {displayTags && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {displayTags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#4a4d55] text-white hover:bg-[#5a5d66] transition-colors whitespace-nowrap"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
});

StreamCard.displayName = "StreamCard";
