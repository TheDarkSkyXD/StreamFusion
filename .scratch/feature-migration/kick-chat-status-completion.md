# Kick chat connection visibility

The compiled run does not establish the cause of its blank rail. At 00:12:25 the network log records the app status monitor reporting a Kick outage; at 00:16:14 Chromium records a Pusher WebSocket already closing/closed. The noise log contains only its header, and production debug logging omits successful room/subscription details. Root subsequently found the app occluded/hidden, which stalled queries. These observations do not prove a wrong chatroom ID or failed subscription.

A definite UI issue was reproduced locally: `KickChat` awaits `kickChatService.connect()` before adding its first connection marker, while Pusher can remain connecting/unavailable indefinitely. Connection-state updates previously only affected send eligibility, leaving no rail progress/error message.

Added a small Kick connection-status component rendered independently of asynchronous startup. It shows connecting, reconnecting/unavailable, history-loading, or startup failure and exposes Retry through the existing effect's acquire/release lifecycle. It only disappears when startup completes and the current channel is in the acknowledged subscription list. No transport identifiers, retry timing, Pusher semantics, or direct store mutations changed.

89 component/service tests passed. New regression coverage holds connect pending indefinitely, rejects connect, retries with cleanup, requires the selected channel subscription, and exposes reconnecting state. Full TypeScript, scoped ESLint, and all 19 feature boundary proofs passed. New chat.kickConnection locale keys were sent to the existing locale owner.

No live provider mutations or browser driving. Foreground live reproduction remains root-owned.
