# Make Automatic Conversion Reversible with Backspace and Undo

Status: ready-for-agent
Type: AFK
User stories: 23–24, 27

## Parent

[Stream Emote Typeahead and Inline Draft Rendering](../prd.md)

## What to build

Add explicit draft-history transactions for automatically converted Inline Stream Emotes. Immediate Backspace restores the exact source text and selection, but that special restoration expires after any intervening interaction. Explicitly selected emotes retain existing atomic deletion, and Undo/redo never changes outbound identity.

## Acceptance criteria

- [ ] Automatic conversion records the original text, token range, delimiter, selection, emote identity, and insertion origin as one transaction.
- [ ] Immediate Backspace restores the canonical source name as editable text with the correct caret and delimiter behavior.
- [ ] Any intervening edit, selection change, caret move, focus change, Undo, or redo expires immediate-Backspace restoration.
- [ ] Emotes explicitly inserted through typeahead or a picker continue to delete as one atomic token.
- [ ] Undo and redo preserve the exact draft content, selection, and outbound `provider:id` identity.
- [ ] Transaction state is isolated per composer and cannot leak in multistream.
- [ ] Focused tests with `// Guards:` comments cover restoration, every expiry condition, explicit deletion, Undo/redo identity, multiline/caret-middle edits, both Platforms, and simultaneous composers.
- [ ] Focused tests, lint, type-check, and build pass; Backspace, Undo/redo, caret, and focus behavior are verified with Electron MCP.

## Blocked by

- [04 - Render Completed Names as Inline Stream Emotes](./04-inline-stream-emote-conversion.md)

## Comments
