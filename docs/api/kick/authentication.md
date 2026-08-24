# Kick Authentication

> [← Back to Kick docs](./README.md)
> Official OAuth docs: <https://docs.kick.com/getting-started/oauth>
> Scopes reference: <https://docs.kick.com/getting-started/scopes>
> Source: [`apps/desktop/src/backend/auth/kick-auth.ts`](../../../src/backend/auth/kick-auth.ts), [`kick-client.ts:436`](../../../src/backend/api/platforms/kick/kick-client.ts#L436)

## Flow

Kick uses **OAuth 2.1 with PKCE** for user authentication. The Cloudflare Worker uses the client secret only to exchange and refresh user tokens. StreamFusion does not request Kick app tokens or proxy Kick data through the Worker. Logged-out reads use direct legacy/private fallbacks where available.

```
Desktop app           Cloudflare Worker             id.kick.com
     │   /auth/kick/start  ─────▶
     │                          ─────  PKCE challenge ────▶
     │      OAuth code   ◀─────                    ◀────  user consent
     │   /auth/kick/exchange ──▶
     │      access + refresh tokens     ◀─────
```

Tokens are persisted via `electron-store`. Access tokens auto-refresh in [`kick-auth.ts`](../../../src/backend/auth/kick-auth.ts) via `ensureValidToken()` and `refreshToken()`. The Worker rotates refresh tokens; the client must persist the new one on every refresh.

## Scopes

The app currently requests:

| Scope | Purpose |
|---|---|
| `user:read` | Profile, email, slug |
| `channel:read` | Channel details for own channel |
| `chat:write` | Send chat messages through Kick's official `POST /public/v1/chat` capability. The website-session adapter remains available for delivery compatibility; both paths keep credentials in the main process. |
| `moderation:chat_message:manage` | Delete chat messages as an authorized moderator or broadcaster. |
| `moderation:ban` | Ban, timeout, unban, and remove timeouts. |
| `events:subscribe` | Subscribe to supported Kick channel events. |

`KICK_APP_SCOPES` in `shared/auth-types.ts` is the single source of truth for the OAuth URL and scope validation. The Worker exchanges and refreshes the grant but does not maintain a separate scope allow-list.

## Token use at the request layer

`KickClient.request()`:

1. Calls `kickAuthService.ensureValidToken()` — refreshes if expiry is within the buffer.
2. Reads the access token and sets `Authorization: Bearer <token>`.
3. On `401`, calls `refreshToken()` once and retries the same request with the new token.
4. Sends the request directly to `https://api.kick.com`.
5. Throws `"No Kick user token is available."` if no token is available. Endpoint functions select a public/legacy fallback or return no data before calling the requestor.

## ✅ When to require auth vs. fall back

| Operation | Auth required? | Fallback |
|---|---|---|
| `getUsersById`, `getChannelsBySlugs` (batched) | Yes | None — returns `[]` if not authenticated |
| `getChannel` (single slug) | Tries auth first when signed in | [`getPublicChannel`](./endpoints.md#getpublicchannel) (BrowserWindow) |
| `searchChannels` | No | Mixed: public search + top-streams fuzzy match |
| `getTopStreams` | Yes | [`getPublicTopStreams`](./endpoints.md#getpublictopstreams) |
| `getStreamBySlug` | Yes | [`getPublicStreamBySlug`](./endpoints.md#getpublicstreambyslug) |
| Videos, clips | No (legacy v2) | n/a — the official API doesn't expose VODs/clips |

## ⚠️ Identity-mismatch bug

The authenticated `GET /channels?slug[]=X` occasionally returns the **authenticated user's own channel** instead of the requested one when a single slug is passed. When signed in, `getChannel()` ([`channel-endpoints.ts:34`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L34)) tries the official API first and validates the returned `slug` against the requested one before returning. If that response is missing or mismatched, it falls back to the direct legacy channel source. **Don't remove this validation** — it's the only thing keeping bad data out of the channel cache.
