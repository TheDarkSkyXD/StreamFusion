# KICK API ENDPOINTS

**Read this file before modifying Kick API code.**

## Purpose
Owns Kick-specific API knowledge for `kick-client.ts`, `kick-requestor.ts`, `kick-types.ts`, and `endpoints/`. Keep official Public API calls separate from legacy `kick.com/api/*` fallbacks.

## Official Sources

- Docs: https://docs.kick.com/
- OpenAPI: https://api.kick.com/swagger/doc.yaml
- Public API host: `https://api.kick.com`
- OAuth host: `https://id.kick.com`

## Implementation Rules

- Prefer official `api.kick.com/public/*` endpoints when they cover the behavior.
- Use `KickRequestor.request()` for official authenticated API calls so token refresh, retry, rate limiting, and Electron networking stay centralized.
- Label any `https://kick.com/api/v1/*` or `https://kick.com/api/v2/*` usage as legacy/internal and document why the official API cannot replace it yet.
- Do not mix official endpoint response shapes with legacy response shapes in the same transformer without naming both source contracts.
- Re-check the OpenAPI spec before adding or changing endpoints. Kick deprecates and adds routes without this repo changing.
- OAuth `authorize` is documented as a browser `GET` redirect flow, even though the OpenAPI operation currently appears as `POST /oauth/authorize`.

## Official Endpoint Inventory

Last checked from `docs.kick.com` and `api.kick.com/swagger/doc.yaml` on 2026-06-09.

### OAuth: `https://id.kick.com`

| Method | Path | Use | Auth/Notes |
| --- | --- | --- | --- |
| `GET` | `/oauth/authorize` | User authorization code + PKCE redirect | Browser navigation; query includes `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`. |
| `POST` | `/oauth/token` | Authorization code exchange, app token, refresh token | Form body; `grant_type` is `authorization_code`, `client_credentials`, or `refresh_token`. |
| `POST` | `/oauth/revoke` | Revoke access or refresh token | Query includes `token`; optional token type hint. |
| `POST` | `/oauth/token/introspect` | Inspect token validity | Bearer token; replaces deprecated `/public/v1/token/introspect`. |

### Categories: `https://api.kick.com`

| Method | Path | Use | Params/Auth |
| --- | --- | --- | --- |
| `GET` | `/public/v2/categories` | Current category lookup/list endpoint | Optional `cursor`, `limit`, `name[]`, `tag[]`, `id[]`; user or app token. |
| `GET` | `/public/v1/categories` | Deprecated category search | Required `q`; optional `page`; user or app token. |
| `GET` | `/public/v1/categories/{category_id}` | Deprecated category by ID | Path `category_id`; user or app token. |

### Users And Channels

| Method | Path | Use | Params/Auth |
| --- | --- | --- | --- |
| `GET` | `/public/v1/users` | Get current user or users by ID | Optional `id[]`; `user:read` user token or app token. |
| `GET` | `/public/v1/channels` | Get own channel, channels by broadcaster IDs, or channels by slugs | Optional `broadcaster_user_id[]` or `slug[]`; do not mix both; `channel:read` user token or app token. |
| `PATCH` | `/public/v1/channels` | Update stream metadata | Body may include `category_id`, `custom_tags`, `stream_title`; `channel:write` user token. |
| `POST` | `/public/v1/token/introspect` | Deprecated token introspection | Use `/oauth/token/introspect` instead. |

### Livestreams

| Method | Path | Use | Params/Auth |
| --- | --- | --- | --- |
| `GET` | `/public/v1/livestreams` | Get live streams | Optional `broadcaster_user_id[]`, `category_id`, `language`, `limit`, `sort`; user or app token. |
| `GET` | `/public/v1/livestreams/stats` | Get livestream total stats | User or app token. |

### Chat And Moderation

| Method | Path | Use | Params/Auth |
| --- | --- | --- | --- |
| `POST` | `/public/v1/chat` | Send chat message as user or bot | Body `content`, `type`, optional `broadcaster_user_id`, `reply_to_message_id`; `chat:write` user token. |
| `DELETE` | `/public/v1/chat/{message_id}` | Delete chat message | Path `message_id`; `moderation:chat_message:manage` user token. |
| `POST` | `/public/v1/moderation/bans` | Ban or timeout user | Body `broadcaster_user_id`, `user_id`, optional `duration`, `reason`; `moderation:ban` user token. |
| `DELETE` | `/public/v1/moderation/bans` | Unban or remove timeout | Body `broadcaster_user_id`, `user_id`; `moderation:ban` user token. |

### Channel Rewards

| Method | Path | Use | Params/Auth |
| --- | --- | --- | --- |
| `GET` | `/public/v1/channels/rewards` | List channel rewards | `channel:rewards:read` or `channel:rewards:write` user token. |
| `POST` | `/public/v1/channels/rewards` | Create reward | Body reward payload; `channel:rewards:write` user token. |
| `PATCH` | `/public/v1/channels/rewards/{id}` | Update reward | Path `id`; body reward patch; `channel:rewards:write` user token. |
| `DELETE` | `/public/v1/channels/rewards/{id}` | Delete reward | Path `id`; `channel:rewards:write` user token. |
| `GET` | `/public/v1/channels/rewards/redemptions` | List reward redemptions | Optional `reward_id`, `status`, `id[]`, `cursor`; `channel:rewards:read` or `channel:rewards:write` user token. |
| `POST` | `/public/v1/channels/rewards/redemptions/accept` | Accept reward redemptions | Body `ids[]`, max 25; `channel:rewards:write` user token. |
| `POST` | `/public/v1/channels/rewards/redemptions/reject` | Reject reward redemptions | Body `ids[]`, max 25; `channel:rewards:write` user token. |

### Events

| Method | Path | Use | Params/Auth |
| --- | --- | --- | --- |
| `GET` | `/public/v1/events/subscriptions` | List event subscriptions | Optional `broadcaster_user_id`; user or app token. |
| `POST` | `/public/v1/events/subscriptions` | Subscribe to event | Body includes event, method, and callback details; `events:subscribe` user token or app token. |
| `DELETE` | `/public/v1/events/subscriptions` | Delete subscriptions | Required `id[]`; `events:subscribe` user token or app token. |

### Other Official APIs

| Method | Path | Use | Params/Auth |
| --- | --- | --- | --- |
| `GET` | `/public/v1/public-key` | Retrieve webhook signature public key | No bearer token required by docs. |
| `GET` | `/public/v1/kicks/leaderboard` | Get authenticated broadcaster KICKs leaderboard | Optional `top`; `kicks:read` user token. |
| `GET` | `/public/v1/drops/claims` | Retrieve Drops reward claims | Optional `campaign_id`, `limit`, `cursor`, `user_id`, `claim_id`, `external_status`; organization app access token. |
| `PATCH` | `/public/v1/drops/claims` | Update Drops claim `external_status` | Body `claims[]`, max 100; organization app access token. |

## Known Official Gaps In StreamFusion

- Followed channels/streams: no official followed-channels endpoint in current docs. Existing code uses `kick.com/api/v2/channels/followed`.
- Public channel/stream lookups without Kick login: existing code uses legacy `kick.com/api/v1/channels/:slug` style routes as no-auth fallbacks.
- Videos and clips: not covered by the official Public API inventory above; keep endpoint modules clearly marked as legacy/internal.
- Predictions, pin/unpin, and some chat-send behavior use discovered `kick.com/api/v2` routes; keep those isolated from official Public API client code.
