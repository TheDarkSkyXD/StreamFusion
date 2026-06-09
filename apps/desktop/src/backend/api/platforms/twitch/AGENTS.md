# TWITCH API ENDPOINTS

**Read this file before modifying Twitch API code.**

## Purpose
Owns Twitch-specific API knowledge for `twitch-client.ts`, `twitch-requestor.ts`, `twitch-types.ts`, `twitch-gql-client.ts`, `twitch-eventsub-client.ts`, and `endpoints/`. Keep official Helix calls separate from Twitch web GraphQL fallbacks.

## Official Sources

- API guide: https://dev.twitch.tv/docs/api/
- Helix reference: https://dev.twitch.tv/docs/api/reference/
- EventSub WebSocket reference: https://dev.twitch.tv/docs/eventsub/websocket-reference/
- OAuth docs: https://dev.twitch.tv/docs/authentication/
- Helix API host: `https://api.twitch.tv/helix`
- OAuth host: `https://id.twitch.tv/oauth2`
- EventSub WebSocket host: `wss://eventsub.wss.twitch.tv/ws`

## Implementation Rules

- Prefer official Helix endpoints for authenticated user/moderation flows.
- Use `TwitchRequestor.request()` for normal authenticated Helix calls so token refresh, retries, timeout, rate-limit handling, worker proxying, and platform-health recording stay centralized.
- The current `TwitchRequestor` supports user tokens only. It intentionally does not mint app tokens because client secrets live on the Cloudflare Worker and no app-token proxy endpoint exists yet.
- Use `gql.twitch.tv/gql` only for public/unauthenticated reads or web-only behavior that Helix cannot cover in this app. Label GQL usage as web/internal and keep persisted-query hashes isolated in `twitch-gql-client.ts`.
- Keep IRC/chat WebSocket behavior outside this directory. Chat service ownership is in `../../../services/chat/AGENTS.md`.
- Re-check the Helix reference before adding endpoints. Twitch adds endpoints and changes scopes over time.

## StreamFusion Route Map

| Need | Preferred local surface |
| --- | --- |
| Public browse/search/channel/video/clip reads without login | `twitch-gql-client.ts` via `twitch-client.ts` |
| Authenticated user/follows/streams/channels/games/videos/clips | `endpoints/*.ts` through `TwitchRequestor.request()` |
| Moderation, bans, VIPs, moderators, raids, commercials, chat settings | Dedicated `twitch-helix-*.ts` helpers |
| Polls and predictions | `twitch-helix-polls.ts`, `twitch-helix-predictions.ts` |
| EventSub over WebSocket | `twitch-eventsub-client.ts`, `twitch-eventsub-types.ts` |
| Playback access tokens / HLS URLs | `twitch-gql-client.ts`, `twitch-stream-resolver.ts` |
| Pin/unpin chat messages | Prefer official Helix `/chat/pins`; existing GQL mutations are legacy supplement code. |

## Official Helix Endpoint Inventory

Last checked from `https://dev.twitch.tv/docs/api/reference/` on 2026-06-09. This inventory includes the current official Helix endpoint families and operations; use the linked reference for full parameter, scope, and response details.

- `analytics`: `GET /helix/analytics/extensions` (Get Extension Analytics); `GET /helix/analytics/games` (Get Game Analytics)
- `authorization`: `GET /helix/authorization/users` (Get Authorization By User)
- `bits`: `GET /helix/bits/cheermotes` (Get Cheermotes); `GET /helix/bits/custom_power_ups` (Get Custom Power-up); `GET /helix/bits/extensions` (Get Extension Bits Products); `PUT /helix/bits/extensions` (Update Extension Bits Product); `GET /helix/bits/leaderboard` (Get Bits Leaderboard)
- `channel_points`: `DELETE /helix/channel_points/custom_rewards` (Delete Custom Reward); `GET /helix/channel_points/custom_rewards` (Get Custom Reward); `PATCH /helix/channel_points/custom_rewards` (Update Custom Reward); `POST /helix/channel_points/custom_rewards` (Create Custom Rewards); `GET /helix/channel_points/custom_rewards/redemptions` (Get Custom Reward Redemption); `PATCH /helix/channel_points/custom_rewards/redemptions` (Update Redemption Status)
- `channels`: `GET /helix/channels` (Get Channel Information); `PATCH /helix/channels` (Modify Channel Information); `GET /helix/channels/ads` (Get Ad Schedule); `POST /helix/channels/ads/schedule/snooze` (Snooze Next Ad); `POST /helix/channels/commercial` (Start Commercial); `GET /helix/channels/editors` (Get Channel Editors); `GET /helix/channels/followed` (Get Followed Channels); `GET /helix/channels/followers` (Get Channel Followers); `DELETE /helix/channels/vips` (Remove Channel VIP); `GET /helix/channels/vips` (Get VIPs); `POST /helix/channels/vips` (Add Channel VIP)
- `charity`: `GET /helix/charity/campaigns` (Get Charity Campaign); `GET /helix/charity/donations` (Get Charity Campaign Donations)
- `chat`: `POST /helix/chat/announcements` (Send Chat Announcement); `GET /helix/chat/badges` (Get Channel Chat Badges); `GET /helix/chat/badges/global` (Get Global Chat Badges); `GET /helix/chat/chatters` (Get Chatters); `GET /helix/chat/color` (Get User Chat Color); `PUT /helix/chat/color` (Update User Chat Color); `GET /helix/chat/emotes` (Get Channel Emotes); `GET /helix/chat/emotes/global` (Get Global Emotes); `GET /helix/chat/emotes/set` (Get Emote Sets); `GET /helix/chat/emotes/user` (Get User Emotes); `POST /helix/chat/messages` (Send Chat Message); `DELETE /helix/chat/pins` (Unpin Chat Message); `GET /helix/chat/pins` (Get Pinned Chat Message); `PATCH /helix/chat/pins` (Update Pinned Chat Message); `PUT /helix/chat/pins` (Pin Chat Message); `GET /helix/chat/settings` (Get Chat Settings); `PATCH /helix/chat/settings` (Update Chat Settings); `POST /helix/chat/shoutouts` (Send a Shoutout)
- `clips`: `GET /helix/clips` (Get Clips); `POST /helix/clips` (Create Clip); `GET /helix/clips/downloads` (Get Clips Download)
- `content_classification_labels`: `GET /helix/content_classification_labels` (Get Content Classification Labels)
- `entitlements`: `GET /helix/entitlements/drops` (Get Drops Entitlements); `PATCH /helix/entitlements/drops` (Update Drops Entitlements)
- `eventsub`: `DELETE /helix/eventsub/conduits` (Delete Conduit); `GET /helix/eventsub/conduits` (Get Conduits); `PATCH /helix/eventsub/conduits` (Update Conduits); `POST /helix/eventsub/conduits` (Create Conduits); `GET /helix/eventsub/conduits/shards` (Get Conduit Shards); `PATCH /helix/eventsub/conduits/shards` (Update Conduit Shards); `DELETE /helix/eventsub/subscriptions` (Delete EventSub Subscription); `GET /helix/eventsub/subscriptions` (Get EventSub Subscriptions); `POST /helix/eventsub/subscriptions` (Create EventSub Subscription)
- `extensions`: `GET /helix/extensions` (Get Extensions); `POST /helix/extensions/chat` (Send Extension Chat Message); `GET /helix/extensions/configurations` (Get Extension Configuration Segment); `PUT /helix/extensions/configurations` (Set Extension Configuration Segment); `GET /helix/extensions/jwt/secrets` (Get Extension Secrets); `POST /helix/extensions/jwt/secrets` (Create Extension Secret); `GET /helix/extensions/live` (Get Extension Live Channels); `POST /helix/extensions/pubsub` (Send Extension PubSub Message); `GET /helix/extensions/released` (Get Released Extensions); `PUT /helix/extensions/required_configuration` (Set Extension Required Configuration); `GET /helix/extensions/transactions` (Get Extension Transactions)
- `games`: `GET /helix/games` (Get Games); `GET /helix/games/top` (Get Top Games)
- `goals`: `GET /helix/goals` (Get Creator Goals)
- `guest_star`: `GET /helix/guest_star/channel_settings` (Get Channel Guest Star Settings); `PUT /helix/guest_star/channel_settings` (Update Channel Guest Star Settings); `DELETE /helix/guest_star/invites` (Delete Guest Star Invite); `GET /helix/guest_star/invites` (Get Guest Star Invites); `POST /helix/guest_star/invites` (Send Guest Star Invite); `DELETE /helix/guest_star/session` (End Guest Star Session); `GET /helix/guest_star/session` (Get Guest Star Session); `POST /helix/guest_star/session` (Create Guest Star Session); `DELETE /helix/guest_star/slot` (Delete Guest Star Slot); `PATCH /helix/guest_star/slot` (Update Guest Star Slot); `POST /helix/guest_star/slot` (Assign Guest Star Slot); `PATCH /helix/guest_star/slot_settings` (Update Guest Star Slot Settings)
- `hypetrain`: `GET /helix/hypetrain/status` (Get Hype Train Status)
- `moderation`: `POST /helix/moderation/automod/message` (Manage Held AutoMod Messages); `GET /helix/moderation/automod/settings` (Get AutoMod Settings); `PUT /helix/moderation/automod/settings` (Update AutoMod Settings); `GET /helix/moderation/banned` (Get Banned Users); `DELETE /helix/moderation/bans` (Unban User); `POST /helix/moderation/bans` (Ban User); `DELETE /helix/moderation/blocked_terms` (Remove Blocked Term); `GET /helix/moderation/blocked_terms` (Get Blocked Terms); `POST /helix/moderation/blocked_terms` (Add Blocked Term); `GET /helix/moderation/channels` (Get Moderated Channels); `DELETE /helix/moderation/chat` (Delete Chat Messages); `POST /helix/moderation/enforcements/status` (Check AutoMod Status); `DELETE /helix/moderation/moderators` (Remove Channel Moderator); `GET /helix/moderation/moderators` (Get Moderators); `POST /helix/moderation/moderators` (Add Channel Moderator); `GET /helix/moderation/shield_mode` (Get Shield Mode Status); `PUT /helix/moderation/shield_mode` (Update Shield Mode Status); `DELETE /helix/moderation/suspicious_users` (Remove Suspicious Status From Chat User); `POST /helix/moderation/suspicious_users` (Add Suspicious Status to Chat User); `GET /helix/moderation/unban_requests` (Get Unban Requests); `PATCH /helix/moderation/unban_requests` (Resolve Unban Requests); `POST /helix/moderation/warnings` (Warn Chat User)
- `polls`: `GET /helix/polls` (Get Polls); `PATCH /helix/polls` (End Poll); `POST /helix/polls` (Create Poll)
- `predictions`: `GET /helix/predictions` (Get Predictions); `PATCH /helix/predictions` (End Prediction); `POST /helix/predictions` (Create Prediction)
- `raids`: `DELETE /helix/raids` (Cancel a raid); `POST /helix/raids` (Start a raid)
- `schedule`: `GET /helix/schedule` (Get Channel Stream Schedule); `GET /helix/schedule/icalendar` (Get Channel iCalendar); `DELETE /helix/schedule/segment` (Delete Channel Stream Schedule Segment); `PATCH /helix/schedule/segment` (Update Channel Stream Schedule Segment); `POST /helix/schedule/segment` (Create Channel Stream Schedule Segment); `PATCH /helix/schedule/settings` (Update Channel Stream Schedule)
- `search`: `GET /helix/search/categories` (Search Categories); `GET /helix/search/channels` (Search Channels)
- `shared_chat`: `GET /helix/shared_chat/session` (Get Shared Chat Session)
- `streams`: `GET /helix/streams` (Get Streams); `GET /helix/streams/followed` (Get Followed Streams); `GET /helix/streams/key` (Get Stream Key); `GET /helix/streams/markers` (Get Stream Markers); `POST /helix/streams/markers` (Create Stream Marker); `GET /helix/streams/tags` (Get Stream Tags)
- `subscriptions`: `GET /helix/subscriptions` (Get Broadcaster Subscriptions); `GET /helix/subscriptions/user` (Check User Subscription)
- `tags`: `GET /helix/tags/streams` (Get All Stream Tags)
- `teams`: `GET /helix/teams` (Get Teams); `GET /helix/teams/channel` (Get Channel Teams)
- `users`: `GET /helix/users` (Get Users); `PUT /helix/users` (Update User); `DELETE /helix/users/blocks` (Unblock User); `GET /helix/users/blocks` (Get User Block List); `PUT /helix/users/blocks` (Block User); `GET /helix/users/extensions` (Get User Active Extensions); `PUT /helix/users/extensions` (Update User Extensions); `GET /helix/users/extensions/list` (Get User Extensions)
- `videos`: `DELETE /helix/videos` (Delete Videos); `GET /helix/videos` (Get Videos); `POST /helix/videos/clips` (Create Clip From VOD)
- `whispers`: `POST /helix/whispers` (Send Whisper)

## OAuth Endpoints

These are hosted on `https://id.twitch.tv/oauth2`, not the Helix API host.

| Method | Path | Use |
| --- | --- | --- |
| `GET` | `/authorize` | User authorization code flow. |
| `POST` | `/token` | Exchange code, refresh token, or client credentials. |
| `GET` | `/validate` | Validate access token and inspect scopes. |
| `POST` | `/revoke` | Revoke access token. |

## GQL And Non-Helix Supplements

- `POST https://gql.twitch.tv/gql`: Twitch web GraphQL. Used here for public browse/search/channel/video/clip data, playback access tokens, and legacy pin mutations. Treat persisted query hashes as brittle.
- `https://usher.ttvnw.net/api/channel/hls/{login}.m3u8`: HLS playlist resolved after GQL playback access token.
- `https://usher.ttvnw.net/vod/{vodId}.m3u8`: VOD playlist resolved after GQL VOD access token.
- `https://api.twitch.tv/helix` has no chat-history endpoint. Any chat-history code must clearly name its third-party/community source and stay outside official Helix types.

## Known App Constraints

- Guest/public mode leans on GQL because Helix requires OAuth for many reads and this app does not currently mint app tokens locally.
- Helix pagination is cursor-based (`pagination.cursor` / `after`), unlike some Kick routes.
- Scopes are endpoint-specific and often depend on whether the caller is broadcaster, moderator, app token, or user token. Do not infer scopes from a nearby helper; check the exact reference section.
