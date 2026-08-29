/**
 * useHelixPoll
 *
 * U24 — generic visibility-aware polling hook for the Engagement tab's Helix
 * endpoints (predictions / polls). Polls on the requested interval while
 * `enabled === true` AND the document is visible; pauses when
 * the tab goes to the background; fires once immediately on mount.
 *
 * Caller-owned: the `fetcher` is invoked as-is. Errors surface via the
 * returned `error` string. Successful results replace the previous `data`
 * snapshot.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useInterval } from "@/hooks/useInterval";

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

export function useHelixPoll<T>(opts: UseHelixPollOptions<T>): UseHelixPollResult<T> {
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

  const docVisible = () =>
    typeof document === "undefined" || document.visibilityState === "visible";

  const [isVisible, setIsVisible] = useState<boolean>(docVisible);

  // Immediate fire on mount (when enabled and visible). useInterval won't fire
  // at t=0, so this separate effect preserves that behaviour.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only `enabled` should re-trigger; `isVisible` and `run` are intentionally excluded
  useEffect(() => {
    if (enabled && isVisible) {
      void run();
    }
    // Visibility transitions fire explicitly in handleVisibility below; adding
    // isVisible here would issue a duplicate request when returning foreground.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enabled owns mount/enable transitions.
  }, [enabled]);

  // Track visibility state; fire immediately when returning to foreground.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `docVisible` is a render-stable closure helper; including it would re-attach the listener every render
  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibility = () => {
      const visible = docVisible();
      setIsVisible(visible);
      if (enabled && visible) {
        void run();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, run]);

  // Recurring interval — pauses when hidden or disabled.
  useInterval(run, enabled && isVisible ? intervalMs : null);

  return { data, loading, error, refresh };
}
