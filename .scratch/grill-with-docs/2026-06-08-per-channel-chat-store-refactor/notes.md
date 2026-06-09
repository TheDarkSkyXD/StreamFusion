# Per-channel Chat Store Refactor: Grilling Session Notes
Date: 2026-06-08 · Goal: Decide design and migration plan for refactoring `chat-store.messages: ChatMessage[]` → per-channel map so each chat panel only re-renders on its own room's traffic (matches KickTalk's `ChatProvider.jsx:36` `messages: {}` keyed by chatroomId). Multiview is the big win.

## Summary / key decisions
- **Migration strategy: dual-shape, migrate consumers one-by-one.** Add `state.messagesByChannel: Record<channelKey, ChatMessage[]>` alongside the existing `state.messages: ChatMessage[]`. Write both on add. Migrate `ChatMessageList` first (hot path → instant multiview win), then mod/log/pinned/etc. PR-by-PR. Delete `state.messages` once nothing reads it.
- **channelKey shape:** `${platform}:${channelId}` composite string via canonical `buildChannelKey()`. Also upgrades the existing per-platform batching key to per-channel (fixes a latent batching collision in multiview).
- **Selector API:** inline `useChatStore((s) => s.messagesByChannel[channelKey] ?? EMPTY_MESSAGES)` with a module-scoped EMPTY_MESSAGES constant for stable empty-array reference. ChatMessageList gains a `channelKey` prop.
- **Cap scope:** per-channel (each bucket independently capped at MESSAGE_LIMIT_MAX 1200, paused MESSAGE_LIMIT_PAUSED 1200, default 600). 4-panel multiview ≈ 1.2 MB worst-case.
- **Pause scope:** per-channel via `state.pausedChannels: Set<channelKey>`. `state.isPaused` becomes derived (`size > 0`) during the migration window.
- **clearMessages signature:** `clearMessages(channelKey)` — required arg. Fixes multiview /clear-bleed bug. Channel-switch no-arg calls deleted (no longer needed).
- **Eviction:** tie bucket lifecycle to chat-service ref-count → zero. `dropChannel(channelKey)` runs when the service tears down the WS.
- **Dedupe scope:** per-channel full bucket scan (≤ 1200 entries), same emote-richer preference logic for Kick optimistic echo.
- **Safety net:** dev-only assertion `state.messages.length === sum(state.messagesByChannel[k].length)` after every add during migration.
- **Rollout (rough cut, handed to /to-issues):** PR 1 infrastructure + dual-write; PR 2 ChatMessageList migration (multiview win lands); PR 3 mod actions per-channel (clearMessages, delete, pause); PR 4 service-tied eviction + delete flat `state.messages` and `state.isPaused`.
- **Completion update (2026-06-08):** All four local slices are done. The user explicitly approved overriding the original release-soak gate for slice 04 before deleting flat `state.messages`; no 30+ minute release soak was performed in this local run. Focused tests, lint, type-check, full vitest, and build passed after the final cleanup.

## ADR
[ADR 0005 — Per-channel chat message store with dual-shape migration](../../../docs/adr/0005-per-channel-chat-store.md)

## PRD
[prd.md](./prd.md) — local-markdown tracker per `docs/agents/issue-tracker.md`. Ready for `/to-issues` to break into 4 implementation tickets (infrastructure, ChatMessageList migration, mod actions, eviction + cleanup).

## CONTEXT.md updates
- Added `channelKey` term (composite `${platform}:${channelId}` bucket id with canonical builder; distinct from ChannelRef).

## Q&A log

### Q1 — Migration strategy
- Asked: How do we migrate from flat ChatMessage[] to per-channel map without breaking the live app?
- Captured: **Dual-shape** chosen. Both fields exist during migration; consumers move PR-by-PR; flat array deleted once unused. Doubles per-message storage during the window (accepted — messages are small, window is short).
- Doc updates: none yet (no glossary terms resolved; ADR-worthy decision but waiting for the full design before writing one ADR covering the whole refactor).
- Flags: none.

### Q2 — channelKey shape
- Asked: What shape should the channelKey take in `messagesByChannel`?
- Captured: **`${platform}:${channelId}` composite string** (e.g. `"kick:12345"`, `"twitch:71092938"`). One canonical builder `buildChannelKey(platform, channelId)`. Rejected: nested map (extra selector boilerplate), bare `channelId` (Twitch/Kick ID namespaces could collide), `Map<string, ChatMessage[]>` (poor fit with Zustand shallow-eq).
- Side effect: existing `addMessageBatched(msg, "kick"|"twitch")` calls become `addMessageBatched(msg, buildChannelKey(platform, channelId))`, upgrading the batch keyed-ness from per-platform to per-channel (intended — fixes a latent batching bug where two Twitch chats in a multiview would share one 50ms batch).
- Doc updates: `channelKey` term should be added to CONTEXT.md once the refactor lands.
- Flags: none.

### Q3 — Selector API for ChatMessageList
- Asked: How should ChatMessageList consume per-channel messages?
- Captured: **Inline selector + module-scoped `EMPTY_MESSAGES` constant.** `const messages = useChatStore((s) => s.messagesByChannel[channelKey] ?? EMPTY_MESSAGES)`. ChatMessageList gains a `channelKey: string` prop (parents TwitchChat/KickChat already know platform+channelId; they build the key once and pass it down). Promote to a `useChannelMessages(channelKey)` hook later if/when a second consumer needs the same read.
- Doc updates: none yet.
- Flags: none.

### Q4 — Cap scope across channels
- Asked: How should the message-limit cap apply when messages are stored per channel?
- Captured: **Per-channel cap.** Each channelKey buffer is independently capped at MESSAGE_LIMIT_MAX (default 600, max 1200). Matches KickTalk's per-room cap. 4-panel multiview RAM ≈ 4 × 600 × ~500B ≈ 1.2 MB — well under the original 5 GB-spike incident threshold (which was a shared-array pathology, not per-room). Trim runs independently per channel.
- Doc updates: none yet.
- Flags: none.

### Q5 — Pause scope
- Asked: Should the pause state be per-channel or stay global?
- Captured: **Per-channel pause** via `state.pausedChannels: Set<channelKey>`. Each panel pauses independently when its user scrolls up; paused trim cap applies only to the paused channel. Fixes the multiview pause-bleed bug. During the dual-shape window, `state.isPaused` becomes a derived boolean (`pausedChannels.size > 0`) so existing global-isPaused consumers (currently only ChatMessageList:41 and the trim logic in chat-store) keep working until migrated.
- Doc updates: none yet.
- Flags: none.

### Q6 — clearMessages signature
- Asked: What signature should `clearMessages` have after the refactor?
- Captured: **`clearMessages(channelKey)` — required arg.** Always per-channel. Mod `/clear` becomes `clearMessages(buildChannelKey(platform, channelId))` — fixes a latent multiview /clear-bleed bug (today, /clear in one Twitch panel wipes every Twitch panel because the underlying call passes only `platform`). Channel-switch no-arg calls (KickChat:208, TwitchChat:221) get deleted entirely — they exist only because the shared flat array bled across channels; in per-channel world the new channel just reads its own bucket. ChatSimTool can iterate channels if it wants to nuke a platform's test data.
- Doc updates: none yet.
- Flags: ChatSimTool migration (dev tool, low urgency) → owner: whoever next touches it.

### Q7 — Channel bucket eviction
- Asked: When should a channel's message bucket be freed?
- Captured: **Evict when the chat service for that channel releases.** Tie bucket lifecycle to the WS connection: when `service.release()` brings the ref count to zero (the service tears down the WS), call `dropChannel(channelKey)` to free the bucket in the same hook. Multiview that holds a channel alive across panel re-mounts keeps both the WS and the bucket. Re-visiting a channel after the service has torn down = fresh history fetch (matches today's clear-on-switch UX). Predictable, no arbitrary cap, no bookkeeping.
- Doc updates: none yet.
- Flags: need to confirm where in kickChatService / twitchChatService the release-to-zero hook lives so dropChannel attaches cleanly (likely a `onLastRelease` callback or similar).

### Q8 — Dedupe scope
- Asked: What scope should the duplicate check use after the refactor?
- Captured: **Per-channel full bucket scan.** Each add() scans the full bucket for its channelKey (≤ 1200 entries paused, ≤ 600 active). Same emote-richer preference logic that handles the Kick optimistic local echo. Slightly more correct than today's last-50 window since it catches duplicates anywhere in the channel's scrollback, and it's cheap at our cap sizes (KickTalk does this with 200-entry buffers without issue).
- Doc updates: none yet.
- Flags: none.

## Open flags (pending input)
