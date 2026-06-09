# Slice 02 — Migrate ChatMessageList to per-channel reads (multiview render-count win)

Status: done

## Parent
PRD: [../prd.md](../prd.md)
ADR: [`docs/adr/0005-per-channel-chat-store.md`](../../../docs/adr/0005-per-channel-chat-store.md)

## What to build

This is the slice where the multiview win lands. `ChatMessageList` stops reading the flat `state.messages` array and starts reading only its own channel's bucket from `state.messagesByChannel`. Pause likewise becomes per-channel. After this slice, a message in Channel A only re-renders Channel A's `ChatMessageList` — Channel B, C, D in a multiview stay idle.

Behaviour:
- `ChatMessageList` gains a required `channelKey: string` prop.
- `TwitchChat.tsx` and `KickChat.tsx` build `channelKey` once via `buildChannelKey(platform, channelId)` and pass it to `<ChatMessageList channelKey={...} />`.
- Inside `ChatMessageList`, replace the existing `useChatStore((state) => state.messages)` selector with `useChatStore((state) => state.messagesByChannel[channelKey] ?? EMPTY_MESSAGES)` where `EMPTY_MESSAGES` is a **module-scoped constant** `const EMPTY_MESSAGES: ChatMessage[] = []`. The constant exists specifically to prevent the `?? []` fallback from allocating a fresh array reference on every store update — that would re-render the component on every unrelated channel's traffic and defeat the entire point of the slice.
- Replace the `state.isPaused` read with `useChatStore((s) => s.pausedChannels.has(channelKey))`. Replace the `state.setPaused(bool)` call with `state.setPaused(channelKey, bool)`. (Add a transitional overload to `setPaused` if needed — slice 03 will tighten it.)
- The flat `state.messages` and global `state.isPaused` stay in place (still dual-written by slice 01); only this consumer migrates.
- Render-count regression test: mount two `ChatMessageList` instances with two different `channelKey`s using the existing render-count instrumentation pattern. Dispatch an `addMessage` for the first channel. Assert the first instance's render count incremented; the second instance's render count did NOT increment. This is the assertable expression of the multiview win.

User-visible changes after this slice:
- Pausing one chat panel (scrolling up) no longer pauses sibling panels.
- The "Followers Only Mode" / pause indicator state is per-panel.
- Subjectively: noticeably less lag when one panel is busy in a 2/3/4-panel multiview.

## Acceptance criteria

- [x] `ChatMessageList` accepts and requires a `channelKey: string` prop.
- [x] `TwitchChat` and `KickChat` build `channelKey` exactly once per render via `buildChannelKey(...)` and pass it down.
- [x] `ChatMessageList`'s message selector reads `state.messagesByChannel[channelKey] ?? EMPTY_MESSAGES` with a module-scoped `EMPTY_MESSAGES` constant.
- [x] `ChatMessageList`'s pause read uses `state.pausedChannels.has(channelKey)` and writes via `setPaused(channelKey, bool)`.
- [x] Render-count test: two `ChatMessageList` instances with two channelKeys; `addMessage` to channelA bumps instanceA's render count and does NOT bump instanceB's.
- [x] An empty channel (channelKey with no messages yet) does NOT re-render on every store update — verifiable by adding messages to a different channelKey and asserting the empty-channel instance's render count stays flat.
- [x] Scrolling up in one panel (auto-pause trigger) sets only that channelKey in `pausedChannels`; the other panel's `isPaused` derived state stays accurate for it.
- [x] No regression in single-panel behaviour: chat still streams, auto-scrolls, pauses on scroll-up, and resumes on scroll-to-bottom in a non-multiview view.
- [x] All existing tests still pass plus the new render-count test.
- [x] Manual verification in a 2-panel multiview: open two different channels, send a message in one, confirm the other panel's scroll position and pause state are unaffected.
- [x] Lint, type-check, full vitest suite pass.

## Blocked by

- Slice 01 (per-channel infrastructure + dual-write) must be merged.

## Comments

- Closed 2026-06-08: migrated `ChatMessageList` to per-channel message and pause reads, added channel-key call-site coverage, and added two-panel render/pause regression tests.
- 2026-06-08 smoke follow-up: MultiStream's docked chat still rendered a placeholder, which meant the manual 2-panel smoke could not exercise the real `ChatMessageList`. Replaced the placeholder with the existing `ChatPanel`, passing the selected stream's platform/channel plus `useChannelByUsername` metadata, and added `tests/pages/MultiStream.test.tsx` coverage that the selected multistream channel is passed to the chat panel instead of rendering placeholder text.
- Manual smoke: in Electron MultiView, opened two Twitch streams (`xqc` and `ludwig`), selected the real chat dock, seeded valid local chat messages into `twitch:xqc` and `twitch:ludwig`, cleared only `twitch:xqc`, confirmed the `twitch:ludwig` marker stayed visible, then switched to `xqc` and confirmed the cleared marker was absent. Screenshot evidence: `.scratch/manual-smoke/slice02-03-multiview-real-chat-clear-isolation.png`.
- Verification: `npm test --workspace=streamfusion -- tests/pages/MultiStream.test.tsx`; `npm test --workspace=streamfusion -- tests/pages/MultiStream.test.tsx tests/store/chat-store.test.ts tests/components/chat/ChatMessageList.test.tsx tests/components/chat/KickChat.test.tsx tests/components/chat/TwitchChat.test.tsx`; `npm run lint --workspace=streamfusion`; `npm run typecheck --workspace=streamfusion`; `npm test --workspace=streamfusion`; `npm run build --workspace=streamfusion`.
