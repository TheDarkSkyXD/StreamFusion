# Stream Emote Typeahead and Inline Draft Rendering

Status: ready-for-agent

## Problem Statement

StreamFusion requires a `:` prefix before it suggests Stream Emotes, and typing a canonical emote name directly leaves plain text in the draft. Frost demonstrates a faster experience: matching emotes appear as the current word is composed, and complete emote names render as images inside the editable draft. StreamFusion already has a rich chat editor, an explicit autocomplete popover, and a permanent quick-emote row, but those pieces do not yet form one predictable, Platform-scoped composing experience.

The feature must work equally well in Twitch, Kick, and simultaneous multistream composers without suggesting the wrong Platform's emotes, selecting an unusable subscriber emote, changing send behavior without warning, corrupting the caret, or breaking Undo.

## Solution

Add a default-on Stream Emote Typeahead and Inline Stream Emote experience to the shared Twitch/Kick chat composer.

Any non-empty current word opens typeahead without requiring `:`; explicit `:` queries remain backward-compatible. Both use one fixed-height horizontal row that temporarily replaces the idle quick-send emotes. Results are image-only, Platform- and Channel-scoped, eligibility-filtered, relevance-ranked, keyboard accessible, capped at 9, and never expose a scrollbar. Completing a unique, usable, case-sensitive canonical emote name at a valid boundary converts it into an animated inline image while retaining its sendable identity. Automatic conversion supports caret-local editing, paste transactions, text restoration on immediate Backspace, and normal Undo.

## User Stories

1. As a Twitch viewer, I want matching Twitch, 7TV, BTTV, and FFZ emotes to appear while I type, so that I can compose chat faster.
2. As a Kick viewer, I want matching Kick and 7TV emotes to appear while I type, so that suggestions belong to the chat I am using.
3. As a viewer, I want any non-empty current word to trigger suggestions without typing `:`, so that typeahead behaves like Frosty.
4. As a viewer, I want existing `:` queries to remain compatible, so that the previous explicit autocomplete habit does not break.
5. As a viewer, I want ordinary and `:` queries to use the same result row, so that autocomplete has one interaction model.
6. As a viewer, I want exact matches before prefixes and prefixes before substring matches, so that likely emotes are easiest to reach.
7. As a viewer, I want recent and favorite emotes boosted within the same relevance group, so that my habits improve ordering without hiding better textual matches.
8. As a viewer, I want at most 9 results with no visible scrollbar, so that typeahead stays compact and visually quiet.
9. As a viewer, I want image-only results, so that more emotes fit in the compact chat rail.
10. As a viewer, I want duplicate emote names marked by provider, so that I can choose the intended identity.
11. As a keyboard user, I want Left and Right to move through matches, so that I do not need a mouse.
12. As a keyboard user, I want Tab or Enter to insert the selected result, so that selection is quick.
13. As a keyboard user, I want Escape to close typeahead, so that I can return Enter to message sending.
14. As a viewer, I want Enter to send only after active emote typeahead has closed, so that a highlighted emote is never bypassed accidentally.
15. As a pointer user, I want clicking a typeahead result to insert it rather than send it immediately, so that I can continue editing the draft.
16. As a viewer, I want the idle quick-emote row to return after typeahead closes, so that existing send-now shortcuts remain available.
17. As a viewer, I want the shared row to keep one height in quick-send, loading, results, and explicit-query empty states, so that chat does not jump while I type.
18. As a viewer, I want an explicit “No matching emotes” state for deliberate `:` searches, while ordinary words with no matches return to the familiar quick-send row, so that Frosty-style typing does not block normal message sending.
19. As a viewer, I want a unique, usable canonical emote name to render inline after I complete the token, so that the draft looks like the message I intend to send.
20. As a viewer, I want punctuation after an emote to remain editable text, so that sentences preserve their punctuation.
21. As a viewer, I want automatic conversion to require canonical case, so that similarly spelled ordinary words are not reinterpreted.
22. As a viewer, I want ambiguous provider duplicates to stay as text until I choose one, so that StreamFusion does not guess the wrong emote identity.
23. As a viewer, I want immediate Backspace after automatic conversion to restore the canonical name as text, so that I can correct or continue it.
24. As a viewer, I want explicitly selected emotes to retain whole-token Backspace deletion, so that existing editor behavior remains consistent.
25. As a viewer, I want pasted canonical emote names to render inline, so that pasting an emote-rich draft produces the expected composition.
26. As a viewer, I want one Undo to restore an entire paste and its automatic conversions, so that paste remains one coherent edit.
27. As a viewer editing in the middle of a draft, I want only the token at my caret replaced, so that surrounding text and caret position are preserved.
28. As a viewer, I do not want emote typeahead inside mentions, slash-command tokens, URLs, or email-like text, so that unrelated text does not produce noise.
29. As a viewer, I want mention autocomplete to take priority over emote typeahead, so that `@` always behaves as a mention.
30. As a viewer, I want subscriber-only emotes hidden when StreamFusion cannot prove I can send them, so that suggestions lead to valid actions.
31. As a viewer, I want locked emotes to remain discoverable in the full picker, so that eligibility filtering does not erase discovery.
32. As a multistream viewer, I want each composer to search its own Platform and Channel, so that one open chat cannot contaminate another.
33. As a viewer, I want animated typeahead thumbnails to remain static, so that the dense row is easy to scan.
34. As a viewer, I want inserted Inline Stream Emotes to animate, so that the draft previews the sent result.
35. As a reduced-motion user, I want typeahead and inline draft emotes to remain genuinely static, so that motion preferences are respected.
36. As a screen-reader user, I want the row mode, selected emote name, provider, result count, and insert-versus-send action announced, so that image-only controls remain understandable.
37. As a keyboard user, I want a visible focus ring and focused emote identity, so that I can track selection in the image-only row.
38. As a viewer, I want one default-on “Emote suggestions while typing” Chat setting, so that I can disable automatic suggestions and conversion.
39. As a viewer who disables the setting, I want explicit `:` autocomplete to keep working, so that disabling automation does not remove deliberate search.
40. As a viewer, I want the preference to apply consistently to Twitch and Kick and persist across restarts, so that behavior is predictable.

## Implementation Decisions

- Use the canonical terms **Stream Emote**, **Stream Emote Typeahead**, and **Inline Stream Emote**. Unicode emoji are not part of this feature.
- Replace the separate emote autocomplete listener with one composer-owned exclusive interaction state machine. Keyboard ownership precedence is `mention > emote > send`. Mention autocomplete remains a separate visual surface but wins whenever the active token is a mention.
- Model the shared emote row with mutually exclusive `quick-send`, context-scoped `loading`, `results`, and explicit-query `no-results` modes. Its height is fixed across modes. An ordinary word with zero matches returns to the familiar quick-send row; a deliberate `:` query with zero matches stays in `no-results`. Quick-send activation sends immediately; result activation only inserts. Mode-specific visible and accessible labels must make that semantic change explicit.
- Ordinary current-word and backward-compatible `:` queries use the shared horizontal results mode. Any non-empty ordinary token activates without a colon; `:` remains accepted and the colon is excluded from replacement. The previous vertical emote autocomplete surface is retired.
- Every query, exact lookup, conversion, and eligibility decision receives the composing Platform and Channel identity explicitly. Do not rely on one global active Channel. Twitch allows Twitch, 7TV, BTTV, and FFZ candidates; Kick allows Kick and 7TV candidates.
- Identify emotes by `provider:id` throughout matching, deduplication, favorites, recents, selection, and inline draft state. Exact-name lookup returns all candidates rather than collapsing names into a single map entry.
- Filter disabled providers and unusable subscriber emotes before ranking and limiting. Subscriber-only candidates appear only when user availability or an authoritative current-Channel eligibility result proves they are usable. Unknown eligibility fails closed in typeahead and automatic conversion; the full picker may continue to display the locked emote.
- Rank case-insensitive query matches by exact name, prefix, then substring. Within a group, boost favorites and recents deterministically, then use stable provider/catalog order. Return at most 9 and hide overflow without exposing a scrollbar.
- Show image-only result buttons. When multiple usable candidates have the same canonical name, add compact provider marks. Hover, keyboard focus, and assistive technology expose the full canonical name and provider.
- Left/Right moves selection among the 9 displayed candidates. Tab or Enter inserts the selected candidate. Escape closes emote mode. Enter sends only on a subsequent keypress after emote mode has closed. Pointer activation inserts only.
- Use a caret-local, catalog-aware token parser. Scan the editable token surrounding the caret, preserve text on both sides, and suppress tokens that begin with `@` or `/` as well as URL- and email-like tokens. Unicode whitespace/newline ends a token. Leading or trailing punctuation is treated as a boundary only when it is not part of any eligible canonical candidate, allowing provider-defined punctuation emotes without an ASCII-only allowlist.
- Automatic inline conversion occurs only when a completed token case-sensitively equals exactly one usable candidate. Conversion is triggered by a valid delimiter or paste transaction. Preserve trailing whitespace, newline, and boundary punctuation outside the inline node.
- Inline draft nodes retain canonical name, provider, id, image identity, outbound serialization data, and insertion origin. Kick native emotes continue to serialize using Kick's required wire representation; text-based third-party and Twitch paths continue to preserve correct optimistic fragments.
- Add explicit draft-history transactions. Automatic conversion records enough information to restore the original text, range, delimiter, selection, and emote identity. Immediate Backspace restores text only when no intervening edit, selection change, caret move, focus change, or Undo has occurred. Explicit picker/typeahead insertions remain atomic whole-token deletions.
- Treat one paste plus all derived conversions as one transaction. One Undo restores the exact original pasted text and selection. Paste conversion uses the same Platform, Channel, eligibility, ambiguity, canonical-case, and suppression rules as typed conversion.
- Add a provider-valid static thumbnail contract. Typeahead must use a genuinely static asset or frame, not a CSS-paused animated image. Inline draft emotes animate only when the existing animated-emote preference permits it and reduced motion is not requested.
- Persist one default-true Chat display preference for automatic typeahead and automatic inline conversion. Its label is “Emote suggestions while typing,” with helper copy explaining both behaviors. Explicit `:` typeahead ignores this automation preference and remains available.
- Update the domain glossary with the three canonical emote terms. No ADR is required because the interaction and composition choices are reversible and do not establish a surprising system boundary.
- Use the approved visual direction from the grill prototypes: contextual row swap and image-only result tiles.

## Testing Decisions

- Prefer behavior tests at the highest stable seam. Do not assert component internals, Tailwind classes, or raw state transitions when the same contract can be observed through rendered behavior, serialized output, selection, or persisted preference.
- Add pure behavior tests for caret-local token parsing, catalog-aware punctuation boundaries, colon removal, URL/email/mention/command suppression, case-sensitive canonical conversion, ambiguous candidates, delimiter preservation, and editing before or after the caret.
- Add emote-query tests for explicit Platform and Channel isolation, provider filtering, `provider:id` deduplication, exact/prefix/substring ordering, recent/favorite boosts, the 9-result cap, hidden overflow/scrollbar, disabled providers, duplicate names, and known/unknown subscriber eligibility.
- Add draft-history tests proving automatic conversion restores text on immediate Backspace, any intervening edit expires that restoration, explicit insertion deletes atomically, multi-token paste is one Undo unit, and outbound emote identity remains unchanged through Undo/redo cycles.
- Add shared-row component tests for quick-send, loading, results, and no-results modes; fixed-height behavior; image-only duplicate provider marks; visible focus; horizontal scroll-into-view; pointer insertion; Left/Right/Tab/Enter/Escape; and screen-reader announcements of mode, identity, count, and action.
- Add chat-composer integration tests with the real emote interaction surface rather than mocking it away. Cover ordinary first-character activation without `:`, backward-compatible `:` activation, mention precedence, Enter requiring a second keypress to send after insertion/close, inline conversion on whitespace/newline/punctuation, caret-middle replacement, paste conversion, and preserved text around inline nodes.
- Run all interaction cases for Twitch and Kick serialization. Include Twitch native, Twitch third-party, Kick native markup, Kick third-party text, duplicate names, and unavailable subscriber emotes.
- Add a simultaneous-composer regression test proving two different Platform/Channel composers cannot leak emote catalogs, active queries, selection, eligibility, or inline identity into each other.
- Add preference hydration and migration tests proving existing users receive the default-on value, disabling affects automatic behavior only, `:` remains active, and the setting persists across restart-compatible storage hydration.
- Add animation tests proving typeahead requests a real static asset, inline animation follows the existing animation preference, and reduced motion keeps both composing surfaces static.
- Every new or rewritten test must carry a concise `// Guards:` comment naming the regression class it protects.
- Run the focused tests during red-green-refactor, then the full test suite, lint, type-check, and production build.
- Verify the running desktop app with Electron MCP only. Exercise Twitch and Kick chats, a narrow rail, multistream with two composers, pointer and keyboard selection, caret-middle editing, horizontal overflow, paste/Undo, reduced motion, empty/loading states, and the absence of composer/chat layout shifts. Capture intentional proof artifacts under `.scratch/images/`.

## Out of Scope

- Unicode emoji suggestions or conversion.
- Redesigning mention autocomplete beyond exclusive keyboard ownership and precedence.
- Redesigning the full native or third-party emote pickers.
- Changing idle quick-emote actions from send-now to insert.
- Purchasing subscriptions, changing subscriber eligibility, or adding new Platform entitlement APIs beyond what is required to determine current usability.
- Adding new emote providers or changing provider enablement preferences.
- Changing sent-message emote rendering, chat parsing, or moderation behavior except where outbound inline identity must preserve existing contracts.
- Copying Frost's touch-only interaction, unbounded substring search, final-word-only parsing, or provider-collision behavior.

## Further Notes

- Frost is a behavioral reference, not a code template. StreamFusion's desktop editor requires caret-aware selection, keyboard navigation, explicit history transactions, per-composer scoping, and accessibility beyond Frost's implementation.
- Approved mockups live beside this PRD under `designs/`: `suggestion-row-layouts.html` (contextual swap) and `suggestion-result-styles.html` (image-only results).
- The grill audit trail and resolved tradeoffs are in `notes.md` in this folder.
- Recommended next step: run `/to-issues` to split this PRD into independently grabbable vertical slices.
