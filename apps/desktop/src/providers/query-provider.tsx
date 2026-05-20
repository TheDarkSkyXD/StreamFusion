import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

// Lazy load ReactQueryDevtools only in development to avoid bundling in production
// This can save ~200KB+ in production bundle size
const isDev = process.env.NODE_ENV !== "production";
const ReactQueryDevtools = isDev
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((mod) => ({
        default: mod.ReactQueryDevtools,
      }))
    )
  : () => null;

const DEVTOOLS_POS_KEY = "tanstack-devtools-pos";
const DEVTOOLS_BTN_SIZE = 60;
const DRAG_THRESHOLD_PX = 5;

function DraggableDevtools({ children }: { children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const maxX = Math.max(0, window.innerWidth - DEVTOOLS_BTN_SIZE);
    const maxY = Math.max(0, window.innerHeight - DEVTOOLS_BTN_SIZE);
    try {
      const saved = localStorage.getItem(DEVTOOLS_POS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
          return {
            x: Math.max(0, Math.min(maxX, parsed.x)),
            y: Math.max(0, Math.min(maxY, parsed.y)),
          };
        }
      }
    } catch {
      // ignore corrupt storage
    }
    return { x: Math.max(0, maxX - 16), y: Math.max(0, maxY - 16) };
  });

  useEffect(() => {
    try {
      localStorage.setItem(DEVTOOLS_POS_KEY, JSON.stringify(pos));
    } catch {
      // ignore quota errors
    }
  }, [pos]);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    posX: number;
    posY: number;
    dragging: boolean;
  } | null>(null);
  const wasDraggingRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      posX: pos.x,
      posY: pos.y,
      dragging: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      d.dragging = true;
    }
    if (d.dragging) {
      e.preventDefault();
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - DEVTOOLS_BTN_SIZE, d.posX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - DEVTOOLS_BTN_SIZE, d.posY + dy)),
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.dragging) {
      // onClickCapture below swallows the trailing click; the timer clears the
      // flag if Chromium already suppressed the synthesized click.
      wasDraggingRef.current = true;
      setTimeout(() => {
        wasDraggingRef.current = false;
      }, 0);
    }
    dragRef.current = null;
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
  };

  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={onClickCapture}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 99999,
        touchAction: "none",
        cursor: "grab",
      }}
    >
      {children}
    </div>
  );
}

// Create a client with sensible defaults
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30 seconds
      staleTime: 30 * 1000,
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Retry failed requests 3 times with exponential backoff
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Refetch on window focus for live data
      refetchOnWindowFocus: true,
      // Don't refetch on mount if data is fresh
      refetchOnMount: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {isDev && (
        <Suspense fallback={null}>
          <DraggableDevtools>
            <ReactQueryDevtools initialIsOpen={false} buttonPosition="relative" />
          </DraggableDevtools>
        </Suspense>
      )}
    </QueryClientProvider>
  );
}
