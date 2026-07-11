# Harden Caret-Local Stream Emote Typeahead and Persist the Opt-Out

Status: ready-for-agent
Type: AFK
User stories: 1–3, 28–29, 32, 38–40

## Parent

[Stream Emote Typeahead and Inline Draft Rendering](../prd.md)

## What to build

Harden the shared contextual row's Frosty-style ordinary caret-local typing while mentions, commands, URLs, and email-like tokens remain quiet. Add the approved default-on persisted preference so users can disable automatic activation without losing backward-compatible explicit `:` search.

## Acceptance criteria

- [ ] Any non-empty ordinary active token opens the shared row without requiring `:`.
- [ ] Active-token detection is caret-local, preserves text before and after the caret, and works in the middle of multiline drafts.
- [ ] Tokens beginning with `@` or `/`, URLs, and email-like tokens suppress automatic emote mode.
- [ ] Mention autocomplete has exclusive priority and keyboard ownership for `@` tokens.
- [ ] Catalog-aware token boundaries support provider-defined punctuation names without using an ASCII-only punctuation allowlist.
- [ ] Automatic queries use the same scoping, eligibility, ranking, cap, duplicate identity, and interaction behavior as explicit `:` queries.
- [ ] Two simultaneous Twitch/Kick or same-Platform Channel composers cannot leak automatic query or selection state.
- [ ] Chat settings exposes the default-on “Emote suggestions while typing” preference with copy explaining automatic suggestions and inline conversion.
- [ ] Disabling the preference suppresses ordinary-token activation while explicit `:` typeahead still works.
- [ ] Existing users hydrate to the default-on value and the preference persists through restart-compatible storage hydration.
- [ ] Focused tests with `// Guards:` comments cover thresholds, suppression, mention precedence, caret-middle editing, punctuation, persistence, both Platforms, and simultaneous composers.
- [ ] Focused tests, lint, type-check, and build pass; caret, setting, mention, and multistream behavior are verified with Electron MCP.

## Blocked by

- [01 - Contextual `:` Stream Emote Row](./01-contextual-colon-emote-row.md)
- [02 - Rank and Disambiguate Trustworthy Typeahead Results](./02-rank-and-disambiguate-emote-results.md)

## Comments
