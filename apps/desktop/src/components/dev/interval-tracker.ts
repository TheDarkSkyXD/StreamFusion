/**
 * Dev-only setInterval / clearInterval shim. Tracks live interval IDs so
 * PerfOverlay can show how many timers are running — a leak indicator for
 * effect-cleanup bugs. Install once at app boot; no-op in production.
 */

const liveIntervals = new Set<unknown>();
let installed = false;

export function installIntervalTracker(): void {
  if (installed) return;
  if (!import.meta.env.DEV) return;
  installed = true;

  const origSet = window.setInterval.bind(window);
  const origClear = window.clearInterval.bind(window);

  // Cast through `unknown` because the global typings have a slightly different
  // shape per platform (NodeJS.Timeout vs number) and we want to swap the
  // implementation while keeping callers' types intact.
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = origSet(handler as () => void, timeout, ...args);
    liveIntervals.add(id);
    return id;
  }) as typeof window.setInterval;

  window.clearInterval = ((id?: number) => {
    if (id !== undefined) liveIntervals.delete(id);
    return origClear(id);
  }) as typeof window.clearInterval;
}

export function getActiveIntervalCount(): number {
  return liveIntervals.size;
}
