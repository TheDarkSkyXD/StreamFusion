# Deleted Message Moderation Chat: Grilling Session Notes
Date: 2026-06-29 · Goal: Define how StreamFusion should capture, persist, and optionally render deleted messages, timeouts, bans, moderator attribution, and emotes across Twitch and Kick chat.

## PRD

- [prd.md](prd.md)

## Summary / key decisions

- Deleted message content visibility should be available to every viewer, not limited to moderators/broadcasters.
- The deleted-message content toggle should default on.
- When enabled, deleted messages should render as highlighted deleted-message rows instead of plain tombstones.
- "Separate file" means a separate deleted-message highlight UI component file, not a persisted audit/log file.
- When moderator attribution is missing from the platform payload, the UI should show an explicit unknown-moderator fallback.
- The deleted-message visibility toggle should also control timeout/ban "Last: ..." message-body visibility.
- If the original deleted message content is unavailable locally, render the existing plain "Message deleted" tombstone.
- The new deleted-message-content switch belongs in the full Settings -> Chat panel only, next to the deleted-message notice controls.
- Deleted-message highlights should support a settings-controlled detail mode with three options: compact detail, message content only, and audit-style detail.
- The default deleted-message detail mode should be full compact detail.
- The existing "Show deleted-message notices" toggle is the master switch. When off, deleted rows are hidden entirely. When on, deleted rows render as tombstones or highlighted content based on the new content setting.
- Deleted-message display mode should be chosen from a dropdown/select in Chat settings.
- Moderator attribution should be split into two implementation issues: live payload support first, then Twitch EventSub/mod-log enrichment as a follow-up.
- Messages marked deleted by timeout/ban mass deletion should use the same deleted-message highlight behavior as direct message deletions.
- Settings should use one dropdown under the existing deleted-message notice master switch, not a separate content switch plus dropdown.
- Frosty's Twitch approach should inform implementation: match `CLEARMSG` `target-msg-id` against locally retained visible/buffered messages, mark the original message deleted, and render the retained parsed content/emotes when the setting allows it.
- Frosty-style per-message tap-to-reveal should not be included; the dropdown controls deleted-message visibility.
- When deleted-message content display is enabled, deleted messages should always be visible whenever StreamFusion has the original message retained locally.
- Deleted-message highlights should use the event-highlight structure with a moderation tone.

## Q&A log

### Q1 - Visibility scope
- Asked: Who should be allowed to see the full deleted message content when the toggle is on?
- Captured: User chose option 3: everyone can see deleted message content, and the setting defaults on.
- Doc updates: none; this is a product behavior decision rather than stable domain vocabulary.
- Flags: Privacy and platform-policy risk should be called out in the PRD/implementation plan.

### Q2 - Separate file meaning
- Asked: When the user said "make it a highlight and a seperate file," should that mean a separate UI component file, a persisted audit file, or both?
- Captured: User chose option 1: create a separate UI component file for deleted-message highlight rendering.
- Doc updates: none.
- Flags: none.

### Q3 - Missing moderator attribution
- Asked: What should the UI show when Twitch/Kick does not provide the moderator username for a delete, timeout, ban, or clear event?
- Captured: User chose option 1: show an explicit fallback such as "by unknown moderator" when attribution is missing.
- Codebase facts: Twitch live delete/timeout/ban currently lacks moderator attribution; Kick ban/timeout includes `banned_by`, but Kick delete/clear does not.
- Doc updates: none.
- Flags: If richer Twitch attribution is required later, it may need EventSub/mod-log integration beyond the live chat event payload.

### Q4 - Timeout/ban last-message visibility
- Asked: Should the new "show deleted messages" toggle also control the `Last: ...` message currently shown on timeout/ban notices?
- Captured: User chose option 1: the same toggle should control timeout/ban last-message content. When off, timeout/ban notices still show the moderation action and moderator attribution but hide the removed message body.
- Doc updates: none.
- Flags: none.

### Q5 - Missing deleted-message content fallback
- Asked: If a delete event arrives but StreamFusion no longer has the original message in the local buffer, what should the highlighted row show?
- Captured: User chose option 2: render the existing plain "Message deleted" tombstone.
- Doc updates: none.
- Flags: none.

### Q6 - Toggle placement
- Asked: Where should the new show-deleted-message-content switch appear?
- Captured: User chose option 1: expose it in the full Settings -> Chat panel only, not the in-chat quick settings gear.
- Doc updates: none.
- Flags: none.

### Q7 - Deleted-message highlight content
- Asked: What should the highlighted deleted-message row include when content is available?
- Captured: User wants a settings option with all three display modes: compact detail, message content only, and audit-style detail. Compact detail includes sender, message content with emotes, deletion time, and moderator attribution. Message content only shows just the deleted message text/emotes in a highlight. Audit-style detail includes sender, content, deletion time, moderator, platform, and message id.
- Doc updates: none.
- Flags: none.

### Q8 - Default deleted-message detail mode
- Asked: Which of the three display modes should be the default?
- Captured: User chose option 1: full compact detail should be the default.
- Doc updates: none.
- Flags: none.

### Q9 - Toggle interaction and display-mode control
- Asked: How should the existing "Show deleted-message notices" toggle interact with the new "Show deleted message content" toggle?
- Captured: User chose option 1: the notice toggle is the master switch. User also clarified that the display options should be selected from a dropdown controlling how deleted messages are displayed.
- Doc updates: none.
- Flags: none.

### Q10 - Moderator attribution implementation depth
- Asked: Should the first implementation stay with live chat payloads only, add Twitch EventSub/mod-log enrichment now, or split into two issues?
- Captured: User chose option 3: split into two issues. First issue uses live payloads and unknown-moderator fallback. Follow-up issue investigates/adds Twitch EventSub/mod-log enrichment for richer attribution.
- Doc updates: none.
- Flags: The follow-up issue should explicitly validate whether EventSub/mod-log data can be correlated to live chat rows without races or duplicates.

### Q11 - Timeout/ban mass-deleted messages
- Asked: When a user is timed out or banned and all their messages get marked deleted, should each affected message render with the new deleted-message highlight too?
- Captured: User chose option 1: yes, every affected message should use the same deleted-message highlight behavior as direct message deletes.
- Doc updates: none.
- Flags: none.

### Q12 - Settings model
- Asked: Should this be modeled as a separate content toggle plus dropdown, or as one dropdown under the existing deleted-message notice toggle?
- Captured: User chose option 1: one dropdown. Keep "Show deleted-message notices" as the master switch, then add "Deleted message display" with tombstone only, message content only, full compact detail, and audit-style detail. Default is full compact detail.
- Doc updates: none.
- Flags: none.

### Q13 - Frosty reference check
- Asked: User asked to inspect `reference/frosty-main` to see how Frosty handles getting the original deleted message for Twitch.
- Captured: Frosty does not fetch deleted content from Twitch. It parses Twitch `CLEARMSG`, reads the `target-msg-id`, searches both rendered messages and buffered messages for a matching original message id, and changes that original message's command to `clearMessage`. Because the original message object remains in memory, Frosty can later render the original parsed text/emotes when `showDeletedMessages` is enabled or the user taps the tombstone to reveal that specific message.
- Codebase facts: `reference/frosty-main/lib/models/irc.dart` has `IRCMessage.clearMessage(...)`, `reference/frosty-main/lib/screens/channel/chat/stores/chat_store.dart` calls it for `Command.clearMessage`, and `reference/frosty-main/lib/screens/channel/chat/widgets/chat_message.dart` passes `showMessage` based on the global `showDeletedMessages` setting or per-message `revealedMessageIds`.
- Doc updates: none.
- Flags: none.

### Q14 - Per-message tap-to-reveal
- Asked: Should StreamFusion copy Frosty's tap-to-reveal individual deleted-message behavior when the dropdown is set to tombstone only?
- Captured: User chose option 2: no, the dropdown controls everything.
- Doc updates: none.
- Flags: Decide visual style for deleted-message highlight.

### Q15 - Always show retained deleted messages
- Asked: User clarified "we want to always see the deleted messages when its toggled on."
- Captured: When deleted-message display is enabled, all locally retained deleted messages should remain visible, including direct deletes and messages marked deleted by timeout/ban. If the original message is unavailable because StreamFusion never saw it or it was trimmed, the existing plain "Message deleted" tombstone remains the fallback.
- Doc updates: none.
- Flags: Decide visual style for deleted-message highlight.

### Q16 - Deleted-message highlight visual style
- Asked: Should the deleted-message highlight look kind of like StreamFusion's existing sub highlights?
- Captured: User chose option 1: use the event-highlight style with a moderation tone. The row should share the newer highlight structure (left accent line, icon, label, contained content) but use a muted red/amber moderation treatment rather than celebratory subscription styling.
- Doc updates: none.
- Flags: none.

### Q17 - Completeness backstop
- Asked: Is there anything else before turning the grill into a PRD?
- Captured: User said "ok then done."
- Doc updates: PRD written to `prd.md`.
- Flags: none.

### Q18 - Debug console preview
- Asked: User added that StreamFusion should have a debug console button to see the deleted-message behavior for Twitch and Kick if one does not already exist.
- Captured: StreamFusion already has a dev-only DebugPanel with a Chat Sim tool and Twitch/Kick platform selector. It currently has a generic "delete last" moderation button, but the feature should add explicit deleted-message preview controls so devs can inject retained deleted-message examples for both Twitch and Kick without manual setup.
- Doc updates: PRD and implementation issues updated.
- Flags: none.

## Open flags (pending input)

- None.
