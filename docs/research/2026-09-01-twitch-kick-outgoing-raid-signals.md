# Twitch and Kick outgoing raid signals

Research date: 2026-09-01

This note covers the signals that StreamFusion can use to follow a viewer from a source channel to a same-platform raid target. It separates outgoing viewer redirects from incoming raid notices because the platforms expose different data for each case.

## Recommendation

Kick can support the requested popup as a guarded, best-effort integration. The current Kick web client receives an outgoing redirect event with the target name, avatar, slug, category, thumbnail, and target viewer count. Kick does not document this event in its public developer API. StreamFusion must isolate the parser, reject malformed payloads, and keep the current source stream open if the event changes.

Twitch cannot support the full pre-raid experience through a documented public API. Twitch documents the viewer behavior, but IRC and EventSub report a raid when it reaches the target. They do not send a source viewer the countdown, current participation state, or opt-out deadline. Twitch's current web bundle names a proprietary raid PubSub topic and three message types. Twitch does not document their payload or compatibility. Treat that path as experimental rather than a stable platform contract.

Do not label a number as "chatters joined" unless the event supplies a raid-party count. Twitch supplies the final viewer count when the raid lands. Kick's outgoing payload supplies the target channel's current viewer count. Those numbers mean different things.

## Capability matrix

| Capability | Twitch documented contract | Twitch first-party web behavior | Kick documented contract | Kick first-party web behavior |
| --- | --- | --- | --- | --- |
| Source-side pre-raid signal | No viewer contract | Undocumented `raid.<channelId>` PubSub topic | No raid webhook or WebSocket contract | `channel.<channelId>` Pusher event |
| Destination identity before redirect | Only available to the caller that starts a raid | Proprietary raid update | No public raid event | `hosted.slug`, `hosted.username` |
| Destination avatar | Not in Start Raid or `channel.raid` | Proprietary raid update may carry it, but the current public contract does not | No public raid event | `hosted.profile_pic` |
| Raid-party count before redirect | Not exposed to ordinary viewers | Native UI shows participation, but the public payload is undocumented | Not exposed | Not exposed. `hosted.viewers_count` is the target's audience |
| Countdown or deadline in public event | No | Proprietary and undocumented | No | No. The web client starts a local eight-second timer |
| Viewer opt out and rejoin | Behavior is documented, transport is not | Native site calls proprietary join and leave operations | Not documented | Reject only. The current web client has no rejoin control after dismissal |
| Automatic move | Documented viewer behavior | Native site redirects enrolled viewers | Help Center says the community is sent to the target | Native client navigates when its local timer reaches zero |
| Incoming target notice | IRC and EventSub | Same data rendered in chat | No public raid webhook | `App\Events\StreamHostedEvent` |
| Stable enough for an unguarded integration | No for the pre-raid flow | No | No | No |

## Twitch

### Documented viewer behavior

Twitch says a raid starts with a pinned chat message. The broadcaster gets a 90-second launch window. Viewers see a separate pinned message, join by default, can click **Leave**, can click **Join** after changing their mind, and move to the target after a 30-second viewer countdown. The Help Center describes the behavior but does not expose the viewer state as an API. See [How to use raids](https://help.twitch.tv/s/article/how-to-use-raids?language=en_US).

The Helix Start Raid endpoint is a broadcaster control, not a viewer signal. It returns only:

```json
{
  "created_at": "RFC3339 timestamp",
  "is_mature": false
}
```

The call requires a user token with `channel:manage:raids`. Twitch says the request queues the raid, opens the native popup, and starts the raid when the broadcaster clicks **Raid Now** or the 90-second timer expires. The same scope allows Cancel Raid until the raid begins. See [Twitch Raids](https://dev.twitch.tv/docs/api/raids/) and [Twitch OAuth scopes](https://dev.twitch.tv/docs/authentication/scopes/).

This endpoint helps only when StreamFusion starts the raid for the broadcaster. It cannot notify an ordinary StreamFusion viewer that a raid started elsewhere.

### IRC is an incoming notice

Twitch IRC sends a `USERNOTICE` to the channel that receives the raid. The documented raid tags are:

| Tag | Meaning |
| --- | --- |
| `msg-id=raid` | Identifies the notice as a raid |
| `msg-param-displayName` | Source broadcaster display name |
| `msg-param-login` | Source broadcaster login |
| `msg-param-viewerCount` | Viewers arriving from the source channel |
| `room-id` | Receiving chat room ID |
| `system-msg` | Localized incoming raid text |

IRC does not include the destination because the connection already identifies the receiving channel. It does not include a countdown, deadline, opt-out state, or destination avatar. See [Twitch IRC `USERNOTICE`](https://dev.twitch.tv/docs/chat/irc/).

### EventSub fires when the raid lands

`channel.raid` version `1` accepts exactly one condition:

- `from_broadcaster_user_id` for outgoing raids from one broadcaster.
- `to_broadcaster_user_id` for incoming raids to one broadcaster.

Twitch documents no authorization requirement for this subscription type. The event contains:

```text
from_broadcaster_user_id
from_broadcaster_user_login
from_broadcaster_user_name
to_broadcaster_user_id
to_broadcaster_user_login
to_broadcaster_user_name
viewers
```

Twitch says Start Raid only queues the operation and instructs clients to use `channel.raid` to determine whether it happened. The event therefore confirms the transition. It is too late to provide the pre-raid opt-out countdown. It also has no avatar or deadline. See [EventSub `channel.raid`](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelraid) and [Twitch Raids](https://dev.twitch.tv/docs/api/raids/).

`channel.chat.notification` version `1` is another incoming target-channel notice. It requires `user:read:chat` for the connected chat user. A raid notice uses `notice_type=raid` and this nested object:

```text
raid.user_id
raid.user_login
raid.user_name
raid.viewer_count
raid.profile_image_url
```

This event can render a rich incoming notice with the source avatar. It does not announce the source channel's pending outbound redirect. See the [`channel.chat.notification` reference](https://dev.twitch.tv/docs/eventsub/eventsub-reference/#channel-chat-notification-event).

### Twitch proprietary web signal

The Twitch web bundle retrieved on 2026-09-01 defines a PubSub topic prefix named `Raid` with the value `raid`. Its topic helper produces `raid.<channelId>`. The same bundle defines these message names:

```text
raid_update_v2
raid_cancel_v2
raid_go_v2
```

See Twitch's first-party [`98437` web bundle](https://assets.twitch.tv/assets/98437-7cf239d1f3380052991c.js).

These names show that Twitch's native site has a source-side update, cancellation, and launch channel. The bundle does not establish a public payload contract. Twitch omits these events from its developer PubSub and EventSub documentation. Authorization, delivery guarantees, countdown fields, and join-state semantics are unsupported for third-party clients.

The current Twitch GraphQL schema used by the native client also includes `joinRaid` and `leaveRaid` mutations, but Twitch does not publish them as third-party API operations. StreamFusion must not depend on them as stable APIs. A client-side preference can suppress StreamFusion navigation, but it cannot promise that Twitch recorded the user as leaving the raid.

## Kick

### Public developer API has no raid event

Kick's public webhook list has chat messages, follows, subscriptions, rewards, livestream status and metadata, bans, and gifted Kicks. It has no raid or host event. See the official [Kick webhook event list](https://github.com/KickEngineering/KickDevDocs/blob/main/events/event-types.md).

Kick's Help Center says `/raid` is limited to channel owners, requires at least five viewers, and redirects the community to another live Kick channel. It does not document a viewer countdown, opt-out operation, rejoin operation, event payload, or public raid endpoint. See [Kick chat commands](https://help.kick.com/en/articles/7112979-kick-chat-commands) and [Collaborating with other streamers](https://help.kick.com/en/articles/14994663-collaborating-with-other-streamers-on-kick).

### Kick outgoing redirect signal

The Kick web client retrieved on 2026-09-01 subscribes to this public-style Pusher channel and event:

```text
channel: channel.<sourceChannelId>
event: App\Events\ChatMoveToSupportedChannelEvent
```

The handler reads these fields:

```text
hosted.slug
hosted.username
hosted.profile_pic
hosted.preview_thumbnail.src
hosted.preview_thumbnail.srcset
hosted.category
hosted.viewers_count
```

The source channel ID comes from the currently viewed channel. The event has enough target data to render the requested name and avatar. `hosted.viewers_count` is the target stream's viewer count. It is not the number of viewers or chatters joining the raid.

The current client starts a local eight-second countdown when it receives the event. The payload does not provide a duration or deadline. The client dismisses the dialog when the viewer clicks **Reject** or closes it. Otherwise it navigates to `/<hosted.slug>` at zero. Dismissal deletes the local target state, so the current Kick UI offers no change-your-mind control after rejection. See Kick's first-party [`JoinHostDialog` bundle](https://assets.kick.com/main/_next/static/chunks/3i50k20d8f8_m.js).

The channel name does not use Kick's `private-` prefix, which is consistent with a public Pusher subscription. Kick does not document this transport. Do not treat the name, payload, or authentication behavior as guaranteed.

### Kick incoming target notice

The current Kick web client handles incoming raids separately:

```text
channel: chatrooms.<targetChatroomId>
event: App\Events\StreamHostedEvent
```

The rendered notice reads:

```text
user.id
user.username
message.numberOfViewers
```

The event describes the source broadcaster and the arriving viewers. It does not include the source avatar. A client must resolve the avatar from `user.id` or `user.username`. See Kick's first-party [chat event bundle](https://assets.kick.com/main/_next/static/chunks/0xaybill_tntz.js) and [chat store bundle](https://assets.kick.com/main/_next/static/chunks/22e5nv07yzzb2.js).

This incoming notice must not trigger source-channel navigation. It appears in the target chat after the raid arrives.

## StreamFusion impact

StreamFusion already renders incoming raid notices. Twitch IRC maps incoming raids to `UserNotice.type="raid"`. Kick currently binds `App\Events\StreamHostEvent` and expects `host_username` plus `number_viewers`. Kick's current first-party client instead uses `App\Events\StreamHostedEvent` with `user.username` plus `message.numberOfViewers`. The existing Kick incoming parser is likely stale and needs a compatibility fix before the outgoing popup work.

The new flow needs a separate source-raid model. An incoming `UserNotice` cannot represent pending navigation, local enrollment, a deadline, or cancellation.

A safe product policy is:

1. Model `pending`, `opted_out`, `joining`, `cancelled`, and `completed` states per source channel.
2. Default to `joining` when a valid source-side event arrives.
3. Keep **Leave raid** and **Join raid** as local navigation choices. Do not claim that the platform recorded the choice unless a documented mutation exists.
4. Navigate only after a `go` signal or a platform-derived deadline. For Kick, the only current behavior is the native client's local eight-second timer.
5. Resolve a missing target avatar through the existing platform user lookup.
6. Label only a true raid count as raiders. Hide the count when the platform does not supply one.
7. Ignore cross-platform targets and malformed slugs.
8. Keep the source stream open on adapter errors, disconnects, and unknown payload versions.

## Verification limits

Neither platform offers a documented way to inject a source-viewer pre-raid event into a third-party client. Unit and integration tests should replay captured, redacted boundary fixtures. A real proof still requires a controlled source channel, a target channel, and at least one viewer account.

Twitch provides CLI support for testing `channel.raid`, but that proves only the landed EventSub event. It does not prove the native viewer countdown. See [Twitch CLI EventSub tests](https://dev.twitch.tv/docs/cli/event-command/).

For Kick, pin a fixture to the retrieval date and make parser failure non-fatal. Recheck the current first-party bundle before release because the Pusher names and fields have no compatibility promise.
