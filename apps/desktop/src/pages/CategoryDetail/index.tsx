import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";

import type { UnifiedCategory } from "@/backend/api/unified/platform-types";
import { CategoryFilterBar } from "@/components/discovery/category-filter-bar";
import { StreamGrid } from "@/components/stream/stream-grid";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { useCategoryById } from "@/hooks/queries/useCategories";
import { useInfiniteStreamsByCategory } from "@/hooks/queries/useInfiniteStreams";
import { useDebounce } from "@/hooks/useDebounce";
import { getStreamElementKey } from "@/lib/id-utils";
import { formatViewerCount, getEquivalentCategoryName, normalizeCategoryName } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";

const PAGE_SIZE = 30;

export function CategoryDetailPage() {
  const { platform, categoryId } = useParams({ from: "/_app/categories/$platform/$categoryId" });
  // `otherId` is set by the Categories list when it knows the cross-platform
  // category id up-front. When present, we skip the brittle name-search below.
  const { otherId } = useSearch({ from: "/_app/categories/$platform/$categoryId" });

  // Filter / sort state lives here; the underlying queries re-key on `language`
  // (so changing it triggers a fresh fetch from cursor=0), while tag search
  // and sort are applied client-side to the already-loaded pages.
  const [language, setLanguage] = useState("");
  const [rawTagQuery, setRawTagQuery] = useState("");
  const tagQuery = useDebounce(rawTagQuery, 200);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // 1. Fetch primary category details
  const { data: category, isLoading: isCategoryLoading } = useCategoryById(
    categoryId,
    platform as Platform
  );

  // 2. Determine other platform
  const currentPlatform = platform as Platform;
  const otherPlatform: Platform = currentPlatform === "twitch" ? "kick" : "twitch";

  // 3. Find corresponding category on other platform.
  // Reverse-lookup: if the current name has a curated equivalent for the other
  // platform (e.g. Kick "Slots" → Twitch "Slots & Casino"), search by that.
  // Otherwise search by the same name (covers IRL, GTA V, etc).
  // Skipped entirely when `otherId` is provided via URL — that path is faster
  // and more reliable (works for unauthenticated users on niche categories).
  const { data: otherCategoryFromSearch } = useQuery({
    queryKey: ["category-match", category?.name, otherPlatform],
    queryFn: async () => {
      if (!category?.name) return null;
      const normalizedKey = normalizeCategoryName(category.name);
      const searchQuery = getEquivalentCategoryName(normalizedKey, otherPlatform) ?? category.name;

      const response = await window.electronAPI.categories.search({
        query: searchQuery,
        platform: otherPlatform,
        limit: 10,
      });

      const candidates = (response.data as UnifiedCategory[]) || [];
      return candidates.find((c) => normalizeCategoryName(c.name) === normalizedKey) || null;
    },
    enabled: !!category?.name && !otherId,
    staleTime: 1000 * 60 * 5, // Cache for 5 mins
  });

  const otherCategoryId = otherId ?? otherCategoryFromSearch?.id ?? "";

  // Resolved name on the OTHER platform — passed to the secondary query so the
  // Kick path can slug-guess when we never managed to find a numeric id.
  // For Twitch → Kick this uses the curated equivalence (e.g. Twitch "Slots & Casino"
  // → Kick "Slots"); falls back to the primary name when no override exists.
  // Only meaningful when the secondary is Kick — Twitch's `getTopStreams` has no
  // slug-fallback and would happily return the global top dump for an empty id.
  const otherCategoryName = useMemo(() => {
    if (otherPlatform !== "kick" || !category?.name) return undefined;
    const normalizedKey = normalizeCategoryName(category.name);
    return (
      otherCategoryFromSearch?.name ??
      getEquivalentCategoryName(normalizedKey, otherPlatform) ??
      category.name
    );
  }, [category?.name, otherCategoryFromSearch?.name, otherPlatform]);

  // 4. Infinite-load streams from both platforms in parallel.
  // Pass `undefined` (not `""`) so the IPC handler doesn't set an empty
  // `language=` query param on the upstream APIs.
  const langParam = language || undefined;
  const primaryQuery = useInfiniteStreamsByCategory(
    categoryId,
    currentPlatform,
    PAGE_SIZE,
    undefined,
    langParam
  );
  const secondaryQuery = useInfiniteStreamsByCategory(
    otherCategoryId,
    otherPlatform,
    PAGE_SIZE,
    otherCategoryName,
    langParam
  );

  const isLoading = isCategoryLoading || primaryQuery.isLoading;
  const isFetchingNextPage = primaryQuery.isFetchingNextPage || secondaryQuery.isFetchingNextPage;
  const hasNextPage = primaryQuery.hasNextPage || secondaryQuery.hasNextPage;

  // 5. Merge, dedup, filter by tag, then sort by viewer count.
  // Defensive: a page's `data` can be undefined if the backend fetch failed and
  // returned a malformed response; flatMap with `p?.data ?? []` filters those out.
  // Dedup by platform+id because Kick's offset pagination can return the same
  // stream across consecutive pages when live channels shift between fetches.
  const { merged, streams } = useMemo(() => {
    const primary = primaryQuery.data?.pages.flatMap((p) => p?.data ?? []) ?? [];
    const secondary = secondaryQuery.data?.pages.flatMap((p) => p?.data ?? []) ?? [];
    const seen = new Set<string>();
    const mergedList = [];
    for (const s of [...primary, ...secondary]) {
      if (s == null) continue;
      const key = getStreamElementKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      mergedList.push(s);
    }
    const lowerTag = tagQuery.trim().toLowerCase();
    const filtered = lowerTag
      ? mergedList.filter((s) => s.tags?.some((t) => t.toLowerCase().includes(lowerTag)))
      : mergedList;
    const sorted = [...filtered].sort((a, b) =>
      sortOrder === "desc"
        ? (b.viewerCount ?? 0) - (a.viewerCount ?? 0)
        : (a.viewerCount ?? 0) - (b.viewerCount ?? 0)
    );
    return { merged: mergedList, streams: sorted };
  }, [primaryQuery.data, secondaryQuery.data, tagQuery, sortOrder]);

  // Match the number the Categories card shows. `category.viewerCount` is the
  // authoritative platform total (Twitch GQL `viewersCount`, Kick public-stream
  // aggregation), so prefer it over summing the streams we've paginated in —
  // that sum is partial and drifts upward as the user scrolls.
  // Fall back to the running sum (pre-tag-filter so the header doesn't shrink
  // when the user searches for a tag) when the API didn't supply a total (e.g.
  // authenticated Kick's `/categories/:id` doesn't expose viewer_count).
  const streamsSum = merged.reduce((acc, stream) => acc + (stream.viewerCount || 0), 0);
  const totalViewers = category?.viewerCount ?? streamsSum;

  // 6. IntersectionObserver sentinel — fetch next page on both queries in parallel
  // so the merged sort stays balanced (avoids one side running far ahead).
  // The scrollable container is <main id="main-content-scroll-area"> from AppLayout,
  // not the viewport — pass it explicitly as the IO root.
  // A queries ref keeps the callback stable so the observer is created exactly once
  // (per sentinel mount), instead of re-creating on every render.
  const queriesRef = useRef({ primaryQuery, secondaryQuery });
  queriesRef.current = { primaryQuery, secondaryQuery };
  const observerRef = useRef<IntersectionObserver | null>(null);

  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;

    const root = document.getElementById("main-content-scroll-area");
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        const { primaryQuery: pq, secondaryQuery: sq } = queriesRef.current;
        if (pq.hasNextPage && !pq.isFetchingNextPage) pq.fetchNextPage();
        if (sq.hasNextPage && !sq.isFetchingNextPage) sq.fetchNextPage();
      },
      { root, threshold: 0, rootMargin: "1500px" }
    );
    observerRef.current.observe(node);
  }, []);

  return (
    <div className="p-6 h-full flex flex-col gap-6">
      {isLoading && (
        <div className="animate-pulse space-y-6">
          <div className="space-y-4">
            {/* Back Button Skeleton */}
            <div className="h-6 w-32 bg-[var(--color-background-tertiary)] rounded" />
            {/* Header Skeleton */}
            <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
              <div className="w-48 aspect-[3/4] bg-[var(--color-background-tertiary)] rounded-xl" />
              <div className="flex-1 space-y-4 w-full">
                <div className="h-12 w-3/4 md:w-1/2 bg-[var(--color-background-tertiary)] rounded" />
                <div className="h-6 w-1/4 bg-[var(--color-background-tertiary)] rounded" />
              </div>
            </div>
          </div>
        </div>
      )}

      {!isLoading && (
        <div className="flex flex-col gap-6">
          <Link
            to="/categories"
            className="text-[var(--color-foreground-muted)] hover:text-white flex items-center gap-2 transition-colors w-fit"
          >
            <LuArrowLeft size={20} />
            Back to Categories
          </Link>

          <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
            <div className="w-48 aspect-[3/4] bg-[var(--color-background-tertiary)] rounded-xl shadow-2xl flex items-center justify-center shrink-0 border border-[var(--color-border)] relative overflow-hidden group">
              {category?.boxArtUrl ? (
                <ProxiedImage
                  src={category.boxArtUrl.replace("{width}", "285").replace("{height}", "380")}
                  alt={category.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <span className="text-6xl">🎮</span>
              )}
              {/* Gradient overlay for depth */}
              <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent pointer-events-none" />
            </div>
            <div className="flex-1 text-center md:text-left space-y-2 pb-2">
              <h1 className="text-4xl md:text-6xl font-black tracking-tight">{category?.name}</h1>
              <div className="flex items-center justify-center md:justify-start gap-3 text-lg">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[var(--color-primary)] text-xl">
                    {formatViewerCount(totalViewers)}
                  </span>
                  <span className="text-[var(--color-foreground-secondary)]">Viewers</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isLoading && (
        <CategoryFilterBar
          language={language}
          onLanguageChange={setLanguage}
          tagQuery={rawTagQuery}
          onTagQueryChange={setRawTagQuery}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
        />
      )}

      <StreamGrid
        streams={streams}
        isLoading={isLoading}
        emptyMessage={
          tagQuery && merged.length > 0
            ? `No streams in this category match "${tagQuery}".`
            : "No active streams found for this category."
        }
        skeletons={8}
      />

      {/* Footer: fixed-height area that holds the IO sentinel and loading spinner.
          Keeping the height constant avoids the layout shift that nudged the scroll
          position when the spinner appeared/disappeared between pages. */}
      {hasNextPage && (
        <div className="relative h-14 flex items-center justify-center">
          <div ref={sentinelRef} className="absolute inset-0" aria-hidden="true" />
          {isFetchingNextPage && (
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
          )}
        </div>
      )}
    </div>
  );
}
