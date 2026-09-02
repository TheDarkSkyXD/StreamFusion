import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ClipCard } from "@/features/playback/components/related-content/ClipCard";
import { ClipDialog } from "@/features/playback/components/related-content/ClipDialog";
import type { VideoOrClip } from "@/features/playback/components/related-content/types";
import { VideoCard } from "@/features/playback/components/related-content/VideoCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type CategoryClipTimeRange,
  type CategoryMediaItem,
  type CategoryMediaKind,
  type CategoryMediaSort,
  useCategoryMedia,
} from "@/features/discovery/data/queries/useCategoryMedia";
import { useFollowedClipPlayback } from "@/features/discovery/data/queries/useFollowedContent";
import type { CategoryPlatformScope } from "@/features/discovery/routes/category-detail-search";

interface CategoryMediaTabProps {
  kind: CategoryMediaKind;
  platformScope: CategoryPlatformScope;
  twitchCategoryId: string;
  kickCategoryId: string;
  kickCategorySlug?: string;
  kickCategoryName?: string;
  language?: string;
  tag?: string;
  direction: "asc" | "desc";
  timeRange: CategoryClipTimeRange;
  sort: CategoryMediaSort;
}

function mediaToCard(item: CategoryMediaItem): VideoOrClip {
  return {
    id: item.id,
    platform: item.platform,
    title: item.title,
    duration: item.duration,
    views: item.views,
    viewCount: item.viewCount,
    date: item.publishedAt,
    created_at: item.publishedAt,
    creatorName: item.creatorName,
    thumbnailUrl: item.thumbnailUrl,
    embedUrl: item.embedUrl,
    url: item.url,
    shareUrl: item.shareUrl,
    source: item.source,
    isLive: item.isLive,
    isSubOnly: item.isSubOnly,
    gameName: item.gameName,
    gameId: item.gameId,
    category: item.gameName,
    channelSlug: item.channelName,
    channelName: item.channelDisplayName,
    channelAvatar: item.channelAvatar,
  };
}

export function CategoryMediaTab({
  kind,
  platformScope,
  twitchCategoryId,
  kickCategoryId,
  kickCategorySlug,
  kickCategoryName,
  language,
  tag,
  direction,
  timeRange,
  sort,
}: CategoryMediaTabProps) {
  const { t } = useTranslation();
  const { items, isLoading, failures, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCategoryMedia({
      kind,
      platformScope,
      twitch: { platform: "twitch", categoryId: twitchCategoryId },
      kick: {
        platform: "kick",
        categoryId: kickCategoryId,
        categorySlug: kickCategorySlug,
        categoryName: kickCategoryName,
      },
      sort,
      language,
      tag,
      direction,
      timeRange,
    });
  const [selectedClip, setSelectedClip] = useState<VideoOrClip | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const clipPlayback = useFollowedClipPlayback(selectedClip);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label={t("discovery.category.loadingMedia", { kind })}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="space-y-3">
            <Skeleton className="aspect-video rounded-xl" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <section
      aria-label={t("discovery.category.tabFilters", { tab: t(`discovery.${kind}`) })}
      className="space-y-4"
    >
      {failures.map(({ platform, retry }) => {
        const platformLabel = platform === "twitch" ? "Twitch" : "Kick";
        const message =
          kind === "videos" && platform === "kick"
            ? t("discovery.category.kickVideosUnavailable")
            : t("discovery.category.mediaUnavailable", {
                platform: platformLabel,
                kind: t(`discovery.${kind}`),
              });
        return (
          <div
            key={platform}
            role="status"
            className="flex min-h-10 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-4 py-2 text-sm"
          >
            <span>{message}</span>
            <button
              type="button"
              onClick={() => void retry()}
              className="min-h-10 rounded-md bg-[var(--color-background-elevated)] px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {t("discovery.category.retryPlatform", { platform: platformLabel })}
            </button>
          </div>
        );
      })}

      {items.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-foreground-muted)]">
          {t("discovery.category.noMedia", { kind: t(`discovery.${kind}`) })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {kind === "clips"
            ? items.map((clip) => {
                const card = mediaToCard(clip);
                return (
                  <ClipCard
                    key={`${clip.platform}:${clip.id}`}
                    clip={card}
                    onClick={() => setSelectedClip(card)}
                    platform={clip.platform}
                    channelName={clip.channelName}
                    channelData={null}
                  />
                );
              })
            : items.map((video) => (
                <VideoCard
                  key={`${video.platform}:${video.id}`}
                  video={mediaToCard(video)}
                  platform={video.platform}
                  channelName={video.channelName}
                  channelData={null}
                />
              ))}
        </div>
      )}

      {hasNextPage && <div ref={loadMoreRef} aria-hidden="true" className="h-px" />}
      {isFetchingNextPage && (
        <div
          role="status"
          className="flex justify-center py-4"
          aria-label={t("discovery.category.loadingMore", { kind: t(`discovery.${kind}`) })}
        >
          <Skeleton className="h-4 w-32" />
        </div>
      )}

      {selectedClip && (
        <ClipDialog
          selectedClip={selectedClip}
          onClose={() => setSelectedClip(null)}
          clipLoading={clipPlayback.isLoading}
          clipError={clipPlayback.error instanceof Error ? clipPlayback.error.message : null}
          clipPlaybackUrl={clipPlayback.data?.url ?? null}
          clipQualities={clipPlayback.data?.qualities}
          platform={selectedClip.platform ?? "twitch"}
          channelName={selectedClip.channelSlug ?? selectedClip.channelName ?? ""}
          channelData={null}
          onPlaybackError={() => void clipPlayback.refetch()}
        />
      )}
    </section>
  );
}
