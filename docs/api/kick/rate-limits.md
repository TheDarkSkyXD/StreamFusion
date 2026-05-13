# Kick Rate Limits & Retries

> [← Back to Kick docs](./README.md)
> Source: [`kick-client.ts`](../../../src/backend/api/platforms/kick/kick-client.ts), [`kick-network-health.ts`](../../../src/backend/api/platforms/kick/kick-network-health.ts)

## Official API limits

Kick's public API documentation does not currently publish a concrete numerical rate-limit cap. Empirically we see `429 Too Many Requests` start around 5 req/s sustained per-token. We apply a conservative client-side cap:

| Limiter | Cap | Where |
|---|---|---|
| Global request rate | **5 req/s** (200 ms minimum gap between calls) | `KickRateLimiter` in [`kick-client.ts:36`](../../../src/backend/api/platforms/kick/kick-client.ts#L36) |
| Concurrent `net.request` slots | **4** | `acquireKickRequestSlot()` in [`kick-network-health.ts:81`](../../../src/backend/api/platforms/kick/kick-network-health.ts#L81) |
| Concurrent BrowserWindow scrapes | **1** | `_browserWindowMutex` in [`channel-endpoints.ts:202`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L202) |

## Retry strategy

`KickClient.request()` ([`kick-client.ts:468`](../../../src/backend/api/platforms/kick/kick-client.ts#L468)) retries up to **3 times** on:

| Status | Backoff | Honour `Retry-After`? |
|---|---|---|
| `429 Too Many Requests` | `5s → 10s → 20s` | ✅ Yes |
| `502 Bad Gateway` | `1s → 2s → 4s` | n/a |
| `503 Service Unavailable` | `1s → 2s → 4s` | n/a |
| `504 Gateway Timeout` | `1s → 2s → 4s` | n/a |
| `401 Unauthorized` | one-shot token refresh + immediate retry | n/a |

After max retries, the request throws `"Kick API error: <status>"`.

## Network-health circuit breaker

Sometimes Electron's network service itself crashes (renderer GPU crash → network process restart). Without coordination, every in-flight call retries simultaneously and re-triggers the crash. The shared `kick-network-health` module solves this:

| Function | Purpose | Source |
|---|---|---|
| `recordServiceCrash()` | Manually mark network down | [`kick-network-health.ts:43`](../../../src/backend/api/platforms/kick/kick-network-health.ts#L43) |
| `recordTransientNetworkError(msg)` | Increment failure counter; flip flag after threshold | [`kick-network-health.ts:50`](../../../src/backend/api/platforms/kick/kick-network-health.ts#L50) |
| `isNetworkLikelyDown()` | Read the current flag | [`kick-network-health.ts:69`](../../../src/backend/api/platforms/kick/kick-network-health.ts#L69) |

Callers check `isNetworkLikelyDown()` before opening a `BrowserWindow` or making an image-proxy request, and bail out early during the cooldown window.

## BrowserWindow mutex

The single most important latency / stability lever in the codebase.

```ts
// channel-endpoints.ts:202
let _browserWindowMutex: Promise<void> = Promise.resolve();
function acquireBrowserWindowSlot(): Promise<() => void> { … }
```

**Why a mutex:**

- Each hidden window is a fresh Chromium renderer + GPU context (~50-100 MB).
- Opening multiple windows concurrently has triggered `exit_code=34` GPU crashes that take down Chromium's shared network service with them.
- Under realistic load (5-channel search batch + 3-channel `useFollowedStreams` refresh + hover-prefetch) we could easily have **8 simultaneous renderer subprocess starts**. The mutex makes that one-at-a-time.

**Trade-off:** A 10-result search now takes up to 10 × `PUBLIC_CHANNEL_LOAD_TIMEOUT_MS` (10s each = 100s worst case) **if every slug has to scrape**. To dodge this we batch via [`getChannelsBySlugs`](./endpoints.md#getchannelsbyslugs) on the authenticated path — see [`implementation-notes.md`](./implementation-notes.md#search-enrichment-architecture).

**Do not remove the mutex** to "fix" search performance — the GPU crash returns.

## Caches

| Cache | TTL | Location | Purpose |
|---|---|---|---|
| `_channelCache` (positive) | 5 min | [`channel-endpoints.ts:12`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L12) | `getChannel` success memoisation |
| `_publicChannelFailureCache` (negative) | 5 min | [`channel-endpoints.ts:183`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L183) | Dead-slug lockout to stop retry storms |
| `_publicChannelInFlight` | request lifetime | [`channel-endpoints.ts:176`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L176) | Per-slug dedupe |
| `kickChannelDataCache` (search-handlers) | 5 min | [`search-handlers.ts:128`](../../../src/backend/ipc/handlers/search-handlers.ts#L128) | Search-enrichment memoisation |
| Display-name cache | 30 min | [`stream-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts) | Followed-streams refresh |
| Top-streams cache | 5 min | [`stream-endpoints.ts:1115`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts#L1115) | Search fuzzy-match Step 4 |
| Public category cache | 15 min | [`category-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/category-endpoints.ts) | Avoid hitting `/private/v1/categories` repeatedly |
| Image negative cache | 10 min | [`kick-client.ts:105`](../../../src/backend/api/platforms/kick/kick-client.ts#L105) | Skip 4xx image URLs on re-renders |
