# Twitch Implementation Notes

> [← Back to Twitch docs](./README.md)

This page captures the **non-obvious wiring** behind the Twitch integration — why the code looks the way it does.

## GQL-first, Helix-fallback

Most `twitch-client.ts` wrapper methods try **GraphQL first** and fall back to Helix if GQL is unavailable (network error, persisted-query hash drift, intentional bail-out). Examples:

| Wrapper | GQL path | Helix path |
|---|---|---|
| `getTopStreams` ([`twitch-client.ts:137`](../../../src/backend/api/platforms/twitch/twitch-client.ts#L137)) | `gqlGetTopStreams` | `StreamEndpoints.getTopStreams` |
| `searchChannels` ([`:187`](../../../src/backend/api/platforms/twitch/twitch-client.ts#L187)) | `gqlSearchChannels` | `SearchEndpoints.searchChannels` |
| `getCategoryById` ([`:253`](../../../src/backend/api/platforms/twitch/twitch-client.ts#L253)) | `gqlGetCategoryById` | `CategoryEndpoints.getCategoryById` |
| `getVideoById` ([`:299`](../../../src/backend/api/platforms/twitch/twitch-client.ts#L299)) | `gqlGetVideoMetadata` | `VideoEndpoints.getVideoById` |
| `getChannelByLogin` ([`:167`](../../../src/backend/api/platforms/twitch/twitch-client.ts#L167)) | `gqlGetChannelByLogin` | n/a (Helix has no equivalent) |

**Why prefer GQL:**

- No user auth required → works for logged-out users.
- Richer data per request (tags, follower count, cover art inline).
- Helix `/games/top` doesn't return category tags; we need GQL `BrowsePageAllDirectories` to get them.
- GQL `ChannelRootAboutPanel` returns a follower count for any channel without the `moderator:read:followers` scope dance.

**Why keep Helix as fallback:**

- GQL's persisted-query hashes occasionally drift (see [`gql-api.md`](./gql-api.md#persisted-query-maintenance)). A Helix fallback keeps the feature working while we update the hash.
- Helix is the only path for write operations (sending chat, modding, follow/unfollow) and for user-scoped reads (followed channels/streams).

## Why a Cloudflare Worker proxy for Helix

Same reason as Kick — we can't ship the Helix client secret in the desktop binary. The OAuth code-exchange step needs the secret, so it lives on `streamfusion.leveluptogetherbiz.workers.dev/twitch/...`. Helix reads don't strictly need the secret (a user token alone authorizes the call), but routing all traffic through the Worker means:

- Single egress IP makes rate-limit accounting simpler.
- Easy to add response shaping or error-normalisation if needed.
- The Worker can attach the `Client-Id` header so the client doesn't need to know our Helix Client-ID.

## Playback URL construction

The three GQL `*AccessToken` queries return signed tokens, not URLs. URL construction is in [`twitch-stream-resolver.ts`](../../../src/backend/api/platforms/twitch/twitch-stream-resolver.ts):

| Function | GQL call(s) | URL pattern |
|---|---|---|
| `getStreamPlaybackUrl(login)` | `gqlIsChannelLive` then `gqlGetPlaybackAccessToken` | `https://usher.ttvnw.net/api/channel/hls/{login}.m3u8?...` |
| `getVodPlaybackUrl(vodId)` | `gqlGetVodAccessToken` | `https://usher.ttvnw.net/vod/{vodId}.m3u8?...` |
| `getClipPlaybackUrl(slug)` | `gqlGetClipAccessToken` | Chooses a quality from the `videoQualities` array on the response |

These URLs are time-limited; cache them carefully. The HLS manifest itself has further short-lived segment URLs that hls.js fetches on its own.

## Transformer chain

Each Twitch raw type has a unified-type counterpart:

```
TwitchApiUser            → UnifiedUser            (transformTwitchUser)
TwitchApiStream          → UnifiedStream          (transformTwitchStream)
TwitchApiGame            → UnifiedCategory        (transformTwitchCategory)
TwitchApiChannel + User  → UnifiedChannel         (transformTwitchChannel)
TwitchApiUser            → UnifiedChannel         (transformTwitchUserToChannel)
TwitchApiSearchChannel   → UnifiedChannel         (transformTwitchSearchChannel)
TwitchApiFollowed + User → UnifiedFollow          (transformTwitchFollow)
TwitchApiVideo           → UnifiedVideo           (transformTwitchVideo)
TwitchApiClip            → UnifiedClip            (transformTwitchClip)
```

All defined in [`twitch-transformers.ts`](../../../src/backend/api/platforms/twitch/twitch-transformers.ts). Endpoint functions call the transformer before returning — callers never see raw API shapes.

There's also `parseTwitchDuration(str)` for converting `"3h8m32s"` into seconds.

## File map

| File | Purpose |
|---|---|
| [`twitch-client.ts`](../../../src/backend/api/platforms/twitch/twitch-client.ts) | `TwitchClient` god-object: wrapper methods that prefer GQL and fall back to Helix |
| [`twitch-requestor.ts`](../../../src/backend/api/platforms/twitch/twitch-requestor.ts) | Generic Helix HTTP layer (`request<T>()`), retry logic, 401 refresh |
| [`twitch-gql-client.ts`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts) | All GraphQL queries (~21 functions, ~1200 lines) |
| [`twitch-gql-helpers.ts`](../../../src/backend/api/platforms/twitch/twitch-gql-helpers.ts) | Backwards-compat re-exports |
| [`twitch-types.ts`](../../../src/backend/api/platforms/twitch/twitch-types.ts) | Raw API types + base-URL constants |
| [`twitch-transformers.ts`](../../../src/backend/api/platforms/twitch/twitch-transformers.ts) | Raw → `Unified*` mapping |
| [`twitch-stream-resolver.ts`](../../../src/backend/api/platforms/twitch/twitch-stream-resolver.ts) | Builds HLS / clip playback URLs from GQL tokens |
| [`endpoints/user-endpoints.ts`](../../../src/backend/api/platforms/twitch/endpoints/user-endpoints.ts) | `/users`, `/channels/followed`, `/channels/followers` |
| [`endpoints/stream-endpoints.ts`](../../../src/backend/api/platforms/twitch/endpoints/stream-endpoints.ts) | `/streams`, `/streams/followed` |
| [`endpoints/channel-endpoints.ts`](../../../src/backend/api/platforms/twitch/endpoints/channel-endpoints.ts) | `/channels` + `/users` merge for profile images |
| [`endpoints/category-endpoints.ts`](../../../src/backend/api/platforms/twitch/endpoints/category-endpoints.ts) | `/games`, `/games/top` |
| [`endpoints/search-endpoints.ts`](../../../src/backend/api/platforms/twitch/endpoints/search-endpoints.ts) | `/search/channels`, `/search/categories` |
| [`endpoints/video-endpoints.ts`](../../../src/backend/api/platforms/twitch/endpoints/video-endpoints.ts) | `/videos` |
| [`endpoints/clip-endpoints.ts`](../../../src/backend/api/platforms/twitch/endpoints/clip-endpoints.ts) | `/clips` |
