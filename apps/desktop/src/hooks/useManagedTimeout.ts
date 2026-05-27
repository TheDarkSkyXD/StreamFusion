import { useCallback, useEffect, useRef } from "react";

/**
 * Imperative, self-cancelling, unmount-safe one-shot timer.
 *
 * `start(ms)` clears any pending timer and schedules the latest `callback` to run
 * after `ms`; `clear()` cancels it. The delay is passed at call time, so dynamic
 * delays and restart-on-event work (e.g. player-control auto-hide re-arming with
 * 1000/3000/200 ms on each mouse event). Clears on unmount.
 */
export function useManagedTimeout(callback: () => void): {
  start: (ms: number) => void;
  clear: () => void;
} {
  const savedCallback = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const start = useCallback(
    (ms: number) => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        savedCallback.current();
      }, ms);
    },
    [],
  );

  // Clear any pending timer when the consuming component unmounts.
  useEffect(() => clear, [clear]);

  return { start, clear };
}
