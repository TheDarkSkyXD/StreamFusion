Status: done
Type: AFK

## Parent

[Multi Streams Layout Presets PRD](../prd.md)

## What to build

Harden the Add Stream flow for cap and duplicate edge cases. Add Stream remains a toolbar action. At `MultiviewCap`, the add affordance is disabled and explains the cap. Duplicate platform/channel additions are blocked with visible feedback such as "Already in multiview"; the app keeps one StreamSlot per platform/channel.

## Acceptance criteria

- [x] Add Stream is disabled when the current StreamSlot count reaches `MultiviewCap`.
- [x] The disabled affordance explains the cap with a tooltip or equivalent UI.
- [x] Duplicate platform/channel additions are blocked with visible inline or toast feedback.
- [x] Failed add attempts do not close the dialog as though a stream was added.
- [x] Add stream tests cover cap-reached and duplicate-add behavior.

## Blocked by

- [01-persist-multiview-layout-presets.md](01-persist-multiview-layout-presets.md)

## Comments

Closed 2026-07-07. Add Stream now disables at cap with explanatory title text, blocks duplicate platform/channel additions with inline feedback, and keeps the dialog open on failed attempts.

Evidence: `npm run typecheck`; `npm run lint`; `npm test` (348 files, 4561 tests); `npm run build`; Electron MCP verification confirmed Add Stream disabled at six seeded streams with `MultiviewCap` set to 6.
