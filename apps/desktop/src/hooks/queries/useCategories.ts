import { useQuery } from "@tanstack/react-query";

import type { UnifiedCategory } from "../../backend/api/unified/platform-types";
import { normalizeCategoryName } from "../../lib/utils";
import type { Platform } from "../../shared/auth-types";

// Minimal interface for stream data needed for category aggregation
interface StreamSummary {
  categoryId?: string;
  viewerCount?: number;
}

export const CATEGORY_KEYS = {
  all: ["categories"] as const,
  top: (platform?: Platform) => [...CATEGORY_KEYS.all, "top", platform] as const,
  byId: (categoryId: string, platform: Platform) =>
    [...CATEGORY_KEYS.all, "id", platform, categoryId] as const,
  metadata: (categoryId: string, platform: Platform) =>
    [...CATEGORY_KEYS.all, "metadata", platform, categoryId] as const,
};

export interface CategoryMetadata {
  tags?: string[];
}

/**
 * Lazy-fetch per-category content tags for Twitch categories.
 *
 * Twitch's Helix /games/top response doesn't include tags, so the only way
 * to surface them is a per-card raw GQL query. The virtualized grid only
 * mounts visible cards, so this fans out to at most ~36 requests on first
 * page open, cached for 5 minutes via React Query.
 *
 * Kick categories already carry their tags through from the bulk
 * /private/v1/categories fetch, so this hook short-circuits for them.
 */
export function useCategoryMetadata(category: UnifiedCategory) {
  return useQuery({
    queryKey: CATEGORY_KEYS.metadata(category.id, category.platform),
    queryFn: async (): Promise<CategoryMetadata> => {
      const response = await window.electronAPI.categories.getMetadata({
        platform: category.platform,
        categoryId: category.id,
        slug: category.slug,
      });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return (response.data as CategoryMetadata) ?? { tags: undefined };
    },
    enabled: category.platform === "twitch",
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useTopCategories(platform?: Platform) {
  return useQuery({
    queryKey: CATEGORY_KEYS.top(platform),
    queryFn: async () => {
      // OPTIMIZATION: Fetch categories AND streams in PARALLEL instead of sequentially
      // This cuts loading time roughly in half since both requests run concurrently
      const [categoriesResponse, streamsResponse] = await Promise.all([
        window.electronAPI.categories.getTop({ platform }), // No limit - fetch ALL
        window.electronAPI.streams.getTop({ platform, limit: 100 }),
      ]);

      if (categoriesResponse.error) {
        throw new Error(categoriesResponse.error as unknown as string);
      }
      const categories = (categoriesResponse.data as UnifiedCategory[]) || [];
      const streams = (streamsResponse.data as StreamSummary[]) || [];

      // 3. Aggregate viewer counts by category ID
      const viewerCounts = new Map<string, number>();
      streams.forEach((stream) => {
        const categoryId = stream.categoryId;
        const viewers = stream.viewerCount || 0;
        if (categoryId) {
          viewerCounts.set(categoryId, (viewerCounts.get(categoryId) || 0) + viewers);
        }
      });

      // 4. Enrich categories with viewer counts
      const enrichedCategories = categories.map((category) => ({
        ...category,
        viewerCount: Math.max(viewerCounts.get(category.id) || 0, category.viewerCount || 0),
      }));

      // 5. De-duplicate: Twitch-first, then ADD Kick-exclusives
      // Rule:
      //   - Use Twitch version for any category that exists on Twitch
      //   - ADD Kick categories that DON'T exist on Twitch
      //   - Exception: Slots → prefer Kick version (better metadata)
      //
      // For every category that exists on BOTH platforms we also stash the
      // other-platform id/name on the surviving entry as `crossPlatformId` /
      // `crossPlatformName`. CategoryDetail uses that to fetch streams from the
      // other platform directly, skipping a name-based runtime search that's
      // brittle and (for unauthenticated Kick users) limited to whatever
      // happens to be in the top public livestream dump.

      const twitchByKey = new Map<string, UnifiedCategory>();
      const kickByKey = new Map<string, UnifiedCategory>();
      for (const category of enrichedCategories) {
        const key = normalizeCategoryName(category.name);
        if (category.platform === "twitch") {
          twitchByKey.set(key, category);
        } else if (category.platform === "kick") {
          kickByKey.set(key, category);
        }
      }

      const categoryMap = new Map<string, UnifiedCategory>();
      const slotsKey = "slots";

      // First pass: Twitch entries (priority), enriched with Kick id/name if present.
      // For shared categories, sum the Kick viewer count into the surviving Twitch
      // entry — otherwise the card under-reports total cross-platform viewership.
      // Tags fall back to Kick's curated set when Twitch hasn't supplied any
      // (Helix /games/top doesn't return tags at all, so without this the merged
      // card would have no tags despite Kick having them).
      for (const [key, twitchCategory] of twitchByKey) {
        // Slots: prefer Kick metadata when available — handled in the second pass.
        if (key === slotsKey && kickByKey.has(key)) continue;
        const kickMatch = kickByKey.get(key);
        const tags =
          twitchCategory.tags && twitchCategory.tags.length > 0
            ? twitchCategory.tags
            : kickMatch?.tags;
        categoryMap.set(key, {
          ...twitchCategory,
          viewerCount: (twitchCategory.viewerCount ?? 0) + (kickMatch?.viewerCount ?? 0),
          crossPlatformId: kickMatch?.id,
          crossPlatformName: kickMatch?.name,
          tags,
        });
      }

      // Second pass: Kick entries — fill in exclusives, and own the Slots key.
      // When the Kick row wins (Slots), fold in the Twitch viewer count too.
      for (const [key, kickCategory] of kickByKey) {
        if (key !== slotsKey && categoryMap.has(key)) continue;
        const twitchMatch = twitchByKey.get(key);
        const tags =
          kickCategory.tags && kickCategory.tags.length > 0
            ? kickCategory.tags
            : twitchMatch?.tags;
        categoryMap.set(key, {
          ...kickCategory,
          viewerCount: (kickCategory.viewerCount ?? 0) + (twitchMatch?.viewerCount ?? 0),
          crossPlatformId: twitchMatch?.id,
          crossPlatformName: twitchMatch?.name,
          tags,
        });
      }

      return Array.from(categoryMap.values()).sort(
        (a, b) => (b.viewerCount || 0) - (a.viewerCount || 0)
      );
    },
    // PERFORMANCE: Categories list is expensive to fetch (1500+ items)
    // Cache for 5 minutes since the category set itself rarely changes
    staleTime: 5 * 60 * 1000, // 5 minutes - data considered fresh on remount
    gcTime: 15 * 60 * 1000, // 15 minutes - keep in cache for quick return
    // Show previous data instantly while refetching in background
    placeholderData: (previousData) => previousData,
    // Poll every 30s so card viewer counts update in real time — counts are
    // derived from the top-streams aggregation above, so the query has to
    // re-run to refresh them. Matches useStreamByChannel's 30s cadence.
    refetchInterval: 30000,
    refetchIntervalInBackground: false, // pause polling when window is hidden
    // Refetch when window regains focus (user may have been away)
    refetchOnWindowFocus: true,
  });
}

export function useCategoryById(categoryId: string, platform: Platform) {
  return useQuery({
    queryKey: CATEGORY_KEYS.byId(categoryId, platform),
    queryFn: async () => {
      const response = await window.electronAPI.categories.getById({ categoryId, platform });
      if (response.error) {
        throw new Error(response.error as unknown as string);
      }
      return response.data as UnifiedCategory;
    },
    enabled: !!categoryId && !!platform,
  });
}
