# Emoji-as-you-type Chat: Grilling Session Notes
Date: 2026-07-11 · Goal: Define how StreamFusion chat should surface emote suggestions while the user types, using Frost as a reference.

## PRD

- [Stream Emote Typeahead and Inline Draft Rendering](./prd.md)

## Implementation issues

- [01 - Contextual `:` Stream Emote Row](./issues/01-contextual-colon-emote-row.md)
- [02 - Rank and Disambiguate Trustworthy Typeahead Results](./issues/02-rank-and-disambiguate-emote-results.md)
- [03 - Automatic Caret-Local Stream Emote Typeahead](./issues/03-automatic-caret-local-emote-typeahead.md)
- [04 - Render Completed Names as Inline Stream Emotes](./issues/04-inline-stream-emote-conversion.md)
- [05 - Make Automatic Conversion Reversible with Backspace and Undo](./issues/05-reversible-inline-conversion-history.md)
- [06 - Convert Pasted Emote-Rich Drafts as One Undo Transaction](./issues/06-paste-emote-rich-draft-transaction.md)
- [07 - Use Static Thumbnails and Motion-Safe Inline Emotes](./issues/07-motion-safe-emote-previews.md)

## Summary / key decisions

- Scope is Stream Emotes only: Twitch, Kick, 7TV, BTTV, and FFZ. Unicode emoji are out of scope.
- Frost has two separate experiences: automatic suggestions for the current word and inline image rendering for exact emote names.
- StreamFusion will adopt both experiences: Stream Emote Typeahead for partial words and Inline Stream Emotes for completed exact names.
- StreamFusion already has `:`-triggered, keyboard-accessible emote autocomplete and rich emote nodes after selection, plus a permanent Quick Emote Action Bar that sends emotes immediately.
- Visual HTML mockups will be used for layout decisions.
- Implementation override: any non-empty current word opens suggestions without requiring `:`; `:` remains backward-compatible.
- The existing quick-emote row becomes a contextual shared row: typeahead matches temporarily replace quick-send actions, then quick-send actions return when typeahead closes.
- Typeahead is keyboard-first: Left/Right selects, Tab or Enter inserts, Escape closes; Enter sends only after typeahead is closed.
- Matches rank exact name, then prefix, then substring; recent/favorite emotes are boosted within each group, with at most 9 results and no visible scrollbar.
- A typed exact Stream Emote name converts to an Inline Stream Emote only when its canonical case-sensitive token is completed by whitespace, newline, or punctuation; punctuation remains outside the image.
- Backspace immediately after automatic conversion restores the canonical emote name as editable text; explicitly selected emotes retain whole-token deletion.
- Automatic typeahead is suppressed for mentions, slash commands, URLs, and email-like tokens; mention autocomplete takes priority.
- Ambiguous exact names shared by multiple providers do not auto-convert; provider-labeled results remain visible until the user explicitly selects one.
- Typeahead hides subscriber-only Stream Emotes the current viewer cannot send; locked emotes remain discoverable in the full picker.
- Automatic typeahead and inline conversion are enabled by default behind one Chat setting; disabling it preserves explicit `:` autocomplete.
- Typeahead results are image-only for maximum density; provider marks appear on duplicate names, with full identity exposed through tooltip, keyboard-focus text, and accessible labels.
- Animated emotes use static typeahead thumbnails and animate only after inline insertion; reduced-motion mode keeps both static.
- An active query with no results keeps the shared row stable and shows “No matching emotes”; it never falls back to send-now quick actions until typeahead closes.
- Automatic and explicit `:` typeahead share the same horizontal row and behavior; the old vertical emote popover is retired.
- Paste processing converts complete, usable, unambiguous canonical emote names inline while preserving the original paste as one Undo operation.
- The user considers the behavior and visual decision tree complete and approved PRD close-out.
- Close-out review added explicit constraints for per-composer Platform/Channel scoping, `provider:id` identity, fail-closed eligibility, static thumbnail assets, exclusive keyboard ownership, catalog-aware token parsing, and draft-history transactions.

## Q&A log

### Q1 — Emotes versus Unicode emoji
- Asked: Does “emoji” mean stream emotes, Unicode emoji, or both?
- Captured: Stream emotes only — Twitch, Kick, 7TV, BTTV, and FFZ.
- Doc updates: Added **Stream Emote** to `CONTEXT.md`; established “emote” as the canonical term and reserved “emoji” for Unicode emoji.
- Flags: None.

### Q2 — Suggestion typeahead versus inline rendering
- Asked: Should StreamFusion adopt Frost's suggestion surface, inline rendering, or both?
- Captured: Both. Partial words show matching Stream Emotes, and completing an exact emote name renders the image inside the draft.
- Doc updates: Added **Stream Emote Typeahead** and **Inline Stream Emote** to `CONTEXT.md`.
- Flags: The precise trigger threshold and how the contextual suggestions coexist with the permanent Quick Emote Action Bar remain open.

### Q3 — Visual companion
- Asked: Should layout choices be compared through visual mockups or kept text-only?
- Captured: Use visual mockups.
- Doc updates: None.
- Flags: None.

### Q4 — Typeahead trigger
- Asked: Should typeahead follow Frost exactly, retain `:` only, or use a hybrid trigger?
- Captured: Hybrid. Ordinary words trigger after 2 characters; the existing `:` path remains available after 1 character.
- Doc updates: None; this is a reversible interaction detail and does not warrant an ADR.
- Flags: Decide how exact-name recognition commits an Inline Stream Emote and which tokens suppress typeahead.

### Q5 — Suggestion row layout
- Asked: Should typeahead replace the quick-emote row, stack beneath it, or float over chat?
- Captured: Use the contextual swap. While typeahead is active, the shared row shows matching Stream Emotes; otherwise it shows the existing quick-send emotes.
- Visual: `designs/suggestion-row-layouts.html` (Option A selected).
- Doc updates: None; this is a reversible UI composition choice and does not warrant an ADR.
- Flags: The row changes semantics by state, so accessibility labels and interaction behavior must make “insert” versus “send now” unambiguous.

### Q6 — Keyboard interaction
- Asked: Should the horizontal typeahead support full keyboard insertion, Tab-only insertion, or Frost-style pointer-only selection?
- Captured: Full keyboard support. Left/Right changes selection; Tab or Enter inserts; Escape closes. Enter sends only when typeahead is no longer active.
- Inferred companion behavior: Clicking a typeahead result inserts/replaces the active token and never sends immediately; the idle quick-emote row retains its existing send-now behavior.
- Doc updates: None.
- Flags: Accessible state labels must announce which row mode is active and whether activation inserts or sends.

### Q7 — Match ranking and result cap
- Asked: Should matches use relevance ranking, Frost's unbounded provider-order substring search, or prefix-only matching?
- Captured: Relevance ranking. Exact names first, then prefixes, then substring matches; recent/favorite emotes rank higher within each group; cap at 20 horizontally scrollable results.
- Inferred platform scope from Q1 and current provider contracts: Twitch typeahead searches Twitch, 7TV, BTTV, and FFZ; Kick typeahead searches Kick and 7TV. Cross-platform native emotes are excluded before ranking and limiting.
- Doc updates: None.
- Flags: Decide how duplicate names across providers are presented and resolved.

### Q8 — Inline conversion boundary
- Asked: Should a typed exact name convert immediately, at token completion, or only after explicit selection?
- Captured: Convert at token completion. The typed name must match the canonical case-sensitive emote name and be followed by space, newline, or punctuation. Preserve punctuation after the inline image.
- Doc updates: None.
- Flags: Define undo/Backspace behavior for automatically converted emotes.

### Q9 — Undoing automatic conversion
- Asked: Should immediate Backspace restore editable text, delete the emote, or remove only the trailing delimiter?
- Captured: Restore the canonical emote name as editable text with the caret after it, allowing correction or continued typing.
- Clarification: This special restoration applies to automatically converted Inline Stream Emotes. Emotes explicitly inserted from typeahead or a picker retain the current one-Backspace whole-token deletion behavior.
- Doc updates: None.
- Flags: The implementation must preserve insertion origin or equivalent undo metadata without changing the outbound emote identity.

### Q10 — Suppressed token contexts
- Asked: Should automatic typeahead be suppressed only for mentions, for common non-emote token contexts, or never?
- Captured: Use safe suppression. Do not trigger inside mentions (`@`), slash commands (`/`), URLs, or email-like text; mention autocomplete takes priority.
- Doc updates: None.
- Flags: Token detection must be caret-aware rather than Frost's final-space-delimited-token behavior.

### Q11 — Duplicate emote names across providers
- Asked: Should an ambiguous exact name require selection, use fixed provider priority, or use the most recently used provider?
- Captured: Require explicit selection. Show provider identity for each duplicate and leave the typed token as text until the user chooses one.
- Doc updates: None.
- Flags: Provider labels must remain legible in the image-first horizontal row without adding excessive height.

### Q12 — Unusable subscriber emotes
- Asked: Should typeahead hide subscriber-only emotes the viewer cannot send, show them disabled, or allow selection and rely on server rejection?
- Captured: Hide unusable subscriber-only emotes from typeahead. Keep them discoverable in the full emote picker.
- Doc updates: None.
- Flags: Confirm that both Platform integrations expose sufficiently authoritative per-viewer emote eligibility; when eligibility is unknown, the implementation must fail closed for subscriber-only typeahead entries.

### Q13 — User preference
- Asked: Should the feature be always on, controlled by one default-on setting, or split across two settings?
- Captured: Use one default-on Chat setting named “Emote suggestions while typing.” Disabling it turns off automatic typeahead and inline auto-conversion while preserving explicit `:` autocomplete.
- Doc updates: None.
- Flags: The preference must persist with the existing chat display preferences and apply consistently across Twitch and Kick.

### Q14 — Suggestion result presentation
- Asked: Should results be images only, compact image-and-name pills, or detailed provider cards?
- Captured: Images only (visual Option A; numbered answer 2). Use small provider marks only when duplicate names need disambiguation.
- Visual: `designs/suggestion-result-styles.html` (Option A selected).
- Accessibility companion behavior: Full emote name and provider remain available through hover tooltip, keyboard-focus text, and accessible labels.
- Doc updates: None.
- Flags: Define animated-emote behavior in the dense typeahead row and inline editor.

### Q15 — Animated emotes while composing
- Asked: Should animated emotes animate everywhere, only after inline insertion, or only after sending?
- Captured: Keep typeahead thumbnails static; animate inserted Inline Stream Emotes. Respect reduced-motion by keeping both surfaces static.
- Doc updates: None.
- Flags: None.

### Q16 — Empty typeahead results
- Asked: Should an active query with no matches show an explicit empty state, revert to quick-send actions, or hide the row?
- Captured: Keep the shared row's height stable and show “No matching emotes.” Restore quick-send only after dismissal or token completion.
- Inferred companion behavior: While emote data is loading, use quiet fixed-height placeholders in the same row; do not reflow the composer.
- Doc updates: None.
- Flags: None.

### Q17 — Explicit colon autocomplete surface
- Asked: Should `:` use the new shared row, retain the old vertical popover, or open the full picker?
- Captured: Unify automatic and explicit `:` matching in the shared horizontal row with identical ranking, keyboard controls, and insertion behavior. Retire the old vertical emote autocomplete popover.
- Inferred desktop editing behavior: Detect the active token at the caret, replace only that token, preserve text before and after it, and leave the caret after the inserted Inline Stream Emote plus delimiter.
- Doc updates: None.
- Flags: Mention autocomplete remains a separate surface and retains priority for `@` tokens.

### Q18 — Pasted emote names
- Asked: Should canonical emote names convert after any paste, only a single-token paste, or never on paste?
- Captured: Convert complete, usable, unambiguous canonical emote names after paste.
- Undo behavior: Preserve the original pasted text so one Undo restores the paste as text rather than undoing each emote independently.
- Doc updates: None.
- Flags: Paste conversion must not reinterpret URLs, email-like text, mentions, slash commands, unavailable subscriber emotes, or ambiguous provider duplicates.

### Q19 — Completeness backstop
- Asked: Is the decision tree complete, or should behavior/visual exploration continue?
- Captured: Nothing else; close the grill and produce the implementation PRD.
- Doc updates: None.
- Flags: None added.

### Post-grill implementation override — Frosty-style activation and row density
- Asked during implementation: Make emotes appear from ordinary typing rather than requiring `:`, hide the scrollbar, and show only 9 emotes at a time.
- Captured: Any non-empty current word activates Stream Emote Typeahead. `:` remains backward-compatible but is not required. Results are capped at 9 and the row exposes no scrollbar.
- Ordinary no-match behavior: Match Frosty's non-blocking behavior by returning to the familiar quick-send row; deliberate `:` searches retain the explicit “No matching emotes” state.
- Supersedes: Q4's two-character hybrid threshold and Q7's 20-result horizontally scrollable cap.
- Doc updates: Updated `prd.md` and implementation issues 01–03.
- Flags: None.

## Open flags (pending input)

- None currently.
