# Convert Pasted Emote-Rich Drafts as One Undo Transaction

Status: ready-for-agent
Type: AFK
User stories: 25–26, 28, 30, 32

## Parent

[Stream Emote Typeahead and Inline Draft Rendering](../prd.md)

## What to build

Apply the approved automatic conversion rules to pasted drafts while preserving paste as one coherent history transaction. Multiple eligible canonical names may render inline, but one Undo must restore the exact pasted text and selection. Suppression, ambiguity, eligibility, Platform/Channel scope, and serialization remain identical to typed conversion.

## Acceptance criteria

- [ ] Paste converts every complete canonical-case, usable, unambiguous name that is valid under the composing Platform and Channel.
- [ ] Mentions, commands, URLs, emails, ambiguous duplicates, and unavailable subscriber emotes remain text.
- [ ] Mixed plain text, punctuation, newlines, and multiple Inline Stream Emotes preserve their exact ordering and caret placement.
- [ ] Paste plus every derived conversion is recorded as one history transaction.
- [ ] One Undo restores the exact original pasted text and selection; redo reconverts without changing outbound emote identities.
- [ ] Disabling automatic emotes leaves pasted names as text while explicit `:` typeahead remains available.
- [ ] Twitch/Kick serialization and simultaneous-composer isolation remain correct.
- [ ] Focused tests with `// Guards:` comments cover multi-token paste, suppression, ambiguity, eligibility, punctuation, newlines, Undo/redo, preference, both Platforms, and multistream.
- [ ] Focused tests, lint, type-check, and build pass; multi-token paste and one-step Undo are verified with Electron MCP.

## Blocked by

- [04 - Render Completed Names as Inline Stream Emotes](./04-inline-stream-emote-conversion.md)
- [05 - Make Automatic Conversion Reversible with Backspace and Undo](./05-reversible-inline-conversion-history.md)

## Comments
