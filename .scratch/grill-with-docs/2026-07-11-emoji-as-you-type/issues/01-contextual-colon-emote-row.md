# Contextual Frosty-Style Stream Emote Row

Status: done
Type: AFK
User stories: 4–5, 9, 11–18, 30–32, 36–37

## Parent

[Stream Emote Typeahead and Inline Draft Rendering](../prd.md)

## What to build

Replace the current vertical `:` autocomplete popover with the approved fixed-height contextual Stream Emote row for Twitch and Kick. Any non-empty current word must replace idle quick-send actions with at most 9 Platform- and Channel-scoped image results, loading, or an explicit no-results state; no scrollbar is shown. `:` remains backward-compatible but is not required. Pointer and keyboard selection insert into the draft without sending; closing restores quick-send behavior. The first slice must be safe for simultaneous composers, filter unusable candidates before display, preserve full-picker discovery, and expose the image-only controls accessibly.

## Acceptance criteria

- [x] One ordinary typed character activates the contextual row in Twitch and Kick without requiring `:`; backward-compatible `:` queries exclude the colon from replacement.
- [x] Every query receives the composing Platform and Channel explicitly; two simultaneous composers cannot leak catalogs, query state, selection, or eligibility.
- [x] Twitch searches only enabled Twitch/7TV/BTTV/FFZ candidates and Kick searches only enabled Kick/7TV candidates.
- [x] Unknown or unusable subscriber-only candidates are hidden from the row without changing locked-emote discovery in the full picker.
- [x] Quick-send, context-scoped loading, results, and explicit-`:` “No matching emotes” use one fixed row height without shifting chat or the composer; ordinary no-match words return to the familiar quick-send row.
- [x] Result buttons are image-only, use `provider:id` identity, show provider marks for duplicate names, and expose name/provider/action through tooltip, focus text, and accessible labels.
- [x] The row shows at most 9 results, clips any overflow, and never renders a visible horizontal or vertical scrollbar.
- [x] Pointer activation inserts and never sends; Left/Right moves selection; Tab or Enter inserts; Escape closes; sending requires a subsequent Enter after emote mode closes.
- [x] The selected result remains visible within the clipped nine-result row, has a visible focus ring, and result mode/count/identity/action are announced to assistive technology.
- [x] The idle quick-emote row returns with its existing send-now semantics after emote mode closes.
- [x] The old vertical emote autocomplete surface is retired while mention autocomplete remains intact.
- [x] Twitch and Kick insertion preserve existing outbound serialization and optimistic fragment behavior.
- [x] Focused behavior tests include `// Guards:` comments and cover loading, empty, pointer, keyboard, accessibility, Platform scope, Channel scope, and simultaneous composers.
- [x] Focused tests, lint, type-check, and build pass; the running app is verified with Electron MCP in Twitch, Kick, narrow-rail, and multistream scenarios.

## Blocked by

None - can start immediately

## Comments

- Completed 2026-07-11. Ordinary typing activates the Frosty-style row from the first character; `:` remains compatible.
- The row is hard-capped at nine image results and is intentionally non-scrollable in both axes.
- Focused chat tests passed (100/100), along with lint, type-check, and production build.
- Electron verification passed on Twitch and Kick, including the narrow rail and simultaneous-composer behavior. Proof images are under `.scratch/images/`.
- The repository-wide test run reached 4,738 passing tests; its two remaining failures are isolated to concurrent stream-recording work and do not touch this issue's files or behavior.
