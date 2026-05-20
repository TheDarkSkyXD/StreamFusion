---
title: Polling fan-out — positive cache + dispatch stagger for CDN cold-burst timeouts
module: apps/desktop/backend/api/platforms/kick
date: 2026-05-19
category: architecture-patterns
problem_type: architecture_pattern
component: service_object
severity: medium
related_components:
  - kick-client
  - stream-handlers
  - stream-endpoints
  - kick-network-health
applies_when:
  - An IPC or background handler fans out N identical HTTP requests on the same JS tick via Promise.allSettled or similar
  - The per-request timeout is shorter than N × cold-TLS-handshake time when the request semaphore is saturated
  - The poll interval is shorter than a reasonable positive-cache TTL (so consecutive polls would re-burst the same cold work)
  - Requests within one cycle share the same CDN edge (Cloudflare, Akamai), amplifying concurrent TLS pressure
  - The app uses electron net.request or another Node HTTP client that does not share TLS session caches with a browser context
symptoms:
  - Recurring timeout-and-retry log noise that fires on every poll cycle while the retry consistently succeeds
  - 4-6 seconds of perceived latency on every poll despite no real outage
  - Stream-detail (or equivalent) UI flashes "is currently offline" for up to N seconds after a single transient timeout
root_cause: async_timing
resolution_type: code_fix
tags:
  - polling
  - fan-out
  - cache
  - stagger
  - abort-controller
  - electron
  - net-request
  - cold-tls
---

# Polling fan-out — positive cache + dispatch stagger for CDN cold-burst timeouts

## Context

A periodic poll that fans N parallel HTTP requests out to a CDN-fronted API can produce a failure mode that looks like API flakiness but is actually self-inflicted: every cycle, all N requests fire on the exact same JS tick, the cold TLS handshake against the shared CDN edge cannot complete N times within the per-request timeout, every first attempt fails, every jittered retry succeeds. The result is recurring `… timeout … retrying` log noise on every cycle with no actual loss of data — and several compounding follow-on UX bugs once a single transient timeout starts poisoning negative caches.

In this repo it surfaced as `[KickStream] timeout … retrying (attempt 1/3)` firing every 60s for every locally-followed Kick channel in `useFollowedStreams`. With `MAX_CONCURRENT_KICK_REQUESTS = 4` (`kick-network-health.ts`) and a 5s per-request timeout, four parallel `/api/v1/channels/{slug}` calls on the same tick consistently exhausted the timeout window. The retry then ran with jitter and a warm TLS state, so the user saw data — just six seconds late on every cycle with the log noise masking any real failures.

## Guidance

Apply this four-part pattern together. Each part defends a different concrete failure mode; missing one degrades the others.

### 1. Positive cache with TTL > poll interval, < 2× poll interval

Reuse the existing success cache if one is already populated for outage stale-serve. Add a normal-path read with a distinct, shorter TTL so most polls hit the cache and skip the burst entirely. The "channel went live" detection latency is bounded by one extra poll cycle in the worst case.

```typescript
// stream-endpoints.ts — TTL chosen as 1.5× the 60s poll interval
const PUBLIC_STREAM_POLL_HIT_TTL_MS = 90 * 1000;

// Inside getPublicStreamBySlug, after the failure-cache check and BEFORE
// the in-flight dedupe:
const cachedSuccess = _publicStreamSuccessCache.get(key);
if (cachedSuccess && Date.now() - cachedSuccess.timestamp < PUBLIC_STREAM_POLL_HIT_TTL_MS) {
  return cachedSuccess.data;
}
```

Cache both live and offline (`data: null`) results — an offline follow that hasn't gone live shouldn't burn a network request every cycle either.

**Name TTL constants for the path they guard**, not the mechanism. Two TTLs on the same Map will be conflated unless the name signals which consumer reads them. `PUBLIC_STREAM_OUTAGE_STALE_TTL_MS` (5 min, network-service-crash stale-serve) and `PUBLIC_STREAM_POLL_HIT_TTL_MS` (90s, normal-path positive cache) read from the same `_publicStreamSuccessCache` for completely different reasons. Path-in-name prevents future readers conflating the two.

### 2. Stagger AFTER the cache check, not before

This is the part that's easy to get wrong. A stagger applied at the *call site* — inside the dispatcher's `map(...)` — fires the timer for every slug, including ones that would hit the cache synchronously. Warm-cache polls (the common case after the first cycle) pay `(N-1) × stagger_ms` of dead-timer latency for a Map lookup. `Promise.allSettled` blocks until the last timer fires.

Move the stagger *inside* the fetched function, after all cache checks. Pass the offset as a parameter; the dispatcher just supplies the index.

```typescript
// stream-endpoints.ts — accept an optional stagger offset
export async function getPublicStreamBySlug(
  slug: string,
  staggerOffsetMs: number = 0,
  signal?: AbortSignal,
): Promise<UnifiedStream | null> {
  // ... outage check, failure-cache check, positive-cache check (all synchronous) ...

  const inFlight = _publicStreamInFlight.get(key);
  if (inFlight) return inFlight;

  // Register the in-flight promise BEFORE the stagger so concurrent same-slug
  // callers dedupe against the staggered work, not against a "not started
  // yet" gap.
  const promise = (async () => {
    if (staggerOffsetMs > 0) {
      await staggerDelay(staggerOffsetMs, signal);
    }
    return _doFetchPublicStreamBySlug(slug, key);
  })();
  _publicStreamInFlight.set(key, promise);
  // ...
}
```

```typescript
// stream-handlers.ts — dispatcher passes index × stagger
const settled = await Promise.allSettled(
  uniqueSlugs.map((slug, i) =>
    kickClient.getPublicStreamBySlug(slug, i * fanOutStaggerMs, abort.signal),
  ),
);
```

The dispatcher is now a flat `.map(...)` — no IIFE, no inline `await`, no implicit ordering of concerns. The function's contract is explicit: pass a stagger offset, only network-bound work pays it.

### 3. Cancellable timers via AbortController scoped to the dispatcher

The controller lives in the dispatcher's closure, not inside the fetched function. Each new dispatch aborts the prior one — pending stagger timers from a stale invocation reject instead of firing into the network.

```typescript
// stream-handlers.ts — module-private to the IPC handler's registration closure
let _kickFollowsAbort: AbortController | null = null;

// Inside the handler body:
if (_kickFollowsAbort) _kickFollowsAbort.abort();
const abort = new AbortController();
_kickFollowsAbort = abort;
```

The delay helper translates abort into a rejected promise that the dispatcher can filter out of normal failure reporting:

```typescript
// stream-endpoints.ts
function staggerDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("AbortError"));
      return;
    }
    const timeoutId = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        reject(new Error("AbortError"));
      },
      { once: true },
    );
  });
}
```

Filter `AbortError` from the warn path — these are expected cancellations, not failures:

```typescript
for (const result of settled) {
  if (result.status === "fulfilled") {
    // ... use result.value ...
  } else if ((result.reason as Error)?.message !== "AbortError") {
    console.warn("Failed to fetch:", result.reason);
  }
}
```

Without this, a focus event firing the poll while the user is also clicking a manual refresh button orphans the prior dispatch's timers. They fire ~60-180ms later, acquire semaphore slots, and hold them behind the live poll's requests.

### 4. Transient failure-cache suppression when positive cache is fresh

When all retries exhaust with a *transient* failure (timeout, `net::ERR_*`, known network-service crash), check the positive cache before writing a failure-cache entry. A 5s cold-TLS timeout is exactly what the poll-hit cache was designed to absorb — letting a 30s timeout-failure-TTL preempt a still-fresh success would produce false-offline UI flashes for the lockout duration.

```typescript
// stream-endpoints.ts — at the exhausted-retry path
const isTimeout = lastError.message === "TRANSIENT:timeout";
const isNetCrash = /TRANSIENT:net::ERR_/.test(lastError.message || "");
const transient = isTimeout || isNetCrash || isNetworkLikelyDown();

if (transient) {
  const fresh = _publicStreamSuccessCache.get(key);
  if (fresh && Date.now() - fresh.timestamp < PUBLIC_STREAM_POLL_HIT_TTL_MS) {
    return null; // skip writing the failure entry; let the cached success stand
  }
}
// Genuine failures (DNS, 5xx, parse errors) still lock out for the full TTL
const ttl = transient ? PUBLIC_STREAM_TIMEOUT_TTL_MS : PUBLIC_STREAM_FAILURE_TTL_MS;
_publicStreamFailureCache.set(key, Date.now() + ttl);
```

The asymmetry is deliberate: only the *non-transient* branch (DNS/5xx/parse) unconditionally locks out. Transient errors that the positive cache could absorb don't get to override it.

## Why This Matters

Getting any one of these four parts wrong creates a compounding failure that's easy to miss in development (one follow, warm TLS, no concurrent polls) but degrades the production experience continuously:

1. **Log noise masks real failures.** When `… timeout … retrying` fires on every cycle, engineers stop reading those lines. A genuine DNS failure or API outage produces the same log and goes unnoticed.

2. **Perceived UI latency on every poll.** A 5s timeout plus a 1s jittered backoff plus retry adds ~6s of "stale sidebar" to every 60s cycle. Over an hour that's ~6 minutes of stale state per channel.

3. **False-offline flashes.** A transient timeout that writes a 30s failure-cache entry will preempt a still-valid 90s positive-cache entry for the lockout duration. The stream-detail page reads stream data to decide whether to render an "is currently offline" overlay — so a single CDN hiccup produces a 30s false "channel went offline" flash even while the stream is healthy.

4. **Orphan timers hold semaphore slots.** Without the AbortController, a rapid double-invocation (focus + manual refresh within the stagger spread) leaves N-1 stagger timers queued from the first dispatch. They fire behind the second dispatch's real requests, consuming slots from the global semaphore.

## When to Apply

**Apply when all of these hold:**

- Polling loop fetches N > 1 resources per tick in parallel
- Each resource is individually cacheable for at least the poll interval
- Requests share a CDN edge or any infrastructure where cold-connection setup is measurable (>1s)
- App uses `net.request` (Electron) or another Node HTTP client that does not share TLS session state with a browser context
- Poll interval is fixed and known

**Do not apply when:**

- Single-resource polls (no fan-out, no burst)
- Server-side code where connections are long-lived and pooled
- Resources change faster than the proposed cache TTL (real-time prices, live cursors)
- A batch/bulk endpoint exists (one request for all N is the better fix)
- Browser `fetch` is in use (browsers share TLS session caches, so the cold-burst surface is much smaller)

## Examples

### Before — IIFE-style stagger at the call site (the wrong placement)

```typescript
// Cache check is INSIDE getPublicStreamBySlug. The stagger fires here before
// that check is even reached, so warm-cache polls wait for nothing.
const settled = await Promise.allSettled(
  uniqueSlugs.map((slug, i) =>
    (async () => {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, fanOutStaggerMs * i));
      }
      return kickClient.getPublicStreamBySlug(slug);
    })(),
  ),
);
```

Symptoms after applying this: log noise drops by ~50% (the cache half), but every other poll still bursts cold, and warm polls now pay (N-1)*60ms of dead-timer latency.

### After — flat map with stagger as a parameter

```typescript
// AbortController per dispatch; flat map; stagger offset passed in.
if (_kickFollowsAbort) _kickFollowsAbort.abort();
const abort = new AbortController();
_kickFollowsAbort = abort;

const fanOutStaggerMs = 60;
const settled = await Promise.allSettled(
  uniqueSlugs.map((slug, i) =>
    kickClient.getPublicStreamBySlug(slug, i * fanOutStaggerMs, abort.signal),
  ),
);

for (const result of settled) {
  if (result.status === "fulfilled") {
    // ... use result.value ...
  } else if ((result.reason as Error)?.message !== "AbortError") {
    console.warn("Failed to fetch:", result.reason);
  }
}
```

Symptoms after applying this: log noise effectively gone. Warm polls return in <1ms (cache short-circuits before the timer even arms). Cold polls spread their `net.request` calls across 0/60/120/180ms, giving TLS time to warm. AbortError is silently filtered when consecutive polls fire.

## Related

- `docs/solutions/integration-issues/twitch-gql-search-pagination-skeleton-flicker-loop-2026-05-17.md` — prior use of `AbortSignal.timeout` in this codebase for bounding a different flaky-upstream shape. Complementary technique, different failure mode.
- `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md` — Kick channels have two numeric IDs (`user_id` vs `channel.id`). Any cache that downstream consumers identity-key against must preserve the right ID. This pattern's positive cache stores `UnifiedStream` (where `id` is the livestream id, not the channel id) — safe today, but worth re-checking if the cache is ever extended to surface identity-keyed responses. (auto memory [claude])
