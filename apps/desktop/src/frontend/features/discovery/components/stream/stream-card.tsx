import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { UnifiedStream } from "@shared/platform-types";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { Card, CardContent } from "@/components/ui/card";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { getQueryCacheOptions } from "@/features/discovery/data/queries/cache-policy";
import { CHANNEL_KEYS } from "@/features/discovery/data/queries/useChannels";
import { STREAM_KEYS } from "@/features/discovery/data/queries/useStreams";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { cn, formatLanguageLabel, formatViewerCount, uniqueTagLabels } from "@/lib/utils";
import { preloadStreamExperience } from "@/features/playback/routes/stream-route-preload";
import { StreamVerifiedBadge } from "./stream-verified-badge";

interface StreamCardProps {
  stream: UnifiedStream;
  showCategory?: boolean;
  isWatching?: boolean;
}

// Hover-debounce window: long enough that wheel-scrolling past cards doesn't
// trigger prefetches, short enough that intentional hovers still warm the
// cache before the user clicks.
const HOVER_PREFETCH_DELAY_MS = 150;
const STREAM_CARD_RENDER_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 296px",
} satisfies React.CSSProperties;
// Memoize StreamCard to prevent re-renders when grid updates but individual stream hasn't changed
export const StreamCard = React.memo(
  ({ stream, showCategory = true, isWatching = false }: StreamCardProps) => {
    const { t } = useTranslation();
    const PlatformIcon = stream.platform === "twitch" ? TwitchIcon : KickIcon;
    const platformColor = stream.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]";

    const queryClient = useQueryClient();
    const pointerIntentStartedRef = React.useRef(false);

    const prefetchTimer = useManagedTimeout(
      useCallback(() => {
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
          ...getQueryCacheOptions("followedChannelList"),
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
          ...getQueryCacheOptions("streamChannelDetail"),
        });
      }, [queryClient, stream.channelName, stream.platform])
    );

    const handlePointerMove = useCallback(() => {
      if (pointerIntentStartedRef.current) return;
      pointerIntentStartedRef.current = true;
      void preloadStreamExperience(stream.platform);
      prefetchTimer.start(HOVER_PREFETCH_DELAY_MS);
    }, [prefetchTimer, stream.platform]);

    const handleMouseLeave = useCallback(() => {
      pointerIntentStartedRef.current = false;
      prefetchTimer.clear();
    }, [prefetchTimer]);

    const handleFocus = useCallback(() => {
      void preloadStreamExperience(stream.platform);
      prefetchTimer.start(0);
    }, [prefetchTimer, stream.platform]);

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

      const uniqueTags = uniqueTagLabels(tags);
      if (uniqueTags.length === 0) return null;

      let totalChars = 0;
      const checkCount = Math.min(uniqueTags.length, 3);
      for (let i = 0; i < checkCount; i++) {
        totalChars += uniqueTags[i].length;
      }

      const maxTags = totalChars > 24 ? 3 : 4;
      return uniqueTags.slice(0, maxTags);
    }, [stream.language, stream.tags]);

    return (
      <Link
        to="/stream/$platform/$channel"
        params={{ platform: stream.platform, channel: stream.channelName }}
        search={{ tab: "home" }}
        className="block group"
        style={STREAM_CARD_RENDER_STYLE}
        aria-current={isWatching ? "true" : undefined}
        onPointerMove={handlePointerMove}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
      >
        <Card
          data-testid="stream-card"
          className={cn(
            "h-full overflow-hidden transition-colors duration-200 motion-reduce:transition-none",
            isWatching
              ? "border-white/40 bg-[var(--color-background-secondary)] ring-2 ring-white/25 group-hover:ring-white/40"
              : "border-transparent bg-transparent hover:bg-[var(--color-background-secondary)] group-hover:ring-1 group-hover:ring-[var(--color-border)]"
          )}
        >
          <div className="relative aspect-video w-full overflow-hidden rounded-lg">
            <ProxiedImage
              src={stream.thumbnailUrl}
              alt={stream.title}
              className="object-cover w-full h-full transition-transform duration-300 group-hover:scale-105"
              fallback={
                <div className="w-full h-full bg-[var(--color-background-tertiary)] flex items-center justify-center text-[var(--color-foreground-muted)]">
                  {t("discovery.noThumbnail")}
                </div>
              }
            />

            <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
              {isWatching && (
                <div
                  data-testid="watching-badge"
                  className="px-1.5 py-0.5 rounded bg-white text-black text-[10px] font-bold uppercase tracking-wider shadow-sm"
                >
                  {t("discovery.watching")}
                </div>
              )}
              {stream.isLive && (
                <div className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                  {t("discovery.live")}
                </div>
              )}
            </div>

            {/* Viewer Count */}
            <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs font-medium backdrop-blur-sm">
              {t("discovery.viewers", {
                count: stream.viewerCount,
                formattedCount: formatViewerCount(stream.viewerCount),
              })}
            </div>

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
              <div className="flex min-w-0 items-center gap-1.5 mt-1">
                <span className="min-w-0 text-sm font-bold text-[#b5b5b5] truncate leading-none">
                  {stream.channelDisplayName}
                </span>
                {stream.channelIsVerified && <StreamVerifiedBadge platform={stream.platform} />}
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
  }
);

StreamCard.displayName = "StreamCard";
