# Kick Authentication

> [← Back to Kick docs](./README.md)
> Official OAuth docs: <https://docs.kick.com/getting-started/oauth>
> Scopes reference: <https://docs.kick.com/getting-started/scopes>
> Source: [`apps/desktop/src/backend/auth/kick-auth.ts`](../../../src/backend/auth/kick-auth.ts), [`kick-client.ts:436`](../../../src/backend/api/platforms/kick/kick-client.ts#L436)

## Flow

Kick uses **OAuth 2.1 with PKCE** for user authentication. There is no app-token (client-credentials) flow in this codebase — the client secret lives on the Cloudflare Worker and we haven't built a `/auth/kick/app-token` proxy. Callers that need to work for logged-out users **fall back to the public/legacy API** (no auth).

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
| `chat:write` | Send chat via official `POST /chat` (currently unused — chat sending goes through internal `POST /api/v2/messages/send/{chatroomId}`) |

When adding a new scope, update both the OAuth start URL in `kick-auth.ts` AND the Cloudflare Worker's scope allow-list.

## Token use at the request layer

`KickClient.request()` ([`kick-client.ts:427`](../../../src/backend/api/platforms/kick/kick-client.ts#L427)):

1. Calls `kickAuthService.ensureValidToken()` — refreshes if expiry is within the buffer.
2. Reads the access token and sets `Authorization: Bearer <token>`.
3. On `401`, calls `refreshToken()` once and retries the same request with the new token.
4. Throws `"Not authenticated with Kick. Use the public API fallback."` if no token is available — caller is expected to switch to the public/legacy path.

## ✅ When to require auth vs. fall back

| Operation | Auth required? | Fallback |
|---|---|---|
| `getUsersById`, `getChannelsBySlugs` (batched) | Yes | None — returns `[]` if not authenticated |
| `getChannel` (single slug) | Tries public first, then auth | [`getPublicChannel`](./endpoints.md#getpublicchannel) (BrowserWindow) |
| `searchChannels` | No | Mixed: public search + top-streams fuzzy match |
| `getTopStreams` | Yes | [`getPublicTopStreams`](./endpoints.md#getpublictopstreams) |
| `getStreamBySlug` | Yes | [`getPublicStreamBySlug`](./endpoints.md#getpublicstreambyslug) |
| Videos, clips | No (legacy v2) | n/a — the official API doesn't expose VODs/clips |

## ⚠️ Identity-mismatch bug

The authenticated `GET /channels?slug[]=X` occasionally returns the **authenticated user's own channel** instead of the requested one when a single slug is passed. `getChannel()` ([`channel-endpoints.ts:34`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L34)) tries the public API first to avoid this, and validates the returned `slug` against the requested one before returning. **Don't remove this validation** — it's the only thing keeping bad data out of the channel cache.
