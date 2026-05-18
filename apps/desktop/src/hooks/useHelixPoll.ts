/**
 * useHelixPoll
 *
 * U24 — generic visibility-aware polling hook for the Engagement tab's Helix
 * endpoints (predictions / polls / future giveaways). Polls on the requested
 * interval while `enabled === true` AND the document is visible; pauses when
 * the tab goes to the background; fires once immediately on mount.
 *
 * Caller-owned: the `fetcher` is invoked as-is. Errors surface via the
 * returned `error` string. Successful results replace the previous `data`
 * snapshot.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseHelixPollOptions<T> {
  /** Async fetcher. Errors are caught and surfaced via the returned `error`. */
  fetcher: () => Promise<T>;
  /** Poll interval in milliseconds. */
  intervalMs: number;
  /** When false, polling is paused entirely. */
  enabled: boolean;
}

export interface UseHelixPollResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Force-fetch now, outside the interval cadence. */
  refresh: () => void;
}

export function useHelixPoll<T>(
  opts: UseHelixPollOptions<T>,
): UseHelixPollResult<T> {
  const { fetcher, intervalMs, enabled } = opts;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Stash the latest fetcher in a ref so we never bake a stale closure into
  // the interval callback. Caller may reassign each render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  // Track an in-flight token so a late-resolving fetch doesn't clobber state
  // after the component unmounted or a fresh refresh fired.
  const callIdRef = useRef(0);

  const run = useCallback(async () => {
    const myId = ++callIdRef.current;
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (callIdRef.current !== myId) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (callIdRef.current !== myId) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (callIdRef.current === myId) {
        setLoading(false);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    void run();
  }, [run]);

  useEffect(() => {
    if (!enabled) return;

    let intervalHandle: ReturnType<typeof setInterval> | null = null;

    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const start = () => {
      if (intervalHandle !== null) return;
      intervalHandle = setInterval(() => {
        if (isVisible()) {
          void run();
        }
      }, intervalMs);
    };

    const stop = () => {
      if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    };

    // First fetch fires immediately on mount (if visible).
    if (isVisible()) {
      void run();
    }
    start();

    const handleVisibility = () => {
      if (isVisible()) {
        // Coming back to foreground — fire once immediately, keep interval.
        void run();
        start();
      } else {
        // Hidden — pause the interval; resumes on next visibilitychange.
        stop();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [enabled, intervalMs, run]);

  return { data, loading, error, refresh };
}
