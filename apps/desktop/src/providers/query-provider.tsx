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
    try {
      const saved = localStorage.getItem(DEVTOOLS_POS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
          return parsed;
        }
      }
    } catch {
      // ignore corrupt storage
    }
    return {
      x: window.innerWidth - DEVTOOLS_BTN_SIZE - 16,
      y: window.innerHeight - DEVTOOLS_BTN_SIZE - 16,
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem(DEVTOOLS_POS_KEY, JSON.stringify(pos));
    } catch {
      // ignore quota errors
    }
  }, [pos]);

  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: Math.max(0, Math.min(p.x, window.innerWidth - DEVTOOLS_BTN_SIZE)),
        y: Math.max(0, Math.min(p.y, window.innerHeight - DEVTOOLS_BTN_SIZE)),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    posX: number;
    posY: number;
    dragging: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: pos.x,
      posY: pos.y,
      dragging: false,
    };

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (!d.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        d.dragging = true;
      }
      if (d.dragging) {
        ev.preventDefault();
        setPos({
          x: Math.max(0, Math.min(window.innerWidth - DEVTOOLS_BTN_SIZE, d.posX + dx)),
          y: Math.max(0, Math.min(window.innerHeight - DEVTOOLS_BTN_SIZE, d.posY + dy)),
        });
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragRef.current?.dragging) {
        // Suppress the click that would otherwise open the devtools panel
        const blockClick = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
        };
        window.addEventListener("click", blockClick, { capture: true, once: true });
      }
      dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      onPointerDown={onPointerDown}
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
