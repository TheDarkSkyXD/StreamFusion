# Twitch Authentication

> [← Back to Twitch docs](./README.md)
> Official OAuth docs: <https://dev.twitch.tv/docs/authentication/>
> Scopes reference: <https://dev.twitch.tv/docs/authentication/scopes/>
> Source: [`apps/desktop/src/backend/auth/twitch-auth.ts`](../../../src/backend/auth/twitch-auth.ts), [`twitch-requestor.ts:166`](../../../src/backend/api/platforms/twitch/twitch-requestor.ts#L166)

## Two token types — only one is used

| Token | Used? | Reason |
|---|---|---|
| **User token** (OAuth Authorization Code + PKCE) | ✅ Yes | Required for `/users` with own scope, `/channels/followed`, `/streams/followed`, `/channels/followers`, `/clips` creation |
| **App token** (Client Credentials) | ❌ No | The client secret lives on the Cloudflare Worker, so we'd need a Worker endpoint to mint app tokens. We don't have one because GQL covers all the public reads we'd otherwise need an app token for. |

## OAuth flow

Standard Authorization Code + PKCE.

```
Desktop app          Cloudflare Worker          id.twitch.tv
     │  /auth/twitch/start ─▶
     │                       ── PKCE challenge ──▶
     │     code ◀──                          ◀── user consent
     │  /auth/twitch/exchange ─▶
     │     access + refresh + expiry  ◀──
```

Tokens stored via `electron-store`. `twitchAuthService.ensureValidToken()` refreshes if the expiry is within the buffer; `refreshToken()` is also called one-shot on a 401 response (see [`twitch-requestor.ts:166`](../../../src/backend/api/platforms/twitch/twitch-requestor.ts#L166)).

## Scopes

| Scope | Why |
|---|---|
| `user:read:email` | Display email in profile |
| `user:read:follows` | List followed channels (Helix `/channels/followed`) |
| `moderator:read:followers` | Follower count via Helix `/channels/followers` (the broadcaster-side endpoint requires this even for read-only) |
| `chat:read`, `chat:edit` | IRC chat read + send |
| `user:read:chat`, `user:write:chat` | EventSub-driven chat (future) |

When adding a scope: update the OAuth start URL in `twitch-auth.ts` AND the scope allow-list on the Cloudflare Worker.

## Token use at the request layer

`TwitchRequestor.request()` ([`twitch-requestor.ts:166`](../../../src/backend/api/platforms/twitch/twitch-requestor.ts#L166)):

1. Calls `twitchAuthService.ensureValidToken()`.
2. Sets `Authorization: Bearer <token>` and `Client-Id: <our helix client id>`.
3. Retries on `429` (honours `Ratelimit-Reset` header), `5xx` (exponential backoff, max 3 retries).
4. One-shot refresh on `401`.
5. Throws `"Twitch API error: <status>"` after max retries.

## GraphQL has its own auth

GraphQL **does not use the user OAuth token**. It uses a public Client-ID:

```ts
// twitch-gql-client.ts
const GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp"; // Twitch Android app
const GQL_ENDPOINT  = "https://gql.twitch.tv/gql";
```

Every GQL request includes `Client-ID: <that constant>` and **no** Authorization header. This is the same Client-ID twitch.tv uses for its web client. Don't substitute our own.

For mutations or queries that require user identity (which we don't currently issue), GraphQL accepts an `OAuth <token>` header — but our codepaths only call GQL for public data.

## ✅ When to require auth vs. fall back

| Operation | Surface | Auth |
|---|---|---|
| `getUser()` | Helix `/users` | ✅ Required |
| `getUsersByLogin/Id` | Helix `/users` | ✅ Required |
| `getFollowedChannels` / `getFollowedStreams` | Helix | ✅ Required |
| `getFollowerCount` (any channel) | GQL `ChannelRootAboutPanel` | ❌ None |
| `getTopStreams` | GQL first → Helix fallback | None (GQL) / Required (Helix) |
| `searchChannels` | GQL `SearchResultsPageSearchResults` | None |
| `searchCategories` | GQL `SearchResultsPageSearchResults` (target=GAME) | None |
| `getStreamByLogin` | GQL `StreamMetadata` | None |
| `getChannelByLogin` | GQL `ChannelShell` + `ChannelRootAboutPanel` | None |
| Videos, clips metadata | GQL | None |
| Playback URLs (HLS, VOD, clip) | GQL `*AccessToken` | None |
