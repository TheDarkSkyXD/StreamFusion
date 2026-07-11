# Use Static Thumbnails and Motion-Safe Inline Emotes

Status: ready-for-agent
Type: AFK
User stories: 33–35

## Parent

[Stream Emote Typeahead and Inline Draft Rendering](../prd.md)

## What to build

Give every supported provider a genuinely static composing thumbnail and apply the approved motion policy across the contextual row and Inline Stream Emotes. Typeahead never animates; inline draft emotes animate only when the existing animation preference permits and reduced motion is off.

## Acceptance criteria

- [ ] Twitch, Kick, 7TV, BTTV, and FFZ typeahead results resolve a genuinely static asset or frame rather than a CSS-paused animation.
- [ ] Typeahead thumbnails remain static regardless of the general animated-emote preference.
- [ ] Inline draft emotes animate only when the existing animated-emote preference is enabled and reduced motion is not requested.
- [ ] Reduced-motion mode makes both typeahead and inline composing surfaces genuinely static.
- [ ] Static fallback failure is handled without layout shift or a broken interactive control.
- [ ] Provider fixtures and focused component tests with `// Guards:` comments prove static URL/frame selection and motion-preference behavior.
- [ ] Focused tests, lint, type-check, and build pass; provider thumbnails and reduced-motion behavior are verified with Electron MCP.

## Blocked by

- [01 - Contextual `:` Stream Emote Row](./01-contextual-colon-emote-row.md)
- [04 - Render Completed Names as Inline Stream Emotes](./04-inline-stream-emote-conversion.md)

## Comments
