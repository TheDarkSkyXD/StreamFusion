---
date: 2026-05-17
topic: twitch-pinned-messages
---

# Twitch Pinned Messages — Mirror Twitch UX, Unify With Kick, Support Multistream

## Summary

Add pinned-message support to Twitch chat in StreamForge — both viewer-side display (mirroring Twitch.tv's native inset card) and a moderator surface (pin from message context menu, set duration, unpin, reply to pinned author). Introduce one shared `PinnedMessageBanner` component used by both Twitch and Kick chats so the two platforms feel consistent inside StreamForge; Kick's existing edge-to-edge banner is retrofitted to the new Twitch-faithful card. The feature works in single-stream and multistream views with per-slot isolation: each slot reflects its own channel's pin, dismiss state is per-slot, and mod controls are gated by the signed-in user's mod role on that specific channel.

---

## Problem Frame

Twitch streamers and mods routinely pin messages — drop links, brackets, charity totals, schedule notes — and that surface is invisible in StreamForge today. Users watching Twitch in StreamForge miss context that's plainly visible on twitch.tv, and mods who want to pin from inside their viewer have to swap to a browser to do it. Kick pinned messages already work in StreamForge (`kickChatService` emits `pinnedMessage` / `pinnedMessageCleared`, rendered by `KickPinnedMessageBanner` in `apps/desktop/src/components/chat/kick/KickChat.tsx`), but that banner is styled as an edge-to-edge strip with "Sent by X" labelling, which diverges from Twitch's prominent inset "Pinned by X" card. Building the Twitch feature is the right moment to unify on the better of the two designs rather than ship a second divergent banner.

Multistream is in scope from v1 because StreamForge's per-slot chat instance pattern (`apps/desktop/src/components/multistream/stream-slot.tsx`) already gives natural isolation — but pin state, dismiss state, and mod-role detection all have to actually honor that isolation rather than leaking across slots.

---

## Requirements

**Shared banner component**

- R1. A shared `PinnedMessageBanner` component SHALL be used by both `TwitchChat` and `KickChat`. Its visual style SHALL match Twitch.tv's native pinned card: inset (not edge-to-edge), ~6px border-radius, 1px subtle border, "Pinned by [username]" label on top, original-message row below (colored sender username + content), an expand/collapse chevron, and a context-dependent close control (see R7).
- R2. The shared component SHALL accept a normalized prop interface that abstracts Twitch's and Kick's slightly different pin payload shapes (Kick carries `sender` and `pinned_by` separately; Twitch's modern format carries the original message plus a `pinned_by` actor). The normalization SHALL happen at the platform-chat boundary, not inside the banner.
- R3. The banner SHALL render correctly at narrow widths down to ~280px (multistream slot floor). Long messages SHALL collapse to a single-line ellipsis in collapsed state and wrap in expanded state — never overflow the slot horizontally.

**Twitch viewer-side display**

- R4. When a Twitch channel has an active pinned message, the Twitch chat banner SHALL display it at the top of the chat area with the shared component (R1).
- R5. On chat reconnect, the banner SHALL bootstrap its state with a one-shot query for the channel's current pin (a missed real-time event must not leave the banner empty when a pin is in fact active).
- R6. The Twitch banner SHALL honor upstream pin lifecycle events: when an unpin event arrives or the pin's TTL elapses, the banner clears for everyone. No visible countdown is shown.

**Close-button semantics**

- R7. The banner's close control SHALL be role-aware:
  - For users with mod or broadcaster permissions on the current channel, the control SHALL be labelled **Unpin**, show a confirm step, and trigger a server-side unpin.
  - For non-mods, the control SHALL be labelled **Dismiss** and only hide the banner locally for the current slot/session.
- R8. Dismiss state SHALL be per-slot. Hiding the banner in one multistream slot SHALL NOT hide it in another slot — even when both slots show the same channel.

**Twitch mod surface**

- R9. Mods/streamer SHALL be able to pin a message via the chat message's hover/context-menu "Pin message" action. The action SHALL open a duration picker (see R10) before submitting.
- R10. The duration picker SHALL offer the values Twitch's native flow offers: **1h, 12h, 24h, No expiry**. The user's last-used choice MAY be the default, but defaults are not load-bearing on this slice.
- R11. The expanded banner SHALL expose a "Reply" action that drafts a reply to the pinned message's original author in the chat input. No threaded-reply infrastructure is implied.
- R12. Mod actions SHALL be visible only when the signed-in user is a mod/broadcaster on *the channel of that banner's slot* (see R20). In multistream, a user who mods slot 1 but only views slot 2 SHALL see Unpin/Pin controls in slot 1 and the viewer-only banner in slot 2.

**Pin lifecycle**

- R13. Each channel has at most one active pin at any time. A new pin event SHALL replace any prior pin in the banner without requiring a remount.
- R14. The banner SHALL NOT show countdown text or progress bars for expiry. Auto-clear at TTL is sufficient.

**Kick retrofit**

- R15. Kick's banner SHALL switch from the current edge-to-edge `border-b` strip to the shared `PinnedMessageBanner` component (R1).
- R16. Kick's existing behaviors SHALL be preserved across the retrofit: viewer local Dismiss, expand/collapse, sender + pinned-by attribution, and the per-slot dismiss isolation from R8. No new Kick mod actions are added in this slice.

**Multistream**

- R17. Each multistream chat slot SHALL display only its own channel's pin. Pin state SHALL NOT leak between slots even if multiple slots show the same channel.
- R18. The banner SHALL pass narrow-width verification at multistream slot dimensions via a Playwright screenshot before the work is declared done (see Success Criteria).
- R19. Multistream slots showing channels the user does not mod SHALL hide all Twitch mod controls in that slot regardless of mod status on a different slot.

**Mod-role detection**

- R20. The app SHALL know which Twitch channels the signed-in user mods, in order to gate the controls described in R7, R9, R11, R12, and R19. If this data is not already cached, the brainstorm requires adding a cached lookup (e.g. Helix `GET /moderation/channels` or equivalent). The cache lifetime and refresh policy are a planning-time decision.

**Dev tooling**

- R21. `apps/desktop/src/components/dev/ChatSimTool.tsx` SHALL gain a "Twitch-only" section with at minimum "pin message" and "clear pin" buttons, parallel to the existing Kick buttons. The simulator SHALL inject a synthetic Twitch pin/unpin event through the same code path real Twitch pin events use.
- R22. The simulator SHALL target only the currently active chat slot when a multistream view is mounted. If the existing emission pattern broadcasts to all slots of the same platform, the simulator (not production code) SHALL be scoped to the active slot before this work ships.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R15.** Given a Twitch stream with an active pinned message AND a Kick stream with an active pinned message open in two windows, when the user inspects both banners, then both render with the same shared component: inset 6px card, "Pinned by X" label on top, identical typography and spacing. Platform-specific data (Twitch vs Kick sender colors, badges) flows through unchanged.
- AE2. **Covers R5.** Given a Twitch channel where a pin was set 10 minutes before the user opened the stream, when the user first navigates to that channel, then the banner appears populated within a reasonable load window — without waiting for the next live pin event.
- AE3. **Covers R7.** Given the signed-in user is a moderator on the open Twitch channel, when they click the banner's close control, then a confirm step appears and confirming triggers a real server-side unpin that clears the banner for all viewers. A non-mod in the same channel sees the same banner but a "Dismiss" control that only hides their local view.
- AE4. **Covers R8, R17.** Given a multistream view with the same Twitch channel in slot 1 and slot 2, when the user clicks Dismiss in slot 1, then the banner hides in slot 1 only; slot 2's banner remains visible.
- AE5. **Covers R9, R10.** Given the signed-in user is a moderator on a Twitch channel, when they right-click a chat message and choose "Pin message", then a duration picker offers 1h / 12h / 24h / No expiry; selecting one submits the pin and the banner appears at the top of chat with that message.
- AE6. **Covers R12, R19.** Given a multistream layout with channel A (user is mod) in slot 1 and channel B (user is viewer) in slot 2, when the user inspects message hover actions in each, then slot 1's messages expose "Pin message" while slot 2's do not; slot 1's banner exposes Unpin while slot 2's exposes Dismiss.
- AE7. **Covers R13.** Given an active pinned message is showing, when a new pin event arrives for the same channel, then the banner content updates in place to the new pin without a remount flash.
- AE8. **Covers R3, R18.** Given a multistream slot resized to ~280px width with a long-text pin, when the banner is in collapsed state, then the message truncates to one line with ellipsis and the controls remain visible without horizontal overflow.
- AE9. **Covers R21.** Given the dev panel is open on a Twitch chat in single-stream view, when the user clicks the Twitch "pin message" sim button, then a synthetic pin renders in the banner via the same render path as real Twitch pins.

---

## Success Criteria

- A viewer watching Twitch in StreamForge sees the same pinned message they would see on twitch.tv, with visually equivalent styling, and the banner clears on its own when the pin is unpinned or expires.
- A signed-in moderator can pin and unpin Twitch messages without leaving StreamForge, including choosing a duration that matches Twitch's native choices.
- Both Twitch and Kick chats render their pin banners with the same shared component; visually they are the same card.
- In multistream, a banner in one slot never affects a banner in another slot, mod controls appear only in slots where the user is actually a mod, and the banner is verified to lay out cleanly at ~280px width via Playwright screenshot.
- The dev simulator can drive Twitch pin/unpin states through the same render path as production events.
- A downstream implementing agent can plan against this doc without re-deciding scope, surface boundaries, role behaviors, or platform retrofit policy.

---

## Scope Boundaries

- No editing of an existing pin (Twitch itself effectively requires unpin + repin; we follow suit).
- No Kick moderator surface — Kick remains view-only. The Kick retrofit is visual-only and behavior-preserving.
- No visible TTL countdown, progress bar, or "expires in N minutes" chip on the banner.
- No new chat-message reply / threading infrastructure beyond drafting an `@username` prefix into the input (R11).
- No telemetry or analytics for pin/unpin actions in this slice.
- No retroactive backfill of pre-existing pins beyond R5's bootstrap-on-mount query — old pins not surfaced via that query are not reconstructed from chat history.

---

## Open Questions & Assumptions

- **Pin data source (unverified)**: Twitch publishes pin events via IRC `PRIVMSG`/`USERNOTICE` tags and/or chat GraphQL pubsub. The right primary source for receiving real-time pin events SHALL be verified in planning; GQL polling is the documented fallback if neither real-time path is reliable, with poll-cost scoped explicitly at that point.
- **Bootstrap-on-mount endpoint (unverified)**: R5 assumes a one-shot lookup for the channel's current pin exists or is buildable via Twitch GQL. Planning SHALL confirm the exact operation.
- **Mod auth scope**: pin/unpin requires `channel:moderate` on IRC or `moderator:manage:chat_messages` on Helix/EventSub. Current OAuth flow may need scope expansion; an expansion would prompt re-consent for already-connected accounts and SHALL be flagged in planning.
- **Mod-channels cache (R20)**: existence and shape of any current cache of which channels the signed-in user mods is unverified. Adding one is in scope if absent.
- **Dev simulator emission scope (R22)**: whether `kickChatService.emit(...)` and the to-be-added Twitch equivalent broadcast to every mounted slot or only the active one is unverified. The simulator SHALL be made slot-scoped if it isn't already; production code is unaffected.
- **Default duration**: R10 declines to specify a default. Planning MAY pick one ("1h" or "last-used"); this is intentionally left open.

---

## Dependencies

- Existing Twitch IRC plumbing (`apps/desktop/src/backend/services/chat/twitch-chat.ts`, `twitch-irc-parser.ts`, `twitch-parser.ts`) for receiving pin-related IRC events.
- Existing Twitch GraphQL client (`apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts`) for any bootstrap query and any unauth/auth fallbacks.
- Auth + OAuth scope plumbing (`apps/desktop/src/components/auth/AuthProvider.tsx`, `apps/desktop/src/backend/auth/token-exchange.ts`) — possibly modified to request additional mod scopes.
- Chat store and shared chat types (`apps/desktop/src/store/chat-store.ts`, `apps/desktop/src/shared/chat-types.ts`) for adding any normalized Twitch pin types and per-slot state.
- Existing Kick banner code (`KickPinnedMessageBanner` inside `apps/desktop/src/components/chat/kick/KickChat.tsx`) — to be deleted as part of the retrofit, with its behaviors absorbed into the shared component.
- Dev simulator (`apps/desktop/src/components/dev/ChatSimTool.tsx`) for R21–R22.
- Multistream slot container (`apps/desktop/src/components/multistream/stream-slot.tsx`) for verifying per-slot isolation behaviors.

---

## References

- Twitch native pinned-message UI captured via Playwright on https://www.twitch.tv/fitzbro (2026-05-17):
  - Outer wrapper class `pinned-chat__highlight-card` (with `__collapsed` variant)
  - Inner highlight box: 1px solid `rgba(83, 83, 95, 0.48)` border, 6px radius, 8px padding
  - "Pinned by [user]" label: 14px, weight 400
  - Message body: 18px, weight 500, line-height ~1.3
  - Controls: single Expand chevron (no viewer dismiss); mod surface is in the message context menu, not on the banner
- Existing Kick banner reference: `apps/desktop/src/components/chat/kick/KickChat.tsx` lines 510–579 (`KickPinnedMessageBanner`).
- Existing Kick pin event pipeline: `kickChatService` `pinnedMessage` / `pinnedMessageCleared` events, `KickPinnedMessage` type in `apps/desktop/src/shared/chat-types.ts`.
- Existing dev simulator: `apps/desktop/src/components/dev/ChatSimTool.tsx`, Kick-only section (current pin/clear-pin buttons gated on `platform === "kick"`).
- Related project memory: `feedback_electron_mcp_eval.md`, `feedback_electron_mcp_eval_pitfalls.md` (for any Playwright/electron-mcp eval probes done during planning or implementation verification).
