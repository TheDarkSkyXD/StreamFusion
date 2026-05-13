import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { UnifiedCategory } from "@/backend/api/unified/platform-types";
import { cn } from "@/lib/utils";

import { CategoryCard } from "./category-card";
import { CategoryCardSkeleton } from "./category-card-skeleton";

interface VirtualizedCategoryGridProps {
  categories: UnifiedCategory[];
  isLoading?: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
  className?: string;
  rowHeight?: number;
  overscan?: number; // Extra rows to render above/below viewport
  skeletonCount?: number; // Number of skeletons to show while loading
  scrollKey?: string; // Key for scroll position persistence (e.g., 'categories-page')
}

/**
 * Virtualized category grid that only renders visible items for performance.
 * Handles 1000+ categories efficiently by windowing the render.
 * Supports infinite scroll with progressive loading.
 */
export function VirtualizedCategoryGrid({
  categories,
  isLoading = false,
  isFetchingNextPage = false,
  hasNextPage = false,
  onLoadMore,
  emptyMessage = "No categories found",
  className,
  rowHeight = 280, // Approximate card height including gap
  overscan = 3,
  skeletonCount = 7, // Default to 7 skeletons
  scrollKey, // Optional key for scroll persistence
}: VirtualizedCategoryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  // Calculate responsive items per row based on grid columns
  // Optimized breakpoints: 2 → 3 → 4 → 5 → 6 → 7 → 8 (max)
  const [itemsPerRow, setItemsPerRow] = useState(6);

  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      // Optimized responsive breakpoints for smooth scaling
      if (width < 640)
        setItemsPerRow(2); // sm: mobile
      else if (width < 768)
        setItemsPerRow(3); // md: small tablet
      else if (width < 1024)
        setItemsPerRow(4); // lg: tablet
      else if (width < 1280)
        setItemsPerRow(5); // xl: small desktop
      else if (width < 1536)
        setItemsPerRow(6); // 2xl: medium desktop
      else if (width < 1920)
        setItemsPerRow(7); // large desktop
      else setItemsPerRow(8); // maximized/ultrawide
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  // Calculate row count and total height
  const totalRows = Math.ceil(categories.length / itemsPerRow);
  const totalHeight = totalRows * rowHeight;

  // Volatile deps for the scroll handler are stored in refs so the handler
  // identity stays stable and the scroll listener doesn't re-attach on every
  // load-more / categories.length change.
  const scrollStateRef = useRef({
    rowHeight,
    overscan,
    itemsPerRow,
    categoriesLength: categories.length,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
  });
  useEffect(() => {
    scrollStateRef.current = {
      rowHeight,
      overscan,
      itemsPerRow,
      categoriesLength: categories.length,
      hasNextPage,
      isFetchingNextPage,
      onLoadMore,
    };
  }, [rowHeight, overscan, itemsPerRow, categories.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  // Update visible range on scroll and trigger load more when near bottom.
  // Empty dep array — reads volatile values from scrollStateRef.current.
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const {
      rowHeight: rh,
      overscan: ov,
      itemsPerRow: ipr,
      categoriesLength,
      hasNextPage: hnp,
      isFetchingNextPage: ifp,
      onLoadMore: olm,
    } = scrollStateRef.current;

    const scrollTop = containerRef.current.scrollTop;
    const clientHeight = containerRef.current.clientHeight;
    const scrollHeight = containerRef.current.scrollHeight;

    const startRow = Math.floor(scrollTop / rh);
    const endRow = Math.ceil((scrollTop + clientHeight) / rh);

    const startIndex = Math.max(0, (startRow - ov) * ipr);
    const endIndex = Math.min(categoriesLength, (endRow + ov) * ipr);

    setVisibleRange((prev) => {
      // Only update if changed significantly to avoid excessive rerenders
      if (
        Math.abs(prev.start - startIndex) > ipr ||
        Math.abs(prev.end - endIndex) > ipr
      ) {
        return { start: startIndex, end: endIndex };
      }
      return prev;
    });

    // Trigger load more when scrolled near bottom (within 2 rows)
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const loadMoreThreshold = rh * 2;

    if (distanceFromBottom < loadMoreThreshold && hnp && !ifp && olm) {
      olm();
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    handleScroll(); // Initial calculation
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Re-run handleScroll once when categories.length grows so visibleRange
  // expands without waiting for the next scroll event.
  useEffect(() => {
    handleScroll();
  }, [categories.length, itemsPerRow, handleScroll]);

  // Scroll position persistence - restore on mount, save on scroll
  const hasRestoredScroll = useRef(false);

  useEffect(() => {
    if (!scrollKey || !containerRef.current || hasRestoredScroll.current) return;

    // Restore scroll position from sessionStorage
    const savedPosition = sessionStorage.getItem(`scroll-${scrollKey}`);
    if (savedPosition && categories.length > 0) {
      const scrollTop = parseInt(savedPosition, 10);
      containerRef.current.scrollTop = scrollTop;
      hasRestoredScroll.current = true;

      // Recalculate visible range for restored position
      const clientHeight = containerRef.current.clientHeight;
      const startRow = Math.floor(scrollTop / rowHeight);
      const endRow = Math.ceil((scrollTop + clientHeight) / rowHeight);
      const startIndex = Math.max(0, (startRow - overscan) * itemsPerRow);
      const endIndex = Math.min(categories.length, (endRow + overscan) * itemsPerRow);
      setVisibleRange({ start: startIndex, end: endIndex });
    } else {
      hasRestoredScroll.current = true;
    }
  }, [scrollKey, categories.length, rowHeight, overscan, itemsPerRow]);

  // Save scroll position on scroll (debounced via the existing handleScroll)
  useEffect(() => {
    if (!scrollKey || !containerRef.current) return;

    const saveScrollPosition = () => {
      if (containerRef.current) {
        sessionStorage.setItem(`scroll-${scrollKey}`, String(containerRef.current.scrollTop));
      }
    };

    const container = containerRef.current;
    container.addEventListener("scroll", saveScrollPosition, { passive: true });
    return () => container.removeEventListener("scroll", saveScrollPosition);
  }, [scrollKey]);

  // Visible items slice
  const visibleCategories = useMemo(
    () => categories.slice(visibleRange.start, visibleRange.end),
    [categories, visibleRange]
  );

  // Calculate offset for visible items
  const startRow = Math.floor(visibleRange.start / itemsPerRow);
  const offsetTop = startRow * rowHeight;

  // Dynamic grid style based on itemsPerRow
  const gridStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))`,
      gap: "1rem",
    }),
    [itemsPerRow]
  );

  if (isLoading) {
    return (
      <div style={gridStyle} className={className}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <CategoryCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--color-foreground-muted)]">
        <div className="text-4xl mb-4">🎮</div>
        <p className="text-lg">{emptyMessage}</p>
      </div>
    );
  }

  // Calculate total height including space for loading indicator
  const loadingIndicatorHeight = isFetchingNextPage || hasNextPage ? rowHeight : 0;
  const totalHeightWithLoading = totalHeight + loadingIndicatorHeight;

  return (
    <div
      ref={containerRef}
      className="h-[calc(100vh-220px)] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
      style={{ contain: "strict" }}
    >
      {/* Spacer to maintain scroll height */}
      <div style={{ height: totalHeightWithLoading, position: "relative" }}>
        {/* Positioned grid with visible items only */}
        <div
          className={cn("absolute left-0 right-0 pl-0.5 pr-4 pt-2", className)}
          style={{ ...gridStyle, top: offsetTop }}
        >
          {visibleCategories.map((category) => (
            <div
              key={`${category.platform}-${category.id}`}
              className="transition-opacity duration-150"
            >
              <CategoryCard category={category} />
            </div>
          ))}
        </div>

        {/* Loading skeletons at bottom when fetching more */}
        {isFetchingNextPage && (
          <div
            className={cn("absolute left-0 right-0 pl-0.5 pr-4", className)}
            style={{ ...gridStyle, top: totalHeight }}
          >
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <CategoryCardSkeleton key={`loading-${i}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
