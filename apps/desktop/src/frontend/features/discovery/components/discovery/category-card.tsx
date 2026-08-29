import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import React, { useCallback } from "react";

import type { UnifiedCategory } from "@shared/platform-types";
import { Card, CardContent } from "@/components/ui/card";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useCategoryMetadata } from "@/features/discovery/data/queries/useCategories";
import { STREAM_KEYS } from "@/features/discovery/data/queries/useStreams";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { formatViewerCount, uniqueTagLabels } from "@/lib/utils";

interface CategoryCardProps {
  category: UnifiedCategory;
  imageLoading?: "lazy" | "eager";
  imageFetchPriority?: "high" | "low" | "auto";
}

// Hover-debounce window mirrors StreamCard — long enough that wheel-scrolling
// past cards doesn't trigger prefetches, short enough that intentional hovers
// still warm the cache before the user clicks.
const HOVER_PREFETCH_DELAY_MS = 150;

// Memoize CategoryCard to prevent re-renders when grid updates but individual category hasn't changed
export const CategoryCard = React.memo(
  ({ category, imageLoading = "lazy", imageFetchPriority }: CategoryCardProps) => {
    const queryClient = useQueryClient();
    const pointerIntentStartedRef = React.useRef(false);
    // Lazy-fetch stream count + (Twitch-only) tags. The virtualized grid only
    // mounts cards that are visible, so we only pay for what the user can see.
    const { data: metadata } = useCategoryMetadata(category);
    const rawTags = category.tags && category.tags.length > 0 ? category.tags : metadata?.tags;
    const tags = rawTags ? uniqueTagLabels(rawTags) : undefined;

    const prefetchTimer = useManagedTimeout(
      useCallback(() => {
        queryClient.prefetchQuery({
          queryKey: STREAM_KEYS.byCategory(category.id, category.platform),
          queryFn: async () => {
            const response = await window.electronAPI.streams.getByCategory({
              categoryId: category.id,
              platform: category.platform,
              limit: 20,
            });
            if (response.error) throw new Error(response.error as string);
            return response.data;
          },
        });
      }, [category.id, category.platform, queryClient])
    );

    const handlePointerMove = useCallback(() => {
      if (pointerIntentStartedRef.current) return;
      pointerIntentStartedRef.current = true;
      void import("@/pages/CategoryDetail");
      prefetchTimer.start(HOVER_PREFETCH_DELAY_MS);
    }, [prefetchTimer]);

    const handleMouseLeave = useCallback(() => {
      pointerIntentStartedRef.current = false;
      prefetchTimer.clear();
    }, [prefetchTimer]);

    const handleFocus = useCallback(() => {
      void import("@/pages/CategoryDetail");
      prefetchTimer.start(0);
    }, [prefetchTimer]);

    return (
      <Link
        to="/categories/$platform/$categoryId"
        params={{
          platform: category.platform,
          categoryId: category.id,
        }}
        search={category.crossPlatformId ? { otherId: category.crossPlatformId } : {}}
        className="block h-full"
        onPointerMove={handlePointerMove}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
      >
        <Card className="overflow-hidden cursor-pointer hover:ring-2 hover:ring-white transition-shadow h-full group bg-[var(--color-background-secondary)] border-transparent">
          <div className="aspect-[3/4] bg-[var(--color-background-tertiary)] relative overflow-hidden">
            <ProxiedImage
              src={category.boxArtUrl.replace("{width}", "285").replace("{height}", "380")}
              alt={category.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading={imageLoading}
              fetchPriority={imageFetchPriority}
              fallback={
                <div className="w-full h-full flex items-center justify-center text-4xl">🎮</div>
              }
            />
          </div>
          <CardContent className="p-3">
            <h3
              className="font-semibold text-sm line-clamp-1 group-hover:text-[var(--color-primary)] transition-colors"
              title={category.name}
            >
              {category.name}
            </h3>
            <p className="text-xs text-neutral-400 mt-1 truncate">
              {formatViewerCount(category.viewerCount ?? 0)} viewers
            </p>
            <div
              data-testid="category-tags"
              className="mt-2 flex h-5 flex-nowrap gap-1 overflow-hidden"
            >
              {tags?.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="shrink-0 whitespace-nowrap rounded-full bg-[var(--color-background-tertiary)] px-2 py-0.5 text-[10px] font-medium text-neutral-300"
                  title={tag}
                >
                  {tag}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }
);

CategoryCard.displayName = "CategoryCard";
