---
title: "Raw WebSocket client teardown — defer close() when readyState is CONNECTING"
date: 2026-05-20
category: design-patterns
module: apps/desktop/src/backend/services/chat
problem_type: design_pattern
component: service_object
severity: medium
applies_when:
  - "A class owns a raw browser WebSocket (not a library wrapper) and must support stop()/cleanup()"
  - "The owner can be destroyed (React effect cleanup, component unmount, channel switch) before the handshake completes"
  - "React StrictMode or rapid channel-switching causes useEffect to run setup then teardown then setup in quick succession"
  - "A sibling WebSocket client (e.g. EventSub) follows the same raw-socket ownership pattern"
root_cause: async_timing
resolution_type: code_fix
related_components:
  - twitch-hermes-client
  - twitch-eventsub-client
  - TwitchChat
tags:
  - websocket
  - async-timing
  - react-strictmode
  - effect-cleanup
  - socket-lifecycle
  - deferred-close
---

# Raw WebSocket client teardown — defer close() when readyState is CONNECTING

## Context

`TwitchHermesClient.stop()` originally called `this.ws.close()` unconditionally during cleanup. Under React 19 StrictMode's dev double-invoke, the consumer effect at `apps/desktop/src/components/chat/twitch/TwitchChat.tsx:551-564` synchronously runs setup-then-cleanup in the same tick, so `close()` lands while the WebSocket is still mid-handshake (`readyState === CONNECTING`). The browser then emits an uncatchable console error — `WebSocket connection to 'wss://hermes.twitch.tv/v1?clientId=...' failed: WebSocket is closed before the connection is established.` — because the WHATWG spec requires the "fail the WebSocket connection" algorithm to run when `.close()` is called on a CONNECTING socket. The same path fires in production whenever the user unmounts chat or switches `channelId` within the ~50–300 ms TCP handshake window.

The fix is small and the bug is specific, but the **pattern** generalizes: any raw-WebSocket client in this codebase that can be destroyed mid-handshake needs the same shape. The sibling `twitch-eventsub-client` has the identical unguarded `close()` and is the next application of the pattern.

## Guidance

Route every `WebSocket.close()` call site that could observe a CONNECTING readyState through a small state-aware helper. The helper:

1. **Detaches handlers first.** Null `onmessage`, `onerror`, `onclose` before touching `close()`. After teardown, the owner's state machine must not react to events from a dying socket.
2. **Branches on `readyState`.**
   - `CLOSING` / `CLOSED`: null `onopen`, return. Avoids a second close call on a socket already on its way down.
   - `CONNECTING`: install **two** handlers on the otherwise-dead socket. One on `onopen` that calls `close()` once the handshake lands (the close now runs against an OPEN socket and is silent). One on `onerror` that nulls `onopen` so the deferred-close closure is released promptly if the handshake never lands.
   - OPEN (default): null `onopen`, then close normally.

```ts
function closeWebSocketSafe(ws: WebSocket): void {
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  const state = ws.readyState;
  if (state === WebSocket.CLOSING || state === WebSocket.CLOSED) {
    ws.onopen = null;
    return;
  }
  if (state === WebSocket.CONNECTING) {
    ws.onopen = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
    // Hung-handshake release: if the server never sends the 101 Upgrade,
    // the browser fires onerror then onclose. Clear the deferred-close
    // lambda here so the captured WebSocket can be GC'd promptly instead
    // of waiting for the OS TCP timeout (~90 s).
    ws.onerror = () => {
      ws.onopen = null;
    };
    return;
  }
  ws.onopen = null;
  try { ws.close(); } catch { /* ignore */ }
}
```

Caller pattern (the owning class's `stop()` / `dispose()`):

```ts
stop(): void {
  this.active = false;
  this.reconnectAttempts = 0;
  this.clearTimers();
  if (this.ws) {
    closeWebSocketSafe(this.ws);
    this.ws = null;
  }
  this.emitter.emit("state", "disconnected");
}
```

Key points: `active = false` and `this.ws = null` run before/after the helper in the owner. The helper itself only mutates the socket. The owner's state events (`"disconnected"`) are emitted synchronously by the owner so consumers see correct state regardless of whether the actual `close()` is immediate or deferred.

## Why This Matters

Three distinct failure modes the pattern addresses:

1. **Browser console noise (the user-visible symptom).** The WHATWG WebSocket spec ([websockets.spec.whatwg.org](https://websockets.spec.whatwg.org/#dom-websocket-close)) requires that `.close()` on a CONNECTING socket run "fail the WebSocket connection," which logs the error from the networking layer — not through `console.error`, so no JS hook can suppress it. The only way to avoid it is to never call `.close()` while CONNECTING. Deferring the close to `onopen` runs it against an OPEN socket and stays quiet.

2. **Hung-handshake memory retention.** Without the `onerror` release, the deferred-close lambda keeps the WebSocket object reachable for the full OS TCP timeout (~90 s) whenever the server accepts TCP but never sends the 101 Upgrade. Each such failed connection holds its closure until then. With the release, the closure clears whenever the browser's failure path fires `onerror`.

3. **Behavior under rapid teardown.** StrictMode's dev double-invoke is deterministic; production fast channel-switching is not, but the consumer effect at `TwitchChat.tsx:551-564` re-runs on every `channelId` change. Pre-fix, the eager `close()` ran the spec-defined fail path and initiated immediate TCP teardown — a real network event but accompanied by the spec-defined console error. Post-fix, the socket completes its handshake before being closed. Under stress (a hypothetical multi-view grid with rapid channel hovering, ~10× channel switches/second), this can keep more half-open sockets alive concurrently. Mitigation, if it ever proves necessary, belongs in the consumer (debounce the effect, or cap concurrent CONNECTING sockets) rather than in the helper.

## When to Apply

Apply this pattern when **all** of the following hold:

- The owner is a class that directly constructs a browser `WebSocket` (not via a library wrapper like Pusher-js, Socket.IO, or a managed-reconnect SDK).
- The owner exposes a `stop()` / `dispose()` / `close()` method called from an unmount path — most commonly a React `useEffect` cleanup, but also direct calls from app shutdown or channel-switch logic.
- The handshake duration is non-trivial relative to expected teardown timing (any TLS WebSocket over the public internet qualifies).

Do **not** apply this pattern when:

- The WebSocket is wrapped by a library that owns the lifecycle (Pusher-js / Socket.IO / etc.). The library either handles the CONNECTING-close case itself or exposes a different teardown primitive.
- The owner is a long-lived singleton that never gets torn down within a typical user session (e.g., a process-lifetime telemetry channel). The CONNECTING window never gets observed in practice. Audit the actual call sites before deciding the pattern is unnecessary.

## Examples

**Anchor (landed):** `apps/desktop/src/backend/services/chat/twitch-hermes-client.ts` — `closeWebSocketSafe(ws)` defined at module scope, called from `stop()`. The other `ws.close()` sites in the same file (`resetPongTimer` and `handleMessage`'s `"reconnect"` frame) are intentionally **not** routed through the helper: both fire only after `handleWelcome`, when the socket is OPEN, so the CONNECTING-close case is unreachable from them. The comment at the `"reconnect"` frame's catch block names this invariant.

Regression tests at `apps/desktop/tests/backend/services/chat/twitch-hermes-client.test.ts` cover four lifecycle cases: stop-during-CONNECTING with state-event spy (asserts only `"connecting"` then `"disconnected"` fire; no spurious `"connected"` after the deferred close), hung-handshake `onerror` release, stop-after-OPEN, and stop while already CLOSING / CLOSED. The local `MockWebSocket` stub dispatches `onclose` via `queueMicrotask` to match the real WebSocket spec's async close ordering.

**Next application (not landed yet):** `apps/desktop/src/backend/api/platforms/twitch/twitch-eventsub-client.ts` ~line 220 calls `this.ws.close(1000, "client close")` unconditionally. The EventSub client is longer-lived than the per-channel Hermes client (singleton per token rather than per component mount), so the CONNECTING window is shorter in practice — but any consumer that calls `close()` before the handshake completes will hit the same spec-required error. The clean migration is to extract `closeWebSocketSafe` to a shared module under `apps/desktop/src/backend/shared/` and apply it in both clients. Also extract `MockWebSocket` to `apps/desktop/tests/helpers/mock-websocket.ts` so the two test suites stop duplicating it.

**Anti-pattern (do not do this):**

```ts
// Hand-rolled state machine that "knows" handlers are still attached.
stop(): void {
  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
    this.ws.close();  // CONNECTING case still leaks the console error if it ever races here
  }
  this.ws = null;
}
```

The readyState check looks like a guard but misses the CONNECTING case entirely (it just silently skips the close, leaking the socket). Always handle every readyState branch explicitly.

## Related

- [`docs/solutions/architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md`](../architecture-patterns/singleton-bus-multiview-channel-filter-2026-05-19.md) — Covers a sibling `TwitchHermesClient` lifecycle fix (moving `reconnectAttempts = 0` from `ws.onopen` to `handleWelcome` to prevent reconnect storms on half-open sockets). Together with this pattern, the two docs describe the lifecycle invariants for the Hermes client end-to-end.
- [`docs/solutions/integration-issues/twitch-viewer-prediction-read-discovery-2026-05-18.md`](../integration-issues/twitch-viewer-prediction-read-discovery-2026-05-18.md) — Documents the Twitch Hermes endpoint and protocol that `TwitchHermesClient` implements.
- [`docs/solutions/design-patterns/draggable-click-disambiguation-pattern-2026-05-19.md`](./draggable-click-disambiguation-pattern-2026-05-19.md) — Another StrictMode-double-mount mitigation in this codebase (orphaned imperative pointer listeners on window). Different primitive, same root concern: detach handlers before the cleanup callback returns.
- Audit-log entry for the specific bug-fix landed in commits `e2141ea` and `447eb14` — see [`docs/test-audit/2026-05-19-audit-log.md`](../../test-audit/2026-05-19-audit-log.md) under "Follow-up: TwitchHermesClient stop()-during-CONNECTING — 2026-05-20".

**Outstanding pre-existing race (separate work, not addressed by this pattern):** `twitch-hermes-client.ts:123` — the `ws.onclose` handler assigned in `connect()` can clobber `this.ws` if it dispatches after `scheduleReconnect()` → `connect()` has already assigned a new socket (server-initiated reconnect frame or pong-timeout paths). Fix shape is a generation counter captured in the `onclose` closure. Independent of the close-during-CONNECTING pattern.
