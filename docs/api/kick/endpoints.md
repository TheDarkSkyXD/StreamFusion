# Kick Endpoints by Resource

> [← Back to Kick docs](./README.md)
> Official docs: <https://docs.kick.com/>
>
> Endpoint paths are written **relative to the base URL** identified in the **Surface** column.
> See [Base URLs](./README.md#base-urls) for the mapping.

## Endpoint index

| Resource | Section |
|---|---|
| Users | [Users](#users) |
| Channels | [Channels](#channels) |
| Streams (livestreams) | [Streams](#streams) |
| Categories | [Categories](#categories) |
| Videos (VODs) | [Videos](#videos) |
| Clips | [Clips](#clips) |
| Search | [Search](#search) |

---

## Users

### `getUser()` — Get authenticated user

- **Method:** `GET`
- **Path:** Delegates to `kickAuthService.fetchCurrentUser()`; backed by `GET /public/v1/users`
- **Surface:** Public API (proxied)
- **Auth:** OAuth Bearer
- **Source:** [`user-endpoints.ts:9`](../../../src/backend/api/platforms/kick/endpoints/user-endpoints.ts#L9)
- **Returns:** `KickUser | null`
- **Official doc:** [docs.kick.com/apis/users](https://docs.kick.com/apis/users)

### `getUsersById(ids)` — Batch user lookup

- **Method:** `GET`
- **Path:** `/users?id[]=:id1&id[]=:id2…`
- **Surface:** Public API (proxied)
- **Auth:** OAuth Bearer
- **Source:** [`user-endpoints.ts:17`](../../../src/backend/api/platforms/kick/endpoints/user-endpoints.ts#L17)
- **Returns:** `KickApiUser[]` — includes `profile_picture` (avatar)
- **Official doc:** [docs.kick.com/apis/users](https://docs.kick.com/apis/users)
- **Notes:** Used by the batched search-enrichment path to fetch avatars after `getChannelsBySlugs`. Returns `[]` if unauthenticated. Caller passes a deduplicated `number[]`.

---

## Channels

### `getChannel(slug)` — Get channel info by slug

- **Method:** `GET`
- **Path:** Tries public `kick.com/api/v2/channels/:slug` first (via `getPublicChannel`), then `GET /channels?slug[]=:slug` on the official API.
- **Surface:** Internal v2 → Public API (proxied)
- **Auth:** None (public fallback) / OAuth Bearer (official)
- **Source:** [`channel-endpoints.ts:34`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L34)
- **Returns:** `UnifiedChannel | null`
- **Official doc:** [docs.kick.com/apis/channels](https://docs.kick.com/apis/channels)
- **Notes:** 5-minute positive cache (`_channelCache`). Public API is tried first because the official API has an [identity-mismatch bug](./authentication.md#identity-mismatch-bug) on single-slug queries. After fetching, calls `getUsersById` once to enrich with avatar + display name.

### `getChannelsBySlugs(slugs)` — Batch channel lookup

- **Method:** `GET`
- **Path:** `/channels?slug[]=:slug1&slug[]=:slug2…`
- **Surface:** Public API (proxied)
- **Auth:** OAuth Bearer
- **Source:** [`channel-endpoints.ts:151`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L151)
- **Returns:** `UnifiedChannel[]`
- **Official doc:** [docs.kick.com/apis/channels](https://docs.kick.com/apis/channels)
- **Notes:** Max **50 slugs per request** — additional slugs are silently dropped. The transformer (`transformKickChannel`) reads `stream.is_live` for authoritative live status, so this is the canonical batch path for search-result enrichment.

### `getPublicChannel(slug)` <a name="getpublicchannel"></a> — Unauthenticated channel info via BrowserWindow

- **Method:** `GET` (via hidden Electron `BrowserWindow.loadURL`)
- **Path:** `https://kick.com/api/v2/channels/:slug`
- **Surface:** Internal v2
- **Auth:** None (cookies persisted in `persist:kick_public` partition pick up Cloudflare clearance tokens automatically)
- **Source:** [`channel-endpoints.ts:224`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L224)
- **Returns:** `UnifiedChannel | null` (includes `chatroomId` for Pusher subscription)
- **Notes:** ⚠️ **Expensive.** Each call spins up a full Chromium renderer + GPU context. Calls are:
  - **Deduplicated in-flight** (per slug) via `_publicChannelInFlight`
  - **Negative-cached for 5 min** via `_publicChannelFailureCache` to avoid retry storms on dead slugs
  - **Serialised globally** via the `_browserWindowMutex` (one window at a time) — see [Rate limits](./rate-limits.md#browserwindow-mutex)
  - **Bypassed during network outages** via `isNetworkLikelyDown()`

---

## Streams

### `getStreamBySlug(slug)` — Live stream by channel

- **Method:** `GET`
- **Path:** `/livestreams?broadcaster_user_id=:id` (after a slug→id lookup via `getChannel`)
- **Surface:** Public API (proxied)
- **Auth:** OAuth Bearer
- **Source:** [`stream-endpoints.ts:480`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts#L480)
- **Returns:** `UnifiedStream | null`
- **Official doc:** [docs.kick.com/apis/livestreams](https://docs.kick.com/apis/livestreams)

### `getPublicStreamBySlug(slug)` <a name="getpublicstreambyslug"></a> — Unauthenticated live stream

- **Method:** `GET` (via `electron.net`)
- **Path:** `https://kick.com/api/v1/channels/:slug`
- **Surface:** Internal v1
- **Auth:** None
- **Source:** [`stream-endpoints.ts:226`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts#L226)
- **Returns:** `UnifiedStream | null`

### `getTopStreams(options)` — Top live streams

- **Method:** `GET`
- **Path:** `/livestreams?limit=:limit&offset=:offset&sort=viewer_count&category_id=:id&language=:lang`
- **Surface:** Public API (proxied)
- **Auth:** OAuth Bearer
- **Source:** [`stream-endpoints.ts:967`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts#L967)
- **Returns:** `PaginatedResult<UnifiedStream>`
- **Official doc:** [docs.kick.com/apis/livestreams](https://docs.kick.com/apis/livestreams)

### `getPublicTopStreams(options)` <a name="getpublictopstreams"></a> — Unauthenticated top streams

- **Method:** `GET` (via `electron.net`)
- **Path:** Tries in order (first parseable wins):
  1. `https://api.kick.com/private/v1/livestreams[?category_id=:id]`
  2. `https://kick.com/stream/livestreams/:language[?category_id=:id]`
  3. `https://kick.com/stream/featured-livestreams/:language[?category_id=:id]`
- **Surface:** Private (anonymous) + web-app routes
- **Auth:** None
- **Source:** [`stream-endpoints.ts:723`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts#L723)
- **Returns:** `PaginatedResult<UnifiedStream>`

### `getStreamsByCategory(categoryId, options)`

- **Method:** `GET`
- **Path:** `/livestreams?category_id=:id&limit=:limit&offset=:offset` (official) or `https://api.kick.com/private/v1/categories/:slug/livestreams?cursor=:cursor` (public fallback)
- **Surface:** Public API / Private API
- **Auth:** OAuth Bearer (official) / None (private)
- **Source:** [`stream-endpoints.ts:1169`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts#L1169)

### `getTopStreamsCached()` — Memoised top-streams snapshot for search fallback

- **Source:** [`stream-endpoints.ts:1115`](../../../src/backend/api/platforms/kick/endpoints/stream-endpoints.ts#L1115)
- **Notes:** 5-minute in-memory cache used by `searchChannels` Step 4 (fuzzy match against the current top-streams list).

---

## Categories

### `getTopCategories()` — Derived from top livestreams

- **Method:** `GET`
- **Path:** `/livestreams?limit=100&sort=viewer_count`
- **Surface:** Public API (proxied)
- **Auth:** OAuth Bearer
- **Source:** [`category-endpoints.ts:180`](../../../src/backend/api/platforms/kick/endpoints/category-endpoints.ts#L180)
- **Returns:** `PaginatedResult<UnifiedCategory>`
- **Notes:** Kick has no "browse all categories" endpoint, so we aggregate over a top-streams sample.

### `searchCategories(query)`

- **Method:** `GET`
- **Path:** `/categories?q=:query&page=:page`
- **Surface:** Public API (proxied)
- **Auth:** OAuth Bearer (optional)
- **Source:** [`category-endpoints.ts:234`](../../../src/backend/api/platforms/kick/endpoints/category-endpoints.ts#L234)
- **Official doc:** [docs.kick.com/apis/categories](https://docs.kick.com/apis/categories)

### `getCategoryById(id)`

- **Method:** `GET`
- **Path:** `/categories/:category_id`
- **Surface:** Public API (proxied)
- **Auth:** OAuth Bearer (optional)
- **Source:** [`category-endpoints.ts:284`](../../../src/backend/api/platforms/kick/endpoints/category-endpoints.ts#L284)

### `getAllCategories()` — Full category catalogue via paginated top-streams scan

- **Source:** [`category-endpoints.ts:328`](../../../src/backend/api/platforms/kick/endpoints/category-endpoints.ts#L328)
- **Notes:** Issues up to 10 `/livestreams?limit=100&offset=0…900` calls to surface ~1000 streams and extract unique categories.

### `getPublicTopCategories()` / `getPublicCategoryList()`

- **Method:** `GET` (via `electron.net`)
- **Path:** `https://api.kick.com/private/v1/categories?cursor=:cursor`
- **Surface:** Private (anonymous)
- **Auth:** None
- **Source:** [`category-endpoints.ts:165`](../../../src/backend/api/platforms/kick/endpoints/category-endpoints.ts#L165) (and `:43`)
- **Notes:** Returns curated tags that the official `GET /categories` doesn't include.

---

## Videos

### `getVideosByChannelSlug(slug, options)`

- **Method:** `GET` (via `electron.net`)
- **Path:** `https://kick.com/api/v2/channels/:slug/videos?cursor=:cursor&limit=:limit&sort=:sort`
- **Surface:** Internal v2
- **Auth:** None
- **Source:** [`video-endpoints.ts:11`](../../../src/backend/api/platforms/kick/endpoints/video-endpoints.ts#L11)
- **Returns:** `PaginatedResult<any>` — raw legacy shape (not yet mapped to `UnifiedVideo`)
- **Notes:** VODs are NOT in the official API. This is undocumented and may break.

---

## Clips

### `getClipsByChannelSlug(slug, options)`

- **Method:** `GET` (via `electron.net`)
- **Path:** `https://kick.com/api/v2/channels/:slug/clips?cursor=:cursor&limit=:limit&sort=:sort`
- **Surface:** Internal v2
- **Auth:** None
- **Source:** [`clip-endpoints.ts:11`](../../../src/backend/api/platforms/kick/endpoints/clip-endpoints.ts#L11)
- **Returns:** `PaginatedResult<any>`
- **Notes:** Clips are NOT in the official API. The legacy v2 endpoint is undocumented.

---

## Search

### `searchChannels(query)`

- **Source:** [`search-endpoints.ts:13`](../../../src/backend/api/platforms/kick/endpoints/search-endpoints.ts#L13)
- **Returns:** `PaginatedResult<UnifiedChannel>`
- **Strategy** (each step's results are merged into a slug→channel `Map`):
  1. **Step 1 — Exact slug match (unauth):** `getPublicChannel(query)` — authoritative for `isLive`.
  2. **Step 2 — Unofficial fuzzy search:** `GET https://kick.com/api/search?searched_word=:query` (3+ chars) or fallback to `/api/search/channel`, `/api/v1/search` for shorter queries. 1.5s timeout per endpoint. Results have no avatars and `isLive: false` by default.
  3. **Step 3 — Official exact slug (auth):** `getChannel(query)` if authenticated — authoritative for `isLive`.
  4. **Step 4 — Top-streams fuzzy match:** filters `getTopStreamsCached()` results against the query. Authoritative-positive for `isLive: true` only (can't say a channel is *not* live based on this).
- **Notes:** The old "Step 5" live-status verification (opened 5 more BrowserWindows) was removed in commit `5d85467` — `verifyAndEnrichKickChannels` in the IPC handler now sets `isLive` authoritatively from the batched `/channels` call.

### `search(query)`

- **Source:** [`search-endpoints.ts:318`](../../../src/backend/api/platforms/kick/endpoints/search-endpoints.ts#L318)
- **Returns:** `{ channels, categories, streams, videos: [], clips: [] }` — videos/clips are intentionally empty for Kick search; the legacy v2 endpoints require a known channel slug.

### Unofficial search endpoints (reference)

| URL | Used when | Notes |
|---|---|---|
| `https://kick.com/api/search?searched_word=:q` | Query length ≥ 3 | Returns 400 for shorter queries |
| `https://kick.com/api/search/channel?searched_word=:q` | Query length < 3 | Sometimes returns Cloudflare HTML |
| `https://kick.com/api/v1/search?q=:q` | Query length < 3 (last resort) | Rarely returns useful data |
