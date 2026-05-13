/**
 * Tracks Electron network/GPU service health to break retry storms.
 *
 * When Chromium's Utility (network service) or GPU process crashes, every
 * in-flight `net.request` fails with `net::ERR_FAILED`. Without coordination,
 * each call site's retry loop re-fires immediately, hammering the service
 * during the ~1-3s window it needs to restart. That sustained load can
 * keep the service unhealthy, turning a 3s blip into 30+ seconds of cascading
 * failures across every followed Kick channel.
 *
 * This module is the single signal that says "stop retrying for a moment".
 * Two inputs mark the network unhealthy:
 *  - explicit `recordServiceCrash()` from main.ts on `child-process-gone`
 *  - implicit detection: 3+ `ERR_FAILED` from `recordTransientNetworkError()`
 *    inside a 2s rolling window (covers cases where the crash event fires
 *    after callers have already noticed the failures)
 *
 * Callers check `isNetworkLikelyDown()` before issuing or retrying a request
 * and skip the work when true. The unhealthy state self-clears after
 * UNHEALTHY_WINDOW_MS of quiet (no new errors).
 */

const UNHEALTHY_WINDOW_MS = 3000;
const ERROR_BURST_WINDOW_MS = 2000;
const ERROR_BURST_THRESHOLD = 3;

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

let unhealthyUntil = 0;
const recentErrorTimestamps: number[] = [];
let inFlight = 0;
const waiters: Array<() => void> = [];

export function recordServiceCrash(reason: string): void {
  unhealthyUntil = Date.now() + UNHEALTHY_WINDOW_MS;
  console.warn(
    `[KickNetworkHealth] Network unhealthy due to ${reason}; pausing Kick retries for ${UNHEALTHY_WINDOW_MS}ms`
  );
}

export function recordTransientNetworkError(errorMessage: string): void {
  // Only treat real network-layer failures as a health signal. Plain timeouts
  // and 5xx are normal Kick flakiness, not a process crash.
  if (!/net::ERR_/.test(errorMessage)) return;

  const now = Date.now();
  recentErrorTimestamps.push(now);
  while (
    recentErrorTimestamps.length > 0 &&
    now - recentErrorTimestamps[0] > ERROR_BURST_WINDOW_MS
  ) {
    recentErrorTimestamps.shift();
  }

  if (recentErrorTimestamps.length >= ERROR_BURST_THRESHOLD && now >= unhealthyUntil) {
    recordServiceCrash("ERR_FAILED burst");
  }
}

export function isNetworkLikelyDown(): boolean {
  return Date.now() < unhealthyUntil;
}

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
