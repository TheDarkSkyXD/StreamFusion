# Kick send-window retention candidate A

## Problem

Home mounts `KickChat` with `showComposer=false` so users can read live chat beside the featured stream. Today `KickChatService.joinChannel()` marks the hidden Kick send window as chat-active for every receive subscription. If a follow, pin, delete, or send operation opens the hidden window while Home read-only chat is mounted, the 5 second idle reaper cannot dispose it until chat leaves. The ownership model conflates Pusher receive lifecycle with composer send readiness.

## Usage

Read-only Home chat keeps the current receive flow:

```ts
<ChatPanel initialPlatform="kick" initialChannel={slug} showComposer={false} />
```

The stream page keeps the normal composer:

```ts
<KickChat channel={slug} chatroomId={chatroomId} showComposer />
```

Inside `KickChat`, composer presence owns retention:

```ts
useEffect(() => {
  if (!showComposer) return;
  kickChatService.acquireSendWindowRetention();
  return () => kickChatService.releaseSendWindowRetention();
}, [showComposer]);
```

## Shape

`KickChatService` gets one private counter, `sendWindowRetentionUsers`, and two public methods:

```ts
class KickChatService {
  private sendWindowRetentionUsers = 0;

  acquireSendWindowRetention(): void;
  releaseSendWindowRetention(): void;
}
```

The first acquire calls `window.electronAPI.kickChat.setSendWindowChatActive(true)`. The final release calls `setSendWindowChatActive(false)`. `forceShutdown()` resets the counter and calls `disposeSendWindow()`. `joinChannel()` and `leaveChannel()` stop touching send-window retention, so Pusher receive and hidden send-window readiness are separate lifecycles. This follows model-the-domain because the counter represents the real resource owner: mounted composers, not mounted chat readers.

The main send-window module stays unchanged. Its `activeWindowOperations` still protects follow/mod/send operations while they run, and its 5 second idle reaper still disposes the window after operations finish when no composer lease exists.

## Synthesis decision

Candidate A is the chosen shape. It hides the race-prone boolean behind one service-level ref count and keeps callers to one acquire/release pair. It avoids a wider IPC API and does not ask Home, Stream, or main-process handlers to coordinate send-window policy.

## Tradeoffs accepted

- We accept a renderer-held retention counter in exchange for keeping the main process API unchanged and focused on the hidden window itself.
- We accept that a crashed renderer may keep the main flag true until existing feature cleanup or app lifecycle cleanup runs, in exchange for not adding heartbeat IPC. A later Diagnostics-managed renderer crash signal can call `disposeSendWindow()` if needed.
- We accept no eager warmup for read-only chat in exchange for preventing Home from pinning extra hidden-window processes during idle.

## Alternatives considered

- Add `showComposer` to `joinChannel()`. It lost because `joinChannel()` owns Pusher receive subscription, so callers would leak UI composition details into a service method that should only know chatroom identity.
- Move the counter into main with lease ids over IPC. It lost because it enlarges the preload/shared/handler surface for a lifecycle that only the renderer chat service needs to count.
- Always dispose after every follow/mod operation. It lost because it would make real composer first-send slower and fight the existing operation guard.

## Open questions and risks

- Should signed-out composer panels retain the send window? My recommendation is no. Without a Kick token, retaining the hidden authenticated window costs memory and cannot guarantee send eligibility.
- Should the app explicitly dispose the send window on renderer crash? Existing lazy-feature cleanup and shutdown cleanup cover normal reload/quit. A crash-specific hook would be a separate reliability task.

## Next implementation step

Add the ref-count methods to `KickChatService`, move retention from `joinChannel()` into a composer-only `KickChat` effect, and update tests to prove `showComposer=false` never sets chat-active.
