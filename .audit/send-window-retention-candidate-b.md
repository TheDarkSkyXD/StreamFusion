# Candidate B: caller-owned Composer Lease

## Problem

`KickChat` currently tells the main-process send-window owner that chat is active when the first Pusher channel joins, then clears that boolean only when the last Pusher channel leaves. That treats receive-only chat and a visible message composer as the same owner. Home deliberately mounts `KickChat` with `showComposer={false}`, so a Kick follow or another web-session mutation can create the hidden renderer while Home chat prevents the existing five-second reaper from disposing it. The observed result is a hidden Chromium renderer retained for the life of the read-only chat. The change must preserve Pusher ownership and let a visible composer keep a send-created window warm.

Grounding: `FeaturedStage` passes `showComposer: false` to its Kick `ChatPanel`; `KickChat` still acquires, connects, and joins Pusher for that rail. `KickChatService.joinChannel()` and `leaveChannel()` currently call `setSendWindowChatActive(true|false)`. The send-window already has a sound operation counter and generation-guarded idle reaper, but `fetchKickWebApiMutation()` is the one renderer-backed operation that does not currently take that operation lease. Commit `959db52` introduced the global chat-active boolean and reaper. It solves an idle window only when Pusher leaves, not when the actual send-capable UI is absent.

## Usage, caller's view

Only a mounted, visible composer holds a lease. A read-only chat does not call this API.

```tsx
function KickChat({ showComposer = true, ...props }: KickChatProps) {
  useKickSendWindowComposerLease(showComposer);
  // Existing Pusher connect, join, receive, history, and release flow.
  return <KickChatView {...props} />;
}
```

```tsx
// Home: receives Pusher messages but never retains a send renderer.
<ChatPanel initialPlatform="kick" showComposer={false} />

// Stream chat: when a send or web mutation creates the window, this lease
// keeps it ready for the next message while the composer remains mounted.
<ChatPanel initialPlatform="kick" showComposer />
```

The hook owns one opaque ID for its React instance and issues the paired bridge calls:

```ts
type KickSendWindowComposerLeaseChange =
  | { kind: "retain"; leaseId: string }
  | { kind: "release"; leaseId: string };

window.electronAPI.kickChat.setComposerSendWindowRetention({
  kind: "retain",
  leaseId,
});
// effect cleanup sends the same id with kind: "release"
```

Two composer instances produce two distinct IDs. Releasing one ID cannot release the other instance's retention.

## Shape

### Renderer

Add `use-kick-send-window-composer-lease.ts` beside `KickChat`. The hook creates one `crypto.randomUUID()` in a ref and has one effect keyed by `enabled` (`showComposer`). When enabled, it invokes `setComposerSendWindowRetention({ kind: "retain", leaseId })`; effect cleanup invokes the matching `release`. When disabled it does nothing. It does not call `ensureSendWindowReady`, so merely opening a composer does not create a hidden renderer. It only preserves a window after the first real send or renderer-backed operation creates one.

Delete the three send-window bridge wrappers from `kick-chat.ts` and remove the calls in `joinChannel`, `leaveChannel`, and `forceShutdown`. Pusher's reference counting, subscriptions, disconnect ordering, and receive lifecycle remain exactly as they are. They no longer carry a UI-composer policy they cannot observe.

### Shared contract and preload

Add the discriminated `KickSendWindowComposerLeaseChange` type under `shared/`, plus one IPC channel and one preload method:

```ts
setComposerSendWindowRetention(
  change: KickSendWindowComposerLeaseChange
): Promise<void>;
```

The preload method is a necessary process-boundary adapter, not a policy layer. It forwards the typed change unchanged.

### Main-process ownership

`kick-chat-handlers.ts` validates the small discriminated payload and scopes the supplied ID to `event.sender.id` before it reaches the resource owner. It keeps a `Map<number, Set<string>>` only to clean every key owned by one renderer. It attaches one cleanup listener per sender WebContents:

- `did-start-loading`: release that sender's leases before a hard reload creates a fresh React tree.
- `render-process-gone` and `destroyed`: release that sender's leases after crash or close.

Each release is idempotent. The handler never accepts a global `false`, so one composer cannot clear another's state. SPA route changes do not emit a document load; a hard reload safely drops leases and the remounted visible composer reacquires its own.

`kick-send-window.ts` becomes the sole owner of resource retention:

```ts
export function retainSendWindowForComposer(ownerKey: string): void;
export function releaseSendWindowForComposer(ownerKey: string): void;
export function releaseSendWindowsForOwner(ownerId: number): void;
```

Internally it replaces `sendWindowChatActive` with a `Set<string>` of owner keys. `scheduleIdleReap()` refuses to reap only while that set is non-empty or a real operation is active. `disposeSendWindow()` destroys the BrowserWindow and credentials but deliberately does not clear live composer leases; if a window is recreated while a composer still exists, it remains warm. Test-only reset and process exit clear all state.

Wrap `fetchKickWebApiMutation()` in the existing `beginWindowOperation()`/`finally release` pattern, matching send and GET. Also call `scheduleIdleReap()` after a successful standalone `ensureSendWindowReady()` return. Together these ensure a follow mutation cannot be reaped during execution, then is reaped five seconds later when no composer lease exists. This is essential to the Home regression, not a separate feature.

The interface is deep: callers declare only whether their own composer exists, while ownership cardinality, crash cleanup, reaper cancellation, in-flight safety, and window generations remain inside the main-process owner. No Pusher or BrowserWindow detail leaks to React.

## Synthesis decision

Candidate B uses an instance-scoped, caller-owned compositor lease. It is preferred over deriving retention from Pusher channels because `showComposer` is a caller concern and Pusher is a receive concern. It also fixes the uncovered mutation-operation lease, so the reaper is safe independently of UI retention.

Screened red flags: it is not shallow because the one retain/release command hides cardinality, owner cleanup, and reaper policy. It avoids information leakage because only the IPC handler knows WebContents identities. It avoids temporal decomposition because all retention policy stays with the send-window owner. The preload call is not pass-through abstraction, it is the required privilege boundary.

## Tradeoffs accepted

- We accept one short IPC call per visible-composer mount and unmount in exchange for exact ownership instead of a global boolean.
- We accept no eager warmup on composer mount in exchange for avoiding a hidden renderer on pages where the user never sends. A real first send or mutation establishes the warm window.
- We accept release on hard reload before the new React tree mounts in exchange for guaranteed cleanup after a crash or abandoned renderer. The new visible composer reacquires immediately.

## Alternatives considered

- Keep the boolean but pass `showComposer` into `KickChatService.joinChannel()`: rejected. It exposes renderer policy to the Pusher service, still needs shared ref counting for multiple components, and makes a receive lifecycle own an unrelated BrowserWindow.
- Dispose immediately after every send or mutation: rejected. It makes read-only Home safe but removes the legitimate first-send warm path from stream chat and repeats expensive browser/session setup.
- Keep one boolean per WebContents: rejected. It still lets two composer instances in the same renderer race a final `false`, so it does not encode the multiplicity invariant.

## Open questions and risks

- Does any non-`KickChat` surface intentionally need a warm send window? If so, it should use the same explicit lease hook or a similarly named caller-owned wrapper, never Pusher state.
- `did-start-loading` should be verified against this app's hard-reload path in Electron proof. It must only be attached to a renderer that has acquired a lease.

## Focused verification

1. `KickChat.test.tsx`: read-only mode emits no retain; visible mode retains then releases its exact ID; two mounted composers release independently.
2. `kick-chat.test.ts`: joining and leaving Pusher channels never invokes send-window retention, preserving the receive lifecycle while removing the conflation.
3. `kick-chat-handlers.test.ts`: validates command shape, scopes IDs to the sender, and releases every sender-owned lease on reload/crash.
4. `kick-send-window.test.ts`: one of two leases cannot permit reaping; releasing the final lease reaps after five seconds; a follow mutation increments the operation counter and reaps after completion when no lease remains.
5. Electron proof: Home Kick chat (`showComposer=false`), execute a follow mutation, wait past five seconds, and verify Diagnostics loses the hidden send renderer. Then verify stream chat keeps one send-created renderer warm while its composer remains mounted and releases it on unmount/reload.

## Next implementation step

Introduce the shared lease-change contract and caller hook, then migrate `KickChat` before deleting the Pusher-derived global-active calls.
