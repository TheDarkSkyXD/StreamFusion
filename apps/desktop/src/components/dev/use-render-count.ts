/**
 * Dev-only render counter. Components call `useRenderCount("Name")` once at
 * the top of their render function to register; PerfOverlay polls the counter
 * map at 2Hz. No-op in production builds — the import.meta.env.DEV guard at
 * the entry point lets bundlers dead-code-eliminate the entire body.
 *
 * Counts include React Strict-Mode double-renders in dev. That's fine; the
 * value of this overlay is *relative* deltas before/after a fix, not absolute.
 */

const counters = new Map<string, { count: number }>();

export function useRenderCount(name: string): void {
  if (!import.meta.env.DEV) return;
  let entry = counters.get(name);
  if (!entry) {
    entry = { count: 0 };
    counters.set(name, entry);
  }
  entry.count += 1;
}

export function getRenderCounts(): Record<string, number> {
  const result: Record<string, number> = {};
  counters.forEach((entry, name) => {
    result[name] = entry.count;
  });
  return result;
}

export function resetRenderCounts(): void {
  counters.forEach((entry) => {
    entry.count = 0;
  });
}
