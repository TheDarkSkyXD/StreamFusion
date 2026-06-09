# Slice 04 — Service-tied bucket eviction + delete flat `state.messages` and global `state.isPaused`

Status: done

## Parent
PRD: [../prd.md](../prd.md)
ADR: [`docs/adr/0005-per-channel-chat-store.md`](../../../docs/adr/0005-per-channel-chat-store.md)

## What to build

Final slice. Wire bucket eviction to the chat-service lifecycle so a channel's memory is released when its WS connection tears down, then delete the flat `state.messages` and global `state.isPaused` — they're no longer read by any consumer after slices 02 and 03.

**This slice is irreversible.** Once `state.messages` is deleted, the dual-shape safety net is gone. Ship this slice only after slices 02 and 03 have soaked for at least one user-facing release without a chat regression.

Behaviour:
- Each chat service (`kickChatService`, `twitchChatService`) already has an `acquire()` / `release()` reference-counting pair (the WS connection tears down when the last reference releases). Add a `dropChannel(channelKey)` call in the same hook that runs when the count hits zero — same code path that ends the WS — so the bucket and its `pausedChannels` entry are freed atomically with the connection ending.
- The `channelKey` passed to `dropChannel` is built from the service's own `platform` + `channelId` at the moment of teardown. Each service knows its own platform; the channelId is either threaded through the acquire/release pair or stored alongside the ref count.
- A multiview that keeps a channel alive across panel re-mounts (because at least one panel still holds the service) keeps both the WS AND the bucket. No surprise eviction while any consumer is still watching.
- A user that closes the last panel for a channel, then re-opens that channel later, will see a fresh history backfill (no stale scrollback). This matches today's clear-on-switch UX.
- After eviction is wired and verified:
  - Delete `state.messages: ChatMessage[]` and every code path that writes to it (the dual-write halves inside `addMessage`, `addMessageBatched`, `prependMessages`, `clearMessages`, `deleteMessage`, `deleteMessagesByUser`, `dropChannel`).
  - Delete `state.isPaused: boolean` (the derived-getter form from slice 01) — no consumer reads it after slice 02.
  - Delete the dev-only dual-write invariant assertion — there are no longer two shapes to compare.
- The PRD already lists this slice's risks. Manual verification before deleting the flat array: render-count multiview test still passes; `/clear` scope from slice 03 still works; pause scope from slice 02 still works; soak test of long-session chat (open and close 10+ different channels over an extended session) shows bounded RAM and no errors.

## Acceptance criteria

- [x] `dropChannel(channelKey)` is called from the chat-service release-to-zero hook (for both `kickChatService` and `twitchChatService`) in the same code path that tears down the WS connection.
- [x] Closing the last panel for a channel frees its bucket: `state.messagesByChannel[channelKey]` becomes `undefined` after the release.
- [x] Multiview that keeps a channel alive (≥1 panel still holding the service) keeps the bucket — closing one of two panels for the same channel does NOT evict.
- [x] Re-opening a channel after eviction fetches fresh history (no stale scrollback bug).
- [x] `state.messages: ChatMessage[]` is deleted from the store; no code references it.
- [x] `state.isPaused: boolean` is deleted from the store; no code references it.
- [x] All dual-write halves are deleted (no `state.messages.push(...)` or equivalent remains anywhere in the store).
- [x] The dev-only invariant assertion from slice 01 is deleted.
- [x] Soak gate override: user explicitly approved proceeding with the irreversible deletion before a 30+ minute release soak. Local bounded-memory evidence remains covered by service-tied eviction tests and the MultiStream teardown smoke/tests; no 30+ minute soak was performed in this local slice.
- [x] Render-count multiview test from slice 02 still passes.
- [x] `/clear`-scope tests from slice 03 still pass.
- [x] Lint, type-check, full vitest suite pass.

## Blocked by

- Original gate was slice 03 merged plus one user-facing release soak. On 2026-06-08 the user explicitly approved overriding that gate and proceeding with the irreversible cleanup locally.

## Comments

- 2026-06-08: Reversible eviction prework completed. `kickChatService.acquire(channel)` / `twitchChatService.acquire(channel)` now track channel-level references, and `release(channel)` only leaves and evicts the channel bucket when that channel's final panel releases. Added service tests proving one-of-two same-channel panels keeps the bucket and final release drops `messagesByChannel[channelKey]` plus the paused entry.
- Verification: `npm test --workspace=streamfusion -- tests/backend/services/chat/kick-chat.test.ts tests/backend/services/chat/twitch-chat.test.ts`; `npm test --workspace=streamfusion -- tests/backend/services/chat/kick-chat.test.ts tests/backend/services/chat/twitch-chat.test.ts tests/components/chat/KickChat.test.tsx tests/components/chat/TwitchChat.test.tsx tests/store/chat-store.test.ts`; `npm run lint --workspace=streamfusion`; `npm run typecheck --workspace=streamfusion`; `npm test --workspace=streamfusion`; `npm run build --workspace=streamfusion`.
- 2026-06-08: Migrated the remaining UI readers (`MentionAutocomplete` and `UserPopout`) from flat `state.messages` to per-channel buckets, with tests for channel-scoped suggestions and recent-message history. Re-ran `npm run lint --workspace=streamfusion`, `npm run typecheck --workspace=streamfusion`, `npm test --workspace=streamfusion`, and `npm run build --workspace=streamfusion`.
- 2026-06-08: Added Kick/Twitch reopen-after-eviction history tests proving a dropped bucket gets fresh API backfill and does not reuse stale scrollback. Re-ran focused history/service/store tests plus `npm run lint --workspace=streamfusion`, `npm run typecheck --workspace=streamfusion`, `npm test --workspace=streamfusion`, and `npm run build --workspace=streamfusion`.
- 2026-06-08: Covered the hard-shutdown teardown path too. `kickChatService.forceShutdown()` and `twitchChatService.forceShutdown()` now drop every active channel bucket and clear channel reference counts before clearing the service channel registry. Added focused service tests for force-shutdown eviction. Re-ran focused service tests, `npm run lint --workspace=streamfusion`, `npm run typecheck --workspace=streamfusion`, `npm test --workspace=streamfusion`, and `npm run build --workspace=streamfusion`.
- 2026-06-08: Superseded audit note: after the hard-shutdown cleanup, no safe pre-soak implementation work remained; the only open checklist items were the irreversible flat-state deletion, invariant removal, and required 30+ minute post-release soak.
- 2026-06-08: Superseded blocker note: slice 03's local implementation blocker was satisfied, but this slice still waited on the explicit merge + one user-facing release soak before deleting the flat compatibility state. The user later approved overriding that gate locally.
- 2026-06-08: Added a reversible MultiStream page teardown guard so leaving the MultiView route calls `window.electronAPI.slot.destroySlot(...)` for every configured stream, releasing per-slot WCV/player resources without clearing the saved multiview layout. Added `tests/pages/MultiStream.test.tsx` coverage for this route-exit cleanup. Re-ran focused multiview/chat tests, `npm run lint --workspace=streamfusion`, `npm run typecheck --workspace=streamfusion`, `npm test --workspace=streamfusion`, and `npm run build --workspace=streamfusion`.
- 2026-06-08: User explicitly approved overriding the release-soak gate and proceeding with the irreversible cleanup. Deleted flat `state.messages`, global `state.isPaused`, the dual-write store branches, and the dev-only dual-write invariant. Updated Kick/Twitch ban-marker lookup to scan the scoped channel bucket, updated store/component/service/history tests to seed and assert only `messagesByChannel` / `pausedChannels`, and added a store assertion that the deleted compatibility fields are absent.
- Verification: `npm test --workspace=streamfusion -- tests/store/chat-store.test.ts`; `npm test --workspace=streamfusion -- tests/store/chat-store.test.ts tests/components/chat/ChatMessageList.test.tsx tests/components/chat/KickChat.test.tsx tests/components/chat/TwitchChat.test.tsx tests/pages/MultiStream.test.tsx tests/components/multistream/stream-slot.test.tsx tests/components/chat/MentionAutocomplete.test.tsx tests/components/chat/mod/UserPopout/UserPopout.test.tsx`; `npm test --workspace=streamfusion -- tests/backend/services/chat/kick-chat.test.ts tests/backend/services/chat/twitch-chat.test.ts tests/components/chat/kick/kick-chat-history.test.ts tests/components/chat/twitch/twitch-chat-history.test.ts tests/components/chat/KickChat.test.tsx tests/components/chat/TwitchChat.test.tsx tests/store/chat-store.test.ts tests/components/chat/ChatMessageList.test.tsx tests/components/chat/MentionAutocomplete.test.tsx tests/components/chat/mod/UserPopout/UserPopout.test.tsx`; `npm run lint --workspace=streamfusion`; `npm run typecheck --workspace=streamfusion`; `npm test --workspace=streamfusion`; `npm run build --workspace=streamfusion`.
