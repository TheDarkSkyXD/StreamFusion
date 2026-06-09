# Slice 01 — Per-channel chat store: infrastructure + dual-write

Status: done

## Parent
PRD: [../prd.md](../prd.md)
ADR: [`docs/adr/0005-per-channel-chat-store.md`](../../../docs/adr/0005-per-channel-chat-store.md)

## What to build

Introduce the per-channel storage shape inside `chat-store` without touching any consumer. The store grows two new fields and a canonical key builder; every existing `addMessage` / `addMessageBatched` / `prependMessages` path dual-writes to both the old flat array AND the new per-channel map. The flat `state.messages` array keeps its arrival-order semantics exactly so unmigrated consumers (which is all of them in this slice) see zero behaviour change.

This slice is invisible to the user. Its purpose is to land the foundational data structures and the dual-write discipline so subsequent slices can migrate consumers one at a time.

Behaviour:
- New state field: `messagesByChannel: Record<channelKey, ChatMessage[]>`. Empty record on init.
- New state field: `pausedChannels: Set<channelKey>`. Empty set on init. The existing `state.isPaused` becomes a derived value (`pausedChannels.size > 0`) so unmigrated readers stay correct.
- New helper: `buildChannelKey(platform, channelId)` returning the composite string `${platform}:${channelId}`. This is the ONLY way to construct the key — both internal store code and call sites in later slices must use it. Term added to `CONTEXT.md` (already landed via the grill session).
- New action: `dropChannel(channelKey)` removes the bucket and its `pausedChannels` entry. Also removes the dropped channel's messages from the flat `state.messages` during the dual-shape window so the invariant assertion (below) holds. Not wired into the chat-service yet (slice 04).
- `addMessage(msg)` writes to BOTH `state.messages` (existing append-with-trim-and-dedupe behaviour preserved exactly) AND `state.messagesByChannel[buildChannelKey(msg.platform, msg.channelId)]` (per-channel append with the same trim and dedupe semantics applied to that bucket).
- `addMessageBatched(msg, channelKey)` — same dual-write. The `channelKey` parameter is upgraded from the current per-platform shape (`"kick"` / `"twitch"`) to the per-channel shape (`buildChannelKey(...)`). All call sites in `KickChat.tsx:521` and `TwitchChat.tsx:512` and `PerfTool.tsx:83` are updated to pass the per-channel key. (This upgrade is the fix for the latent batching collision described in PRD user story #10 — two Twitch panels in multiview previously shared one 50 ms flush timer because both keyed on `"twitch"`.)
- `prependMessages(channelKey, msgs)` — gains a required `channelKey` arg and dual-writes per channel. Call sites in `twitch-chat-history.ts` and `kick-chat-history.ts` updated to pass `buildChannelKey(...)`.
- Per-channel cap and pause: the trim path inside `addMessage` / `addMessageBatched` consults `state.pausedChannels.has(channelKey)` to choose between `MESSAGE_LIMIT_PAUSED` (1200) and `resolveMessageLimit()` (default 600), then trims the bucket independently. The flat-array trim keeps its existing global-cap behaviour.
- Per-channel dedupe: the new bucket's dedupe scans the full bucket (≤ 1200 entries) using the existing emote-richer preference rule (the rule that handles the Kick optimistic local echo).
- Dev-only invariant assertion: after every add path, in DEV builds only, assert `state.messages.length === sum(state.messagesByChannel[k].length for all k)`. Throws (or `console.error`s) on divergence with the channelKey + counts so a regression is caught at its source rather than via a downstream symptom.
- No change to `clearMessages`, `deleteMessage`, `deleteMessagesByUser`, or `setPaused` in this slice — those move in slice 03.
- No change to `ChatMessageList` or any other consumer in this slice — that's slice 02.

## Acceptance criteria

- [x] `state.messagesByChannel` exists and is initialised empty.
- [x] `state.pausedChannels` exists and is initialised empty; `state.isPaused` resolves as the derived boolean `pausedChannels.size > 0`.
- [x] `buildChannelKey(platform, channelId)` is exported from `chat-store` and used everywhere a channelKey is constructed inside the store.
- [x] Every code path that mutates `state.messages` also mutates `state.messagesByChannel[channelKey]` (addMessage, addMessageBatched, prependMessages, dropChannel).
- [x] `addMessageBatched` flush timer is keyed per channel (not per platform); two different channels on the same platform have independent flush timers.
- [x] `prependMessages` requires a `channelKey` argument; both call sites in `twitch-chat-history.ts` and `kick-chat-history.ts` build the key via `buildChannelKey(...)` and pass it.
- [x] Per-channel cap trims each bucket independently to `MESSAGE_LIMIT_MAX` (or `MESSAGE_LIMIT_PAUSED` if that channel is in `pausedChannels`), with the existing `TRIM_BUFFER` hysteresis.
- [x] Per-channel dedupe applies the existing emote-richer preference rule within a single bucket only.
- [x] DEV-only assertion fires when `state.messages.length !== sum(state.messagesByChannel[k].length)` and never fires under normal use.
- [x] No consumer changes outside the store and its existing direct call sites (no edits to `ChatMessageList`, no edits to mod-action call sites, no UI changes).
- [x] Existing chat-store tests still pass. New tests cover: `buildChannelKey` totality; dual-write correctness on add / batched-add / prepend; per-channel cap (700 msgs into one channel trims that channel and leaves a second channel untouched); per-channel dedupe (same id in two channels does NOT collapse); the invariant assertion fires when manually mutating one shape only.
- [x] Lint, type-check, and the full vitest suite pass.

## Blocked by

None — can start immediately.

## Comments

- Closed 2026-06-08: implemented per-channel chat-store infrastructure and dual-write paths; verified lint, typecheck, full vitest suite, and build pass.
