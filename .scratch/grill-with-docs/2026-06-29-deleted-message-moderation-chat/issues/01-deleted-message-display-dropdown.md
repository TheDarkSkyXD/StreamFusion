# Deleted-message display dropdown and direct-delete highlight
Status: done
Type: AFK

## Parent

`.scratch/grill-with-docs/2026-06-29-deleted-message-moderation-chat/prd.md`

## What to build

Add a Settings -> Chat deleted-message display dropdown under the existing "Show deleted-message notices" master switch, then use it to render direct Twitch/Kick message deletions as either tombstones or highlighted retained-content rows. When StreamFusion has the original message locally, the deleted-message highlight must preserve the original parsed message content, including emotes and emojis. When the original message is unavailable locally, keep the existing plain "Message deleted" tombstone.

Extend the dev-only DebugPanel Chat Sim tool with an explicit deleted-message preview control for the selected Twitch/Kick platform so developers can inject a retained deleted-message example without manually adding and deleting a message first.

The dropdown options are:

- Tombstone only
- Message content only
- Full compact detail
- Audit-style detail

Default to full compact detail. Do not add this control to the in-chat quick settings popover, and do not add Frosty-style per-message tap-to-reveal.

## Acceptance criteria

- [x] Chat display preferences include a deleted-message display mode with default full compact detail.
- [x] The Settings -> Chat panel shows a "Deleted message display" dropdown next to the existing deleted-message notice controls.
- [x] "Show deleted-message notices" remains the master switch: when off, deleted rows are hidden entirely.
- [x] Direct deleted-message rows render according to all four dropdown modes.
- [x] Highlighted deleted-message rows use a separate deleted-message highlight component file and the event-highlight visual structure with a moderation tone.
- [x] Deleted-message content rendering preserves retained parsed content fragments, including emotes and emojis.
- [x] If a deleted message cannot be matched to a retained original message, the UI renders the existing plain "Message deleted" tombstone.
- [x] The dev-only Chat Sim tool has an explicit direct deleted-message preview control that works for the selected Twitch or Kick platform.
- [x] Tests cover default preference behavior, settings writes, master-switch behavior, all dropdown modes, emote/emoji rendering, and missing-content fallback.
- [x] Tests cover the Chat Sim deleted-message preview injection.

## Blocked by

None - can start immediately

## Comments

- Closed after implementing `DeletedMessageHighlight`, `deletedMessageDisplay`, Settings -> Chat dropdown, retained direct-delete rendering, and Chat Sim `deleted msg` preview.
