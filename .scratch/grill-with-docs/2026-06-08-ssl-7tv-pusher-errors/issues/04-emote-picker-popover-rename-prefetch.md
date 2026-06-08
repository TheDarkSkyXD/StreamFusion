Status: ready-for-agent

## Parent

PRD #62: https://github.com/TheDarkSkyXD/StreamFusion/issues/62

## What to build

Two changes to the emote picker, bundled because they touch the same file:

1. **Rename `EmoteDialog` to `EmotePickerPopover` and fix the ARIA role.** The component is not a modal dialog: it portals to body and renders at `position: fixed` anchored to an external ref, with no backdrop, no focus trap, and no escape-to-close-modal behaviour. The file's own header comment already calls it an "anchored-popover". Rename the file from `EmoteDialog.tsx` to `EmotePickerPopover.tsx`, rename the exported component and all of its supporting type/sub-component identifiers (`EmoteDialogProps`, `EmoteDialogScope`, `EmoteDialogPlatform`, `EmoteDialogItem`, `EmoteDialogItemProps`), and update every importer: `NativeEmoteButton.tsx`, `ThirdPartyEmoteButton.tsx`, `ChatInput.tsx` (mock + comment references), the test file imports, and the `vi.mock(...)` module path string in `ChatInput.test.tsx`. Also rename the test file to `EmotePickerPopover.test.tsx`. Change `data-testid="emote-dialog"` to `data-testid="emote-picker-popover"`. Drop the `role="dialog"` attribute and keep the existing `aria-label`. (If a role is required by an existing accessibility test, use `role="region"` as the non-modal fallback.)

2. **Tame the prefetch burst that triggers `net::ERR_CONNECTION_RESET 200 (OK)` from `cdn.7tv.app`.** Introduce a module-private constant `PREFETCH_BATCH_SIZE` with initial value 4, used by the `pump()` loop to bound the per-tick `new Image()` count (currently 16). Add an `img.onerror` handler that retries each failed URL exactly once after a short jittered delay (roughly 200ms plus jitter); the second failure is silent. Track retried URLs in a `Set<string>` so retries never loop; `img.onload` removes the URL from the set so the set does not grow unbounded over long sessions.

The bundle exists because User Story 16 of the PRD asks for one logical touch of this file rather than two adjacent renames of the same lines.

## Acceptance criteria

- [ ] File renamed from `apps/desktop/src/components/chat/EmoteDialog.tsx` to `apps/desktop/src/components/chat/EmotePickerPopover.tsx`. Test file renamed correspondingly.
- [ ] All in-file exports renamed: `EmoteDialog` → `EmotePickerPopover`, `EmoteDialogProps` → `EmotePickerPopoverProps`, `EmoteDialogScope` → `EmotePickerScope` (or equivalent), `EmoteDialogPlatform` → `EmotePickerPlatform`, `EmoteDialogItem` → `EmotePickerItem`, `EmoteDialogItemProps` → `EmotePickerItemProps`.
- [ ] All importers updated: `NativeEmoteButton.tsx`, `ThirdPartyEmoteButton.tsx`, `ChatInput.tsx`, and the relevant test files (including the `vi.mock` module path string).
- [ ] `data-testid="emote-dialog"` replaced with `data-testid="emote-picker-popover"`. Any test or selector that depended on the old testid is updated.
- [ ] `role="dialog"` removed from the popover container; `aria-label` retained.
- [ ] `PREFETCH_BATCH_SIZE` constant exists and is used by `pump()`; the per-tick image-construction count never exceeds it.
- [ ] `img.onerror` handler retries each URL at most once with a jittered delay; a `Set<string>` tracks retried URLs; `img.onload` removes the URL from the set.
- [ ] `EmotePickerPopover.test.tsx` gains a new test asserting that the prefetch effect never opens more than `PREFETCH_BATCH_SIZE` concurrent `new Image()` instances. Counted via a mock of `window.Image` that records constructions and resolves load synchronously.
- [ ] Manual verification: open the third-party emote picker on a Kick channel with many emotes. DevTools Network panel shows a sharp drop in `cdn.7tv.app` `ERR_CONNECTION_RESET` entries compared to the pre-fix baseline.
- [ ] Lint, type-check, and build pass. `grep -r EmoteDialog apps/desktop/src apps/desktop/tests` returns no matches.
- [ ] `/deslop` run on the diff before committing.

## Blocked by

None — can start immediately.

## Comments
