---
date: 2026-05-18
topic: channel-management-console
---

# Channel-Management Console — Multi-Surface Moderation + Broadcaster Tools

## Summary

A unified channel-management console layered onto StreamForge that serves both **moderators** and **broadcasters** across five surfaces: a per-message hover toolbar (Timeout / Ban / Unban / Delete), an inline strip above the chat tabs for channel-mode toggles and one-shot actions, a username-click user popout with profile + per-user mod history + quick actions, chat-panel tabs (Chat / AutoMod / Mod log + Engagement on Twitch when broadcaster), and a `/mod` top-level route for per-channel mod settings and cross-channel banned-user search. Kick gets a from-scratch AutoMod implementation (keyword + 4-severity-tier filters) because Kick has no native AutoMod system. Persistent state (mod log, AutoMod config, allow-lists, Streamlabs tokens) extends the existing local SQLite layer (`apps/desktop/src/backend/services/database-service.ts`) fed by Twitch EventSub + Helix. Giveaways ship as an in-house keyword-based picker (both platforms) plus an optional Streamlabs OAuth integration; StreamElements is explicitly excluded since the service is winding down in 2026.

---

## Problem Frame

Today, every moderation or broadcaster-engagement action a StreamForge user wants to take requires leaving the app: opening twitch.tv or kick.com in a browser, finding the message or user, and acting there. The friction is highest at the moments mods are most needed — during a raid, a hate spike, a backseat-modding incident, or a giveaway closeout. The existing pinned-message work (`apps/desktop/src/components/chat/PinnedMessageBanner.tsx`) and the dev-panel mod-action overrides established that the app can host mod-tier UI and the OAuth/scope plumbing works — but the user-facing surface stops at pin/unpin. There is no way to timeout, ban, delete, raid, run a poll, manage AutoMod, or even see who a chatter is, all of which mods and broadcasters do dozens of times per stream.

Broadcasters who self-mod are a particular pain case: they need both moderation reach (ban, timeout, AutoMod) and broadcaster reach (predictions, polls, giveaways, raids), and today have to keep two browser tabs open beside StreamForge to do their job. The app's identity-shift from "viewer/chat client" to "channel-management console" recognizes that the same human is wearing both hats simultaneously and serves both with one console.

---

## Actors

- A1. **Moderator** — a StreamForge user signed in to a Twitch or Kick account that has moderator role on at least one channel they are currently viewing. Primary user of Timeout/Ban/Unban/Delete, AutoMod review, mod log, user popout, and chat-mode toggles.
- A2. **Broadcaster** — a StreamForge user viewing their own channel. Inherits all Moderator capabilities (A1) plus broadcaster-only actions: `/raid`, `/commercial`, Shield mode, add/remove mod + VIP, Engagement tab (Predictions, Polls, Giveaways).
- A3. **Viewer** — any other signed-in (or guest) user. Read-only for everything in this brainstorm; named here only so requirements can explicitly hide mod surfaces from them.
- A4. **Held-message author** — a chatter whose message AutoMod intercepted. Indirect actor; their message appears in the Twitch AutoMod queue or the Kick custom AutoMod queue awaiting review.

---

## Key Flows

- F1. **Quick timeout from chat**
  - **Trigger:** A1/A2 hovers a chat message and clicks the hourglass icon in the per-message toolbar.
  - **Actors:** A1 or A2
  - **Steps:** Hover reveals the toolbar → click hourglass → confirm dialog opens with 6 preset duration chips (10s / 1m / 10m / 30m / 24h / 7d) and a Cancel / Timeout button pair → click duration → click Timeout → mutation fires → toast confirms success.
  - **Outcome:** Target user is timed out on the upstream platform; the existing `ban` system-message in chat reflects the action; mod log records the entry.
  - **Covered by:** R1, R3, R4, R5, R55

- F2. **Approve a held AutoMod message**
  - **Trigger:** AutoMod holds a Twitch chat message; sonner toast + tab badge + OS notification fire (if enabled).
  - **Actors:** A1 or A2
  - **Steps:** Mod switches to AutoMod tab → sees the held message with author, hold reason, full text → clicks one of: Approve, Deny, Allow+allow-list user, Approve-and-timeout (opens timeout duration picker first).
  - **Outcome:** Message is released to chat or denied; allow-list updated if applicable; mod log records the action.
  - **Covered by:** R21, R22, R23, R27, R28, R29, R31

- F3. **Open user popout and act**
  - **Trigger:** A1/A2 clicks a username anywhere in chat.
  - **Actors:** A1 or A2
  - **Steps:** Centered modal opens → shows profile basics (avatar, display name, account age, follower-since), channel roles + badges, recent messages from this user in this channel, per-user mod history → mod clicks a quick-action button (Timeout/Ban/Unban/Delete-last-msg, mod/VIP promote-demote for broadcaster, Whisper on Twitch, open external profile).
  - **Outcome:** Action fires through the same mutation paths as the hover toolbar; popout stays open for follow-up actions.
  - **Covered by:** R14, R15, R16, R17, R18, R19, R20

- F4. **Start a prediction (broadcaster)**
  - **Trigger:** Broadcaster on their own Twitch channel opens the Engagement tab.
  - **Actors:** A2
  - **Steps:** Tab shows current active prediction (if any) or a "Create prediction" button → broadcaster fills in title and 2-10 outcome labels → sets prediction window (1s-1800s) → clicks Start → prediction is live; broadcaster can Lock or Cancel during the window; after the window closes, broadcaster picks a winning outcome → channel-points payout fires on Twitch.
  - **Outcome:** Active prediction lifecycle managed entirely inside StreamForge for the broadcaster's own channel.
  - **Covered by:** R37, R38, R39, R44

- F5. **Run an in-house giveaway**
  - **Trigger:** A1/A2 opens Engagement tab → Giveaways section.
  - **Actors:** A1 or A2 (broadcaster or mod)
  - **Steps:** Enters keyword (default `!enter`) + duration + (optional) eligibility filters (followers-only, subs-only, min-account-age) → clicks Start → app sends keyword instructions to chat → app listens for matching messages and records eligible entries → on countdown end, app picks N random winners and posts the announcement in chat. Mod can re-roll if a winner is offline.
  - **Outcome:** Random winners selected client-side; chat announcement made; entry list retained until reset.
  - **Covered by:** R40, R41, R42, R43

- F6. **First action requires a missing OAuth scope**
  - **Trigger:** A1/A2 clicks any mod or broadcaster action whose required scope is not currently in their access token (e.g., Ban requires `moderator:manage:banned_users`).
  - **Actors:** A1 or A2
  - **Steps:** Mutation returns 401/403 with missing-scope kind → existing `ReconnectForModDialog` opens with a list of all missing scopes needed for the actions visible in the current console → user clicks Reconnect → OAuth re-consent flow runs → token refreshes with new scopes → original action retried automatically.
  - **Outcome:** User regains the consented capability; no other actions need to re-prompt unless an additional new scope is requested later.
  - **Covered by:** R49, R50, R51, R52

---

## Requirements

**Per-message hover toolbar (all platforms)**

- R1. The toolbar SHALL render in the top-right of every chat message on hover, alongside the existing Pin button. Buttons SHALL be: Timeout (hourglass), Ban (gavel), Unban (circle-slash), Delete (trash).
- R2. The toolbar SHALL be gated by `useIsTwitchMod` / `useIsKickMod`. Non-mods SHALL NOT see any button in the toolbar (only their existing Reply button on Kick remains).
- R3. The toolbar SHALL be hidden on messages sent by the channel broadcaster, by other moderators (any user carrying a moderator badge in the current channel), and by Twitch staff / admin / global-mod badge holders. The toolbar SHALL be visible on the signed-in user's own messages.
- R4. Clicking any toolbar button SHALL open a confirm dialog reusing the visual pattern of the existing pin-message dialog (modal with a preview of the message + Cancel / primary-action button pair). No action SHALL fire on a single click of the toolbar icon.
- R5. The Timeout dialog SHALL present six preset duration chips: 10s, 1m, 10m, 30m, 24h, 7d. No slider or custom-duration input. The user picks a chip and clicks the primary "Timeout" button.
- R6. The Unban button SHALL always render in the toolbar (no banned-state tracking). Clicking it fires the unban mutation; the platform's "user is not banned" response SHALL be swallowed silently or surfaced as a soft toast at most.

**Inline strip above chat tabs**

- R7. A thin horizontal strip SHALL sit directly above the chat-panel tabs and SHALL be visible only to moderators (A1) and broadcasters (A2) for the current channel.
- R8. The strip SHALL contain four chat-mode toggles for both platforms: slow-mode (with a duration picker on activation), followers-only (with a min-age picker on activation), subscribers-only, emote-only. Toggle state SHALL reflect the live channel state from the chat connection's room-state.
- R9. The strip SHALL contain four one-shot action icons: chat-wide `/clear`, `/raid` (broadcaster-only, opens target picker), Unique-chat / r9kbeta (Twitch-only), Run commercial (Twitch broadcaster-only, partner/affiliate gated).
- R10. The strip SHALL contain a Shield-mode toggle on Twitch only (broadcaster + selected mods scoped via `moderator:manage:shield_mode`). On Kick the Shield icon SHALL be absent.
- R11. Every destructive action triggered from the strip (`/clear`, `/raid`, `/commercial`, Shield activation) SHALL open a confirm dialog before firing. Toggle activations (slow / followers / subs / emote / Shield) confirm via the duration/min-age picker itself; their deactivations fire without a separate confirm.
- R12. The `/raid` action SHALL open a target-channel picker (typeahead search across the user's follows + recent raids) before issuing the raid.
- R13. Strip icons SHALL render in a consistent visual language with the per-message toolbar (same icon size, same tooltip pattern, same hover state). Tooltips SHALL name each action plainly.

**Username-click user popout**

- R14. Clicking a username anywhere in chat (in a live message, in the AutoMod queue, in the mod log, in the user popout's own "recent messages") SHALL open the user popout as a centered modal overlay.
- R15. The popout SHALL display: avatar, display name, account creation date, follower-since date for the current channel; subscriber tier + months subbed, founder, VIP, mod-role badges; the last 5-10 messages from this user in the current channel session with timestamps; and per-user mod history (timeouts, bans, deletes, warnings) recorded in the local mod log for this channel.
- R16. The popout footer SHALL contain quick-action buttons: Timeout, Ban, Unban, Delete-last-message (mirroring the hover toolbar) — gated by the same mod-role check as the toolbar. Each opens the same confirm-dialog flow.
- R17. The popout SHALL contain Add/remove moderator and Add/remove VIP buttons, visible only when the signed-in user is the broadcaster (A2) of the current channel.
- R18. The popout SHALL contain a Whisper button on Twitch only (Kick has no public whisper API). Whisper opens an existing or new whisper thread.
- R19. The popout SHALL contain an "Open external profile" button that opens `twitch.tv/<user>` or `kick.com/<user>` via `window.electronAPI.openExternal`.
- R20. The popout SHALL remain open after an action fires, so a mod can take multiple actions against the same user without re-opening (timeout → delete-last-message → ban, etc.).

**Chat-panel tabs**

- R21. The chat panel SHALL render three tabs on both platforms: **Chat**, **AutoMod**, **Mod log**. Chat is the default and matches the current chat-panel behavior unchanged for non-mods.
- R22. The AutoMod and Mod log tabs SHALL be visible only to moderators (A1) and broadcasters (A2). Non-mods SHALL see only the Chat tab (no tab strip at all if there's only one tab).
- R23. On Twitch broadcaster sessions, a fourth tab **Engagement** SHALL render alongside the three above. Engagement is hidden for non-broadcaster mods and for all Kick sessions.
- R24. The AutoMod tab SHALL show a numeric badge (`AutoMod (n)`) when n ≥ 1 messages are pending review. Badge clears when the tab is viewed and the queue is empty.
- R25. The Mod log tab SHALL show a list of mod actions taken on the current channel, newest first, scrollable, filterable by action type (timeout / ban / unban / delete / chat-mode change / raid / AutoMod approve / AutoMod deny) and by acting moderator.
- R26. Switching tabs SHALL NOT disconnect the chat connection or drop incoming messages; the Chat tab's message stream continues to accumulate in the background.

**AutoMod (Twitch native + Kick custom)**

- R27. On Twitch, the AutoMod tab SHALL surface held messages via Twitch EventSub (`automod.message.hold` subscription) and render each as: held message text, author username/badges (clickable → user popout per R14), AutoMod category and severity, and four action buttons.
- R28. The four AutoMod actions SHALL be: **Approve** (release to chat), **Deny** (block permanently), **Allow + allow-list user** (release and add the user to the channel's AutoMod allow-list), **Approve-and-timeout** (release the message and timeout the user, using the same six-chip picker as R5).
- R29. New AutoMod holds SHALL trigger three concurrent alerts: increment the tab badge (R24), fire a sonner toast at bottom-right with a brief preview and inline Approve/Deny buttons, and fire an OS notification via the Electron Notification API. OS notifications SHALL be configurable per-channel and default OFF.
- R30. On Kick, the AutoMod tab SHALL run a from-scratch client-side filter. The filter SHALL evaluate incoming Kick chat messages against a per-channel keyword blocklist + four severity-tier keyword lists (identity, sexual, aggression, bullying) — same four categories Twitch uses. Matched messages SHALL be held from the live chat stream and rendered in the AutoMod tab with the same approve/deny/allow-list/approve-and-timeout actions as Twitch.
- R31. The Kick AutoMod keyword + severity lists SHALL be configurable per-channel from the `/mod` page (R46) and SHALL be persisted in the local SQLite store. Editing the lists SHALL not require re-authentication.
- R32. Every AutoMod action (Twitch or Kick) SHALL write an entry to the mod log (R33).

**Mod log**

- R33. The mod log SHALL record every observable mod action on every channel the signed-in user views (or moderates), regardless of whether the action originated from inside StreamForge or from another client. Source events: Twitch EventSub `channel.moderate`, IRC CLEARCHAT/CLEARMSG, Helix `/moderation/bans` polling at session start; on Kick, the corresponding chatroom-event channels.
- R34. Each mod log entry SHALL capture: action type, target username + user-id, acting moderator username + user-id (when known), action duration (for timeouts), reason (when provided), and a timestamp. Entries SHALL persist in a local SQLite store across app restarts.
- R35. Mod log retention SHALL default to forever-with-manual-clear, with a per-channel "Clear log for this channel" button and an additional global setting allowing user-configurable rolling retention (7 days / 30 days / 90 days / forever).
- R36. The mod log entries SHALL be addressable by user (clicking a target username opens the user popout per R14, which then displays this user's mod-log entries on the current channel per R15).

**Engagement (Twitch broadcaster only)**

- R37. The Engagement tab SHALL contain three sections: **Predictions**, **Polls**, **Giveaways**.
- R38. Predictions SHALL support the full Twitch lifecycle: create (title + 2-10 outcome labels + window duration 1s-1800s), monitor live (channel points totals per outcome update live), Lock, Resolve (pick winning outcome), Cancel. Active prediction state SHALL bootstrap on tab open via Helix `GET /predictions`.
- R39. Polls SHALL support the full Twitch lifecycle: create (title + 2-5 choices + window duration + channel-points-voting + bits-voting toggles), monitor live, Terminate early, Archive after completion. Active poll state SHALL bootstrap on tab open via Helix `GET /polls`.
- R40. Giveaways SHALL ship in two flavors, both usable from the Engagement tab: **in-house chat-keyword giveaway** and **third-party connector** (Streamlabs). StreamElements is explicitly excluded — the service is winding down as of 2026 and is not a viable integration target.
- R41. The in-house giveaway SHALL: accept a keyword (default `!enter`) + duration + optional eligibility filters (followers-only, subscribers-only, minimum-account-age); listen to incoming chat for matching messages from eligible users; de-duplicate entries per user; on countdown end pick N random winners (default 1); announce the winner(s) in chat; allow a re-roll if a winner is unresponsive within a configurable window.
- R42. The in-house giveaway SHALL work on both Twitch and Kick (the chat-listening path already exists in both `twitch-chat.ts` and `kick-chat.ts`).
- R43. Streamlabs integration SHALL be opt-in (no auto-connect). It requires its own OAuth flow stored alongside the existing Twitch + Kick auth-store entries. When connected, the Giveaways section SHALL surface Streamlabs's giveaway tools (start, end, redraw) inline.
- R44. All Engagement actions (start prediction, terminate poll, end giveaway, third-party draws) SHALL write a mod-log entry tagged with the action type and the broadcaster as the actor.

**/mod top-level route**

- R45. A new top-level route `/mod` SHALL be reachable from the existing top-nav, visible only when the signed-in user has moderator-role on at least one cached channel (per existing `useModeratedChannels` infrastructure).
- R46. The `/mod` page SHALL contain a **per-channel mod settings** section: for each channel the user mods, a card containing the channel's default chat-mode preferences (slow-mode default duration, followers-only min-age default), AutoMod configuration (Twitch AutoMod severity levels, Kick keyword + severity-tier lists per R30/R31), the channel's AutoMod allow-listed users, and the channel's banned-keyword editor.
- R47. The `/mod` page SHALL contain a **cross-channel banned-user search**: an input field that, on submit, queries Helix `/moderation/bans` for the target username across every cached moderated channel and returns the list of channels where the user is currently banned or timed out (with remaining duration where applicable).
- R48. The `/mod` page SHALL contain a **cross-channel engagement aggregate** section listing the broadcaster's active predictions, polls, and giveaways across the channels they own. This section is only present when the signed-in user is broadcaster of at least one channel.

**OAuth scope management**

- R49. The OAuth-config scope list SHALL be expanded to include every scope required by the surfaces above: `moderator:manage:banned_users`, `moderator:manage:chat_messages` (already present), `moderator:manage:shield_mode`, `moderator:manage:automod`, `moderator:manage:automod_settings`, `moderator:read:chat_messages`, `moderator:read:moderated_channels` (already present), `channel:manage:raids`, `channel:manage:moderators`, `channel:manage:vips`, `channel:manage:predictions`, `channel:manage:polls`, `channel:edit:commercial`, `user:manage:whispers`.
- R50. When a token is missing any scope required by an action the user attempts, the existing lazy `ReconnectForModDialog` SHALL fire with a list of **all** currently-missing scopes (not just the one the attempted action needs). This batches re-consent into a single OAuth round-trip rather than one prompt per action.
- R51. The Streamlabs OAuth flow SHALL be independent of the Twitch + Kick auth-store entries and SHALL never block Twitch / Kick mod actions when disconnected.

**Cross-cutting**

- R52. Mod-action failures SHALL surface via sonner toast (success: silent; failure: toast at bottom-right with action name + reason). Auth failures (401, 403 missing-scope) SHALL additionally trigger the reconnect-dialog flow per R50.
- R53. The console SHALL extend the existing local SQLite storage layer (`apps/desktop/src/backend/services/database-service.ts`, currently used for `key_value` + `local_follows` tables) with new tables for: mod log per R34, Kick AutoMod config per R31, Streamlabs tokens per R51 (encrypted via the existing `safeStorage`-backed token path), and retention settings per R35.
- R54. The console SHALL introduce a new Twitch EventSub WebSocket subsystem alongside the existing tmi.js IRC connection (used for: `channel.moderate` events per R33, `automod.message.hold` per R27). EventSub subscription lifecycle SHALL be tied to the active chat channel(s).
- R55. Performance: opening the chat panel on a slow channel SHALL NOT regress beyond +50ms p95 due to mod-console scaffolding (toolbar gating, EventSub bootstrap, mod-log read). Background scaffolding for non-mods SHALL be skipped entirely when `useIsTwitchMod` / `useIsKickMod` return false.

---

## Acceptance Examples

- AE1. **Covers R3.** Given the signed-in user is a moderator on channel X and the channel broadcaster sends a chat message, when the moderator hovers that message, then no mod-action toolbar is shown (only the regular hover area renders).
- AE2. **Covers R3.** Given the signed-in user is a moderator on channel X, when they hover one of their own messages, then the full Timeout / Ban / Unban / Delete toolbar IS shown (self-actions are permitted by this brainstorm).
- AE3. **Covers R5.** Given the user clicks the Timeout button on a chat message, when the confirm dialog opens, then exactly six duration chips (10s, 1m, 10m, 30m, 24h, 7d) are visible and no custom-duration input is rendered.
- AE4. **Covers R6.** Given the user clicks Unban on a chat message whose author is not currently banned, when the unban mutation returns the platform's "user not banned" response, then no error toast surfaces (or only a soft confirmation toast).
- AE5. **Covers R22.** Given the signed-in user is a non-mod viewer, when they open the chat panel, then only the Chat tab is visible (no tab strip is rendered).
- AE6. **Covers R23.** Given the signed-in user is broadcaster of the current Twitch channel, when they open the chat panel, then four tabs are visible: Chat, AutoMod, Mod log, Engagement.
- AE7. **Covers R23.** Given the signed-in user is broadcaster of the current Kick channel, when they open the chat panel, then three tabs are visible: Chat, AutoMod, Mod log (Engagement is hidden because Kick has no Predictions/Polls APIs).
- AE8. **Covers R29.** Given Twitch AutoMod holds a new message, when the alert pipeline fires, then the AutoMod tab badge increments, a sonner toast appears at bottom-right, and (if OS notifications are enabled for this channel) an Electron Notification fires.
- AE9. **Covers R30.** Given a Kick chat message contains a word on the channel's keyword blocklist, when the message is received, then it is NOT rendered in the Chat tab and IS rendered in the AutoMod tab with the four standard actions available.
- AE10. **Covers R35.** Given mod-log retention is set to "30 days" globally and a mod-log entry is 31 days old, when the app starts the next time, then that entry has been removed from the local SQLite store.
- AE11. **Covers R41.** Given an in-house giveaway is configured for keyword `!enter` with a 60-second window and a "followers-only" eligibility filter, when a non-follower posts `!enter` and a follower also posts `!enter`, then only the follower is recorded as an eligible entry.
- AE12. **Covers R50.** Given the user's token has `moderator:manage:chat_messages` but is missing `moderator:manage:banned_users` and `channel:manage:raids`, when the user clicks Ban on a message, then the `ReconnectForModDialog` opens listing both missing scopes (not just the ban one).

---

## Success Criteria

- A moderator can complete a full timeout → mod-log-verify cycle without leaving StreamForge.
- A broadcaster can run a prediction, a poll, and an in-house giveaway end-to-end without opening twitch.tv.
- The AutoMod tab on Twitch surfaces every held message within ≤2 seconds of Twitch's EventSub emitting the hold event, and approval/denial round-trips complete within ≤1 second.
- The Kick custom AutoMod intercepts messages before they appear in the Chat tab (no flicker).
- The mod log survives app restart and shows actions from prior sessions.
- The `ReconnectForModDialog` is shown at most once per OAuth-scope-set delta — not once per action attempt.
- Non-mods see no new chrome (no tabs, no inline strip, no hover-toolbar buttons, no `/mod` route link).
- Downstream `ce-plan` produces a phased implementation plan without re-litigating actor model, surface placement, confirm-dialog policy, AutoMod action set, retention default, or scope list.

---

## Scope Boundaries

- Shared block lists across channels are out of scope.
- Ban-evasion detection (cross-platform user matching, alt-account heuristics) is out of scope.
- ML / AI-driven moderation suggestions, sentiment scoring, or LLM-classified holds are out of scope.
- Voice / audio moderation (TTS-suppression, voice-channel mods) is out of scope — chat only.
- Chat-bot integration, custom-command authoring, or user-defined response automations are out of scope.
- Custom alerts (donations, follows, subs visual / sound overlays) are out of scope — Engagement here means Twitch's first-party Predictions / Polls + the in-house Giveaways only.
- Stream-deck-style hotkey panel for one-press mod actions is out of scope.
- Mobile / responsive layout for the `/mod` route — desktop-window-width only.
- Mod permissions editor (per-mod feature gating beyond Twitch's existing mod role) is out of scope.

---

## Key Decisions

- **One bundled brainstorm over four tiered brainstorms.** Chose long-term coherence and single-design-pass consistency over fast incremental shipping. Acknowledged the trade-off: resulting PR(s) will be large; ce-plan should phase delivery into ordered units even though the requirements are unified.
- **All destructive actions get a confirm dialog reusing the pin dialog's pattern.** Chose consistency + guard-rails over KickTalk's one-click-fires-it model. The pin dialog (`apps/desktop/src/components/chat/twitch/TwitchPinMessageDialog.tsx`, `KickPinMessageDialog.tsx`) is the visual reference.
- **Six preset chips for timeout duration, no slider.** Chose Twitch-web speed for common cases over KickTalk's log-scale fine control. No custom-duration input.
- **Unban is always visible, fire-and-forget.** Chose zero-state-tracking over per-user ban-state caching. Matches KickTalk; an Unban on a non-banned user becomes a silent no-op or soft toast.
- **Toolbar shows on the signed-in user's own messages.** Self-target was deliberately NOT added to the hide list (the user can ban or delete their own messages). Broadcaster, other mods, and staff/admin badges ARE hidden.
- **Build Kick AutoMod from scratch with keyword + 4-severity-tier filters.** Chose Twitch parity over scope discipline; we are inventing a feature Kick does not offer. Lists are per-channel and persisted locally.
- **Persistent mod log via EventSub + Helix + local SQLite.** Chose history retention over session-only in-memory log. Introduces the first persistent local store beyond zustand+localStorage.
- **In-house giveaway plus Streamlabs connector, not either-or.** Chose flexibility for broadcasters: in-house works on both platforms, Streamlabs is opt-in (Twitch-only). StreamElements is explicitly excluded — the service is winding down in 2026.
- **Sonner library for toasts.** Resolves the existing `TwitchChat.tsx:527` "toast/error surface is a future follow-up" TODO with a single Toaster mount in `App.tsx`.
- **All OAuth scopes added in one batch, with batched reconnect-dialog.** Chose one consent screen over scope-on-first-use. The reconnect dialog will list all currently-missing scopes for the actions visible in the active console, not just one.
- **Hybrid surface layout.** Chat-panel tabs handle channel-scoped persistent surfaces (AutoMod, Mod log, Engagement). Inline strip above tabs handles channel-scoped one-shot actions + chat-mode toggles. Username popout handles per-user context. `/mod` top-level route handles cross-channel settings + search.
- **Identity shift recorded.** StreamForge's user model is being expanded from "viewers" to "viewers + moderators + broadcasters." This is a positioning decision, not just a feature addition.

---

## Dependencies / Assumptions

- The existing `useIsTwitchMod` / `useIsKickMod` hooks and `useModeratedChannels` cache from the pinned-message work are accurate enough to drive all mod-gating in this brainstorm. They will need scope-aware extensions but not architectural rework.
- The existing `ReconnectForModDialog` (`apps/desktop/src/components/auth/ReconnectForModDialog.tsx`) can be extended to accept a list of missing scopes rather than a single fixed scope. If not, planning may need to refactor it.
- The existing Cloudflare Worker token exchange is a pure pass-through with no scope allow-list (verified during pinned-message work and captured in `feedback_electron_mcp_eval.md` memory). Adding scopes to `oauth-config.ts` is sufficient on Twitch's side; the Worker requires no change.
- Twitch's EventSub WebSocket transport (not webhook) is reachable from the Electron renderer over standard WS. Twitch's published session-keepalive behavior holds.
- Kick's chatroom Pusher events expose enough mod-action signal to populate the Kick side of the mod log. Where they do not, the Kick mod log will reflect only actions taken from inside StreamForge (locally-originated, locally-logged).
- The `react-icons` package already in the app contains the gavel, hourglass, circle-slash, and trash icons needed for the new toolbar (otherwise a separate icon-asset decision is needed).
- Sonner is a viable library for this codebase (no React-version conflicts, no peer-dep issues with existing Radix usage).
- Streamlabs's public OAuth API remains stable enough to integrate against. If it deprecates or paywalls, the connector becomes deferred — in-house giveaways still ship.
- SQLite via better-sqlite3 (main-process) is the assumed persistence layer; planning may switch to IndexedDB (renderer-only) if main-process IPC overhead is a concern. Either way, the schema is owned by this brainstorm.
- The signed-in user's broadcaster identity for a channel is detectable from existing auth-store data (the user's slug/username matches the channel's slug). The detection logic already exists in `useIsKickMod` for Kick; Twitch needs the equivalent.

---

## Outstanding Questions

### Resolve Before Planning

- *(None — all surface-level product decisions resolved during the brainstorm.)*

### Deferred to Planning

- [Affects R30, R31][Technical] Exact Kick AutoMod evaluation pipeline (where in the kick-chat IPC flow the keyword check runs — pre-emit vs post-emit) and how holds back-fill into the AutoMod queue if the chat connection drops mid-evaluation.
- [Affects R34, R53][Technical] SQLite-vs-IndexedDB was resolved during planning research: better-sqlite3 is already a dependency (v11.8.1) and `apps/desktop/src/backend/services/database-service.ts` already provides the schema/migration pattern. The plan will extend that service rather than introduce a new persistence layer.
- [Affects R47][Needs research] Helix `/moderation/bans` rate-limit and pagination behavior across N moderated channels. The cross-channel banned-user search may need throttling or per-channel parallelism limits.
- [Affects R49, R50][Technical] Whether `user:manage:whispers` is needed at all given Twitch's increasing anti-spam restrictions on whisper. If the API surface is effectively unusable for new apps, drop the scope and the Whisper button from R18.
- [Affects R54][Technical] Twitch EventSub WebSocket connection topology — one shared connection across all channels the user views vs one per channel. Twitch limits subscriptions per WebSocket; the choice affects multistream behavior.
- [Affects R38, R39, R44][Needs research] Whether channel-points balances and bits totals on active polls/predictions need their own EventSub subscription for live updates, or whether Helix polling at a sensible cadence is sufficient.
- [Affects R29, R41][Technical] OS-notification rate-limiting strategy (debounce / coalesce / drop) for AutoMod-heavy channels where holds may fire faster than a human can review.
- [Affects R45, R47][Needs research] Whether the existing `useModeratedChannels` cache refresh cadence is fast enough for `/mod` to feel current after a new mod-promotion happens off-app, or whether `/mod` needs its own refresh trigger.
- [Affects R51][Needs research] Streamlabs OAuth scope requirements + token-rotation behavior. Determines whether the Worker pass-through pattern works for it.
- [Affects R55][Technical] Whether to lazy-mount the EventSub subsystem (mount on first mod-tab open) or eager-mount it (mount when any moderated channel chat connects). Affects p95 chat-open regression budget.
