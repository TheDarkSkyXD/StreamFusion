import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import React, { useCallback, useEffect, useRef } from "react";

import type { UnifiedCategory } from "@/backend/api/unified/platform-types";
import { Card, CardContent } from "@/components/ui/card";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useCategoryMetadata } from "@/hooks/queries/useCategories";
import { STREAM_KEYS } from "@/hooks/queries/useStreams";
import { formatViewerCount } from "@/lib/utils";

interface CategoryCardProps {
  category: UnifiedCategory;
}

// Hover-debounce window mirrors StreamCard — long enough that wheel-scrolling
// past cards doesn't trigger prefetches, short enough that intentional hovers
// still warm the cache before the user clicks.
const HOVER_PREFETCH_DELAY_MS = 150;

// Memoize CategoryCard to prevent re-renders when grid updates but individual category hasn't changed
export const CategoryCard = React.memo(({ category }: CategoryCardProps) => {
  const queryClient = useQueryClient();
  // Lazy-fetch stream count + (Twitch-only) tags. The virtualized grid only
  // mounts cards that are visible, so we only pay for what the user can see.
  const { data: metadata } = useCategoryMetadata(category);
  const tags = category.tags && category.tags.length > 0 ? category.tags : metadata?.tags;

  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
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
    }, HOVER_PREFETCH_DELAY_MS);
  }, [category.id, category.platform, queryClient]);

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

  return (
    <Link
      to="/categories/$platform/$categoryId"
      params={{
        platform: category.platform,
        categoryId: category.id,
      }}
      search={category.crossPlatformId ? { otherId: category.crossPlatformId } : {}}
      className="block h-full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Card className="overflow-hidden cursor-pointer hover:ring-2 hover:ring-white transition-all h-full group bg-[var(--color-background-secondary)] border-transparent">
        <div className="aspect-[3/4] bg-[var(--color-background-tertiary)] relative overflow-hidden">
          <ProxiedImage
            src={category.boxArtUrl.replace("{width}", "285").replace("{height}", "380")}
            alt={category.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
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
          {category.viewerCount !== undefined && category.viewerCount > 0 && (
            <p className="text-xs text-gray-400 mt-1 truncate">
              {formatViewerCount(category.viewerCount)} viewers
            </p>
          )}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-background-tertiary)] text-gray-300"
                  title={tag}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
});

CategoryCard.displayName = "CategoryCard";
