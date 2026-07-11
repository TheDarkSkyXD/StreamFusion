# Rank and Disambiguate Trustworthy Typeahead Results

Status: ready-for-agent
Type: AFK
User stories: 6–10, 30–31

## Parent

[Stream Emote Typeahead and Inline Draft Rendering](../prd.md)

## What to build

Make the contextual row's results deterministic, relevant, and provider-safe end to end. Search must preserve every provider-specific identity, filter before limiting, rank textual relevance first, boost viewer habits only within equal relevance, and visibly disambiguate duplicate canonical names without changing the approved image-only density.

## Acceptance criteria

- [ ] Matching and deduplication use `provider:id`; exact-name lookup returns all usable candidates instead of collapsing duplicate names.
- [ ] Results rank exact names before prefixes, prefixes before substring matches, then favorites/recents, followed by stable catalog order.
- [ ] Disabled providers and unusable or unknown subscriber-only candidates are removed before ranking and limiting.
- [ ] At most 9 results are exposed and the row never shows a scrollbar.
- [ ] Duplicate canonical names remain separate results with compact provider marks and unambiguous tooltip, focus, and screen-reader identity.
- [ ] Favorite and recent storage/boosting do not collide when different providers reuse an id or name.
- [ ] Full-picker locked-emote discovery remains unchanged.
- [ ] Twitch, Kick, duplicate-name, disabled-provider, eligibility, ordering, 9-result cap, and scrollbar suppression are covered by focused tests with `// Guards:` comments.
- [ ] Focused tests, lint, type-check, and build pass; ordering and duplicate presentation are verified in the running app with Electron MCP.

## Blocked by

- [01 - Contextual `:` Stream Emote Row](./01-contextual-colon-emote-row.md)

## Comments
