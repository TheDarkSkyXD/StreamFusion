# Kick Implementation Notes

> [← Back to Kick docs](./README.md)

This page captures the **non-obvious wiring** that the endpoint tables don't reveal — why the code is the way it is.

## Cloudflare Worker proxy

The desktop client cannot store an OAuth **client secret**. To avoid that, all authenticated Kick API traffic is proxied through a Cloudflare Worker at `streamfusion.leveluptogetherbiz.workers.dev/kick/...`. The Worker:

- Injects the client secret on `POST /oauth/token` exchanges
- Forwards the user's bearer token on every other request
- Strips response headers that leak Cloudflare internals
- Rate-limits its own egress to Kick to mitigate abuse

In the source, `KickClient.baseUrl` in [`kick-client.ts:110`](../../../src/backend/api/platforms/kick/kick-client.ts#L110) points at the Worker, **not** `api.kick.com` directly. Endpoint paths in the docs are relative to that base.

## Why three API surfaces

| Surface | Why we need it |
|---|---|
| Public API (official) | The only path the OAuth flow supports; required for write operations (channel updates) and authenticated reads of user-private data (followed streams, user email) |
| Internal v1/v2 (legacy) | Only path that exposes **VODs**, **clips**, **chatroom ids**, **follower counts** for unauthenticated users, and **subscriber badges**. The official API exposes none of these. |
| BrowserWindow scrape | The legacy v1/v2 endpoints are behind Cloudflare. `electron.net` requests get blocked by Cloudflare's bot check; a real browser context (with the persistent challenge cookie) gets through. |

## Identity-mismatch defense

The authenticated `GET /channels?slug[]=X` has a server-side bug where a single-slug query sometimes returns the **authenticated user's own channel** regardless of the slug. The defense in [`channel-endpoints.ts:77`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L77):

```ts
if (!apiChannel.slug || apiChannel.slug.toLowerCase() !== normalizedSlug) {
  console.warn(`[Kick] API identity mismatch: requested "${slug}", got "${apiChannel.slug || "null"}"`);
  return null;
}
```

The same defense fires after `getUsersById` enrichment (`user.user_id.toString() === channel.id`). **Don't strip these checks** — they're the only thing keeping bad data out of the long-lived channel cache.

The bug does NOT reproduce on **multi-slug** queries (`slug[]=a&slug[]=b`), which is why `getChannelsBySlugs` is the recommended batch path even for N=1.

## Search-enrichment architecture

Channel search is a multi-step orchestration with non-obvious authority rules:

1. [`searchChannels` in `search-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/search-endpoints.ts) returns coarse channel records (Step 1-4 in [endpoints.md](./endpoints.md#searchchannels)) with placeholder fields.
2. [`verifyAndEnrichKickChannels` in `search-handlers.ts:142`](../../../src/backend/ipc/handlers/search-handlers.ts#L142) takes that list and:
   - For authenticated users, calls `getChannelsBySlugs(50)` + `getUsersById(N)` — **one HTTP request each**, no BrowserWindow.
   - For unauthenticated users, **returns the list unchanged** — frontend lazy-loads avatars on hover/mount. Doing BrowserWindow scrapes here would serialise through the global mutex and dominate latency.
3. Result is cached in `kickChannelDataCache` for 5 min.

The authority rules for `isLive`:

| Source | `isLive` accurate? |
|---|---|
| Public search API (`/api/search`) | ❌ always `false` — search returns offline channels too |
| Top streams cache fuzzy match | ⚠️ `true`-only authoritative — can't say a channel is NOT live based on this |
| `getPublicChannel` (Step 1, Step 3) | ✅ Authoritative — checks `livestream` field |
| `getChannelsBySlugs` (enrichment) | ✅ Authoritative — checks `stream.is_live` |

After Commit 1, the enrichment pass is the **single authoritative source** for `isLive` in search results. Don't reintroduce Step 5 (the old live-status pass).

## Image proxy

Kick CDN returns `403 Forbidden` for image GETs that don't include `Referer: https://kick.com/` and a browser User-Agent. The renderer therefore can't load images directly via `<img src="https://kick.com/...">`; everything goes through `KickClient.fetchImage(url)` in [`kick-client.ts:348`](../../../src/backend/api/platforms/kick/kick-client.ts#L348) which:

- Uses a dedicated `persist:kick-cdn-direct` session with proxy bypass (some user proxy configs interfere with Cloudflare)
- Dedupes in-flight requests per URL
- Negative-caches 4xx responses for 10 minutes — these are typically S3 `AccessDenied` for purged VOD thumbnails that will never succeed

Returns a `data:` URL (base64-encoded) the renderer can use directly. Yes, this is wasteful at scale; it's the price of avoiding 403s.

## File map

| File | Purpose |
|---|---|
| [`kick-client.ts`](../../../src/backend/api/platforms/kick/kick-client.ts) | `KickClient` god-object: HTTP layer + rate limiter + image proxy + wrapper methods that delegate to endpoints |
| [`kick-requestor.ts`](../../../src/backend/api/platforms/kick/kick-requestor.ts) | Interface (`KickRequestor`) so endpoint files can take a minimal client dep |
| [`kick-types.ts`](../../../src/backend/api/platforms/kick/kick-types.ts) | Raw API response types + base URL constants |
| [`kick-transformers.ts`](../../../src/backend/api/platforms/kick/kick-transformers.ts) | Raw API → `Unified*` mapping |
| [`kick-stream-resolver.ts`](../../../src/backend/api/platforms/kick/kick-stream-resolver.ts) | Resolves HLS playback URLs for streams + VODs |
| [`kick-network-health.ts`](../../../src/backend/api/platforms/kick/kick-network-health.ts) | Network-service crash tracking + global slot semaphore |
| [`endpoints/channel-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts) | `getChannel`, `getChannelsBySlugs`, `getPublicChannel`, BrowserWindow mutex |
| [`endpoints/stream-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts) | All livestream endpoints; biggest file in the platform module (~1200 lines) |
| [`endpoints/category-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/category-endpoints.ts) | Categories (public + private + derived from top streams) |
| [`endpoints/search-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/search-endpoints.ts) | 4-step channel search + flat search |
| [`endpoints/user-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/user-endpoints.ts) | `getUser`, `getUsersById` |
| [`endpoints/video-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/video-endpoints.ts) | VODs (legacy v2 only) |
| [`endpoints/clip-endpoints.ts`](../../../src/backend/api/platforms/kick/endpoints/clip-endpoints.ts) | Clips (legacy v2 only) |
