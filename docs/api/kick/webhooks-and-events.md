# Kick Webhooks & Real-time Events

> [← Back to Kick docs](./README.md)
> Source: [`apps/desktop/src/backend/services/chat/kick-chat.ts`](../../../src/backend/services/chat/kick-chat.ts), [`kick-parser.ts`](../../../src/backend/services/chat/kick-parser.ts)

Kick does not currently expose an EventSub-style webhook system to third-party apps for the data we need (live chat). Real-time delivery goes through **Pusher**, the same WebSocket gateway the kick.com website uses.

## Pusher gateway

| Field | Value |
|---|---|
| Cluster | `us2` |
| App key | `32cbd69e4b950bf97679` (public, same as kick.com web) |
| Transport | WebSocket (`wss://ws-us2.pusher.com/app/…`) |
| Library | [`pusher-js`](https://www.npmjs.com/package/pusher-js) (npm dep) |

The connection is established by [`kick-chat.ts`](../../../src/backend/services/chat/kick-chat.ts) when a Kick channel chat is opened.

## Subscribing to a channel

To receive chat events you need the **chatroom id** for the channel (NOT the channel id and NOT the slug).

```
Get chatroom id        →   getPublicChannel(slug).chatroomId
                            ↳ from `data.chatroom.id` in /api/v2/channels/:slug

Subscribe              →   pusher.subscribe(`chatrooms.${chatroomId}.v2`)
```

The `chatroomId` field is extracted in [`channel-endpoints.ts:368`](../../../src/backend/api/platforms/kick/endpoints/channel-endpoints.ts#L368) and persisted on `UnifiedChannel` so the chat layer doesn't need to re-fetch it.

## Channels we subscribe to

| Pusher channel | Event types |
|---|---|
| `chatrooms.{chatroomId}.v2` | `App\Events\ChatMessageEvent`, `App\Events\MessageDeletedEvent`, `App\Events\UserBannedEvent`, `App\Events\UserUnbannedEvent` |
| `chatroom_{chatroomId}` (legacy) | `App\Events\PinnedMessageCreatedEvent`, etc. |
| `channel.{channelId}` | `App\Events\StreamerIsLive`, `App\Events\StopStreamBroadcast`, `App\Events\SubscriptionEvent` |
| `channel_{channelId}` (legacy) | Various legacy events |

Event payload parsing lives in [`kick-parser.ts`](../../../src/backend/services/chat/kick-parser.ts).

## Sending chat

Official API: `POST /chat` with scope `chat:write` (currently **not used** by the app — the official endpoint is rate-limited per-app, not per-user, which doesn't scale to multi-channel chat).

Internal API used instead: `POST https://kick.com/api/v2/messages/send/{chatroomId}` (legacy v2, cookie auth via `electron.net` + persisted partition).

## Live-status changes

The app currently **does not subscribe to live-status events** in any background polling loop — `useFollowedStreams` polls `/livestreams` every 60s. If you add real-time live-status tracking, subscribe to `channel.{channelId}` → `StreamerIsLive` / `StopStreamBroadcast`.

## ⚠️ Stability notes

- Pusher cluster routing changes have happened mid-stream in the past. If chat suddenly stops working app-wide, check kick.com's web client in DevTools for the current cluster.
- The chatroom id is **not** the same as the channel id. Confusing them produces a successful subscribe but zero events.
- The `v2` suffix on `chatrooms.{id}.v2` is meaningful — `chatrooms.{id}` alone receives a different event shape.
