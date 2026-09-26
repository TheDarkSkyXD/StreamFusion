import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const CARD_HEIGHT = 180;
const GRID_GAP = 16;
const INITIAL_VISIBLE_CARD_COUNT = 48;

export interface FollowingChannelGridProps<T> {
  items: readonly T[];
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}

function getItemsPerRow(width: number): number {
  if (width < 480) return 2;
  if (width < 720) return 3;
  if (width < 960) return 5;
  if (width < 1120) return 6;
  return 8;
}

export function FollowingChannelGrid<T>({
  items,
  getItemKey,
  renderItem,
}: FollowingChannelGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const itemsPerRow = getItemsPerRow(containerWidth);
  const [visibleRange, setVisibleRange] = useState({
    start: 0,
    end: Math.min(items.length, INITIAL_VISIBLE_CARD_COUNT),
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = (width: number) => {
      setContainerWidth((current) => (current === width ? current : width));
    };
    updateWidth(container.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) updateWidth(Math.floor(width));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const updateVisibleRange = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rowHeight = CARD_HEIGHT + GRID_GAP;
    const viewportRows = Math.max(
      Math.ceil(container.clientHeight / rowHeight),
      Math.ceil(INITIAL_VISIBLE_CARD_COUNT / itemsPerRow)
    );
    const totalRows = Math.ceil(items.length / itemsPerRow);
    const startRow = Math.min(
      Math.floor(container.scrollTop / rowHeight),
      Math.max(0, totalRows - viewportRows)
    );
    const start = Math.max(0, (startRow - 1) * itemsPerRow);
    const end = Math.min(items.length, (startRow + viewportRows + 1) * itemsPerRow);
    setVisibleRange((current) =>
      current.start === start && current.end === end ? current : { start, end }
    );
  }, [items.length, itemsPerRow]);

  useEffect(() => {
    updateVisibleRange();
  }, [updateVisibleRange]);

  const visibleItems = useMemo(
    () => items.slice(visibleRange.start, visibleRange.end),
    [items, visibleRange]
  );
  const totalRows = Math.ceil(items.length / itemsPerRow);
  const startRow = Math.floor(visibleRange.start / itemsPerRow);
  const rowHeight = CARD_HEIGHT + GRID_GAP;

  const extendRangeForFocus = useCallback(
    (index: number) => {
      setVisibleRange((current) => {
        const padding = itemsPerRow * 2;
        const start =
          index <= current.start + padding ? Math.max(0, current.start - padding) : current.start;
        const end =
          index >= current.end - padding
            ? Math.min(items.length, current.end + padding)
            : current.end;
        return start === current.start && end === current.end ? current : { start, end };
      });
    },
    [items.length, itemsPerRow]
  );

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-y-auto pr-2"
      style={{ contain: "strict" }}
      onScroll={updateVisibleRange}
      data-testid="following-channel-grid"
    >
      <div style={{ height: totalRows * rowHeight, position: "relative" }}>
        <div
          className="absolute left-0 right-0 grid gap-4 pt-2"
          style={{
            top: startRow * rowHeight,
            gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))`,
          }}
        >
          {visibleItems.map((item, index) => (
            <div
              key={getItemKey(item)}
              className="h-[180px] overflow-hidden"
              onFocus={() => extendRangeForFocus(visibleRange.start + index)}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
