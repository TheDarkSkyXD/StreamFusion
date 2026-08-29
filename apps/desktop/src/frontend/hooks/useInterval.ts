import { useEffect, useRef } from "react";

/**
 * Declarative recurring timer. Invokes the latest `callback` every `delay` ms.
 * `delay = null` pauses (nothing scheduled). The interval re-arms only when
 * `delay` changes — not on every render — because the callback is read through a
 * ref. Clears on unmount. Generalizes the timer-in-useEffect-with-cleanup pattern
 * already used by `useDebounce`.
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
