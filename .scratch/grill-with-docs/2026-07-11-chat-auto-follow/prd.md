# Reliable Chat Auto-Follow

## Problem Statement

While bottom-follow is active, a slow or wrapping newest chat message can be partially hidden below the visible chat viewport after Virtuoso finishes measuring its true height.

## Solution

Treat bottom-follow as user intent. Continue using Virtuoso `followOutput` for appends, then realign the measured last item to the viewport bottom whenever total list height changes. Preserve the existing direct scroller fallback when the virtualizer leaves a residual gap. Disable both corrections immediately after intentional wheel-up and restore them when the viewer returns to the latest message.

## User Stories

- As a viewer following live chat, I can read the newest message in full.
- As a viewer in fast chat, I remain at the true bottom without animated-scroll backlog.
- As a viewer reading older messages, delayed layout changes do not pull me back down.
- As a viewer returning to latest, bottom-follow resumes reliably.

## Implementation Decisions

- Corrections are instant, not animated.
- `totalListHeightChanged` is the post-measure signal.
- `scrollToIndex({ index: "LAST", align: "end", behavior: "auto" })` is the primary correction.
- Direct `scrollTop` alignment remains the bounded residual-gap fallback.
- Follow intent is disabled only by explicit user or configured pause input.

## Testing Decisions

- Cover delayed measured-height growth in slow chat.
- Cover consecutive rapid height changes.
- Cover wheel-up preventing snap-back.
- Cover return-to-latest restoring measured-height following.
- Cover the residual-gap fallback when virtualized alignment is insufficient.
- Verify visually in the running Electron app against GiantWaffle chat.

## Out of Scope

- Changing chat message presentation or density.
- Animated catch-up scrolling.
- Refactoring the wider chat component architecture.

## Further Notes

Virtuoso's `autoscrollToBottom()` listens for a future size-increase event and is not a reliable correction when called after `totalListHeightChanged` has already fired.
