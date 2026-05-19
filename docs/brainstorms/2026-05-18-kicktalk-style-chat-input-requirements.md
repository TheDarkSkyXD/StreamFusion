---
date: 2026-05-18
topic: kicktalk-style-chat-input
---

# KickTalk-Style Chat Input — Two-Button Emote Picker, Multi-Mode Info Banner, Live Chat-Settings Data

## Summary

Replace StreamForge's current single-pane emote picker and `BsEmojiSmile` button design with KickTalk's two-button + per-button-dialog UI, applied uniformly to both Twitch and Kick chat inputs. Add a multi-mode info banner above the chat input that renders whichever of {followers-only, subscribers-only, slow, emote-only, account-age, Twitch unique-chat / shield} is active, with an info-icon tooltip listing every active restriction. Wire up real chat-settings data on both platforms so the banner reflects truth at channel entry and as external moderators toggle modes — closing the `TODO(U14.1)` already noted in the room-state store. Drop the explicit send button; rely on Enter-to-send, matching the screenshot.

The reference implementation lives at `../KickTalk-main/src/renderer/src/components/Chat/Input/` (`InfoBar.jsx`, `EmoteDialogs.jsx`). Visual reference: `C:\Users\Admin\Documents\ShareX\Screenshots\2026-05\electron_PmeWG3edIL.png` (Kick channel under followers-only mode).

---

## Problem Frame

StreamForge's current chat input (`apps/desktop/src/components/chat/ChatInput.tsx`) uses a single `BsEmojiSmile` button that opens one `EmotePicker` (`apps/desktop/src/components/chat/EmotePicker.tsx`) with a horizontal tab strip across all providers (Recent, Favorites, Twitch, Kick, BTTV, FFZ, 7TV). It works, but it doesn't match how Kick chat actually looks — and a meaningful slice of StreamForge's audience came from Kick. KickTalk's two-button layout, with separate dialogs that each have provider-native theming, header sub-section avatars, and collapsible Channel/Global sections with infinite-scroll, is the recognizable Kick-tab UX. Adopting it brings native-feel parity on the Kick side and lifts the Twitch side at the same time by giving third-party emote providers (BTTV / FFZ / 7TV) their own dedicated surface.

The banner gap is more concrete. When a viewer enters a follower-only or slow-mode chat today, nothing in the UI indicates the restriction until a send attempt fails. KickTalk's `InfoBar` renders the active mode as a strip above the input with a tooltip listing every active restriction. StreamForge's `room-state-store.ts` already models all five mode fields (`slowMode`, `followersOnly`, `subscribersOnly`, `emoteOnly`, plus Twitch-only `uniqueChat` / `shieldMode`) — but its docstring explicitly notes it's optimistic-only: it only updates from the local user's mod-strip actions. The store has a standing `TODO(U14.1)` to subscribe to Twitch `ROOMSTATE` for authoritative external updates, and the Kick equivalent (chatroom-info fetch on connect + chatroom WS mode events) was never wired. Building the banner without closing both gaps would mean the banner barely fires for viewers and lies for moderators who join after a peer mod toggled a mode.

---

## Requirements

**Chat input layout**

- R1. The chat input SHALL render the info banner (R10–R16) as a row above the input area, occupying the full input width, with the banner row hidden when no mode is active.
- R2. The chat input SHALL render exactly two emote buttons on the right side of the input field: a **native** button (Twitch native on Twitch channels, Kick native on Kick channels) and a **third-party** button (covering 7TV + BTTV + FFZ on Twitch; 7TV on Kick).
- R3. The chat input SHALL NOT render an explicit send button. Pressing Enter (without Shift) SHALL send; Shift+Enter SHALL insert a newline. The current `BsSend` button SHALL be removed.
- R4. The reply-preview banner (`reply` state in `ChatInput.tsx`) SHALL continue to render above the info banner when active, in its current position relative to the input. Mode banner and reply banner MAY stack.
- R5. The native button SHALL render the platform's recognizable mark — a Kick mark on Kick (KickTalk uses a rotating channel emote sampled on hover; matching that exactly is a planning decision, but a static Kick logo is acceptable). The third-party button SHALL render the 7TV mark.

**Emote dialogs — shared behavior**

- R6. Each button SHALL open its own floating dialog anchored near the button, independent from the other dialog. Opening one SHALL close the other.
- R7. Each dialog SHALL include:
  - A search input that filters only that dialog's providers.
  - A header sub-section row of icon buttons that scope the dialog body to one sub-section (KickTalk's `dialogHeadMenuItems` pattern: Channel avatar, Global globe, Personal/Emojis icon).
  - A body of collapsible sections with a caret toggle (KickTalk's `dialogBodySection` / `dialogRowHead` pattern).
  - Infinite-scroll within sections via `IntersectionObserver`, matching KickTalk's `loadMoreTrigger` pattern.
- R8. Each dialog SHALL pin a **Recent** section and a **Favorites** section above provider sections. Both sections SHALL respect the existing `useEmoteStore` recent / favorite state and SHALL continue to support the favorite-toggle interaction (current hover-star UX or its replacement is a planning decision).
- R9. Kick subscriber-only emotes SHALL render with a lock overlay when the viewer is not subscribed, matching KickTalk's `emoteItemSubscriberLock`. Clicking a locked emote SHALL be a no-op. Twitch sub emotes use a different entitlement model (emote_sets); they SHALL appear only when entitled, with no lock UI.

**Info banner — visible behavior**

- R10. The banner SHALL render when any of the following are active on the current channel: followers-only, subscribers-only, slow, emote-only, account-age (Kick only), unique-chat (Twitch only), shield-mode (Twitch only).
- R11. When followers-only is active, the banner label SHALL be `Followers Only Mode [Nm]` where `N` is the minimum follow age. Both platforms normalize to minutes in `useRoomStateStore`.
- R12. When slow mode is active, the banner label SHALL be `Slow Mode [interval]`, formatted by an existing or new equivalent of KickTalk's `convertSecondsToHumanReadable` helper.
- R13. When subscribers-only, emote-only, account-age, unique-chat, or shield-mode are active without a duration, the banner label SHALL be the bare mode name (`Subscribers Only Mode`, `Emote Only Mode`, etc.).
- R14. When multiple modes are simultaneously active, the banner label SHALL show the highest-priority single mode using KickTalk's precedence: followers → subscribers → account-age → emote-only → slow. The info-icon tooltip SHALL list every active mode as a separate row.
- R15. The banner SHALL include a right-aligned info icon. Hovering or focusing it SHALL surface a tooltip listing every currently-active mode (matching KickTalk's `chatInfoBarTooltipContent` pattern).
- R16. The banner SHALL NOT render any toggle / disable / mod-action affordance. It is a passive indicator; mod actions remain in the mod strip.

**Banner data — initial state**

- R17. On entering a Twitch channel, the app SHALL fetch the channel's chat settings via Twitch Helix `GET /chat/settings` and seed `useRoomStateStore` with the result (slow, followers, subscribers, emote-only, unique).
- R18. On entering a Kick channel, the app SHALL fetch the channel's chatroom info (the existing channel-info API surface) and seed `useRoomStateStore` with `slow_mode`, `followers_mode`, `subscribers_mode`, `emotes_mode`, `account_age` per the Kick payload.
- R19. Seed-fetch failures SHALL NOT block chat join. The banner SHALL stay hidden on failure and the failure SHALL be reported through whatever telemetry / log surface other chat-join failures already use (planning decision).
- R20. Re-entering a channel (slot navigation, reconnect) SHALL re-fetch.

**Banner data — live updates**

- R21. The Twitch chat service SHALL subscribe to IRC `ROOMSTATE` tags on every channel join and on every external mod toggle. The handler SHALL translate the `slow`, `followers-only`, `subs-only`, `emote-only`, `r9k` (unique-chat) tag values into `useRoomStateStore.updateRoomState` patches.
- R22. The Kick chat service SHALL subscribe to chatroom WS events that announce mode changes (`ChatroomUpdatedEvent` or its real equivalent — to be confirmed in planning by reading `apps/desktop/src/backend/services/chat/kick-chat.*`) and translate them into `useRoomStateStore.updateRoomState` patches.
- R23. Mod-toggle paths in the mod strip SHALL continue to optimistically update `useRoomStateStore` exactly as today. Live updates from R21 / R22 SHALL converge to the same store keys; conflicting concurrent updates are last-write-wins (consistent with the store's existing shape).
- R24. Shield-mode for Twitch SHALL update via the existing shield-mode subscription path if one exists; if not, the banner reads only optimistic state for shield-mode (acceptable scope ceiling — shield-mode is mod-initiated, so optimistic-only is honest).

**Platform asymmetries to encode honestly**

- R25. Account-age mode is Kick-only. The banner SHALL NOT attempt to render account-age on Twitch channels.
- R26. Unique-chat and shield-mode are Twitch-only. The banner SHALL NOT attempt to render them on Kick channels.
- R27. Reply-send on Kick continues to fall back to `@username` prefix (current `ChatInput.tsx` behavior). No reply-protocol changes ship with this work.

**Carry-over behavior — must not regress**

- R28. Emote autocomplete (`:` trigger) and mention autocomplete (`@` trigger) SHALL continue to work unchanged.
- R29. Slash commands (`/me`, `/clear`, `/timeout`, `/ban`, etc.) SHALL continue to work unchanged.
- R30. The character counter and over-limit styling SHALL continue to work unchanged.
- R31. Reply-preview banner and `mentionUser` imperative handle SHALL continue to work unchanged.

---

## Out of Scope

- **7TV personal emote sets.** KickTalk fetches and renders a "Personal" sub-section in its 7TV dialog header. StreamForge does not currently plumb personal sets (`grep` for `personalEmoteSets` in `apps/desktop/src` returns nothing). Adding personal-set fetching is a follow-up.
- **Per-provider sub-tabs inside the third-party dialog on Twitch.** The third-party dialog covers 7TV + BTTV + FFZ. Whether its header sub-section row distinguishes them with avatars / logos (à la KickTalk's per-provider buttons), or whether they merge into one flat search + Channel/Global split, is a planning-phase decision.
- **A new mod toggle for any mode.** The banner is read-only; toggling modes still happens from the mod strip.
- **Replacing the favorite-star hover affordance with a different favorite gesture.** Keep existing UX unless planning surfaces a better one inside KickTalk's section layout.
- **Mobile / touch layout adjustments.** StreamForge is desktop Electron; Enter-to-send and hover-tooltip are appropriate.

---

## Dependencies / Assumptions

- `useRoomStateStore` (`apps/desktop/src/store/room-state-store.ts`) is the single source of truth for mode state. The banner reads from it; both the seed fetches (R17, R18) and the live-update subscriptions (R21, R22) write to it. No new store is needed.
- KickTalk's reference component files at `../KickTalk-main/src/renderer/src/components/Chat/Input/InfoBar.jsx` and `.../EmoteDialogs.jsx` are available locally for visual + behavioral parity reference. Their license (KickTalk repo `LICENSE`) MUST be checked in planning before copying code verbatim; pattern-copying with our own implementation is the default.
- Twitch Helix `GET /chat/settings` exposes `slow_mode`, `slow_mode_wait_time`, `follower_mode`, `follower_mode_duration`, `subscriber_mode`, `emote_mode`, `unique_chat_mode`. Assumed unchanged; planning to verify against current Helix docs.
- Kick chatroom-info shape matches what KickTalk's `InfoBar.jsx` reads: `chatroomInfo.followers_mode.{enabled, min_duration}`, `subscribers_mode.enabled`, `slow_mode.{enabled, message_interval}`, `emotes_mode.enabled`, `account_age.{enabled, min_duration}`. Planning to verify the StreamForge API client exposes this surface, or add it.
- KickTalk's `useAccessibleKickEmotes` hook abstracts Kick's per-tier subscriber-only filtering. StreamForge's existing `useEmoteStore.getEmotesByProvider("kick")` may need a parallel filter layer to support R9; planning decision on whether to extend the store or layer it in the dialog component.

---

## Success Criteria

- A user joining a Kick channel that has followers-only mode active sees the banner within one render cycle of the chat WS connection report — without having toggled the mode locally.
- A user joining a Twitch channel that has emote-only and slow mode both active sees the highest-precedence banner label and, on hovering the info icon, sees both modes listed in the tooltip.
- A moderator toggling slow mode in the StreamForge mod strip continues to see immediate banner update (no regression from optimistic path).
- A moderator on a Twitch channel where a peer mod toggles followers-only externally sees the banner appear without re-entering the channel.
- Clicking the native button on a Kick channel opens a single dialog with channel-set + global + emojis sub-sections, a working search, Recent + Favorites pinned at top, infinite-scroll within long sections, and subscriber-only emote lock overlays for non-subscribers. The third-party button opens its own dialog independently.
- All existing autocomplete / commands / reply / character-counter behavior continues to work.

---

## Open Questions for /ce-plan

- Dialog positioning: anchored popover (KickTalk's pattern, opens above-and-aligned-to button) vs. input-width sheet (StreamForge's current `EmotePicker` shape)?
- Third-party dialog on Twitch: one flat 7TV+BTTV+FFZ search, or per-provider sub-section icons in the header row?
- Where exactly the Twitch `ROOMSTATE` subscription lives inside the existing twitch-chat service, and how it composes with the existing message-handling loop.
- Whether `useEmoteStore.getEmotesByProvider` is the right primitive for the new two-dialog model or whether the helpers want restructuring around `{native, thirdParty}` slices keyed by current platform.
- How the Recent + Favorites pinned sections interact with KickTalk's sub-section avatar row in the header — does selecting the Global sub-section hide Recent/Favorites, or do the pinned sections persist across sub-section selection?
- Whether to copy KickTalk SCSS class names (`emoteDialog`, `dialogBody`, `dialogBodySection`) directly into a new stylesheet or translate to Tailwind utility classes inline (current StreamForge convention).
- How the new banner row composes with `tests/components/chat/ChatInput.test.tsx` (existing test surface) — whether to add a parallel `InfoBanner.test.tsx` or extend ChatInput tests.

---

## References

- KickTalk InfoBar: `../KickTalk-main/src/renderer/src/components/Chat/Input/InfoBar.jsx`
- KickTalk EmoteDialogs: `../KickTalk-main/src/renderer/src/components/Chat/Input/EmoteDialogs.jsx`
- KickTalk human-readable helper: `../KickTalk-main/src/renderer/src/utils/ChatUtils.jsx` (`convertSecondsToHumanReadable`)
- StreamForge ChatInput today: `apps/desktop/src/components/chat/ChatInput.tsx`
- StreamForge EmotePicker today: `apps/desktop/src/components/chat/EmotePicker.tsx`
- StreamForge room-state store (banner data source): `apps/desktop/src/store/room-state-store.ts`
- StreamForge emote store: `apps/desktop/src/store/emote-store.ts`
- Screenshot reference (Kick followers-only state): `C:\Users\Admin\Documents\ShareX\Screenshots\2026-05\electron_PmeWG3edIL.png`
