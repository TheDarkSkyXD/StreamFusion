# Issue 02 evidence — Category Video discovery

Observed: 2026-07-16 20:21 CDT (`America/Chicago`)

## Decision

**BLOCKED — the Category Videos tab does not pass the cross-Platform parity gate.**

Twitch exposes a native Category Video connection and its two required orders are observable without a viewer session. Kick does not expose a Category Video resource in its current official OpenAPI contract, and its anonymous Category surface has no Video route. Kick's only observed/current StreamFusion Video source is Channel-scoped. Therefore Category-wide Kick discovery, either sort, and pagination cannot be proven. Do not implement Issues 05, 07, or 09 as a one-Platform feed or a live-Channel fan-out.

No access token, cookie, playback URL, manifest URL, or playback credential was captured in this spike.

## Sources and current local surfaces

- Twitch official Videos guide: <https://dev.twitch.tv/docs/api/videos/>. It defines `GET /helix/videos?game_id=...`, `sort=time|views|trending`, cursor pagination, an app-or-user access-token requirement, and an approximately 500-Video result limit for a game.
- Twitch official API concepts: <https://dev.twitch.tv/docs/api/guide/>. It defines token-bucket `429` behavior and `Ratelimit-Limit`, `Ratelimit-Remaining`, and `Ratelimit-Reset` response headers.
- Kick official OpenAPI JSON: <https://api.kick.com/swagger/doc.json> (127,356 characters; SHA-256 `a6f78719f8c46038df7aeeceda9652421244ef4c23b94ed4192383813e3beca1`).
- Kick official OpenAPI YAML: <https://api.kick.com/swagger/doc.yaml> (64,528 characters; SHA-256 `769df3ef807792ee48d09f302aa860f8b2c9845f1de762fab74394796f39dc9b`).
- A case-insensitive `video|vod|clip` scan of both current Kick OpenAPI documents returned zero matches.
- Existing StreamFusion Twitch Video reads are Channel-scoped: `gqlGetVideosByChannel()` selects `user.videos`; Helix `getVideosByUser()` sends `/videos?user_id=...`.
- Existing StreamFusion Kick Video reads are Channel-scoped: `GET https://kick.com/api/v2/channels/{slug}/videos` in `video-endpoints.ts`.

The official documents establish supported contracts. The observations below establish current signed-out wire behavior from this machine and region.

## Twitch observations

### Native identity and signed-out discovery

An anonymous POST to `https://gql.twitch.tv/gql` used Twitch's public Android Client ID and **no** `Authorization` or cookie header. The raw query selected:

```graphql
query CategoryVideos($id: ID!, $first: Int!, $after: Cursor) {
  game(id: $id) {
    id
    name
    videos(first: $first, after: $after, sort: VIEWS) {
      edges {
        cursor
        node {
          id
          title
          broadcastType
          viewCount
          publishedAt
          lengthSeconds
          previewThumbnailURL
          contentClassificationLabels { id description }
          owner { id login displayName profileImageURL(width: 70) stream { id } }
          game { id name displayName }
        }
      }
      pageInfo { hasNextPage hasPreviousPage }
    }
  }
}
```

`sort: TIME` was exercised with the same selection. The native Category ID is the `game(id:)` input and every sampled node returned that same `game.id`; this is not derived from live Channels.

Representative signed-out observations:

| Population | Native Category | `TIME` | `VIEWS` | Termination |
|---|---|---:|---:|---|
| Populated | `509658` — Just Chatting | 5 rows sampled | 5 rows sampled | `hasNextPage=true` |
| Sparse | `2140249928` — Macho de Pon! ZZ | 1 row | 1 row | `hasNextPage=false` |
| Empty | `528395434` — MZ Samgukji | 0 rows | not repeated after native empty result | `hasNextPage=false` |

The populated `VIEWS` sample contained 20 Videos from 20 Channel results. Querying each owner's current `stream` showed 13 live owners and **7 offline owners**. This directly disproves a live-Channel-derived feed.

### Ordering and pagination

Two consecutive 20-row pages were fetched for each sort using the prior page's returned cursor.

| Sort | Page 1 | Page 2 | Duplicates | Cursor advanced | Global boundary/order result |
|---|---:|---:|---:|---:|---|
| `TIME` | 20 | 20 | 0 | yes | all 40 `publishedAt` values were non-increasing |
| `VIEWS` | 20 | 20 | 0 | yes | all 40 `viewCount` values were non-increasing |

Observed `VIEWS` boundary: page 1 ended at Video `2817706620` with 1,035,607 views; page 2 began at Video `2816773902` with 1,021,065 views.

Observed `TIME` boundary: page 1 ended at Video `2821836788` at `2026-07-17T01:16:21Z`; page 2 began at Video `2821836777` at `2026-07-17T01:16:20Z`.

Cursor behavior:

- A normal page's edges shared a page-boundary cursor; sending that cursor returned the next page and a different boundary cursor.
- Sparse and empty Categories returned `hasNextPage=false`; there was no continuation cursor to follow.
- Replaying the same valid input cursor returned the same page and next cursor. This is deterministic, but becomes an all-duplicate page from a caller that retries an already-consumed cursor.
- Inputs `definitely-not-a-valid-cursor`, `||||`, and a structurally cursor-like future value all returned HTTP 200, **silently reset to the first page**, and returned no GraphQL error. A consumer must reject an unchanged/replayed dataset or it can loop forever.
- Cursor expiry was not observable in the spike. The contract must treat an expired cursor like a malformed/stuck cursor: reset only through an explicit page-one refresh, never silently append it.

### Identity, restrictions, and playability

The anonymous connection provided stable Video ID, Channel ID/login/display name/avatar, Category ID/name, publication time, duration, thumbnail template, View Count, broadcast type, and content-classification labels. Platform is fixed by the Twitch adapter, and the public content link is deterministically `https://www.twitch.tv/videos/{id}`.

It does **not** provide an authoritative `isPlayable`, private/deleted/pruned state, entitlement, or subscriber-only field. Very recent rows were observed with duration `0` and Twitch's processing thumbnail, so inclusion in the list is not proof of immediate playability. Playback must remain a per-Video resolution step; playback credentials must never enter a list cache.

Observed or documented behavior:

| Case | Twitch result |
|---|---|
| Signed out | Anonymous GQL Category connection returned data. Helix with a Client ID but no bearer token returned `401`. A production Helix path therefore needs an app token, not viewer sign-in. |
| Signed in / auth change | Not exercised; list identity is public, but account-dependent entitlement/playback must invalidate on auth change. |
| Mature / content classification | The list exposes `contentClassificationLabels`; sampled top rows had no labels. Mature-region permutations were not proven. |
| Subscriber-only | No list entitlement field was found; inclusion/labeling was not proven. |
| Deleted / private / pruned | Not returned in samples. The official response exposes `viewable`, but absence semantics were not independently exercised. |
| Processing / temporarily unplayable | Included: duration `0` and processing thumbnail were observed. |
| Region-limited | Only the current US region was observed; cross-region behavior remains unproven. |

These unobserved restriction permutations are limitations of this spike, not evidence that Twitch includes or excludes them in a particular way.

### Errors and rate limits

| Condition | Observation/source | Actionable classification |
|---|---|---|
| No Helix bearer token | Direct Category request returned `401` | auth-required; obtain/refresh app token, not viewer login |
| Invalid GQL field/query | HTTP 200 with GraphQL validation errors | permanent/schema drift; do not retry unchanged query |
| Unknown native Category | `game` resolves null | permanent/not-found |
| Malformed/stale cursor | HTTP 200 first-page replay, no error | pagination-integrity failure; stop append and explicitly reset |
| `429` | Official token-bucket contract; not intentionally triggered | rate-limited; retry at `Ratelimit-Reset` with jitter |
| timeout/network/5xx | Not forced against production | transient; bounded backoff, retain cached rows |

Twitch's core native discovery and ordering are feasible. A production choice between official Helix (supported, app-token authenticated, approximately 500-result ceiling) and anonymous GQL (signed-out, internal/brittle) must preserve these limitations. The full region/entitlement matrix still requires later contract coverage if Twitch were the only gate.

## Kick observations

### Official capability is absent

Neither current official OpenAPI document contains a Video, VOD, or Clip operation. The official Category API can identify Categories, and the official Livestream API can filter by `category_id`, but there is no official Category Video source to call, sort, or paginate.

Unauthenticated requests to the official `/public/v1` and `/public/v2` host are gated before route resolution and returned `401` for both real and speculative paths. Those `401`s are not evidence that speculative Video routes exist; the OpenAPI path inventory is authoritative.

### Anonymous private surface control and negative probes

The private web API was queried with browser-style public headers and no Authorization/cookies:

- `GET https://api.kick.com/private/v1/categories` returned HTTP 200, 20 Categories, and a continuation cursor. It exposed native IDs, slugs, names, and live viewer counts; Just Chatting was native ID `15`.
- Control: `GET /private/v1/categories/just-chatting/livestreams` returned HTTP 200 JSON.
- `GET /private/v1/categories/just-chatting/videos` returned HTTP 404.
- `GET /private/v1/categories/15/videos` returned HTTP 404.
- Sparse control Category `kinitopet` (native ID `7699`, 6 live viewers when observed) also returned HTTP 404 by both slug and ID Video paths.

The `kick.com/api/v1|v2/categories/.../videos` and known `kick.com/api/v2/channels/xqc/videos` probes returned Cloudflare HTTP 403 from this non-browser client. The 403 is classified as web-integrity/access enforcement, **not** as proof of route presence or absence. The current app's known Channel Video route remains useful only after a Channel slug is known and cannot prove Category completeness.

### Failed contract matrix

| Requirement | Kick evidence | Result |
|---|---|---|
| Native Category-wide discovery | No official route; private Category Video candidates 404 | **failed** |
| Signed-out populated/sparse/empty feed | No feed exists to exercise; populated and sparse native Categories both 404 | **failed** |
| `Most Recent` and `Views` | Only Channel-scoped legacy route accepts `date|view` | **failed** |
| Global multi-page ordering | No Category pages/cursor | **failed** |
| Cursor progression/termination | No Category cursor | **failed** |
| Mixed Video/Channel/Category identity | No Category Video response | **failed** |
| Restriction/playability metadata | Channel payload has partial heuristics, but no Category contract | **failed** |
| Rate/auth/error behavior for Category Videos | Unsupported/404 is permanent; Cloudflare 403 is access/integrity; no resource exists for 429/cursor/auth-change observations | **failed** |

Kick completeness statement: **there is no observable upstream Category Video collection in the current official or anonymous Category surfaces.** StreamFusion cannot enumerate all upstream-discoverable public Kick Videos for a Category. Fan-out over live Channels would omit offline Channels and remains explicitly disallowed.

## Acceptance-criterion audit

| Criterion | Evidence status |
|---|---|
| Native Category discovery on both Platforms | Twitch proven; Kick failed |
| Signed-out populated/sparse/empty on both | Twitch proven for the sampled Categories; Kick failed because no feed exists |
| Both sorts on both | Twitch proven; Kick failed |
| Global multi-page order on both | Twitch two-page samples proven; Kick failed |
| Cursor progression/termination and malformed behavior | Twitch characterized, with expiry explicitly unproven; Kick failed |
| Required stable mixed-feed identity | Twitch mostly present, but authoritative playability absent; Kick failed |
| Account/region/restriction cases | Partially characterized; several Twitch permutations unproven and all Kick permutations unavailable |
| Rate/auth/transient/permanent classification | Twitch source/observations documented; Kick unsupported/404 documented, runtime route classes unavailable |
| Separate completeness statements and sanitized evidence | complete |
| Parity decision with no approximation | **BLOCKED** |

The failed and unproven rows are release blockers, not follow-up polish. Under the PRD's parity rule, the Category Videos tab must remain unshipped.
