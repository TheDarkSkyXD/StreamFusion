import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
  datasetKey?: string; // Identity of the ordered result set for progressive rendering
}

const STARTUP_PREWARM_COUNT = 8;
const ROW_GAP = 16;

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
  overscan = 1,
  skeletonCount = 7, // Default to 7 skeletons
  scrollKey, // Optional key for scroll persistence
  datasetKey,
}: VirtualizedCategoryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: STARTUP_PREWARM_COUNT });
  const [measuredRowHeight, setMeasuredRowHeight] = useState(rowHeight);

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

  // A filter/sort switch must discard the old window before the next paint.
  useLayoutEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setVisibleRange({ start: 0, end: STARTUP_PREWARM_COUNT });
  }, [datasetKey]);

  // Calculate row count and total height
  const effectiveRowHeight = Math.max(rowHeight, measuredRowHeight);
  const totalRows = Math.ceil(categories.length / itemsPerRow);
  const totalHeight = totalRows * effectiveRowHeight;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const measureRowHeight = () => {
      const renderedRowHeight = Array.from(grid.children).reduce((height, child) => {
        return child instanceof HTMLElement ? Math.max(height, child.offsetHeight) : height;
      }, 0);

      if (renderedRowHeight === 0) return;
      setMeasuredRowHeight(renderedRowHeight + ROW_GAP);
    };

    measureRowHeight();
    const observer = new ResizeObserver(measureRowHeight);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [itemsPerRow, rowHeight, visibleRange]);

  // Volatile deps for the scroll handler are stored in refs so the handler
  // identity stays stable and the scroll listener doesn't re-attach on every
  // load-more / categories.length change.
  const scrollStateRef = useRef({
    rowHeight: effectiveRowHeight,
    overscan,
    itemsPerRow,
    categoriesLength: categories.length,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
  });
  useEffect(() => {
    scrollStateRef.current = {
      rowHeight: effectiveRowHeight,
      overscan,
      itemsPerRow,
      categoriesLength: categories.length,
      hasNextPage,
      isFetchingNextPage,
      onLoadMore,
    };
  }, [
    effectiveRowHeight,
    overscan,
    itemsPerRow,
    categories.length,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
  ]);

  // Update visible range on scroll and trigger load more when near bottom.
  // Empty dep array — reads volatile values from scrollStateRef.current.
  const handleScroll = useCallback((event?: Event) => {
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
      if (prev.start !== startIndex || prev.end !== endIndex) {
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

  const hasScrollContainer = !isLoading && categories.length > 0;

  useEffect(() => {
    if (!hasScrollContainer) return;
    const container = containerRef.current;
    if (!container) return;

    handleScroll(); // Initial calculation
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll, hasScrollContainer]);

  // Re-run handleScroll once when categories.length grows so visibleRange
  // expands without waiting for the next scroll event.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `categories.length` and `itemsPerRow` are the re-run triggers; the body only invokes the stable handler
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
      const startRow = Math.floor(scrollTop / effectiveRowHeight);
      const endRow = Math.ceil((scrollTop + clientHeight) / effectiveRowHeight);
      const startIndex = Math.max(0, (startRow - overscan) * itemsPerRow);
      const endIndex = Math.min(categories.length, (endRow + overscan) * itemsPerRow);
      setVisibleRange({ start: startIndex, end: endIndex });
    } else {
      hasRestoredScroll.current = true;
    }
  }, [scrollKey, categories.length, effectiveRowHeight, overscan, itemsPerRow]);

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
  const offsetTop = startRow * effectiveRowHeight;

  // Dynamic grid style based on itemsPerRow
  const gridStyle = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))`,
      gap: `${ROW_GAP}px`,
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
  const loadingIndicatorHeight = isFetchingNextPage || hasNextPage ? effectiveRowHeight : 0;
  const totalHeightWithLoading = totalHeight + loadingIndicatorHeight;

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto overflow-x-hidden"
      style={{ contain: "strict" }}
    >
      {/* Spacer to maintain scroll height */}
      <div style={{ height: totalHeightWithLoading, position: "relative" }}>
        {/* Positioned grid with visible items only */}
        <div
          ref={gridRef}
          className={cn("absolute left-0 right-0 pl-0.5 pr-4 pt-2", className)}
          style={{ ...gridStyle, top: offsetTop }}
        >
          {visibleCategories.map((category) => (
            <div
              key={`${category.platform}-${category.id}`}
              className="transition-opacity duration-150"
            >
              <CategoryCard category={category} imageLoading="eager" imageFetchPriority="high" />
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
