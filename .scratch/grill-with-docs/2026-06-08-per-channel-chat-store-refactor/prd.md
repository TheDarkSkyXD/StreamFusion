---
Status: done
Triage: AFK (autonomous-friendly, no human-in-the-loop decision needed)
ADR: docs/adr/0005-per-channel-chat-store.md
Grill: .scratch/grill-with-docs/2026-06-08-per-channel-chat-store-refactor/notes.md
---

# Per-channel chat message store

## Completion Status

Completed locally on 2026-06-08 through slice 04. The original one-release soak gate before deleting flat `state.messages` was explicitly overridden by the user for this local implementation; no 30+ minute release soak was performed. Verification completed with focused slice tests, lint, type-check, full vitest, and production build.

## Problem Statement

Chat in StreamFusion feels limited compared to KickTalk, and multiview is the worst case. In a 4-panel multiview, a single new message in Channel A causes every panel's chat list to re-render. The configured message-buffer cap (default 600) is shared across every chat panel in the app — Channel A's high-volume scrollback pushes Channel B's slower scrollback off the end. A moderator's `/clear` in one Twitch panel silently wipes every other Twitch panel's chat. Scrolling up in one panel to read backlog pauses auto-scroll in every panel. None of these match KickTalk's behaviour — KickTalk keys messages per chatroom (`ChatProvider.jsx:36`, `:1087-1091`), so each chatroom holds its own buffer, pause state, and moderation actions in isolation.

Users feel these as: chat that "drops messages" too quickly in multiview, multiview panels that lag together, accidental mass-clears, and pause-bleed across panels. The viewer-facing summary is "ours holds half what KickTalk holds and gets laggier the more panels I open".

## Solution

Refactor the chat store so messages are stored per channel rather than in one shared array. Each chat panel reads only its own channel's bucket, has its own cap, its own pause state, and its own moderation scope. Multiview behaves as N independent chats sharing one process. Switching channels, opening a fresh panel, or running a `/clear` only affects the targeted channel. Cap, dedupe, batching, and trim all operate within a single channel's bucket — matching KickTalk's per-chatroom design while keeping our Virtuoso-based render path.

The migration is dual-shape so the live app keeps working PR-by-PR — both the existing flat `state.messages` and the new `state.messagesByChannel` are written on every add until every consumer has been moved over.

## User Stories

1. As a multiview viewer with 4 chat panels open, I want each chat to only re-render when its own channel has a new message, so that a busy Channel A doesn't make Channel B, C, and D laggy.
2. As a multiview viewer, I want each panel to keep its own 600-message scrollback, so that a high-volume channel doesn't push other channels' history off the end.
3. As a moderator with two Twitch panels open in moderation tabs, I want `/clear` in one panel to only clear that panel's messages, so that I don't accidentally wipe a sibling panel's chat.
4. As a multiview viewer scrolling up in one chat to read backlog, I want only that panel to pause auto-scroll, so that the other panels keep streaming live.
5. As a multiview viewer, I want the larger paused buffer cap to apply only to the panel I scrolled up in, so that other panels don't waste memory pretending they're paused.
6. As a moderator using a delete-by-user mod action, I want it to scope to one channel's bucket, so that timing out a user in Channel A doesn't visually change Channel B's view of that same user's earlier messages.
7. As a user closing the last panel for a channel, I want that channel's message bucket freed from memory, so that long sessions browsing many channels don't accumulate unbounded RAM.
8. As a user opening a new panel for a channel that another panel already has open, I want to see the existing scrollback immediately, so that opening a sibling panel feels instant.
9. As a user re-opening a channel after the chat service for it has fully torn down, I want history to be fetched fresh, so that I don't see stale scrollback from minutes or hours ago.
10. As a user with two different Twitch channels open in multiview, I want each channel's messages to batch on its own 50ms timer, so that a high-volume channel doesn't delay a low-volume channel's flush (fixes a latent per-platform batching collision).
11. As a user, I want the per-channel cap to default to 600 messages (matching KickTalk's paused cap), so that scrollback feels generous out of the box.
12. As a power user, I want to dial the per-channel cap up to 1200 messages in settings, so that I can keep more history at the cost of memory.
13. As a power user on a constrained machine, I want to dial the per-channel cap down to 10 messages, so that I can minimize RAM use.
14. As a viewer in a Kick chat sending a message, I want the optimistic local echo to be replaced (not duplicated) when Pusher confirms ~150-400 ms later, so that my own message appears once with the emote-resolved version — even after the dedupe scope changes to per-channel.
15. As a developer maintaining the chat store, I want a dev-only assertion that flags when the dual-write goes out of sync, so that subtle bugs are caught locally before they ship.
16. As a developer shipping this refactor, I want each step (infrastructure, ChatMessageList migration, mod actions, cleanup) to land in its own PR, so that a regression at any step is reversible without unwinding the whole refactor.
17. As a developer reviewing the multiview-win PR, I want a measurable before/after render-count number, so that I can verify the multiview optimization actually landed and didn't regress later.
18. As a developer adding a new chat consumer, I want a single canonical builder for `channelKey`, so that I don't accidentally construct an inconsistent key (`"twitch:123"` vs `"twitch-123"` vs `"twitch_123"`) and silently miss the bucket.
19. As a user opening the chat backfill (history seed) on a fresh panel mount, I want the historical messages to land in the same per-channel bucket as live messages, so that the seam between history and live is invisible.
20. As a developer testing the per-channel store, I want the existing chat-store tests to be extended (not replaced), so that the migration adds coverage rather than swapping it.

## Implementation Decisions

The full design and all rejected alternatives are recorded in **ADR 0005 — Per-channel chat message store with dual-shape migration** (`docs/adr/0005-per-channel-chat-store.md`). Summary of what the implementation must do, not how:

**Store shape.** Add `state.messagesByChannel: Record<channelKey, ChatMessage[]>` and `state.pausedChannels: Set<channelKey>` alongside the existing `state.messages` and `state.isPaused`. `state.isPaused` becomes a derived value (`pausedChannels.size > 0`) during the migration window so unmigrated consumers keep working.

**channelKey.** Composite string `${platform}:${channelId}`. Built only via a canonical `buildChannelKey(platform, channelId)` helper — never assembled inline at call sites. This term is added to `CONTEXT.md` (already landed).

**Selector pattern for ChatMessageList.** Inline `useChatStore((s) => s.messagesByChannel[channelKey] ?? EMPTY_MESSAGES)` where `EMPTY_MESSAGES` is a module-scoped constant so empty channels share one stable empty-array reference (prevents per-update re-renders from `?? []` allocating a fresh array each time). `ChatMessageList` gains a required `channelKey: string` prop; `TwitchChat` and `KickChat` construct the key once and pass it down.

**Dual-write during migration.** Every `addMessage`, `addMessageBatched`, and `prependMessages` writes to BOTH `state.messages` (flat, in arrival order across all channels) and `state.messagesByChannel[channelKey]` (per channel). The flat array's order and dedupe behaviour are preserved exactly so unmigrated consumers see no behaviour change. Storage roughly doubles for messages-in-flight during the migration window (~1.2 MB worst case — trivial).

**Dual-write safety net.** A dev-only assertion runs after every add: `state.messages.length === sum(state.messagesByChannel[k].length for all k)`. Catches divergence at the source rather than waiting for a downstream symptom.

**Per-channel cap.** Each bucket is independently capped at `MESSAGE_LIMIT_MAX` (1200) when paused and `resolveMessageLimit()` (user pref, default 600, clamped to [10, 1200]) when active. Trim runs on the bucket only, not across buckets.

**Per-channel dedupe.** On add, scan the full target bucket (≤ 1200 entries) for the same message ID using the existing emote-richer preference (the rule that swaps the Kick optimistic local-echo for the Pusher-delivered, emote-resolved version). Cross-channel dedupe is not preserved — duplicates are scoped to a single channel by definition.

**clearMessages signature.** Becomes `clearMessages(channelKey: string)` — required arg. The two channel-switch no-arg sites (`KickChat.tsx:208`, `TwitchChat.tsx:221`) are deleted entirely (no longer needed; per-channel buckets don't bleed across channels). The mod `/clear` call sites (`KickChat.tsx:568`, `TwitchChat.tsx:559`) and the dev tool (`ChatSimTool.tsx:226`) are updated to pass a `channelKey`. Fixing those mod call sites resolves the latent multiview `/clear`-bleed bug.

**deleteMessage / deleteMessagesByUser.** Both gain a required `channelKey` arg and scope their work to one bucket.

**addMessageBatched.** The existing `channelKey` parameter is upgraded from `"kick"` / `"twitch"` (per-platform) to `buildChannelKey(platform, channelId)` (per-channel). This fixes a latent batching collision where two Twitch panels in multiview shared one 50 ms flush timer.

**Pause API.** `setPaused(channelKey: string, paused: boolean)`. The internal trim path consults `state.pausedChannels.has(channelKey)` instead of `state.isPaused`.

**Bucket eviction.** Tied to chat-service ref-counting. When `kickChatService.release()` / `twitchChatService.release()` brings the count to zero (the same point that tears down the WS connection), a new `chat-store.dropChannel(channelKey)` action is invoked from the same hook. The bucket and its pause-state entry are removed together. No separate timer, no LRU.

**Rollout — 4 PRs, in order:**

| # | What | When the win lands |
|---|---|---|
| 1 | Infrastructure: add `messagesByChannel`, `pausedChannels`, `buildChannelKey`, `dropChannel`. Dual-write in `addMessage` / `addMessageBatched` / `prependMessages`. Derive `isPaused`. No consumer changes. | Nothing visible. Safety: dev assertion guards correctness. |
| 2 | Migrate `ChatMessageList` to read from `messagesByChannel[channelKey]` and pause from `pausedChannels.has(channelKey)`. Add `channelKey` prop; pass it from `TwitchChat` + `KickChat`. | **Multiview re-render win lands.** Pausing in one panel only pauses that panel. |
| 3 | Mod actions per-channel: `clearMessages(channelKey)`, `deleteMessage(channelKey, …)`, `deleteMessagesByUser(channelKey, …)`. Update mod call sites + dev tools. | Mod `/clear` no longer bleeds across panels. |
| 4 | Wire `dropChannel` into the chat-service release-to-zero hook. Delete the flat `state.messages` and global `state.isPaused`. Remove the dev assertion (no longer two shapes to compare). | RAM stays bounded across long sessions. Final cleanup. |

## Testing Decisions

A good test for this work exercises the **chat-store seam** (Zustand actions and resulting state), not React rendering internals. Render-counting is a special case (PR 2 specifically) because the multiview re-render win is only measurable at the React layer; that test uses `useRenderCount`-style instrumentation and asserts a render-count *delta*, not absolute counts.

**Modules and tests added or extended:**

- **`chat-store` (PR 1).** Extend the existing chat-store test file (or create one if absent at `tests/store/chat-store.test.ts`). Cases:
  - `buildChannelKey(platform, channelId)` is total and idempotent.
  - `addMessage(msg)` dual-writes: the message appears in both `state.messages` (flat) and `state.messagesByChannel[channelKey]` (where `channelKey` is derived from `msg.platform` + the channel context).
  - `addMessageBatched(msg, channelKey)` shares a flush timer only with same-channelKey messages (regression for the per-platform batching collision).
  - `prependMessages(channelKey, [msgs])` lands in the right bucket only.
  - The dev-only dual-write assertion fires when the invariant is broken (simulate by mutating one shape directly in a test-only path).
  - Per-channel cap: adding 700 messages to one channel trims that channel to `resolveMessageLimit() - TRIM_BUFFER`; an untouched second channel is unaffected.
  - Per-channel dedupe with emote-richer preference: two messages with the same ID in the same channel collapse to the richer one; the same ID in different channels does NOT collapse.
  - `clearMessages(channelKey)` wipes one bucket only; the flat array loses only those entries.
  - `setPaused(channelKey, true)` updates `pausedChannels` and the `isPaused` derived value flips iff this was the first paused channel.
  - `dropChannel(channelKey)` removes the bucket and its pause entry; the flat array loses only those entries.

- **`ChatMessageList` (PR 2).** Render-count test using the existing render-count hook pattern. Mount two `ChatMessageList` instances with different `channelKey`s. Dispatch an `addMessage` to one channelKey. Assert: the targeted instance's render count increments; the sibling's does not. This is the explicit multiview-win regression.

- **Mod actions (PR 3).** Integration test at the chat-store seam: `clearMessages("twitch:A")` does not affect `state.messagesByChannel["twitch:B"]`. Same for `deleteMessage` and `deleteMessagesByUser`. The pre-refactor behaviour (where mod actions silently leaked across same-platform panels) is the bug fix being verified.

- **Eviction (PR 4).** Unit test the `dropChannel` action plus an integration test confirming that simulating a chat-service release-to-zero (mock the service ref-count callback) calls `dropChannel` with the right channelKey.

**Prior art.** The codebase already has chat-store-shaped tests under `tests/store/` or similar (locate at implementation time). Match that style; use Zustand's `useChatStore.getState()` and `setState()` pattern directly in tests rather than mounting React.

**What NOT to test:**
- React internal render reasons or Zustand subscription mechanics (those are framework, not us).
- Memoization details inside `ChatMessageList` (the render-count test asserts the observable outcome, not the mechanism).
- The exact wall-clock timing of the batch flush (the existing test pattern is "advance fake timers by N ms"; reuse it, don't measure real time).

## Out of Scope

- **LRU eviction.** Service-tied eviction is the only eviction in this PRD. LRU-with-max-N-channels is explicitly deferred — reconsider only if users complain that returning to a recently-closed channel loses scrollback.
- **Cross-channel scroll synchronization** (e.g. "scroll all panels to the same timestamp"). Different feature.
- **Persisting messages across app restarts.** This refactor stays in-memory; persistence is its own design.
- **Chat search or filtering UI.** Out of scope; PRD is about the store shape.
- **Threading `channelKey` through non-chat features** (polls, predictions, notifications, mod log dashboard). Those features stay on their existing shape; only the chat-message store is refactored.
- **Removing the dual-write before PR 4.** Don't optimise away the safety net early — its whole purpose is to guard the migration window.
- **Promoting the inline selector to a `useChannelMessages(channelKey)` hook.** Only if a second consumer appears that needs the same read; YAGNI today.
- **Changing the user-facing settings UI for the message-limit slider.** Plan A already shipped (min 10 / max 1200 / default 600 / step 10) and that range is what the per-channel cap inherits.

## Further Notes

- **Reference ADR.** All rejected alternatives and reversal-cost analysis live in `docs/adr/0005-per-channel-chat-store.md` (already written). The PRD intentionally summarises the *what*; the ADR holds the *why*.
- **Grill session notes.** Full Q&A audit trail at `.scratch/grill-with-docs/2026-06-08-per-channel-chat-store-refactor/notes.md`.
- **Relationship to Plan A.** Plan A (already shipped: default 600, max 1200, min 10, slider step 10) tuned the *user-facing cap*. Plan C makes that cap *per channel* instead of shared. The constants Plan A set are reused as-is — no further user-facing settings change.
- **KickTalk reference.** The architectural target is `reference/KickTalk-main/src/renderer/src/providers/ChatProvider.jsx` (state shape at line 36, trim logic at lines 1087-1091, selector pattern at `components/Chat/index.jsx:18`). Use it as a working example of the same shape we're building.
- **Migration safety reminders.**
  - PR 1 is invisible to users. Verify by smoke-test that chat still works on one panel and the dev assertion never fires after typical session use.
  - PR 2 is when the multiview win lands AND when the inline selector starts owning the hot path. Watch for any subtle re-render regression — the empty-array stability gotcha is the one most likely to bite.
  - PR 4 is the irreversible step (deleting the flat array). It should not ship until PR 2 and PR 3 have soaked for at least one user-facing release.
- **Out-of-PRD follow-ups to consider after PR 4 lands.**
  - Audit other Zustand stores (auth, emote, mod-log) for the same shared-array pathology if they're shaped similarly.
  - Consider whether the chat-history backfill (`prependMessages`) could move to a per-channel hook now that the store supports it cleanly.
