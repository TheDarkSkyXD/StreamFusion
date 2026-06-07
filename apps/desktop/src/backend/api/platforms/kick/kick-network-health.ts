// Global concurrency cap across every Kick `net.request` call site (public
// stream/channel fetches, image proxy, authenticated API, display-name
// enrichment, top-streams discovery). Before this cap, simultaneous
// followed-streams refresh + discover-page enrichment + visible image cards
// could fan out 10+ in-flight requests at the network service — exactly the
// load profile that triggered the GPU/network crashes. Four is empirical:
// enough to keep wall-clock latency similar for batched work, low enough that
// the service handles the load comfortably on a typical Windows machine
// (especially while the main renderer is also decoding HLS video).
const MAX_CONCURRENT_KICK_REQUESTS = 4;

let inFlight = 0;
const waiters: Array<() => void> = [];

/**
 * Acquire a slot from the global Kick request semaphore. Callers MUST invoke
 * the returned release function in a `finally` block, otherwise the slot leaks
 * and eventually every Kick request queues forever.
 *
 *   const release = await acquireKickRequestSlot();
 *   try { ... } finally { release(); }
 */
export function acquireKickRequestSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    if (inFlight < MAX_CONCURRENT_KICK_REQUESTS) {
      inFlight++;
      resolve(releaseSlot);
    } else {
      waiters.push(() => resolve(releaseSlot));
    }
  });
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) {
    // Hand the slot to the next waiter without bumping the counter — they're
    // taking our place, total in-flight is unchanged.
    next();
  } else {
    inFlight--;
  }
}
