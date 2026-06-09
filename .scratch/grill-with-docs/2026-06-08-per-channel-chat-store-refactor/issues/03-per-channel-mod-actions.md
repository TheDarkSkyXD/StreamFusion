# Slice 03 — Per-channel mod actions: clearMessages / deleteMessage / deleteMessagesByUser

Status: done

## Parent
PRD: [../prd.md](../prd.md)
ADR: [`docs/adr/0005-per-channel-chat-store.md`](../../../docs/adr/0005-per-channel-chat-store.md)

## What to build

Move every moderation action and the channel-switch lifecycle to per-channel scope. After this slice, a Twitch `/clear` in one panel wipes only that panel's chat — fixing a latent multiview bug where `clearMessages(platform)` previously wiped every same-platform panel's chat. Delete and ban actions likewise scope to one channel's bucket. The redundant channel-switch `clearMessages()` calls that exist only as workarounds for the shared flat array are removed.

Behaviour:
- `clearMessages` signature becomes `clearMessages(channelKey: string)` — required arg. No optional, no overload. The action removes the bucket entry from `messagesByChannel` AND removes those same messages from the flat `state.messages` (dual-write maintained).
- `deleteMessage(channelKey, messageId)` — gains a required `channelKey` arg. Marks the message as deleted in BOTH the per-channel bucket and the flat array.
- `deleteMessagesByUser(channelKey, userId)` — gains a required `channelKey` arg. Scopes the per-user delete to one bucket and the matching messages in the flat array.
- `setPaused(channelKey, paused)` — required `channelKey` arg (tightening the transitional signature introduced in slice 02). Updates `state.pausedChannels`; the derived `state.isPaused` reflects `pausedChannels.size > 0`.
- Call sites updated:
  - `KickChat.tsx:568` (mod `/clear` from Kick): pass `buildChannelKey("kick", channelId)`.
  - `TwitchChat.tsx:559` (mod `/clear` from Twitch): pass `buildChannelKey("twitch", channelId)`.
  - `KickChat.tsx:208` and `TwitchChat.tsx:221` (channel-switch `clearMessages()` no-arg): **delete the call entirely.** These exist only because the shared flat array bled across channels; with per-channel buckets, switching to a different channel just reads a different bucket — no clear needed.
  - `KickChat.tsx:1012` (other no-arg call): audit and either delete (if it's another switch-workaround) or convert to the new per-channel form (if it's a real intent to wipe the current channel).
  - `ChatSimTool.tsx:226` (dev tool, currently passes `platform`): convert to iterate channels for that platform if "nuke all test data for this platform" is still desired, OR scope to one channel under test — whichever matches the tool's actual use.
- Mod-action call sites in the existing `KickChat.tsx` / `TwitchChat.tsx` for delete/ban/timeout (which currently call `deleteMessage(id)` and `deleteMessagesByUser(userId)`) updated to pass the channelKey built from the panel's `platform` + `channelId`.

User-visible changes after this slice:
- Running a mod `/clear` in one Twitch panel does NOT clear other Twitch panels' chat.
- Timing out a user in one channel does NOT visually delete that user's messages in another channel's history.
- Switching channels in a single panel still presents fresh chat (now via the bucket switch, no longer via a destructive `clearMessages()` call).

## Acceptance criteria

- [x] `clearMessages` requires `channelKey` — no optional argument, no overload.
- [x] `deleteMessage` requires `channelKey`.
- [x] `deleteMessagesByUser` requires `channelKey`.
- [x] `setPaused` requires `channelKey` (transitional overload from slice 02 removed).
- [x] No call site to `clearMessages()` / `deleteMessage()` / `deleteMessagesByUser()` / `setPaused()` exists without a channelKey.
- [x] Channel-switch `clearMessages()` calls at `KickChat.tsx:208` and `TwitchChat.tsx:221` are deleted; manual smoke test confirms switching channels still shows the new channel's chat (loaded from its bucket or fresh history backfill).
- [x] Mod `/clear` in one Twitch panel wipes only that panel — verifiable by opening two Twitch panels in multiview, running `/clear` in panel A, confirming panel B's messages are intact.
- [x] Per-user delete in one channel does not visually remove the same user's messages from another channel's bucket.
- [x] Dual-write invariant assertion (from slice 01) still holds after every mod action — the per-channel bucket and the flat array stay in sync.
- [x] New tests at the chat-store seam: `clearMessages("twitch:A")` does not affect `messagesByChannel["twitch:B"]`; same for `deleteMessage` and `deleteMessagesByUser`. Tests cover the previously-broken multiview-bleed case.
- [x] Lint, type-check, full vitest suite pass.

## Blocked by

None remaining. Slice 02 (ChatMessageList migrated to per-channel reads) is `done` in the local tracker, so this prerequisite is satisfied for slice 03.

## Comments

- 2026-06-08: Completed slice 03. `clearMessages`, `deleteMessage`, `deleteMessagesByUser`, and `setPaused` now require a `channelKey`; source call sites pass per-panel keys; channel-switch clear workarounds were removed. Added store coverage for per-channel clear/delete/user-delete bleed cases and fixed the paused-bucket trim path so the flat compatibility array cannot retain messages trimmed from the bucket.
- Verification: `npm test --workspace=streamfusion -- tests/store/chat-store.test.ts tests/components/chat/KickChat.test.tsx tests/components/chat/TwitchChat.test.tsx tests/components/chat/ChatMessageList.test.tsx`; `npm run lint --workspace=streamfusion`; `npm run typecheck --workspace=streamfusion`; `npm test --workspace=streamfusion`; `npm run build --workspace=streamfusion`.
- Electron multiview smoke was run via CDP against an existing StreamFusion dev instance on port 9236. Added two Twitch streams (`xqc` and `ludwig`) in MultiView and initially found the side chat was a placeholder rather than the real `ChatMessageList` / moderation surface.
- 2026-06-08 smoke follow-up: replaced the MultiStream placeholder with the existing `ChatPanel`, selected `ludwig`, seeded valid local messages into `twitch:xqc` and `twitch:ludwig`, cleared only `twitch:xqc`, confirmed the `twitch:ludwig` marker stayed visible, switched to `xqc`, and confirmed the cleared marker was absent. Screenshot evidence: `.scratch/manual-smoke/slice02-03-multiview-real-chat-clear-isolation.png`. This verifies the real MultiView chat path and the same per-channel clear isolation covered by the store tests without posting a live `/clear` command into Twitch.
- 2026-06-08: Re-audited slice 03 instead of treating the `done` status as proof. Slice 02 is `done`, so this issue's blocker is satisfied in the local issue tracker. Current source search shows no legacy no-arg `clearMessages()` / `deleteMessage()` / `deleteMessagesByUser()` / `setPaused()` production call sites; remaining calls pass channel keys. Re-ran the focused slice 03 verification set: `npm test --workspace=streamfusion -- tests/store/chat-store.test.ts tests/components/chat/KickChat.test.tsx tests/components/chat/TwitchChat.test.tsx tests/components/chat/ChatMessageList.test.tsx` (73 tests passed).
- 2026-06-08: Re-ran full gates after the smoke follow-up: `npm run lint --workspace=streamfusion`, `npm run typecheck --workspace=streamfusion`, `npm test --workspace=streamfusion`, and `npm run build --workspace=streamfusion`.
