import { useEffect, useRef } from "react";

/**
 * Declarative one-shot timer. Fires the latest `callback` once, `delay` ms after
 * `delay` becomes (or is) a number. `delay = null` cancels / never fires. Re-arms
 * when `delay` changes. Clears on unmount.
 */
export function useTimeout(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setTimeout(() => savedCallback.current(), delay);
    return () => clearTimeout(id);
  }, [delay]);
}
