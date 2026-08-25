# Reclaim the Kick send window after background reads

## Problem

The hidden Kick send window loads a full `https://kick.com` page. Live diagnostics show that the hidden page keeps IVS workers and Stripe frames resident while the visible app sits idle on Settings. `fetchKickWebApiGet()` can open that page when its direct session request falls back to renderer execution, but a successful background read has no matching release. The window then remains alive until Kick chat closes, the user logs out, or another hard cleanup runs.

The same window also sends chat messages and Kick web mutations. Cleanup must not destroy it during an operation. Active Kick chat must keep a window warm if a background read or prior send already opened it. Joining chat must not open the window because the existing startup contract deliberately initializes it only on the first send.

## Current flow

- `kick-send-window.ts` owns one `BrowserWindow`, one captured Sanctum bearer, and the warmup and reload single-flight promises.
- `fetchKickWebApiGet()` tries `session.fetch` first. Network failures, Kick security responses, and non-JSON responses fall back to `ensureSendWindowReady()` and `executeJavaScript()` in the hidden page.
- Follow and account reads call the GET path from `endpoints/follow-endpoints.ts`. Subscription emote reads call it from `kick-user-subscriptions-service.ts`, but only when `isKickWebApiReady()` reports an existing window.
- Chat calls cross `KickChatService`, preload IPC, `kick-chat-handlers.ts`, and then `kick-send-window.ts`. `joinChannel()` does not call the existing readiness method. `sendMessage()` opens the window on demand.
- `leaveChannel()` and `forceShutdown()` call `disposeSendWindow()`. Kick logout also calls it. The current function is a hard destroy and can race a GET, send, mutation, warmup, or reload.
- The GET deadline also calls the hard destroy while the losing branch of `Promise.race()` can still be running.

## Usage from callers

Chat reports only whether at least one Kick channel is active. The call does not warm the window.

```ts
await window.electronAPI.kickChat.setSendWindowChatActive(true);

// Existing join and Pusher subscription continue unchanged.

await window.electronAPI.kickChat.setSendWindowChatActive(false);
```

`KickChatService` sends `true` on the channel-count transition from zero to one. It sends `false` on the transition from one to zero and during final shutdown. Repeated values are safe.

Background callers keep their current API.

```ts
const result = await fetchKickWebApiGet("/api/v2/channels/followed");
```

If the direct request succeeds, no window exists. If renderer fallback opens a window while chat is inactive, the owner schedules that exact window for cleanup after a short idle grace period. The grace period lets a burst of paginated reads reuse one page.

## Recommended shape

Keep lifecycle policy inside `kick-send-window.ts`.

```ts
type WindowOperationRelease = () => void;

interface SendWindowLifecycle {
  chatActive: boolean;
  activeOperations: number;
  generation: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function setSendWindowChatActive(active: boolean): void;

function beginWindowOperation(): WindowOperationRelease;
function scheduleIdleReap(): void;
function reapWindowIfCurrent(window: BrowserWindow, generation: number): void;

export async function disposeSendWindow(): Promise<void>; // hard teardown only
```

`setSendWindowChatActive()` is an idempotent retention bit, not a command to create a window. Setting it to `true` cancels pending cleanup. Setting it to `false` schedules cleanup if no operation is active.

`beginWindowOperation()` increments `activeOperations`, advances `generation`, and cancels pending cleanup before any asynchronous work begins. Its once-only release decrements the count in `finally`. The release schedules cleanup only when chat is inactive and the count reaches zero. Wrap the complete public send, renderer GET fallback, and mutation flows. The lease must cover readiness, `executeJavaScript()`, bearer reload, and retry. Wrapping only `_fire*` leaves warmup and reload exposed to destruction.

The idle callback captures both the current window and `generation`. It destroys only when all conditions still hold.

```ts
sendWindow === capturedWindow &&
generation === capturedGeneration &&
activeOperations === 0 &&
chatActive === false
```

This identity check follows the existing `render-process-gone` protection. A stale timer cannot clear the bearer or destroy a successor window.

Keep `disposeSendWindow()` as a hard teardown for logout and app shutdown. Normal chat leave must set `chatActive` to `false` instead. A hard teardown cancels the timer, advances the generation, clears state, and destroys the current window even if lifecycle hints are stale.

Change the GET deadline so it does not hard-destroy shared state. It should return the bounded error, request idle cleanup, and let the real renderer operation release its lease when it settles. If cancellation of the losing operation is added later, cancellation must target the captured window and generation.

The interface is intentionally small. Callers expose one fact they own, whether Kick chat is active. The main-process owner hides operation counting, timer policy, identity checks, and hard teardown.

## Synthesis decision

Use the idempotent chat-retention bit with owner-local operation leases and a generation-guarded idle reaper.

The explicit-retain candidate correctly protected shared operations, but its proposed retain method warmed the page on chat join. That conflicts with the existing startup regression test and would keep the expensive Kick page resident for every passive viewer. The selected design keeps its operation leases but separates retention from creation.

The timer-only candidate kept the interface smaller, but it could not distinguish abandoned background state from a quiet active chat. Any timeout would eventually make the next send cold. The single chat-active bit supplies the missing fact without passing internal window handles or reference counts across IPC.

## Tradeoffs accepted

- We accept one IPC lifecycle signal in exchange for a proof that cleanup does not make an active chat's already-warm sender cold.
- We accept a short idle grace period in exchange for reuse across paginated or clustered background reads.
- We accept keeping an already-open page resident during quiet active chat in exchange for consistent subsequent send latency.
- We accept owner-local counters and a generation number in exchange for safe cleanup during concurrent sends, reads, mutations, reloads, and stale callbacks.
- We keep immediate hard disposal for logout and app shutdown. Those boundaries intentionally override normal operation leases.

## Alternatives considered

### Dispose in `fetchKickWebApiGet()` immediately

This has the smallest diff, but it can destroy the shared window during a concurrent send or mutation. It also repeats window creation across pagination. The caller would need to understand shared-window concurrency, so the interface hides too little.

### Use only an idle timeout

This avoids an IPC change. It cannot tell whether a quiet window belongs to active chat. A long timeout wastes CPU and memory. A short timeout adds a cold start to the next send.

### Reference-count window ownership across IPC

Acquire and release tokens can model multiple consumers. Lost releases, duplicate releases, renderer reloads, and partial join failures make the cross-process contract harder to recover. `KickChatService` already owns one boolean fact through its channel set, so a count exposes complexity the caller does not need.

### Warm on chat join

This makes every first send warm, but it recreates the diagnosed resource cost whenever a user views Kick chat. The current tests require lazy initialization. Performance work should not trade idle CPU and memory for a page the user may never use to send.

## Required regression tests

Add focused tests in `kick-send-window.test.ts`.

1. A direct GET neither creates nor schedules a hidden window.
2. A renderer-fallback GET creates one window, returns its result, and reaps it after the idle grace when chat is inactive.
3. An active chat bit does not create a window.
4. A fallback GET during active chat leaves its window resident after the grace period.
5. Changing chat to inactive schedules that resident window for cleanup.
6. A send, GET, or mutation that spans the grace period is not destroyed until its lease releases.
7. A rapid inactive-to-active transition cancels pending cleanup.
8. A stale timer cannot destroy a successor window or clear the successor bearer.
9. A GET deadline cannot destroy a concurrent sender's window.
10. Logout hard disposal still destroys immediately and invalidates stale callbacks.

Update `kick-chat.test.ts` so the existing join test still proves that chat activation does not warm the window. Replace normal leave assertions with zero-to-one and one-to-zero chat-active transition assertions. Keep final shutdown and logout tests for hard teardown. Add IPC and preload contract coverage for the boolean method.

Use fake timers. The repository's test budget forbids waiting on production delays.

## Open questions and risks

- What idle grace best amortizes followed-channel pagination without leaving the full page resident long enough to affect idle diagnostics? Start with a small measured value and verify it against the existing diagnostics capture.
- Can the losing GET deadline branch be aborted cleanly? If not, the operation lease must remain attached to the real branch rather than the `Promise.race()` result.
- Does renderer reload always run chat shutdown? Hard app-window teardown should clear `chatActive` so a lost renderer signal cannot retain the page for the rest of the process lifetime.

## Next implementation step

Add the lifecycle state and fake-timer tests in `kick-send-window.test.ts`, then add the idempotent chat-active IPC signal without changing window creation behavior.
