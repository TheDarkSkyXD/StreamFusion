# Twitch Rate Limits & Retries

> [← Back to Twitch docs](./README.md)
> Source: [`twitch-requestor.ts`](../../../src/backend/api/platforms/twitch/twitch-requestor.ts), [`twitch-gql-client.ts`](../../../src/backend/api/platforms/twitch/twitch-gql-client.ts)

## Helix (REST)

Twitch publishes a **points-based** rate-limit system for Helix:

| Bucket | Cap |
|---|---|
| Per user-token (or app-token) | 800 points / minute |
| Cost of most reads | 1 point |
| Cost of `GET /streams/followed`, `/clips` create, etc. | varies — see [Helix rate-limits doc](https://dev.twitch.tv/docs/api/guide/#rate-limits) |

We **do not currently track point balances client-side** — we react to `429` headers when we hit the cap. The response headers we honour:

| Header | Used for |
|---|---|
| `Ratelimit-Reset` | Sleep until this UNIX timestamp before retrying |
| `Ratelimit-Limit` | (logged for debugging) |
| `Ratelimit-Remaining` | (logged for debugging) |

## Retry strategy (Helix)

`TwitchRequestor.request()` ([`twitch-requestor.ts:166`](../../../src/backend/api/platforms/twitch/twitch-requestor.ts#L166)) retries up to **3 times** on:

| Status | Backoff |
|---|---|
| `429` | Sleep until `Ratelimit-Reset`, then retry |
| `5xx` | Exponential `1s → 2s → 4s` |
| `401` | One-shot token refresh + immediate retry |

After max retries, throws `"Twitch API error: <status>"`.

Request timeout: 15 s.

## GraphQL

Twitch does not publish a documented rate limit for the GraphQL gateway. Empirically:

- Per-IP throttling kicks in around hundreds of requests/minute.
- Batched requests (up to ~35 ops in one POST) count as a single hit, so we batch aggressively.
- We currently issue no busy-poll against GQL; everything is request-scoped or React-Query cached with sensible `staleTime`.

If you add a new GQL call, **batch it where possible** — use the existing batched helpers (`gqlGetStreamsByLogins`, `gqlGetChannelsByLogins`, `gqlFetchGamesForVideos`) as templates.

## Cursor pagination

Helix and GQL both use opaque cursor strings:

| Helix | `?after={cursor}` in URL; `pagination.cursor` in response |
| GQL | `cursor` argument in variables; `pageInfo.cursor` in response |

In React Query land, `useInfiniteQuery` is configured to read these via `getNextPageParam`. See e.g. [`useSearch.ts`](../../../src/hooks/queries/useSearch.ts) for the search-channel/category infinite-query pattern.

## Token refresh race

`TwitchRequestor` includes a `retriedOn401` guard so a single request can't trigger more than one refresh per try. If the refresh fails, the auth service emits `session-expired` and the request throws.

If you see "token refresh race" log spam, the symptom is usually that **multiple parallel requests are all expiring simultaneously** — the fix is to centralise refresh in `twitchAuthService.ensureValidToken()` (which is what we do), not to add per-request guards.
