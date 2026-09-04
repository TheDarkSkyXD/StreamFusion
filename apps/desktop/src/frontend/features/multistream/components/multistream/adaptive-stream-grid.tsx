import { Children, type ReactNode, useEffect, useRef, useState } from "react";

const VIDEO_ASPECT_RATIO = 16 / 9;
const MAX_COLUMNS = 3;
const MIN_SLOT_HEIGHT_PX = 180;
const GRID_GAP_PX = 4;

export interface GridGeometryInput {
  width: number;
  height: number;
  itemCount: number;
  gapPx: number;
}

export interface GridGeometry {
  columns: number;
  rows: number;
  slotWidthPx: number;
  slotHeightPx: number;
  gridWidthPx: number;
  gridHeightPx: number;
  overflowY: boolean;
}

function emptyGeometry(): GridGeometry {
  return {
    columns: 0,
    rows: 0,
    slotWidthPx: 0,
    slotHeightPx: 0,
    gridWidthPx: 0,
    gridHeightPx: 0,
    overflowY: false,
  };
}

function fittedGeometry(
  width: number,
  height: number,
  itemCount: number,
  gapPx: number,
  columns: number
): GridGeometry {
  const rows = Math.ceil(itemCount / columns);
  const availableWidth = Math.max(0, Math.floor((width - gapPx * (columns - 1)) / columns));
  const availableHeight = Math.max(0, Math.floor((height - gapPx * (rows - 1)) / rows));
  const widthLimitedHeight = Math.floor(availableWidth / VIDEO_ASPECT_RATIO);
  const slotHeightPx = Math.min(availableHeight, widthLimitedHeight);
  const slotWidthPx = Math.min(availableWidth, Math.floor(slotHeightPx * VIDEO_ASPECT_RATIO));

  return {
    columns,
    rows,
    slotWidthPx,
    slotHeightPx,
    gridWidthPx: slotWidthPx * columns + gapPx * (columns - 1),
    gridHeightPx: slotHeightPx * rows + gapPx * (rows - 1),
    overflowY: false,
  };
}

function scrollingGeometry(
  width: number,
  height: number,
  itemCount: number,
  gapPx: number,
  maxColumns: number
): GridGeometry {
  let columns = 1;
  for (let candidate = 1; candidate <= maxColumns; candidate += 1) {
    const slotWidth = Math.max(0, Math.floor((width - gapPx * (candidate - 1)) / candidate));
    if (Math.floor(slotWidth / VIDEO_ASPECT_RATIO) >= MIN_SLOT_HEIGHT_PX) {
      columns = candidate;
    }
  }

  const rows = Math.ceil(itemCount / columns);
  const slotWidthPx = Math.max(0, Math.floor((width - gapPx * (columns - 1)) / columns));
  const slotHeightPx = Math.floor(slotWidthPx / VIDEO_ASPECT_RATIO);
  const gridHeightPx = slotHeightPx * rows + gapPx * (rows - 1);

  return {
    columns,
    rows,
    slotWidthPx,
    slotHeightPx,
    gridWidthPx: slotWidthPx * columns + gapPx * (columns - 1),
    gridHeightPx,
    overflowY: gridHeightPx > height,
  };
}

export function selectStreamGridGeometry({
  width,
  height,
  itemCount,
  gapPx,
}: GridGeometryInput): GridGeometry {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  const safeItemCount = Math.max(0, Math.floor(itemCount));
  const safeGap = Math.max(0, Math.floor(gapPx));
  if (safeItemCount === 0 || safeWidth === 0 || safeHeight === 0) return emptyGeometry();

  const maxColumns = Math.min(MAX_COLUMNS, safeItemCount);
  let best = fittedGeometry(safeWidth, safeHeight, safeItemCount, safeGap, 1);
  let bestArea = best.slotWidthPx * best.slotHeightPx * safeItemCount;

  for (let columns = 2; columns <= maxColumns; columns += 1) {
    const candidate = fittedGeometry(safeWidth, safeHeight, safeItemCount, safeGap, columns);
    const area = candidate.slotWidthPx * candidate.slotHeightPx * safeItemCount;
    if (area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  }

  if (best.slotHeightPx >= MIN_SLOT_HEIGHT_PX) return best;
  return scrollingGeometry(safeWidth, safeHeight, safeItemCount, safeGap, maxColumns);
}

function sameGeometry(left: GridGeometry | null, right: GridGeometry): boolean {
  return (
    left !== null &&
    left.columns === right.columns &&
    left.rows === right.rows &&
    left.slotWidthPx === right.slotWidthPx &&
    left.slotHeightPx === right.slotHeightPx &&
    left.gridWidthPx === right.gridWidthPx &&
    left.gridHeightPx === right.gridHeightPx &&
    left.overflowY === right.overflowY
  );
}

export function AspectAwareStreamGrid({ children }: { children: ReactNode }) {
  const itemCount = Children.count(children);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<GridGeometry | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateGeometry = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const next = selectStreamGridGeometry({
        width,
        height,
        itemCount,
        gapPx: GRID_GAP_PX,
      });
      setGeometry((current) => (sameGeometry(current, next) ? current : next));
    };

    const initialBounds = container.getBoundingClientRect();
    updateGeometry(initialBounds.width, initialBounds.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateGeometry(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [itemCount]);

  const fallbackColumns = Math.min(2, Math.max(1, itemCount));

  return (
    <div
      ref={containerRef}
      className="grid h-full w-full justify-center"
      style={{
        alignContent: geometry?.overflowY ? "start" : "center",
        gap: GRID_GAP_PX,
        gridAutoRows: geometry ? `${geometry.slotHeightPx}px` : "auto",
        gridTemplateColumns: geometry
          ? `repeat(${geometry.columns}, ${geometry.slotWidthPx}px)`
          : `repeat(${fallbackColumns}, minmax(0, 1fr))`,
        overflowY: geometry?.overflowY ? "auto" : "hidden",
      }}
    >
      {Children.map(children, (child) => (
        <div className="h-full w-full" style={{ aspectRatio: VIDEO_ASPECT_RATIO }}>
          {child}
        </div>
      ))}
    </div>
  );
}
