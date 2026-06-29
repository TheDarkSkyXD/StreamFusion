# Apply deleted-message display to timeout/ban removals and live attribution
Status: done
Type: AFK

## Parent

`.scratch/grill-with-docs/2026-06-29-deleted-message-moderation-chat/prd.md`

## What to build

Extend the deleted-message display behavior to messages marked deleted because a user was timed out or banned. Each locally retained message removed by timeout/ban should use the same deleted-message display dropdown behavior as a direct message delete. Timeout/ban notices should still show the moderation action, while any removed-message body such as "Last: ..." follows the deleted-message display mode.

Extend the dev-only DebugPanel Chat Sim tool with a timeout/ban deleted-message preview control for the selected Twitch/Kick platform so developers can see the mass-deleted-message behavior without relying on live moderation events.

Use live chat payload attribution only in this slice. Show known moderator usernames when the platform provides them, including Kick `banned_by` for ban/timeout events. Show an explicit "unknown moderator" fallback when attribution is missing, including current Twitch live timeout/ban/delete payloads and Kick delete/clear payloads.

## Acceptance criteria

- [x] Messages marked deleted by timeout/ban render with the same dropdown-controlled behavior as direct message deletes.
- [x] Timeout/ban notices keep showing the moderation action even when deleted-message content is hidden.
- [x] Timeout/ban "Last: ..." message-body visibility follows the deleted-message display mode.
- [x] Kick ban/timeout notices show the moderator username when `banned_by` is present.
- [x] Twitch and Kick moderation events without moderator attribution render an explicit unknown-moderator fallback.
- [x] Missing original message content still falls back to the plain tombstone.
- [x] The dev-only Chat Sim tool has an explicit timeout/ban deleted-message preview control that works for the selected Twitch or Kick platform.
- [x] Tests cover timeout/ban mass-deleted messages, `Last: ...` visibility, known Kick moderator attribution, and unknown attribution fallback.
- [x] Tests cover the Chat Sim timeout/ban deleted-message preview injection.

## Blocked by

- `.scratch/grill-with-docs/2026-06-29-deleted-message-moderation-chat/issues/01-deleted-message-display-dropdown.md`

## Comments

- Closed after storing deletion metadata for direct and timeout/ban deletions, applying the dropdown behavior to mass-deleted retained rows, showing Kick `banned_by`, and adding Chat Sim `timeout delete`.
