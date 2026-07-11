# Render Completed Names as Inline Stream Emotes

Status: ready-for-agent
Type: AFK
User stories: 19–22, 27, 32

## Parent

[Stream Emote Typeahead and Inline Draft Rendering](../prd.md)

## What to build

Automatically render a completed typed canonical Stream Emote name as an Inline Stream Emote. Conversion must be caret-local, case-sensitive, unique, usable, delimiter-aware, and serialization-safe for Twitch and Kick. Ambiguous, unavailable, or noncanonical text must remain text.

## Acceptance criteria

- [ ] A unique usable canonical-case name converts only when completed by valid whitespace, newline, or catalog-aware boundary punctuation.
- [ ] Noncanonical case, ambiguous provider duplicates, unknown eligibility, and unusable subscriber emotes remain editable text.
- [ ] Only the token at the caret is replaced; surrounding text, delimiter, punctuation, multiline content, and caret position are preserved.
- [ ] The Inline Stream Emote retains `provider:id`, canonical name, image identity, outbound serialization data, and automatic insertion origin.
- [ ] Twitch native, Twitch third-party, Kick native markup, and Kick third-party messages serialize and optimistically echo exactly as existing contracts require.
- [ ] The automatic-emote preference disables typed conversion while explicit typeahead/picker insertion remains available.
- [ ] Two simultaneous composers cannot leak exact lookup, inline identity, Channel eligibility, or serialization.
- [ ] Existing explicitly inserted emotes retain atomic whole-token deletion behavior.
- [ ] Focused tests with `// Guards:` comments cover boundary grammar, punctuation, newline, case, ambiguity, eligibility, caret-middle replacement, both Platforms, serialization, and multistream isolation.
- [ ] Focused tests, lint, type-check, and build pass; inline rendering, caret placement, and outbound behavior are verified with Electron MCP.

## Blocked by

- [02 - Rank and Disambiguate Trustworthy Typeahead Results](./02-rank-and-disambiguate-emote-results.md)
- [03 - Automatic Caret-Local Stream Emote Typeahead](./03-automatic-caret-local-emote-typeahead.md)

## Comments
