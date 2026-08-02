# Chat User Info UI: Grilling Session Notes
Date: 2026-07-26 · Goal: Define the user-info experience opened from chat, grounded in the current StreamFusion UI and the gaps that need to be fixed.

## PRD

- [Chat User Info Dialog implementation PRD](prd.md)

## Implementation issues

1. [Twitch identity-first dialog and truthful profile data](issues/01-twitch-truthful-user-info.md)
2. [Kick truthful profile and follow parity](issues/02-kick-truthful-user-info.md)
3. [Live Recent Chat Messages and complete badge context](issues/03-live-recent-chat-and-badges.md)
4. [Selected-message public actions](issues/04-selected-message-public-actions.md)
5. [Permission-gated Moderation history and one-flow reconnect](issues/05-permission-gated-moderation-history.md)
6. [State-aware Timeout](issues/06-state-aware-timeout.md)
7. [State-aware Ban and Unban](issues/07-state-aware-ban-unban.md)
8. [Exact selected-message Delete](issues/08-exact-selected-message-delete.md)

## Summary / key decisions

- Use side-by-side visual mockups during the session whenever a layout or visual-hierarchy decision benefits from seeing the options.
- Clicking a chat username serves every viewer and opens an identity-first profile. Moderation controls are secondary and appear only when the signed-in viewer has permission in the current Channel.
- Keep the existing centered dialog interaction. Do not replace the chat rail or use an anchored popover.
- The dialog exposes the same identity and chat context to every viewer: avatar, name/handle, account-created date, following-since relationship, identity/role icons, and recent message history. A separate Moderation section is shown only to an authorized moderator or broadcaster.
- Moderation history is operational data and is visible only to an authorized moderator or broadcaster, alongside the moderation tools.
- Moderation UI fails closed: while the signed-in viewer's authority is loading, unknown, stale without confirmation, or unverifiable, the Moderation section is absent.
- A positively confirmed Twitch moderator whose token lacks required scopes sees a locked Moderation section with a single reconnect action and an explanation; the role is not hidden or presented as capable.
- The public message list is Recent Chat Messages: up to 10 messages from the selected chatter observed in the current Channel during the current live-chat session, labelled “Recent in this chat” and shown with timestamps.
- Recent Chat Messages reuse the full chat presentation: timestamps, badges, emotes, links, reply context, deleted state, and a visible selected state for the message that opened the dialog.
- Recent Chat Messages include both messages authored by the selected chatter and replies addressed to that chatter, matching Xtra's conversation-context behavior; each row keeps its true author visible.
- Safe public message actions follow Xtra's selection model: the clicked message starts selected, another row can become selected, and shared footer actions (`Reply`, `Copy`, `Translate`, `View Channel`) operate on the current selection.
- The public navigation action is `View Channel`, opening the selected chatter's Channel inside StreamFusion. A visually secondary external-link control opens the corresponding Twitch or Kick page.
- Translation behavior is out of scope, but the public selected-message footer includes a disabled `Translate` control marked `Coming Soon`. The active controls are `Reply`, `Copy`, and `View Channel`, plus the secondary external-link control.
- Guest viewers do not see the `Reply` action.
- Authenticated viewers who are temporarily ineligible to send still see `Reply`, disabled with the exact current Channel restriction.
- The centered dialog uses a clean structured profile header with no banner artwork or bio: avatar, identity, account/follow dates, and public badges/icons.
- The public profile header mirrors every available badge from the current chat context, including Platform/Channel roles and third-party badges such as 7TV, BTTV, and FFZ.
- Rich Recent Chat Message rows show at most four badges. The profile header has a separately labelled `Badges` section that shows the complete badge set in one horizontally scrolling row.
- The header's complete badge set comes from the selected chatter's newest authored message in the current session; badges are not unioned across older messages.
- `Account created` and `Following since` visibly use absolute dates. Hover or keyboard focus reveals the relative age in a tooltip.
- Account-created and follow-relationship values must come from real Platform data. A failed or missing lookup must not be presented as `Not following` or silently collapsed to an em dash.
- `Following since` has three truthful states: the real date when known, `Not following` only when positively confirmed, and `Unavailable` when the Platform cannot verify the relationship.
- When an authoritative profile/date lookup is unavailable, the affected field shows `Couldn’t verify` with an inline `Retry`; the rest of the dialog remains usable.
- The dialog opens immediately using identity, badges, and message context already known from chat. Avatar, dates, Channel resolution, and moderation authority load independently with local skeleton/retry states.
- The centered dialog uses a responsive medium desktop size (approximately 560px wide, capped near 80% of viewport height), with fixed profile header and action footer around one scrolling content region.
- Dialog dismissal is action-specific: Reply closes and focuses the composer with reply context; View Channel closes through navigation; Copy stays open and confirms success; successful moderation actions stay open for chained work.
- The protected Moderation section is state-aware and shows only actions valid for the selected chatter's current moderation state; contradictory controls such as `Ban` and `Unban` never appear together.
- Moderator `Delete` is available only when the currently selected row is an undeleted message authored by the profile user; selecting another person's reply never retargets moderation.
- Timeout uses quick duration presets plus a Custom duration. An optional moderation reason appears only when the active Platform can submit it.
- Moderation confirmation is severity-based: Timeout confirms through the duration flow; Ban and Delete require explicit destructive confirmation; Unban acts immediately with success/failure feedback.
- Authorized viewers see the five newest moderation-history entries with action, duration/reason, acting moderator, and date, followed by `View all in Mod Dashboard`.
- `Copy` writes only the selected message's visible content, using emote names and excluding timestamp and username metadata.
- The dialog uses the existing Lucide icon family beside section headings and text-labelled action buttons. Close and the secondary external-link control may be icon-only with accessible names/tooltips.
- Deleted Recent Chat Messages respect the existing deleted-message display preference, rendering either retained content or the normal tombstone.
- If the internal Channel cannot be resolved, `View Channel` is disabled with `Couldn’t verify · Retry`; the external Twitch/Kick link remains independently available.
- When no current-session messages are available, the Recent Chat Messages section remains with `No recent messages in this chat`; selection-dependent `Reply` and `Copy` actions are absent.
- Account-created and follow-date acquisition follows a strict source order: official Platform API/event data first, required authorization upgrade second, validated first-party website fallback third, then an explicit unavailable state. Values are never estimated.
- Moderation authority and current ban/timeout state fail closed. Missing permissions appear as `Reconnect <Platform>`; unverifiable state appears as `Couldn’t verify · Retry`; neither state exposes active moderation controls.
- Reconnect requests every missing canonical StreamFusion scope in one consent flow. The dialog stays open but locked, then refreshes affected fields and actions after success.
- Twitch adds `moderator:read:followers`, `moderator:read:blocked_terms`, `moderator:read:chat_settings`, `moderator:read:moderators`, and `moderator:read:vips`; Kick adds `events:subscribe`. Existing manage scopes remain canonical where they satisfy the documented read/event alternatives.
- The `Badges` section always remains visible. A verified empty result says `No badges on the latest message`; loading and failure have distinct states. Badge hover/focus tooltips include the full name and Platform/source.
- Late-loading content never steals focus. Errors and reconnect prompts use polite announcements; normal close restores focus to the opening username, while Reply deliberately focuses the composer.
- Recent Chat Messages update live and automatically scroll to new matching messages. The explicitly selected message remains pinned in the selected-message footer and is never silently retargeted by live insertion or the 10-message cap.
- Compact windows retain the centered-dialog model while expanding the surface to nearly the available viewport; the fixed header/footer and single scrolling body remain.
- Every destructive moderation action revalidates the active Channel, target user, selected message, viewer authority, and current Platform state immediately before mutation.
- Successful moderation actions keep the dialog open, refresh state/history, and show a brief toast. Failures preserve entered values, show the exact safe Platform error inline, and offer Retry.
- Timeout retains `10s`, `1m`, `10m`, `30m`, `24h`, and `7d` plus Custom, filtered and validated against the active Platform's documented limits.
- `Moderation history` is qualified with `Platform actions available to StreamFusion`. It shows five recent Platform-originated records, uses `No moderation actions available` for verified empty results, and never claims to be a complete Platform archive.
- Confirmation editing may be dismissed. Once a moderation mutation or reconnect is submitted, Escape, outside-click, and Close remain disabled until the operation settles; post-success refresh does not block closing.

## Current implementation observed

- Clicking a username in live chat opens a centered, blocking dialog over the stream and chat.
- The dialog shows avatar, display name, handle, account creation date, channel follow date, role/subscription badges when available, up to 10 recent in-memory chat messages, and channel-scoped moderation history.
- The visible footer currently gives `Timeout`, `Ban`, `Unban`, `Delete`, and `Open` equal visual weight.
- Timeout, ban, unban, and delete controls are rendered for every viewer who can open the profile; only Twitch moderator/VIP role controls are gated to the broadcaster.
- The Twitch mutation context currently uses the channel ID as the moderator ID, including for a signed-in moderator who is not the broadcaster.
- The profile mixes two jobs in one surface: learning who a chatter is and taking moderation action against them.
- Twitch profile data is richer than Kick profile data. Kick currently falls back to a minimal identity and does not populate follow/subscription/role status.
- Recent messages come only from the current in-memory chat session, not a durable or server-fetched user history.

## Xtra reference audit

- Xtra opens an expanded mobile bottom sheet after a chat message is selected. Its placement is mobile-specific and does not change the StreamFusion decision to keep a centered desktop dialog.
- Xtra loads a profile header with optional banner, avatar, display name/login, account-created date, and followed-at date. Clicking the avatar/name opens the full Twitch profile.
- Xtra derives its message list from the current chat adapter, matching the selected user's messages and replies addressed to that user. It does not provide durable Platform history.
- Xtra renders those entries with the normal chat renderer, preserving timestamps, badges, emotes, name paints, replies, notices, and translations; the originally selected message remains highlighted.
- Its safe actions include Reply, Copy Message, Copy Clip, Translate, and View Profile.
- Xtra does not mix moderation controls or moderation history into this public message/profile sheet.
- Relevant StreamFusion opportunities: preserve rich chat rendering instead of plain text, identify the clicked message, consider banner/bio when reliably available, and separate safe message actions from the permission-gated Moderation section.

## Q&A log

### Q1 — Visual decision support

- Asked: Should the session use side-by-side visual mockups as UI decisions arise?
- Captured: Yes.
- Doc updates: None.
- Flags: None.

### Q2 — Primary audience and purpose

- Asked: Should the surface serve every viewer as an identity-first profile, be moderator-only, or split into separate viewer and moderator experiences?
- Captured: Chose the identity-first experience for every viewer. Moderation tools must be permission-gated rather than defining the default surface.
- Doc updates: No glossary term settled yet; CONTEXT.md unchanged.
- Flags: The exact permission model and degraded/unknown permission state still need decisions.

### Q3 — Profile placement

- Asked: Should the profile replace the chat rail, appear as an anchored popover, or remain a centered dialog?
- Captured: Keep the centered dialog that exists today. The chat-rail concept was confusing and is rejected.
- Doc updates: None; this is a reversible presentation decision and does not warrant an ADR.
- Flags: The dialog's information hierarchy, size, and action layout still need decisions.

### Q4 — Permission-aware dialog structure

- Asked: Should moderator capabilities use a separate permission-gated section, a separate tab, or the current flat footer?
- Captured: Use a separate permission-gated Moderation section. Every viewer still sees message history, account-created date, following-since relationship, avatar, badges, and other identity indicators. Only moderation tools and related moderator-only content are hidden from ordinary viewers.
- Doc updates: No canonical glossary term has been confirmed yet; CONTEXT.md unchanged.
- Flags: Confirm whether moderation history belongs to the hidden Moderation section or the public identity context.

### Q5 — Visibility of moderation history

- Asked: Should moderation history be restricted, public, or summarized for public viewers?
- Captured: Restrict complete moderation history to authorized moderators and broadcasters.
- Doc updates: None.
- Flags: The permission source and unknown/loading behavior still need to be defined.

### Q6 — Unknown moderation authority

- Asked: Should moderation UI be hidden, shown disabled, or shown optimistically while moderator authority is loading or unverifiable?
- Captured: Hide the Moderation section until authority is positively confirmed.
- Doc updates: None.
- Flags: Decide how a confirmed moderator with insufficient OAuth scopes is handled.

### Q7 — Confirmed moderator with insufficient scopes

- Asked: Should a confirmed Twitch moderator with insufficient OAuth scopes see a locked recovery state, no Moderation section, or normal actions that prompt only after failure?
- Captured: Show a locked Moderation section with “Reconnect Twitch to enable tools.”
- Doc updates: None.
- Flags: Define the exact copy and per-action scope requirements later.

### Q8 — Message-history scope

- Asked: Should message history be current-session/current-Channel, persistent per Channel, or cross-Channel?
- Captured: Use current-session/current-Channel history only. Show up to 10 entries, label the section “Recent in this chat,” and include timestamps.
- Doc updates: Added `Recent Chat Messages` to CONTEXT.md to distinguish transient observed messages from durable history or Chat Replay.
- Flags: Decide empty-state behavior and whether deleted messages remain represented in this list.

### Q9 — Recent-message rendering fidelity

- Asked: Should Recent Chat Messages use full chat rendering, compact rich snippets, or plain text?
- Captured: Use full chat rendering. Preserve timestamps, badges, emotes, replies, links, and deleted-message state; highlight the message that opened the dialog.
- Doc updates: None.
- Flags: Decide whether the list includes only messages authored by the selected chatter or also replies addressed to them.

### Q10 — Recent-message membership

- Asked: Should the list contain only messages authored by the selected chatter, also include replies addressed to them, or offer a toggle?
- Captured: Include the selected chatter's messages plus replies addressed to them, matching Xtra.
- Doc updates: The existing `Recent Chat Messages` definition remains accurate; no glossary change required.
- Flags: Ensure reply rows retain their true author and cannot be mistaken for the selected chatter's own messages.

### Q11 — Public action organization

- Asked: Should safe public actions be contextual per message, use an Xtra-style selected-message footer, or remain minimal?
- Captured: Chose option 2, the Xtra-style selected-message footer.
- Visual: `designs/public-actions-comparison.html`.
- Doc updates: None.
- Flags: Define what `View Profile` means inside StreamFusion and how unavailable Reply/Translate actions are represented.

### Q12 — Public profile navigation

- Asked: Should the footer open an internal StreamFusion Channel, open only the external Platform page, or show two equal actions?
- Captured: Use `View Channel` as the primary internal navigation action, with a smaller external-link control for Twitch/Kick.
- Doc updates: No new glossary term; this follows the existing `Channel` definition in CONTEXT.md.
- Flags: Confirm fallback behavior when the selected chatter cannot be resolved to a Channel.

### Q13 — Translation scope

- Asked: Should translation be deferred, implemented on-device, or implemented through an online service?
- Captured: Initially chose to defer Translate, then revised the decision: keep translation behavior deferred but include a disabled `Translate` control marked `Coming Soon`.
- Doc updates: None.
- Flags: The future translation implementation still requires its own privacy, language-data, failure, and settings decisions.

### Q14 — Reply availability

- Asked: Should unavailable Reply be disabled with a reason, hidden, or allowed to fail after clicking?
- Captured: Hide `Reply` entirely for Guest viewers.
- Doc updates: None.
- Flags: Decide the state for an authenticated viewer who is temporarily ineligible to send because of Channel chat rules.

### Q15 — Reply for authenticated but ineligible viewers

- Asked: Should Reply be disabled with a reason, hidden, or allowed to fail for authenticated viewers blocked by current Channel chat rules?
- Captured: Keep `Reply` visible but disabled with the exact reason.
- Doc updates: This follows the existing `Chat Send Eligibility` term in CONTEXT.md; no glossary change required.
- Flags: Ensure the dialog consumes the same eligibility source and copy as ChatInput rather than duplicating rule logic.

### Q16 — Profile-header treatment

- Asked: Should the centered dialog use a clean structured header or an Xtra-style Platform banner header?
- Captured: Use the clean structured header. Do not add banner artwork.
- Visual: `designs/profile-header-comparison.html`.
- Doc updates: None.
- Flags: Define the exact public badge/icon set and optional-bio availability by Platform.

### Q17 — Public badge/icon scope

- Asked: Should the header show essential Platform/Channel roles, mirror every chat badge, or use unlabeled icons only?
- Captured: Mirror every available chat badge in the profile header, including third-party cosmetic/supporter badges.
- Doc updates: None.
- Flags: Define overflow behavior and how badge state is sourced when different recent messages carry different badge sets.

### Q18 — Badge overflow

- Asked: Should badge overflow use a two-row cap with expansion, unlimited wrapping, or horizontal scrolling?
- Captured: Initially chose the two-row cap, then revised the decision to option 3: one horizontally scrolling badge row.
- Doc updates: None.
- Flags: Define which observed message or authority supplies the complete current badge set.

### Q19 — Badge density by surface

- Asked: If badge sets differ across messages, should the header use the newest authored message, the clicked message, or a union of observed badges?
- Captured: Each message row shows at most four badges. The header exposes the complete badge set from the selected chatter's newest authored message in a dedicated `Badges` section.
- Doc updates: None.
- Flags: Define the empty state when the newest authored message has no badges.

### Q20 — Profile bio

- Asked: Should a bio appear only when available, always reserve an empty state, or be excluded?
- Captured: Do not include a bio.
- Doc updates: None.
- Flags: None.

### Q21 — Date presentation

- Asked: Should account/follow dates use absolute plus relative, absolute only, or relative only?
- Captured: Show the absolute date in the dialog and place the relative age (for example, “13 years ago”) in a hover/focus tooltip.
- Doc updates: None.
- Flags: Define truthful states for not-following versus unavailable follow data.

### Q22 — Missing follow data

- Asked: Should missing follow data use explicit states, an em dash, or a hidden row?
- Captured: Require a real Platform lookup, then use option 1's explicit three states: date when known, `Not following` when positively confirmed, and `Unavailable` when verification fails. Never infer `Not following` from a failed lookup.
- Cross-reference: Xtra's `UserMessageClicked.graphql` requests `user.follow(targetID).followedAt`; StreamFusion's current `useUserProfile` path needs a stronger authoritative lookup.
- Doc updates: None.
- Flags: Define whether `Unavailable` includes an inline retry.

### Q23 — Lookup recovery

- Asked: Should an unavailable real-data lookup show inline retry, remain loading indefinitely, or fail the whole dialog?
- Captured: Show `Couldn’t verify` with an inline `Retry`, without blocking the rest of the dialog.
- Doc updates: None.
- Flags: None.

### Q24 — Progressive loading

- Asked: Should the dialog open immediately with field-level loading, retain a whole-dialog skeleton, or wait to open until all data is ready?
- Captured: Open immediately and load fields independently.
- Doc updates: None.
- Flags: Define focus/announcement behavior as late fields and the Moderation section appear.

### Q25 — Dialog size and scrolling

- Asked: Should the centered dialog use a responsive medium single-scroll layout, retain compact nested scroll regions, or become a wide two-column layout?
- Captured: Use the responsive medium dialog with one interior scrolling content region and fixed header/footer.
- Visual: `designs/dialog-size-scroll-comparison.html`.
- Doc updates: None.
- Flags: Define compact-window fallback and focus restoration.

### Q26 — Post-action dismissal

- Asked: Should the dialog use action-specific close behavior, always close, or always remain open?
- Captured: Use action-specific behavior. Reply/navigation close; Copy and moderation workflows remain open.
- Doc updates: None.
- Flags: Ensure dialog close restores focus to the clicked username except when Reply deliberately moves focus to the chat composer.

### Q27 — State-aware moderation actions

- Asked: Should moderation show only currently valid actions, show all with invalid ones disabled, or keep every action available?
- Captured: Show only actions valid for the current moderation state.
- Doc updates: None.
- Flags: Define authoritative ban/timeout state retrieval and selected-message deletion semantics.

### Q28 — Selected-message deletion

- Asked: Should Delete be limited to selected messages authored by the profile user, permit deleting any selected author, or always delete the profile user's newest message?
- Captured: Show Delete only for an eligible selected message authored by the profile user.
- Doc updates: None.
- Flags: Define stale/deleted-between-click-and-confirm handling.

### Q29 — Timeout flow

- Asked: Should Timeout use presets plus Custom and optional supported reasons, duration only, or an immediate default?
- Captured: Use quick presets plus Custom, with an optional reason only where supported by the Platform.
- Doc updates: None.
- Flags: Define the shared preset list and Platform maximum-duration validation.

### Q30 — Moderation confirmation policy

- Asked: Should confirmations be severity-based, required for every moderation action, or omitted?
- Captured: Use severity-based confirmation. Timeout confirms through its picker, Ban/Delete require explicit confirmation, and Unban is immediate.
- Doc updates: None.
- Flags: Define whether an immediate Unban offers any undo path; Platform APIs may not support a true undo.

### Q31 — Moderation-history depth

- Asked: Should the dialog show five detailed entries plus a dashboard link, all entries, or summary counts?
- Captured: Show the five newest entries with full context and `View all in Mod Dashboard`.
- Doc updates: None.
- Flags: Define the fallback when the selected Platform has no supported complete moderation-history source.

### Q32 — Clipboard format

- Asked: Should Copy use visible content only, include timestamp/username, or offer both formats?
- Captured: Copy visible message content only. Preserve emote names; omit timestamp and username.
- Doc updates: None.
- Flags: Confirm link URL/text serialization and retained deleted-content behavior.

### Q33 — Deleted-message rendering

- Asked: Should deleted messages respect the existing display setting, always reveal retained content, or always show tombstones?
- Captured: Respect the existing deleted-message display setting.
- Doc updates: This follows the existing deleted-message behavior; no glossary change required.
- Flags: None.

### Q34 — Dialog icon treatment

- Asked: Should icons appear beside sections/labelled actions, on every row, or replace action labels?
- Captured: Use icons beside section headings and text-labelled action buttons. Close and external-link may remain icon-only with accessible treatment.
- Doc updates: None.
- Flags: None.

### Q35 — Unresolved internal Channel

- Asked: Should unresolved Channel navigation be disabled with retry, hidden in favor of the external link, or attempted optimistically?
- Captured: Disable `View Channel` with `Couldn’t verify · Retry`, while keeping the external Platform link available.
- Doc updates: None.
- Flags: None.

### Q36 — Empty Recent Chat Messages

- Asked: Should an empty message set show an explicit empty state, hide the section, or fail the dialog?
- Captured: Keep the section with `No recent messages in this chat`; hide Reply and Copy because no message is selected.
- Doc updates: None.
- Flags: None.

### Visual detour — Dialog icon treatment

- Requested: Show a concrete mockup of the icons chosen in Q34.
- Captured: Added a consolidated centered-dialog mockup using one Lucide-style outline family. Section headings use Award, Message Square, and Shield. Labelled actions use Channel, Reply, Copy, Languages, Clock, Ban, Trash, History, and Dashboard. Only Close and Open on Twitch are icon-only, with accessible names and tooltips.
- Visual: `designs/dialog-icons-mockup.html`.
- Rationale: Preserve readable labels for consequential actions while making the dialog easier to scan and keeping public and moderator-only regions visually distinct.
- Doc updates: None.
- Follow-up: User selected option 1 and approved this icon treatment.
- Flags: None.

### Q37 — Kick follow-data parity

- Asked: Should Kick show an explicit unavailable state, block the redesign until parity, or hide the field when no authoritative arbitrary-chatter follow date is available?
- Captured: Use `Unavailable · Retry` as the truthful fallback, but first obtain every real field the current official Platform API exposes and verify the latest API documentation rather than relying on the existing integration or older reference apps.
- Doc updates: None.
- Follow-up: User explicitly required verification against the live official documentation sites, not only Context7.
- Official-doc audit (2026-07-26):
  - Twitch identity/avatar: `GET /helix/users` supports arbitrary IDs/logins with an app or user token. Its documented response does **not** include account creation time. StreamFusion's `TwitchApiUser.created_at` and profile usage are therefore incorrect for current Helix.
  - Twitch follow relationship: use `GET /helix/channels/followers?broadcaster_id=<channel>&user_id=<chatter>` with `moderator:read:followers`; the authenticated user must be the broadcaster or one of that broadcaster's moderators. The response includes `followed_at`.
  - Twitch current implementation bug: `useUserProfile` calls `/helix/channels/followed` with the chatter's ID. That endpoint only reads the authenticated token owner's follows and requires `user_id` to match that token owner, so it cannot query an arbitrary chatter.
  - Twitch subscription check: `GET /helix/subscriptions/user` requires `user_id` to match the token owner. It cannot query an arbitrary chatter using a normal viewer/mod token. Current code incorrectly attempts this.
  - Twitch badges: `channel.chat.message` supplies the selected message's badge set. Official guidance says to read badges per message because users may change them; resolve images/metadata through channel/global badge catalogs.
  - Twitch ban/timeout state: `GET /helix/moderation/banned?broadcaster_id=<channel>&user_id=<chatter>` returns current state and context but the documented broadcaster ID must match the authorized broadcaster identity. Normal moderators may perform moderation actions but cannot assume this read path is available.
  - Kick identity/avatar: `GET /public/v1/users?id=<user>` returns `user_id`, `name`, `profile_picture`, and possibly email; it does not return account creation time.
  - Kick chat identity: `chat.message.sent` supplies the sender's real ID, username, verification state, profile picture, Channel slug, username color, badges, emotes, reply metadata, and message creation time.
  - Kick follow relationship: the official Public API has no follower/following read endpoint. `channel.followed` is only a future event; its documented payload has no follow timestamp and cannot recover an existing relationship.
  - Kick moderation state/history: the official REST surface only posts bans/timeouts and deletes bans/timeouts. `moderation.banned` supplies observed event details (`moderator`, `reason`, `created_at`, `expires_at`) but there is no documented GET for complete current state/history and no unban event listed.
  - Kick exact-message deletion: `DELETE /public/v1/chat/{message_id}` is officially supported with `moderation:chat_message:manage`.
  - Kick changelog checked through 2026-07-03: the newest changes concern Livestreams V2; no new user-created, follower lookup, subscription lookup, or moderation-history endpoints were added.
  - Twitch changelog checked through 2026-05-19: no replacement exposing account creation or unrestricted arbitrary-chatter follows. The legacy user-follows endpoint was removed in 2023; specific follower data remains restricted to an authorized broadcaster/moderator with `moderator:read:followers`.
- Source policy implication: official Platform APIs and official live chat/event payloads are authoritative. Twitch internal GQL and Kick website `/api/v2` routes can return extra fields but are undocumented, unstable fallbacks rather than official API data.
- Doc updates: None.
- Flags: Decide whether account creation may use undocumented first-party website endpoints or must show `Unavailable`; decide which mod-only fields may use observed local event history when the Platform provides no authoritative read.

### Q38 — Account-creation source policy

- Asked: Should account creation use isolated first-party website fallbacks, official Public APIs only, or be removed?
- Captured: Use Twitch and Kick's undocumented first-party website endpoints as isolated fallback adapters. If a fallback fails or its response cannot be validated, show `Unavailable · Retry`; never guess a date or treat the field as an official Public API guarantee.
- Doc updates: None.
- Flags: Validate the live first-party response shapes during implementation and keep schema drift contained inside Platform adapters.

### Q39 — Following-since source policy

- Asked: Should public follow-date lookup use layered official/first-party sources, official APIs only, or hide the field when official lookup is unavailable?
- Captured: Use a layered lookup. Prefer the official Platform API when the viewer has the required authorization; otherwise try a validated first-party website fallback. If neither source can positively verify the relationship, show `Unavailable · Retry`. Never estimate the date from event arrival time or a locally observed session.
- Doc updates: None.
- Flags: Validate whether current Twitch GQL and Kick website endpoints expose an exact historical follow timestamp; unsupported Platforms retain the explicit unavailable state.

### Q40 — Unverified moderation state

- Asked: Should uncertain ban/timeout state lock moderation actions, use locally observed events as truth, or show all uncertain actions disabled?
- Captured: Fail closed. Lock the moderation action area and show `Couldn’t verify · Retry` until the current Platform state is positively verified. Do not promote locally observed events into authoritative current state.
- Doc updates: None.
- Flags: Define the honest presentation of locally observed moderation activity separately from current Platform state.

### Q41 — Moderation-history provenance clarification

- Initial question: Should the section be qualified as activity observed by StreamFusion because Platforms do not expose one complete historical read endpoint?
- User correction: Moderator data is obtained from the Platforms through authorized APIs/events and scopes.
- User directive: If any required data or scopes are missing, obtain them through the proper Platform authorization and data source rather than accepting an avoidable unavailable state.
- Verified implementation: `mod-log-writer` ingests Twitch `channel.moderate` EventSub notifications, Twitch IRC clear/delete events, Kick Pusher moderation events, and a Twitch Helix `/moderation/banned` bootstrap. Successful local actions are recorded immediately and deduplicated against the corresponding Platform event. SQLite is the persistence/display layer, not the originating authority.
- Captured terminology correction: Do not describe valid Platform-originated records as app-generated or merely inferred. Missing scopes or unavailable Platform feeds are availability/completeness states, not a change in provenance.
- Nuance to preserve: Helix bootstrap supplies current bans/timeouts, while event feeds supply actions received through the connected scoped session; the UI must not claim a Platform returned records that were never delivered.
- Scope audit against live official docs (2026-07-27):
  - Twitch already requests `user:read:moderated_channels`, `moderator:manage:chat_messages`, `moderator:manage:banned_users`, `moderator:manage:warnings`, and `moderator:manage:unban_requests`; these cover moderator-channel discovery, message deletion, ban/timeout/unban mutations and reads, warnings, and the corresponding alternatives accepted by `channel.moderate v2`.
  - Twitch must add `moderator:read:followers` for authoritative chatter follow lookup and `channel.follow` events.
  - Twitch `channel.moderate v2` requires all documented permission categories. The current canonical token set is missing `moderator:read:blocked_terms`, `moderator:read:chat_settings`, `moderator:read:moderators`, and `moderator:read:vips`; add them.
  - Twitch `channel.moderate v2` accepts the existing manage variants for banned users, chat messages, warnings, and unban requests, so duplicate read scopes for those categories are unnecessary.
  - Kick already requests `user:read`, `channel:read`, `moderation:ban`, and `moderation:chat_message:manage`.
  - Kick must add `events:subscribe` to use its official chat, follow, subscription, and moderation event subscription surface where the token/app authorization model permits.
  - `chat:write` is not newly required by this dialog because Reply deliberately reuses the existing Chat Send Eligibility and send path. Revisit only if the app returns to Kick's official chat-send API.
  - Initial connect, reconnect/scope-upgrade, device-code, and token validation paths must share the canonical scope sets. Existing tokens missing new scopes receive a targeted reconnect prompt; new connections request the complete set.
- Data acquisition rule: A field may show unavailable only after the applicable official endpoint/event source, required-scope upgrade, and approved first-party fallback have been attempted or ruled unsupported. Missing permission must be presented as `Reconnect <Platform>`, not as missing Platform data.
- Final title decision: Use `Moderation history`. Do not qualify valid Platform-originated records as merely app-observed. When authorization is insufficient, replace the affected content/actions with the explicit `Reconnect <Platform>` state.
- Doc updates: None.
- Flags: Validate Kick's official event-subscription authorization for moderator-owned versus broadcaster-owned Channels during implementation.

### Q42 — Scope-upgrade batching

- Asked: Should reconnect request every missing StreamFusion permission together, only this dialog's permissions, or permissions one action at a time?
- Captured: Request every currently missing canonical StreamFusion Platform scope in one reconnect. The consent UI must explain what the added permissions enable. Avoid repeated action-by-action reconnect prompts.
- Doc updates: None.
- Flags: Ensure the reconnect completion revalidates the granted token and retries affected field/action queries.

### Q43 — Empty Badges section

- Asked: Should a chatter with no badges on their newest authored message retain an explicit empty section, hide the section, or fall back to older-message badges?
- Captured: Keep the `Badges` section and show `No badges on the latest message`. Do not silently substitute older badge state. Loading and lookup failure remain separate states.
- Doc updates: None.
- Flags: None.

### Q44 — Progressive-loading focus behavior

- Asked: When profile data and permissions resolve after the dialog opens, should late content preserve focus, automatically focus a newly available action, or use no special accessibility behavior?
- Captured: Late-loading content never steals focus. Announce errors and reconnect prompts through a polite live region. Closing the dialog restores focus to the username that opened it. Choosing Reply deliberately closes the dialog and moves focus to the chat composer.
- Doc updates: None.
- Flags: Verify focus restoration when the originating chat message has left the virtualized message list.

### Q45 — Live Recent Chat Messages

- Asked: While the dialog is open, should newly arriving matching messages appear behind an explicit refresh control, update live, or remain frozen until the dialog is reopened?
- Captured: Update Recent Chat Messages live while the dialog remains open.
- Doc updates: None.
- Flags: Define how live insertions behave when the viewer has scrolled away from the newest message.

### Q46 — Live-message scrolling

- Asked: If the viewer has scrolled through Recent Chat Messages when a new matching message arrives, should the dialog preserve their position with an indicator, automatically scroll to the new message, or insert it silently?
- Captured: Automatically scroll Recent Chat Messages to the newly arriving matching message.
- Doc updates: None.
- Flags: Respect reduced-motion preferences and avoid animated scrolling when reduced motion is enabled.

### Q47 — Compact-window dialog layout

- Asked: When the Electron window cannot fit the normal medium dialog, should it grow to the available viewport, retain a clipped fixed size, or switch to Xtra's bottom sheet?
- Captured: Keep the centered-dialog interaction model, but expand the dialog to nearly the full available width and height. Preserve the fixed header and footer with one scrollable body.
- Doc updates: None.
- Flags: Define minimum viewport gutters and ensure the close control remains visible at extreme supported window sizes.

### Q48 — Destructive-action state revalidation

- Asked: Before Ban, Timeout, Unban, or Delete executes, should StreamFusion revalidate the latest Platform state, rely on the state loaded when the dialog opened, or submit immediately and handle rejection afterward?
- Captured: Revalidate current Platform state immediately before every destructive moderation action. If the state changed, cancel the pending action, refresh the dialog, and require the moderator to act from the updated state.
- Doc updates: None.
- Flags: The revalidation response must be tied to the active Channel, target user, selected message, and action attempt so a stale response cannot authorize a different mutation.

### Q49 — Successful moderation-action feedback

- Asked: After a moderator action succeeds, should the dialog remain open and refresh itself, close, or remain open without refreshing?
- Captured: Keep the dialog open. Immediately refresh the relevant profile/action state and Moderation history, and show a brief success toast.
- Doc updates: None.
- Flags: Prevent duplicate submissions while the mutation and post-success refresh are in progress.

### Q50 — Failed moderation-action recovery

- Asked: If a moderator action fails, should the dialog preserve the attempted input with an exact safe error and Retry, show only a generic toast, or close?
- Captured: Keep the dialog open and preserve entered values. Show the exact safe Platform error beside the failed action and provide Retry.
- Doc updates: None.
- Flags: Sanitize Platform error details so credentials, request internals, and other sensitive implementation data never reach the UI.

### Q51 — Platform-aware Timeout durations

- Asked: Should Timeout presets and Custom-duration validation adapt to each Platform's supported limits, remain identical with unsupported choices disabled, or offer only Custom?
- Captured: Show only presets that the active Platform supports. Constrain Custom duration to the Platform's documented minimum and maximum and explain invalid values inline.
- Doc updates: None.
- Flags: Confirm current timeout duration limits against each Platform's live official API documentation during implementation.

### Q52 — Timeout preset set

- Asked: Should the redesigned dialog retain the current six presets, simplify them, or use a different set?
- Captured: Retain `10s`, `1m`, `10m`, `30m`, `24h`, and `7d`, and add Custom. Filter out any preset the active Platform does not support.
- Doc updates: None.
- Flags: The picker must always have a valid default after Platform filtering; prefer `10m` when supported.

### Q53 — Moderation-history empty and failure states

- Asked: If Moderation history is verified empty or cannot load, should the section remain visible with distinct states or be hidden?
- Captured: Keep the section visible. This was later refined by Q56: show `No moderation actions available` for a verified empty result and `Couldn’t load · Retry` for a load failure.
- Doc updates: None.
- Flags: Resolved by Q56; do not present a partial or unauthorized query result as verified empty.

### Q54 — Badge tooltip content

- Asked: When a header badge is hovered or keyboard-focused, should its tooltip identify both its full name and source, only its name, or provide no tooltip?
- Captured: Provide an accessible tooltip with the badge's full name and Platform/source, for example `Subscriber · Twitch` or `Supporter · Kick`.
- Doc updates: None.
- Flags: Badge image alternative text must not duplicate tooltip announcements during ordinary dialog navigation.

### Q55 — Scope-reconnect dialog behavior

- Asked: During a Platform reconnect for missing scopes, should the profile dialog remain open but locked, close first, or stay interactive?
- Captured: Keep the dialog open and lock its interactive content while reconnect is in progress. On success, refresh affected data and actions in place. On cancellation or failure, restore the prior state and offer Retry.
- Doc updates: None.
- Flags: Preserve the target Channel and user identity across the reconnect without retaining stale authorization results.

### Q56 — Moderation-history coverage disclosure

- Asked: Because the Platforms do not expose a complete historical moderation-log endpoint, should the section disclose its limited coverage, remain unqualified, or be hidden?
- Captured: Keep the title `Moderation history`, add subtle coverage copy `Platform actions available to StreamFusion`, and use `No moderation actions available` for a verified empty result. This describes Platform-originated data without claiming an exhaustive archive.
- Doc updates: None.
- Flags: None; Q53's provisional empty-state copy was reconciled to the approved wording.

### Q57 — Selected-message stability during live updates

- Asked: If live updates push the selected message outside the capped 10-message list, should the selected footer retain it, automatically select the newest message, or clear selection?
- Captured: Retain the originally selected message in the selected-message footer until the viewer explicitly selects another message. Live updates and list pruning never retarget Reply, Copy, or Delete.
- Doc updates: None.
- Flags: Keep the pinned selection's deletion/current-eligibility state synchronized even when it is no longer present in the visible recent-message collection.

### Q58 — Dialog dismissal during pending work

- Asked: Should the dialog block dismissal only after a mutation/reconnect is submitted, always permit closing, or block from the moment a confirmation opens?
- Captured: Allow dismissal while the viewer is reviewing or editing a confirmation. Once a moderation mutation or Platform reconnect is submitted, block Escape, outside-click, and Close until that operation settles. Allow closing during the post-success refresh.
- Doc updates: None.
- Flags: Submitted operations need a visible progress state and accessible status announcement while dismissal is disabled.

### Q59 — Grill completion

- Asked: Should the session close with documentation reconciliation and an implementation PRD, produce another integrated mockup first, or continue grilling?
- Captured: Close the grill, reconcile the documentation, and produce the implementation PRD.
- Doc updates: Reconciled the running summary and open flags; verified the `Recent Chat Messages` glossary entry; produced and linked `prd.md`. No ADR was warranted.
- Flags: None.

## Open flags (pending input)

- No unresolved product decisions remain.
- Implementation validation — Platform adapters: validate live first-party fallback schemas for account creation and exact follow dates; fall back explicitly when unsupported.
- Implementation validation — Platform auth/events: confirm Kick event-subscription authorization for moderator-owned versus broadcaster-owned Channels and keep every connect/reconnect path on the canonical scope sets.
- Implementation validation — moderation adapters: confirm current official timeout limits and reason support for each Platform.
- Implementation validation — UI/accessibility: verify focus restoration when the opening message leaves the virtualized list, reduced-motion behavior for live scrolling, and minimum viewport gutters.
- Implementation validation — mutation safety: correlate revalidation to the exact action attempt, prevent duplicate submission, sanitize Platform errors, and keep pinned-message eligibility synchronized.
