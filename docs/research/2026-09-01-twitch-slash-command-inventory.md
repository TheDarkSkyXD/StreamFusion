# Twitch slash command inventory

Research date: 2026-09-01

This reference covers the 47 slash commands in the [ChatStats command guide](https://chatstats.live/resources/guides/chat-commands). The guide is a discovery list, not an implementation contract. Each command below is checked against Twitch Help, Twitch Developer documentation, or a Twitch developer announcement.

## Recommendation

Do not send native slash text through Twitch IRC. Twitch disabled third-party IRC command execution in February 2023. Twitch-owned web and mobile chat kept the commands, but third-party clients must call the matching Helix endpoint. Twitch now documents `/me` as the only supported command over IRC. `/disconnect` remains a local connection action. See [Twitch's IRC command deprecation announcement](https://discuss.dev.twitch.com/t/deprecation-of-chat-commands-through-irc/40486/1/) and [Twitch IRC concepts](https://dev.twitch.tv/docs/chat/irc/#irc-commands).

StreamFusion should split the catalog into these execution types:

| Execution type | Meaning |
| --- | --- |
| Helix | A public Twitch API can perform the command. |
| Helix with limits | A public API exists, but its token ownership or app ownership rules cannot reproduce every role supported by Twitch's own UI. |
| First-party UI | Twitch documents the native command, but no public API reproduces the action. |
| Local | StreamFusion can perform the action without Twitch. |

Every command requires a signed-in Twitch user in Twitch's native composer. An unauthenticated viewer cannot submit chat input. `/mods`, `/vips`, and `/rules` may look read-only, but Twitch's public APIs do not give an arbitrary viewer equivalent access.

Twitch says that typing `/` in its composer shows the commands available to the current user. It hides commands that the user cannot run. The official command groups are authenticated viewer, broadcaster or moderator, broadcaster or channel editor, and broadcaster. See [Twitch Chat Commands](https://help.twitch.tv/s/article/chat-commands?language=en_US). The localized page exposes the same complete tables when the English Help portal fails to render. See [Twitch Chat Commands in Spanish](https://help.twitch.tv/s/article/chat-commands?language=es).

## Authenticated viewer commands

These commands are available to a signed-in viewer. None are available through the chat composer while signed out.

| Command | Native syntax | Public implementation | User token scope | Integration notes |
| --- | --- | --- | --- | --- |
| `/mods` | `/mods` | Helix with limits. `Get Moderators` | `moderation:read` or `channel:manage:moderators` | The Helix `broadcaster_id` must match the token user. A viewer cannot use it to list another channel's moderators. Do not send `/mods` over IRC. |
| `/vips` | `/vips` | Helix with limits. `Get VIPs` | `channel:read:vips` or `channel:manage:vips` | The Helix `broadcaster_id` must match the token user. A viewer cannot use it to list another channel's VIPs. Do not send `/vips` over IRC. |
| `/color` | `/color <colorname>` or `/color <hex>` | Helix. `Update User Chat Color` | `user:manage:chat_color` | Map UI names such as `DodgerBlue` to Helix names such as `dodger_blue`. Twitch permits hex colors for Turbo and Prime users. |
| `/w` | `/w <username> <message>` | Helix. `Send Whisper` | `user:manage:whispers` | Resolve the login to a user ID. Twitch requires a verified phone number and applies whisper limits. A successful API response may still mean Twitch silently dropped the whisper. |
| `/block` | `/block <username>` | Helix. `Block User` | `user:manage:blocked_users` | Resolve the login to a user ID before the call. |
| `/unblock` | `/unblock <username>` | Helix. `Unblock User` | `user:manage:blocked_users` | Resolve the login to a user ID before the call. |
| `/disconnect` | `/disconnect` | Local | None | Disconnect the current IRC or EventSub chat session. Do not send a message. |
| `/gift` | `/gift <quantity>` | First-party UI | None | Opens Twitch's subscription gifting purchase flow. Twitch has no public API for purchasing gifted subscriptions. |
| `/vote` | `/vote` | First-party UI | None | Opens or acts on the current poll in Twitch's UI. Twitch exposes poll creation and management APIs, but no public endpoint for casting a viewer vote. |

The API requirements for color, blocked users, and whispers come from [Twitch OAuth scopes](https://dev.twitch.tv/docs/authentication/scopes/) and [Twitch whispering](https://dev.twitch.tv/docs/chat/whispers/). Twitch's role-list APIs are broadcaster-owned. See [`Get Moderators`, `Get VIPs`, and the related role endpoints](https://dev.twitch.tv/docs/api/reference#get-moderators).

## Broadcaster and moderator commands

The broadcaster can use every command in this section. A channel moderator can use them for a channel they moderate. Some commands have an extra channel setting or product requirement.

| Command | Native syntax | Public implementation | User token scope | Integration notes |
| --- | --- | --- | --- | --- |
| `/timeout` | `/timeout <username> [seconds] [reason]` | Helix. `Ban User` with `duration` | `moderator:manage:banned_users` | Native default is 600 seconds. Helix permits 1 through 1,209,600 seconds. Resolve the login to a user ID. |
| `/ban` | `/ban <username> [reason]` | Helix. `Ban User` without `duration` | `moderator:manage:banned_users` | Resolve the login to a user ID. The moderator ID must match the token user. |
| `/unban` | `/unban <username>` | Helix. `Unban User` | `moderator:manage:banned_users` | Also ends a timeout early. `/untimeout` is a historical alias, but Twitch's current Help page tells users to use `/unban`. |
| `/clear` | `/clear` | Helix. `Delete Chat Messages` without `message_id` | `moderator:manage:chat_messages` | Clears Twitch's current chat history. External clients may retain their own logs. |
| `/followers` | `/followers [duration]` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `follower_mode=true`. Native input accepts units such as `30m`, `2h`, `2d`, `1w`, and `3mo`. Convert them to 0 through 129,600 minutes. |
| `/followersoff` | `/followersoff` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `follower_mode=false`. |
| `/slow` | `/slow [seconds]` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `slow_mode=true` and `slow_mode_wait_time`. Helix permits 3 through 120 seconds. |
| `/slowoff` | `/slowoff` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `slow_mode=false`. |
| `/subscribers` | `/subscribers` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `subscriber_mode=true`. If the channel lacks subscriptions, only the broadcaster and moderators can chat. |
| `/subscribersoff` | `/subscribersoff` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `subscriber_mode=false`. |
| `/emoteonly` | `/emoteonly` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `emote_mode=true`. |
| `/emoteonlyoff` | `/emoteonlyoff` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `emote_mode=false`. |
| `/uniquechat` | `/uniquechat` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `unique_chat_mode=true`. Twitch previously called this R9K mode. |
| `/uniquechatoff` | `/uniquechatoff` | Helix. `Update Chat Settings` | `moderator:manage:chat_settings` | Set `unique_chat_mode=false`. |
| `/pin` | `/pin <description>` | Helix. `Send Chat Message` with `pin=true` | `user:write:chat` and `moderator:manage:chat_messages` | Sends and pins the supplied text for 20 minutes. A channel can disable moderator pin permission. `Pin Chat Message` can pin an existing message by ID. |
| `/announce` | `/announce <description>` | Helix. `Send Chat Announcement` | `moderator:manage:announcements` | The API supports `primary`, `blue`, `green`, `orange`, and `purple`. Limit messages to 500 characters. |
| `/shoutout` | `/shoutout <username>` | Helix. `Send a Shoutout` | `moderator:manage:shoutouts` | Resolve the target ID. Twitch limits a channel to one shoutout every 2 minutes and one per target every 60 minutes. The source channel must be live and have viewers. |
| `/monitor` | `/monitor <username>` | Helix. `Add Suspicious Status to Chat User` with `ACTIVE_MONITORING` | `moderator:manage:suspicious_users` | Resolve the login to a user ID. Twitch added the public endpoint after the older IRC migration. |
| `/unmonitor` | `/unmonitor <username>` | Helix. `Remove Suspicious Status From Chat User` | `moderator:manage:suspicious_users` | The removal endpoint resets the status to `NO_TREATMENT`. |
| `/restrict` | `/restrict <username>` | Helix. `Add Suspicious Status to Chat User` with `RESTRICTED` | `moderator:manage:suspicious_users` | Resolve the login to a user ID. |
| `/unrestrict` | `/unrestrict <username>` | Helix. `Remove Suspicious Status From Chat User` | `moderator:manage:suspicious_users` | The removal endpoint also removes active monitoring. Read the current status before exposing separate reversible controls. |
| `/user` | `/user <username>` | First-party UI | None | Opens Twitch's viewer card and moderator history. Twitch exposes no public equivalent for the complete card, channel chat history, and moderator comments. |
| `/requests` | `/requests` | First-party UI with limited adjacent APIs | `channel:read:redemptions` or `channel:manage:redemptions` for adjacent APIs | Opens the Channel Points request queue. Public redemption APIs only expose rewards created or manageable by the calling app, so they cannot reproduce Twitch's general queue. |
| `/poll` | `/poll` | Helix with limits. `Create Poll` | `channel:manage:polls` | Twitch's command opens a setup dialog. Helix requires a complete poll payload and a broadcaster-owned token, even though Twitch's own UI lets moderators and editors manage polls. |
| `/endpoll` | `/endpoll` | Helix with limits. `End Poll` with `TERMINATED` | `channel:manage:polls` | Requires the active poll ID and a broadcaster-owned token. |
| `/deletepoll` | `/deletepoll` | Helix with limits. `End Poll` with `ARCHIVED` | `channel:manage:polls` | Requires the active poll ID and a broadcaster-owned token. |

Twitch documents the moderation calls in [Moderating Twitch Chatrooms](https://dev.twitch.tv/docs/chat/moderation/) and the chat-setting fields in [`Update Chat Settings`](https://dev.twitch.tv/docs/api/reference#update-chat-settings). The newer pin, announcement, and shoutout operations appear in the [Twitch API reference](https://dev.twitch.tv/docs/api/reference#send-chat-announcement). Suspicious-user statuses use `ACTIVE_MONITORING`, `RESTRICTED`, and `NO_TREATMENT`. See [`Add Suspicious Status to Chat User`](https://dev.twitch.tv/docs/api/reference#add-suspicious-status-to-chat-user). Poll creation and ending use broadcaster-owned scopes. See [Twitch Polls](https://dev.twitch.tv/docs/api/polls/).

## Broadcaster and channel editor commands

Twitch Help groups these commands under broadcaster and channel editor access. Public API permissions are narrower for several commands. A desktop client must follow the API contract, not assume that editor status grants Helix access.

| Command | Native syntax | Public implementation | User token scope | Integration notes |
| --- | --- | --- | --- | --- |
| `/commercial` | `/commercial [30|60|90|120|150|180]` | Helix with limits. `Start Commercial` | `channel:edit:commercial` | The native command defaults to 30 seconds and Twitch Help says editors may run it. The current public API explicitly permits only the broadcaster. The channel must be live, Affiliate or Partner, and outside its ad cooldown. |
| `/goal` | `/goal` | First-party UI with read-only API | `channel:read:goals` only for reading | Opens goal management. Twitch's public API can read active creator goals but cannot create, update, or end them. |
| `/prediction` | `/prediction` | Helix with limits. `Get`, `Create`, and `End Prediction` | `channel:manage:predictions` | Twitch's native command opens management UI. Helix mutations require a broadcaster-owned token, though Twitch's own UI permits moderators and editors. Predictions require an Affiliate or Partner channel. |
| `/raid` | `/raid <channel>` | Helix with limits. `Start a raid` | `channel:manage:raids` | Resolve the target login to an ID. Helix requires `from_broadcaster_id` to match the token user, so an editor's own token cannot start another broadcaster's raid. The API starts a 90-second broadcaster launch window. |
| `/unraid` | `/unraid` | Helix with limits. `Cancel a raid` | `channel:manage:raids` | The broadcaster ID must match the token user. Cancellation works only while the raid is pending. |
| `/marker` | `/marker [description]` | Helix. `Create Stream Marker` | `channel:manage:broadcast` | Broadcasters and editors may use the API. The description limit is 140 characters. The channel must be live, store VODs, and not be showing a rerun. |

The editor differences are explicit in the API reference. [`Start Commercial`](https://dev.twitch.tv/docs/api/reference#start-commercial) says editors and moderators may not call the public endpoint for a broadcaster. [`Start a raid`](https://dev.twitch.tv/docs/api/reference#start-a-raid) requires the sending broadcaster ID to match the token user. [`Create Stream Marker`](https://dev.twitch.tv/docs/api/reference#create-stream-marker) is the exception and accepts an editor's token. Twitch exposes only `Get Creator Goals`, not a goal mutation. See [`Get Creator Goals`](https://dev.twitch.tv/docs/api/reference#get-creator-goals) and [Twitch Predictions](https://dev.twitch.tv/docs/api/predictions/).

## Broadcaster-only commands

Twitch's current Help page places these commands in the broadcaster-only group.

| Command | Native syntax | Public implementation | User token scope | Integration notes |
| --- | --- | --- | --- | --- |
| `/mod` | `/mod <username>` | Helix. `Add Channel Moderator` | `channel:manage:moderators` | The broadcaster ID must match the token user. A VIP must lose VIP status before becoming a moderator. |
| `/unmod` | `/unmod <username>` | Helix. `Remove Channel Moderator` | `channel:manage:moderators` | The broadcaster ID must match the token user. |
| `/vip` | `/vip <username>` | Helix. `Add Channel VIP` | `channel:manage:vips` | The broadcaster ID must match the token user. A moderator must lose moderator status before becoming a VIP. The channel must have an available VIP slot. |
| `/unvip` | `/unvip <username>` | Helix. `Remove Channel VIP` | `channel:manage:vips` | A broadcaster may remove a channel VIP. The API also permits a VIP to remove their own role, but that is separate from broadcaster command discovery. |
| `/rules` | `/rules` | First-party UI | None | Shows the channel's rules if configured. Twitch has no public channel-rules endpoint. |
| `/sharedchat` | `/sharedchat` | First-party UI with read-only API | No scope for `Get Shared Chat Session` | Opens Stream Together backstage and starts or joins Shared Chat in an existing collaboration. The public API can read an active session but cannot start or join one. The host controls session start. |

Role mutations and their scopes are documented in [Managing Roles for Your Channel](https://help.twitch.tv/s/article/Managing-Roles-for-your-Channel) and the [Twitch API reference](https://dev.twitch.tv/docs/api/reference#add-channel-moderator). The [Shared Chat Help page](https://help.twitch.tv/s/article/shared-chat?language=en_US) documents `/sharedchat`. The public [`Get Shared Chat Session`](https://dev.twitch.tv/docs/api/reference#get-shared-chat-session) endpoint is read-only.

## Related commands and aliases outside the linked catalog

The following names matter when matching Twitch behavior, but they are not separate entries in the linked ChatStats table.

| Command or alias | Current status | Recommendation |
| --- | --- | --- |
| `/me <message>` | Twitch documents it as the only slash command supported over third-party IRC. | Keep it as an action message. It needs normal chat authentication, `chat:edit` over IRC or `user:write:chat` through Send Chat Message. |
| `/ignore <username>` | Older Twitch Help localizations used it for blocking. Current Help uses `/block`. | Accept as an optional local alias for `/block`, but show `/block` in discovery. |
| `/unignore <username>` | Older Twitch Help localizations used it for unblocking. Current Help uses `/unblock`. | Accept as an optional local alias for `/unblock`, but show `/unblock` in discovery. |
| `/untimeout <username>` | Twitch included it in the 2023 IRC migration list. Current Help uses `/unban` for both bans and timeouts. | Accept as an optional alias for `/unban`. Show `/unban` as canonical. |
| `/delete <message-id>` | Twitch included it in the 2023 migration list but omits it from the current Help catalog. `Delete Chat Messages` still supports a message ID. | Do not add it from the linked guide. A context-menu delete action is clearer. If retained for compatibility, require `moderator:manage:chat_messages`. |
| `/help` | Twitch removed third-party IRC handling in 2023 and does not list it in the current native catalog. | A local `/help` command is safe, but label it as a StreamFusion command. Do not send it to Twitch. |
| `/host` and `/unhost` | Host Mode ended in 2022. Twitch gave `/host` no API migration path. | Do not add either command. |

Twitch's deprecation announcement names `/untimeout`, `/delete`, `/help`, and `/host` and describes their migration state. See [Deprecation of chat commands through IRC](https://discuss.dev.twitch.com/t/deprecation-of-chat-commands-through-irc/40486/1/).

## Implementation constraints for StreamFusion

1. Parse a command locally and call Helix. Do not rely on `tmi.js` helpers that send slash text to IRC. Twitch confirms that only `/me` survives over IRC.
2. Resolve usernames to Twitch user IDs before user-targeted API calls.
3. Discover commands from both channel role and granted OAuth scopes. Role alone does not prove that the current token can perform an API mutation.
4. Keep first-party-only commands out of the executable list unless StreamFusion can open the correct Twitch page or implement an honest local equivalent.
5. Do not promise moderator or editor support for broadcaster-token APIs. Polls, predictions, commercials, and raids have this mismatch.
6. Treat `/mods` and `/vips` as unavailable to an ordinary third-party viewer through public Helix. Twitch's own composer can show them because Twitch uses first-party services that the public API does not expose.
7. Return the draft to the composer when an API command fails. Twitch API failures include missing scopes, role changes, cooldowns, offline-channel requirements, and product eligibility.

## Verification status

The inventory contains all 47 slash commands from the linked guide. `@username` is not a slash command and belongs to mention completion. Every command is present in Twitch's current Help command groups. Public API mappings come from current Twitch API reference pages and OAuth scope documentation.

The research does not prove live first-party execution from a specific Twitch account. Twitch hides commands based on the account, channel role, product eligibility, and channel settings. A release check should use controlled viewer, moderator, editor, and broadcaster accounts. The integration must verify the API response for each implemented command rather than infer success from a sent chat line.
