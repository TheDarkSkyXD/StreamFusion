# Twitch Helix REST API

> [← Back to Twitch docs](./README.md)
> Official Helix docs: <https://dev.twitch.tv/docs/api/reference/>
>
> Endpoint paths are written **relative to the proxied base URL**:
> `https://streamfusion.leveluptogetherbiz.workers.dev/twitch` (forwards to `https://api.twitch.tv/helix`).
> All endpoints listed here require a **user OAuth bearer token** unless otherwise noted.

## Endpoint index

| Resource | Section |
|---|---|
| Users | [Users](#users) |
| Streams | [Streams](#streams) |
| Channels | [Channels](#channels) |
| Categories (games) | [Categories](#categories) |
| Search | [Search](#search) |
| Videos | [Videos](#videos) |
| Clips | [Clips](#clips) |

---

## Users

### `getUser()` — Get authenticated user

- **Method:** `GET`
- **Path:** `/users`
- **Auth:** User OAuth Bearer
- **Source:** [`user-endpoints.ts:17`](../../../src/backend/api/platforms/twitch/endpoints/user-endpoints.ts#L17)
- **Returns:** `TwitchUser`
- **Official doc:** [dev.twitch.tv/docs/api/reference/#get-users](https://dev.twitch.tv/docs/api/reference/#get-users)

### `getUsersById(ids)` — Batch lookup by user id

- **Method:** `GET`
- **Path:** `/users?id={id1}&id={id2}…`
- **Auth:** User OAuth Bearer
- **Source:** [`user-endpoints.ts:42`](../../../src/backend/api/platforms/twitch/endpoints/user-endpoints.ts#L42)
- **Returns:** `TwitchUser[]`
- **Notes:** Max 100 ids per request.

### `getUsersByLogin(logins)` — Batch lookup by login (username)

- **Method:** `GET`
- **Path:** `/users?login={login1}&login={login2}…`
- **Auth:** User OAuth Bearer
- **Source:** [`user-endpoints.ts:65`](../../../src/backend/api/platforms/twitch/endpoints/user-endpoints.ts#L65)
- **Returns:** `TwitchUser[]`
- **Notes:** Max 100 logins per request. Used by `verifyAndEnrichTwitchChannels` in [`search-handlers.ts:35`](../../../src/backend/ipc/handlers/search-handlers.ts#L35).

### `getFollowedChannels(userId, options)` — Channels the user follows

- **Method:** `GET`
- **Path:** `/channels/followed?user_id={userId}&first={n}&after={cursor}`
- **Auth:** User OAuth Bearer (scope: `user:read:follows`)
- **Source:** [`user-endpoints.ts:91`](../../../src/backend/api/platforms/twitch/endpoints/user-endpoints.ts#L91)
- **Returns:** `PaginatedResult<UnifiedChannel>`
- **Official doc:** [dev.twitch.tv/docs/api/reference/#get-followed-channels](https://dev.twitch.tv/docs/api/reference/#get-followed-channels)

### `getAllFollowedChannels(userId)` — Auto-paginated full list

- **Source:** [`user-endpoints.ts:127`](../../../src/backend/api/platforms/twitch/endpoints/user-endpoints.ts#L127)
- **Notes:** Issues `/channels/followed` requests until the cursor is exhausted. Loop guard at 100 pages = 10000 channels max.

### `getFollowerCount(broadcasterId)` — Follower count of an arbitrary channel

- **Method:** `GET`
- **Path:** `/channels/followers?broadcaster_id={id}&first=1` (we only need the `total` field from the header)
- **Auth:** User OAuth Bearer (scope: `moderator:read:followers` — required even for read-only)
- **Source:** [`user-endpoints.ts:147`](../../../src/backend/api/platforms/twitch/endpoints/user-endpoints.ts#L147)
- **Returns:** `number | null`
- **Notes:** Returns `null` if the requesting user isn't a moderator/broadcaster of the target channel. The fallback for arbitrary channels is the GQL `ChannelRootAboutPanel` query, which has no auth requirement — see [`gql-api.md`](./gql-api.md).

### `getFollowerCounts(broadcasterIds)` — Batch wrapper

- **Source:** [`user-endpoints.ts:178`](../../../src/backend/api/platforms/twitch/endpoints/user-endpoints.ts#L178)
- **Notes:** Returns `Map<userId, count>`. Internally issues one Helix request per id (no native batch endpoint for follower counts), parallelized with a concurrency cap.

---

## Streams

### `getStreamByLogin(login)`

- **Method:** `GET`
- **Path:** `/streams?user_login={login}`
- **Auth:** User OAuth Bearer
- **Source:** [`stream-endpoints.ts:125`](../../../src/backend/api/platforms/twitch/endpoints/stream-endpoints.ts#L125)
- **Returns:** `UnifiedStream | null`
- **Official doc:** [dev.twitch.tv/docs/api/reference/#get-streams](https://dev.twitch.tv/docs/api/reference/#get-streams)

### `getStreamsByUserIds(ids, options)` — Live streams from a set of user ids

- **Method:** `GET`
- **Path:** `/streams?user_id={id1}&user_id={id2}…&first={n}`
- **Auth:** User OAuth Bearer
- **Source:** [`stream-endpoints.ts:16`](../../../src/backend/api/platforms/twitch/endpoints/stream-endpoints.ts#L16)
- **Returns:** `PaginatedResult<UnifiedStream>`
- **Notes:** Max 100 user ids per request. Only returns currently-live channels.

### `getFollowedStreams(userId, options)` — Live streams from followed channels

- **Method:** `GET`
- **Path:** `/streams/followed?user_id={userId}&first={n}&after={cursor}`
- **Auth:** User OAuth Bearer (scope: `user:read:follows`)
- **Source:** [`stream-endpoints.ts:49`](../../../src/backend/api/platforms/twitch/endpoints/stream-endpoints.ts#L49)
- **Returns:** `PaginatedResult<UnifiedStream>`
- **Official doc:** [dev.twitch.tv/docs/api/reference/#get-followed-streams](https://dev.twitch.tv/docs/api/reference/#get-followed-streams)

### `getTopStreams(options)` — Top live streams globally

- **Method:** `GET`
- **Path:** `/streams?first={n}&game_id={id}&language={lang}&after={cursor}`
- **Auth:** User OAuth Bearer
- **Source:** [`stream-endpoints.ts:80`](../../../src/backend/api/platforms/twitch/endpoints/stream-endpoints.ts#L80)
- **Returns:** `PaginatedResult<UnifiedStream>`
- **Notes:** The wrapper in `twitch-client.ts:137` prefers the GQL `GetTopStreams` query — Helix is the fallback for cases where GQL is rejected.

---

## Channels

### `getChannelsById(broadcasterIds)`

- **Method:** `GET`
- **Path:** `/channels?broadcaster_id={id1}&broadcaster_id={id2}…`
- **Auth:** User OAuth Bearer
- **Source:** [`channel-endpoints.ts:9`](../../../src/backend/api/platforms/twitch/endpoints/channel-endpoints.ts#L9)
- **Returns:** `UnifiedChannel[]`
- **Notes:** This Helix endpoint **does not include profile images**. The function makes a parallel `/users?id={ids}` call ([`channel-endpoints.ts:27`](../../../src/backend/api/platforms/twitch/endpoints/channel-endpoints.ts#L27)) to merge in avatars + display names.

---

## Categories

### `getTopCategories(options)`

- **Method:** `GET`
- **Path:** `/games/top?first={n}&after={cursor}`
- **Auth:** User OAuth Bearer
- **Source:** [`category-endpoints.ts:14`](../../../src/backend/api/platforms/twitch/endpoints/category-endpoints.ts#L14)
- **Returns:** `PaginatedResult<UnifiedCategory>`
- **Official doc:** [dev.twitch.tv/docs/api/reference/#get-top-games](https://dev.twitch.tv/docs/api/reference/#get-top-games)
- **Notes:** Helix `/games/top` does **not** return `tags`. The wrapper prefers the GQL `BrowsePageAllDirectories` query for tag-enriched categories; Helix is the fallback.

### `getCategoryById(id)`

- **Method:** `GET`
- **Path:** `/games?id={id}`
- **Auth:** User OAuth Bearer
- **Source:** [`category-endpoints.ts:39`](../../../src/backend/api/platforms/twitch/endpoints/category-endpoints.ts#L39)

### `getCategoriesByIds(ids)`

- **Method:** `GET`
- **Path:** `/games?id={id1}&id={id2}…`
- **Auth:** User OAuth Bearer
- **Source:** [`category-endpoints.ts:54`](../../../src/backend/api/platforms/twitch/endpoints/category-endpoints.ts#L54)

### `getAllTopCategories()` — Full auto-paginated list

- **Source:** [`category-endpoints.ts:82`](../../../src/backend/api/platforms/twitch/endpoints/category-endpoints.ts#L82)

---

## Search

### `searchChannels(query, options)`

- **Method:** `GET`
- **Path:** `/search/channels?query={q}&first={n}&live_only={bool}`
- **Auth:** User OAuth Bearer
- **Source:** [`search-endpoints.ts:15`](../../../src/backend/api/platforms/twitch/endpoints/search-endpoints.ts#L15)
- **Returns:** `PaginatedResult<UnifiedChannel>`
- **Official doc:** [dev.twitch.tv/docs/api/reference/#search-channels](https://dev.twitch.tv/docs/api/reference/#search-channels)
- **Notes:** Prefers the GQL `SearchResultsPageSearchResults` query (no auth, includes follower count). Helix used as fallback.

### `searchCategories(query, options)`

- **Method:** `GET`
- **Path:** `/search/categories?query={q}&first={n}`
- **Auth:** User OAuth Bearer
- **Source:** [`search-endpoints.ts:48`](../../../src/backend/api/platforms/twitch/endpoints/search-endpoints.ts#L48)
- **Official doc:** [dev.twitch.tv/docs/api/reference/#search-categories](https://dev.twitch.tv/docs/api/reference/#search-categories)

---

## Videos

### `getVideosByUser(userId, options)`

- **Method:** `GET`
- **Path:** `/videos?user_id={id}&first={n}&type={archive|highlight|upload}&after={cursor}`
- **Auth:** User OAuth Bearer
- **Source:** [`video-endpoints.ts:12`](../../../src/backend/api/platforms/twitch/endpoints/video-endpoints.ts#L12)
- **Returns:** `PaginatedResult<TwitchApiVideo>`

### `getVideoById(videoId)`

- **Method:** `GET`
- **Path:** `/videos?id={videoId}`
- **Auth:** User OAuth Bearer
- **Source:** [`video-endpoints.ts:45`](../../../src/backend/api/platforms/twitch/endpoints/video-endpoints.ts#L45)
- **Notes:** Wrapper prefers GQL `VideoMetadata` which is faster and richer.

---

## Clips

### `getClipsByBroadcaster(broadcasterId, options)`

- **Method:** `GET`
- **Path:** `/clips?broadcaster_id={id}&first={n}&started_at={iso}&ended_at={iso}`
- **Auth:** User OAuth Bearer
- **Source:** [`clip-endpoints.ts:12`](../../../src/backend/api/platforms/twitch/endpoints/clip-endpoints.ts#L12)
- **Returns:** `PaginatedResult<TwitchApiClip>`
- **Official doc:** [dev.twitch.tv/docs/api/reference/#get-clips](https://dev.twitch.tv/docs/api/reference/#get-clips)
