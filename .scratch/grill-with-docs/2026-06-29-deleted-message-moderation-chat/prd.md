# Deleted Message Moderation Chat PRD

## Problem Statement

StreamFusion currently marks deleted chat messages as deleted but renders them as a plain "Message deleted" tombstone. Moderators and viewers cannot see the original deleted content even when StreamFusion already retained the original message locally. Timeout and ban notices also expose limited "Last: ..." context without a unified display control.

Users need a chat setting that can reveal retained deleted messages, preserve emotes/emoji rendering, and show moderation context for Twitch and Kick without pretending the app knows moderator attribution that the platform did not provide.

## Solution

Add a deleted-message display dropdown under the existing Settings -> Chat "Show deleted-message notices" master switch. The existing notice switch remains authoritative:

- If "Show deleted-message notices" is off, deleted rows are hidden entirely.
- If it is on, "Deleted message display" controls how deleted rows render.

The dropdown options are:

- Tombstone only
- Message content only
- Full compact detail
- Audit-style detail

Default: Full compact detail.

Add a separate `DeletedMessageHighlight` chat UI component file. Deleted-message highlights should use StreamFusion's existing event-highlight visual structure with a moderation tone: left accent line, icon, label, contained content, and muted red/amber styling rather than celebratory subscription styling.

When StreamFusion has the original message locally, direct deletes and timeout/ban mass-deleted messages must remain visible in the selected deleted-message display mode. The retained original content must include parsed content fragments so emotes and emojis render normally. If the original message is not available locally because StreamFusion never saw it or it was already trimmed, render the existing plain "Message deleted" tombstone.

Extend the dev-only DebugPanel Chat Sim tool so developers can preview deleted-message behavior for the selected Twitch or Kick platform without manual setup. The existing Chat Sim platform selector can be reused, but there should be explicit deleted-message preview controls for retained direct deletes and timeout/ban-deleted messages.

Use Frosty's Twitch approach as the reference model: match Twitch `CLEARMSG` / `target-msg-id` to a locally retained message, mark the original message deleted, and render the retained parsed content when settings allow. StreamFusion already does the core local-retention part by marking `isDeleted` without erasing `content` or `rawContent`.

Moderator attribution should ship in two slices:

- Slice 1: Use live chat payloads only. Show known moderator usernames when provided, and "unknown moderator" when missing.
- Slice 2: Investigate and add Twitch EventSub/mod-log enrichment if deleted-message and moderation events can be correlated reliably without races or duplicates.

## User Stories

- As a viewer, I can choose how deleted messages appear in chat so I can either keep tombstones or see retained deleted content.
- As a viewer, I can see deleted-message emotes and emojis when content display is enabled.
- As a viewer, I can see who performed a moderation action when the platform payload provides that moderator username.
- As a viewer, I see "unknown moderator" when the platform does not provide moderator attribution.
- As a moderator, I can keep timeout/ban notices useful while letting the deleted-message display setting control whether removed message bodies appear.

## Implementation Decisions

- Add a `ChatDisplayPreferences` field for deleted-message display mode, with default full compact detail.
- Preserve the existing `showClearMsg` preference as the master visibility switch.
- Add the dropdown to the full Settings -> Chat panel only, next to deleted-message notice controls. Do not add it to the in-chat quick settings popover.
- Do not add Frosty-style per-message tap-to-reveal. The dropdown controls all deleted-message visibility.
- Add explicit dev-only Chat Sim controls for previewing the new deleted-message render states on both Twitch and Kick.
- Direct message deletes and timeout/ban deleted messages should use the same display behavior.
- Compact detail includes sender, message content with emotes, deletion time, and moderator attribution.
- Message content only shows only the deleted message text/emotes in a highlight.
- Audit-style detail includes sender, content, deletion time, moderator, platform, and message id.
- For missing original content, keep the existing plain tombstone fallback.
- For missing moderator attribution, render an explicit unknown-moderator fallback.
- Kick ban/timeout can use `banned_by` from live payloads. Twitch live timeout/ban/delete and Kick delete/clear may not provide moderator attribution.

## Testing Decisions

- Add or update chat settings tests for the new dropdown, default value, and spread-preserved preference writes.
- Add `ChatMessage`/deleted-highlight tests for all dropdown modes.
- Add or update DebugPanel/ChatSimTool tests for deleted-message preview injection.
- Test that `showClearMsg` remains the master switch.
- Test that deleted messages retain and render emote fragments when content display is enabled.
- Test direct message deletion and timeout/ban mass-deleted messages.
- Test missing-content fallback to the plain tombstone.
- Test moderator attribution known vs. unknown fallback.
- For UI work, manually verify in a running app/browser/electron surface after automated tests pass.

## Out of Scope

- Persisting deleted messages to a separate audit/log file.
- Per-message tap-to-reveal behavior.
- Showing deleted content that StreamFusion never received or already trimmed.
- Twitch EventSub/mod-log enrichment in the first implementation slice.
- Adding the setting to the in-chat quick settings popover.

## Further Notes

- This feature intentionally allows all viewers to see retained deleted-message content when the setting is enabled; it is not restricted to moderators or broadcasters.
- The privacy/platform-policy risk should be called out in implementation tickets and review.
- The EventSub/mod-log follow-up should validate correlation mechanics before implementation.
