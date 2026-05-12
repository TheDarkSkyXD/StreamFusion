# Twitch GraphQL Gateway

> [← Back to Twitch docs](./README.md)
> Source: [`twitch-gql-client.ts`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts), [`twitch-gql-helpers.ts`](../../../src/backend/api/platforms/twitch/twitch-gql-helpers.ts)
> Persisted-query hashes: [`twitch-gql-queries`](https://www.npmjs.com/package/twitch-gql-queries) npm package.

The GraphQL gateway is **undocumented by Twitch** — it's the same `gql.twitch.tv` endpoint the twitch.tv web client uses. There is no official reference. The schema, persisted-query hashes, and rate limits can change at any time. We accept that risk because the alternative (Helix-only) is more expensive, missing data we need, and requires user auth for things that are publicly visible on the website.

## Connection

| Field | Value |
|---|---|
| Endpoint | `POST https://gql.twitch.tv/gql` |
| Body | JSON array of `{ operationName, variables, extensions: { persistedQuery: { sha256Hash } } }` |
| Headers | `Client-ID: kd1unb4b3q4t58fwlpcbzcbnm76a8fp` (Twitch Android app id) |
| Auth | **None** — no user OAuth token (the public Client-ID is sufficient for unauthenticated reads) |
| Batching | Up to ~35 queries per request |

## Function index

| Function | Persisted query (or raw) | Purpose | Source |
|---|---|---|---|
| `gqlIsChannelLive(login)` | `UseLive` | Lightweight live check | [`twitch-gql-client.ts:1155`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L1155) |
| `gqlGetStreamByLogin(login)` | `StreamMetadata` + `UseViewCount` | Single stream | [`:514`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L514) |
| `gqlGetStreamsByLogins(logins)` | `UseLive` (batch) → `StreamMetadata` + `UseViewCount` | Live-state for many channels at once | [`:549`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L549) |
| `gqlGetTopStreams(options)` | Raw `GetTopStreams` query | Top streams globally | [`:412`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L412) |
| `gqlGetGameStreamsBySlug(slug)` | `DirectoryPage_Game` (hash `76cb069d…`) | Top streams for a category slug | [`:231`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L231) |
| `gqlGetStreamsByGameId(id)` | Persisted or raw `GetStreamsByGameId` | Top streams for a numeric game id | [`:289`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L289) |
| `gqlGetTopCategories()` | `BrowsePageAllDirectories` | Top games with tags | [`:619`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L619) |
| `gqlGetAllTopCategories()` | `BrowsePageAllDirectories` (paginated) | Full directory | [`:656`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L656) |
| `gqlGetCategoryById(id)` | Raw `GetGameById` | Game info by numeric id | [`:691`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L691) |
| `gqlGetGameMetadata(slug)` | Raw `GameMetadata` | Per-game tags | [`:183`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L183) |
| `gqlSearchChannels(query)` | `SearchResultsPageSearchResults` (target=CHANNEL) | Channel search incl. follower counts | [`:744`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L744) |
| `gqlSearchCategories(query)` | `SearchResultsPageSearchResults` (target=GAME) | Game search | [`:796`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L796) |
| `gqlGetChannelByLogin(login)` | `ChannelShell` + `ChannelRootAboutPanel` | Channel page metadata | [`:833`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L833) |
| `gqlGetChannelsByLogins(logins)` | `ChannelShell` (batch) | Channel-shell-only batch | [`:871`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L871) |
| `gqlGetUserIdByLogin(login)` | `GetUserId` | login → numeric id resolver | [`:906`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L906) |
| `gqlGetVideosByChannel(login)` | `FilterableVideoTowerVideos` | Channel videos (paginated) | [`:917`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L917) |
| `gqlGetClipsByChannel(login)` | `ClipsCardsUser` | Channel clips | [`:979`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L979) |
| `gqlGetVideoMetadata(videoId)` | `VideoMetadata` | Single video info | [`:1110`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L1110) |
| `gqlGetFollowerCount(login)` | `ChannelRootAboutPanel` | Follower count (no auth) | [`:1166`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L1166) |
| `gqlFetchGamesForVideos(videoIds)` | Raw `GetVideosGameData` aliased batch | Batch game-data for a video list | [`:1186`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L1186) |
| `gqlGetPlaybackAccessToken(login)` | `PlaybackAccessToken` (`isLive=true`) | HLS stream token | [`:1032`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L1032) |
| `gqlGetVodAccessToken(videoId)` | `PlaybackAccessToken` (`isVod=true`) | HLS VOD token | [`:1057`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L1057) |
| `gqlGetClipAccessToken(clipSlug)` | `VideoAccessTokenClip` | Clip MP4 quality URLs + signature | [`:1082`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts#L1082) |

## How playback tokens turn into URLs

The three `*AccessToken` queries above don't return URLs directly — they return `{ value, signature }`. The construction lives in [`twitch-stream-resolver.ts`](../../../src/backend/api/platforms/twitch/twitch-stream-resolver.ts):

```
Stream HLS:  https://usher.ttvnw.net/api/channel/hls/{channel}.m3u8?token={value}&sig={signature}&allow_source=true&fast_bread=true&player=twitchweb
VOD HLS:     https://usher.ttvnw.net/vod/{vodId}.m3u8?token={value}&sig={signature}&allow_source=true
Clip MP4:    {sourceURL}?sig={signature}&token={value}    (sourceURL chosen from clip qualities array)
```

## ⚠️ Persisted-query maintenance

`PersistedQueryNotFound` is the standard signal that a hash has rotated. When you see that error:

1. Pull a fresh hash from `twitch-gql-queries` (npm bump).
2. If the query has moved to a new schema shape, the package's TypeScript types will show the diff — update the response parsing in [`twitch-gql-client.ts`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts).
3. If the package hasn't caught up yet, you can fall back to a raw inline query (we do this for several functions today — search `query.replace` in the source).

## Why no auth?

GraphQL accepts an `Authorization: OAuth <token>` header for queries that require user identity (e.g. inbox, payment methods). We never issue those. The public Client-ID covers everything we read.

If you add a feature that needs user-authenticated GraphQL (e.g. sending a chat reply via mutation, getting follow-state for a specific viewer), wire the user OAuth token in **only** for that specific function — don't make it a default for all GQL calls.
