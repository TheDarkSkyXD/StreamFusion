# Chat Backend Services

## Purpose
Owns everything between the wire and the renderer for chat: WebSocket/IRC connection lifecycle,
message parsing, badge resolution, room-state tracking, prediction normalization, third-party
emote substitution, and pinned-message delivery for both Twitch and Kick. Does NOT own: UI
rendering, chat store, IPC handler registration, auth token acquisition, emote-set fetching
(`services/emotes/`), or the Kick send-window (main-process only, driven via IPC).

## Entry Points / File Inventory

| File | Role |
|---|---|
| `twitch-chat.ts` | `TwitchChatService` — tmi.js IRC, send, rate-limit, reconnect |
| `kick-chat.ts` | `KickChatService` — Pusher WebSocket, send via IPC, reconnect |
| `twitch-parser.ts` | tmi.js tags + message → `ChatMessage` |
| `kick-parser.ts` | Kick Pusher payloads → `ChatMessage` / `UserNotice` / `ClearChat` |
| `twitch-irc-parser.ts` | Raw IRCv3 wire-line parser for recent-messages history |
| `badge-resolver.ts` | Twitch global/channel badge fetch + LRU cache (20 channels, 5 000 entries) |
| `twitch-roomstate.ts` | Pure function: raw Twitch event → `RoomStatePatchEvent` |
| `kick-roomstate.ts` | Pure function: raw Kick event → `RoomStatePatchEvent` |
| `kick-predictions-service.ts` | Pusher predictions subscription + REST seed |
| `kick-prediction-normalizer.ts` | `KickPredictionPayload` → `UnifiedPrediction` |
| `twitch-hermes-client.ts` | WebSocket to `wss://hermes.twitch.tv/v1` for Twitch predictions |
| `twitch-pin-poller.ts` | GQL polling every 10 s for pinned messages |
| `third-party-emote-enrich.ts` | Walks `ContentFragment[]`, substitutes 7TV/BTTV/FFZ emotes |

## Contracts & Invariants

- `isActive` MUST be set `false` BEFORE any `disconnect()` / `forceShutdown()` — reconnect
  callbacks gate on this flag.
- `badgeResolver.loadGlobalBadges()` must resolve before Twitch message parsing begins.
- `kickChatService.setChannelBadges()` must be called for subscriber badge rendering to work.
- `KickChatService.joinChannel()` requires `chatroomId` as a `number` — it forms the Pusher
  channel name.
- `RoomStatePatchEvent.patch` contains ONLY changed keys; absent keys mean "no change".
- `KickPredictionsService` emits through `KickChatService`'s emitter, not its own.
- Channel names are normalized (lowercase, no `#`) before any `Map` lookup.
- `KickPredictionsService` is the sole owner of its Pusher subscription.

## Patterns

- Both services extend `EventEmitter` typed via a `TypedEventEmitter` interface.
- **Reference counting** — `acquire()` / `release()` for multiview; `shutdown()` fires only when
  `activeUsers === 0`.
- **Single-flight connect** — `connectingPromise` prevents concurrent connect calls (Twitch).
- **Connection-ID counter** — incremented on each connect attempt; async callbacks abort if the
  ID no longer matches, discarding superseded connections.
- Errors are caught at the service level: logged and re-emitted as `"error"` events rather than
  thrown.
- Roomstate translators are pure functions with no side effects — safe to unit-test in isolation.

## Anti-patterns

- Never enable tmi.js `autoReconnect` — it creates zombie connections that bypass the `isActive`
  guard.
- Never call `.disconnect()` on the shared Pusher instance from outside `KickChatService`.
- Never import Electron APIs or trigger emote-set fetches inside `kick-chat.ts` — the file is
  bundled into the renderer context.
- Never call `resolveBadges(broadcasterId, …)` before the corresponding badge set is loaded.
- Never re-enable the tmi.js self-message pass-through — self-echoed messages carry no emote
  tags.
- Never use module-scope `/g` regexes with `.exec()` — use `String.prototype.matchAll()` instead.
- Never write empty arrays into `senderBadgesCache`.

## Pitfalls

- `TwitchHermesClient.reconnectAttempts` resets only on a `welcome` frame, not on socket `open`.
- `closeWebSocketSafe()` defers the close of `CONNECTING` sockets for React StrictMode
  compatibility — do not assume the socket is gone immediately.
- Kick predictions subscribe anonymously first; on `subscription_error` they retry with an
  authenticated token.
- Kick predictions are ref-counted per `channelId` with a pending-queue to serialize concurrent
  subscribe/unsubscribe calls.

## Related Context

- `services/emotes/` — emote-set fetching (upstream of `third-party-emote-enrich.ts`)
- `ipc/` — IPC handler registration (consumers of service events)
- `services/auth/` — token acquisition (passed in, never fetched here)
- Protocols: Twitch uses tmi.js over WSS (`reconnect: false`, `skipUpdatingEmotesets: true`);
  Kick uses pusher-js (cluster `us2`) for receiving and a hidden `BrowserWindow` send-window
  over IPC for sending.
